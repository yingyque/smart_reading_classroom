import { Server, Socket } from 'socket.io';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../middleware/auth';
import { AiContextMessage, buildSystemPrompt, describeChatImage } from '../services/aiService';
import {
  runCodeBuddy,
  WorkspacePausedError,
} from '../services/containerService';
import { QueueTimeoutError } from '../services/execQueue';
import { config } from '../config/env';
import { CHAT_FILE_NAME_RE, parseChatAttachments } from '../routes/chat';
import {
  ChatAttachment,
  ChatMessage,
  JoinGroupPayload,
  JwtPayload,
  MessageQuote,
  MessageType,
  RecallMessagePayload,
  Role,
  SendAiMessagePayload,
  SendPeerMessagePayload,
} from '../types';

interface SocketUser extends JwtPayload {
  name: string;
}

const roomOf = (groupId: string) => `group:${groupId}`;
const teacherRoomOf = (classroomId: string) => `teacher:${classroomId}`;
// 用户私有房间：AI 对话（学生↔AI 私聊）只发到这里与教师房间，不进小组房间
const userRoomOf = (userId: string) => `user:${userId}`;

// 有待处理 AI 请求（排队中或执行中）的学生：防止一个学生连发多条把全局队列占满
const pendingAiUsers = new Set<string>();

// 消息撤回时限（微信同款 2 分钟，仅发送者可撤回自己的小组消息）
const RECALL_WINDOW_MS = 2 * 60 * 1000;

// 校验聊天附件文件名（上传接口生成，防路径穿越）；非法返回 null
function validChatFile(name: unknown): string | null {
  return typeof name === 'string' && CHAT_FILE_NAME_RE.test(name) ? name : null;
}

// 附件是否为图片（AI 走视觉识别；文档附件无法解析内容，仅作提示）
function isImageFileName(name: string): boolean {
  return /\.(png|jpg|gif|webp)$/.test(name);
}

// 附件原始文件名：限长 200、去空白；未随附件或非法时为 null
function validOrigName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  return t ? t.slice(0, 200) : null;
}

// 单条消息附件数上限
const MAX_ATTACHMENTS = 5;

// 校验客户端发来的多附件载荷（files 数组优先；旧客户端单文件 filePath 回退兼容）
function validChatFiles(payload: { files?: unknown; filePath?: unknown; fileOrigName?: unknown }): ChatAttachment[] {
  const out: ChatAttachment[] = [];
  if (Array.isArray(payload.files)) {
    for (const item of payload.files.slice(0, MAX_ATTACHMENTS)) {
      if (!item || typeof item !== 'object') continue;
      const path = validChatFile((item as { path?: unknown }).path);
      if (!path) continue;
      out.push({ path, origName: validOrigName((item as { origName?: unknown }).origName) });
    }
  }
  // 旧缓存页面仍发单个 filePath：没有 files 时回退
  if (!out.length) {
    const legacy = validChatFile(payload.filePath);
    if (legacy) out.push({ path: legacy, origName: validOrigName(payload.fileOrigName) });
  }
  return out;
}

export function registerChatHandlers(io: Server): void {
  // 握手鉴权
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('未授权'));
    try {
      const payload = verifyToken(token);
      if (!payload) return next(new Error('令牌无效'));
      const user = await prisma.user.findUnique({ where: { id: payload.id } });
      if (!user) return next(new Error('用户不存在'));
      (socket.data as { user: SocketUser }).user = { id: user.id, role: user.role as Role, name: user.name };
      next();
    } catch (err) {
      console.error('[socket] 握手失败:', (err as Error).message);
      next(new Error('令牌无效'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user: SocketUser }).user;
    // 同一账号多端/多标签页都能收到自己的 AI 私聊
    socket.join(userRoomOf(user.id));

    // 加入小组房间（学生）
    socket.on('group:join', async (payload: JoinGroupPayload) => {
      const group = await prisma.group.findUnique({ where: { id: payload.groupId } });
      if (!group) return;
      socket.join(roomOf(payload.groupId));
    });

    // 教师监听整个课堂（接收所有组消息）
    socket.on('teacher:watch', async (payload: { classroomId: string }) => {
      if (user.role !== 'TEACHER') return;
      const classroom = await prisma.classroom.findUnique({ where: { id: payload.classroomId } });
      if (!classroom || classroom.teacherId !== user.id) return;
      socket.join(teacherRoomOf(payload.classroomId));
    });

    // 学生发送小组消息（学生↔学生）
    socket.on('peer:send', async (payload: SendPeerMessagePayload) => {
      const group = await prisma.group.findUnique({ where: { id: payload.groupId } });
      if (!group) return;
      const content = (payload.content || '').trim();
      const files = validChatFiles(payload);
      const primary = files[0] ?? null;
      // 引用快照：被引消息必须是同小组的 PEER 消息
      // （AI 对话是学生私聊，引用进小组会泄露内容，故不允许）
      let quote: MessageQuote | null = null;
      let quotedSenderId: string | null = null;
      if (payload.quoteId) {
        const src = await prisma.message.findUnique({
          where: { id: payload.quoteId },
          include: { sender: { select: { name: true } } },
        });
        if (src && src.type === 'PEER' && src.groupId === group.id && !src.recalledAt) {
          quotedSenderId = src.senderId;
          const srcFiles = parseChatAttachments(src.attachments, src.filePath, src.fileOrigName);
          const first = srcFiles[0];
          quote = {
            id: src.id,
            senderName: src.sender.name,
            content: src.content,
            hasImage: !!first && isImageFileName(first.path),
            fileName: first && !isImageFileName(first.path) ? first.origName : null,
          };
        }
      }
      // 纯附件 / 纯引用消息允许无文字
      if (!content && !files.length && !quote) return;

      const msg = await prisma.message.create({
        data: {
          type: 'PEER',
          classroomId: group.classroomId,
          groupId: group.id,
          documentId: payload.documentId,
          senderId: user.id,
          isAiReply: false,
          content,
          filePath: primary?.path ?? null,
          fileOrigName: primary?.origName ?? null,
          attachments: files.length ? (files as unknown as Prisma.InputJsonValue) : undefined,
          quote: quote ? JSON.stringify(quote) : null,
        },
      });
      const out = toChatMessage(msg, user.name);
      io.to(roomOf(group.id)).emit('message:new', out);
      io.to(teacherRoomOf(group.classroomId)).emit('message:new', out);

      // 提醒被引用的原作者（引用自己的消息不打扰）
      if (quote && quotedSenderId && quotedSenderId !== user.id) {
        io.to(userRoomOf(quotedSenderId)).emit('quote:notify', {
          messageId: msg.id,
          quotedMessageId: quote.id,
          groupId: group.id,
          classroomId: group.classroomId,
          fromName: user.name,
          snippet: quote.content
            ? quote.content.slice(0, 60)
            : quote.hasImage
              ? '[图片]'
              : quote.fileName
                ? `[文件] ${quote.fileName.slice(0, 40)}`
                : '[消息]',
        });
      }
    });

    // 学生撤回自己的小组消息（微信式：2 分钟内可撤回，撤回后内容与图片清除、仅留提示）
    socket.on('peer:recall', async (payload: RecallMessagePayload) => {
      const msg = await prisma.message.findUnique({ where: { id: payload.messageId } });
      if (!msg || msg.type !== 'PEER' || msg.senderId !== user.id || msg.recalledAt) return;
      if (Date.now() - msg.createdAt.getTime() > RECALL_WINDOW_MS) return;
      // 内容与附件一并清除：历史、分析、引用校验都不再可见（已落库的引用快照保留，与微信一致）
      const updated = await prisma.message.update({
        where: { id: msg.id },
        data: { recalledAt: new Date(), content: '', filePath: null, fileOrigName: null, attachments: Prisma.DbNull },
      });
      const out = toChatMessage(updated, user.name);
      io.to(roomOf(msg.groupId)).emit('message:recalled', out);
      io.to(teacherRoomOf(msg.classroomId)).emit('message:recalled', out);
    });

    // 学生向 AI 提问（学生↔AI）
    socket.on('ai:send', async (payload: SendAiMessagePayload) => {
      const group = await prisma.group.findUnique({ where: { id: payload.groupId } });
      if (!group) return;
      const content = (payload.content || '').trim();
      const files = validChatFiles(payload);
      const primary = files[0] ?? null;
      if (!content && !files.length) return;

      // 1) 落库并广播学生提问
      const userMsg = await prisma.message.create({
        data: {
          type: 'AI',
          classroomId: group.classroomId,
          groupId: group.id,
          documentId: payload.documentId,
          senderId: user.id,
          isAiReply: false,
          content,
          filePath: primary?.path ?? null,
          fileOrigName: primary?.origName ?? null,
          attachments: files.length ? (files as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
      const userOut = toChatMessage(userMsg, user.name);
      io.to(userRoomOf(user.id)).emit('message:new', userOut);
      io.to(teacherRoomOf(group.classroomId)).emit('message:new', userOut);

      // 2) 组装文献上下文与最近 AI 对话（仅本人对话，AI 私聊不进他人上下文）
      let docTitle: string | undefined;
      let docContent: string | undefined;
      if (payload.documentId) {
        const doc = await prisma.document.findUnique({ where: { id: payload.documentId } });
        if (doc) {
          docTitle = doc.title;
          docContent = doc.content;
        }
      }
      const recent = await prisma.message.findMany({
        where: { groupId: group.id, type: 'AI', senderId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const recentMessages: AiContextMessage[] = recent
        .reverse()
        .filter((m) => m.id !== userMsg.id)
        .map((m) => ({
          role: m.isAiReply ? 'assistant' : 'user',
          content:
            m.filePath && !m.content
              ? isImageFileName(m.filePath)
                ? '[图片]'
                : '[文件]'
              : m.content,
        }));

      // 3) 检查学生是否已配置个人 AI Key（统一共享 Key 已在注册/后台批量写入）
      const me = await prisma.user.findUnique({ where: { id: user.id } });
      if (!me?.aiKey) {
        const hint = await prisma.message.create({
          data: {
            type: 'AI',
            classroomId: group.classroomId,
            groupId: group.id,
            documentId: payload.documentId,
            senderId: user.id,
            isAiReply: true,
            content: '你的 AI 助手尚未就绪，暂时无法讨论。请联系教师协助。',
          },
        });
        const hintOut = toChatMessage(hint, 'AI 助手');
        io.to(userRoomOf(user.id)).emit('message:new', hintOut);
        io.to(teacherRoomOf(group.classroomId)).emit('message:new', hintOut);
        return;
      }

      // 4) 单用户防刷：上一问还在排队/执行中时直接提示，不占全局并发坑
      if (pendingAiUsers.has(user.id)) {
        const busyHint = await prisma.message.create({
          data: {
            type: 'AI',
            classroomId: group.classroomId,
            groupId: group.id,
            documentId: payload.documentId,
            senderId: user.id,
            isAiReply: true,
            content: '你的上一个问题还在处理中，请等回复后再提新问题。',
          },
        });
        const busyOut = toChatMessage(busyHint, 'AI 助手');
        io.to(userRoomOf(user.id)).emit('message:new', busyOut);
        io.to(teacherRoomOf(group.classroomId)).emit('message:new', busyOut);
        return;
      }

      // 5) 组装 prompt 并路由到该学生的专属容器（CodeBuddy headless）
      io.to(userRoomOf(user.id)).emit('ai:typing', { groupId: group.id });
      const docSnippet = (docContent ?? '').slice(0, config.ai.contextCharLimit);
      const promptParts: string[] = [buildSystemPrompt(docTitle, docSnippet)];
      for (const m of recentMessages) {
        promptParts.push(m.role === 'assistant' ? `[AI]：${m.content}` : `[学生]：${m.content}`);
      }
      // 随消息带附件时：图片由 server 端先用视觉模型转成文字描述写进 prompt；
      // 文档附件无法解析内容，仅如实告知 AI 引导学生描述要点。
      // 不再走「docker cp 进容器 + Read 工具看图」：上游网关拒绝 tool 结果里的
      // 图片块（400 messages[3].content[0].type），该路径对所有模型都不可用。
      let attachNote = '';
      if (files.length) {
        const notes: string[] = [];
        // 逐个调用视觉接口（避免并发触发限流）
        for (const f of files) {
          if (isImageFileName(f.path)) {
            const desc = await describeChatImage(f.path);
            notes.push(
              desc
                ? `图片《${f.origName ?? '图片'}》内容描述：\n${desc}`
                : `图片《${f.origName ?? '图片'}》内容暂时无法识别`,
            );
          } else {
            notes.push(`文件《${f.origName ?? '未命名文件'}》（你无法直接读取该文件的内容，如与问题相关，请引导学生口述文件中的要点）`);
          }
        }
        attachNote = `\n（学生随消息发送了 ${files.length} 个附件：\n${notes.join('\n')}\n请结合附件内容与学生的问题进行讨论。）`;
      }
      promptParts.push(`[学生]：${content}${attachNote}\n\n请以 AI 讨论助手的身份直接回复上述最新问题。`);
      const prompt = promptParts.join('\n');

      let replyContent: string;
      let replyUsage: { inputTokens: number; outputTokens: number } | null = null;
      pendingAiUsers.add(user.id);
      try {
        const cbResult = await runCodeBuddy(group.classroomId, user.id, prompt, (pos) => {
          if (pos > 0) {
            // 排队中：告知位次（只发给提问的学生本人）
            io.to(userRoomOf(user.id)).emit('ai:queued', { groupId: group.id, position: pos });
          } else {
            // 获得执行权：从「排队中」切回「思考中」
            io.to(userRoomOf(user.id)).emit('ai:typing', { groupId: group.id });
          }
        });
        replyContent = cbResult.text;
        replyUsage = cbResult.usage;
      } catch (err) {
        if (err instanceof WorkspacePausedError) {
          replyContent = '你的 AI 工作台已被教师暂停，暂时无法讨论。请联系教师重新开启。';
        } else if (err instanceof QueueTimeoutError) {
          replyContent = '当前提问人数较多，你的问题还在排队中。请稍后重新发送试试。';
        } else {
          const e = err as Error & { stderr?: string; isAiError?: boolean };
          console.error('[socket] 容器 AI 调用失败:', e.message, e.stderr ? `stderr=${e.stderr}` : '');
          // 把 codebuddy 的真实错误（额度/鉴权/模型不可用）直接透传给用户，便于排查
          replyContent = e.isAiError && e.message
            ? e.message
            : '抱歉，你的 AI 助手暂时无法回复（容器启动或调用超时）。请稍后重试，若持续失败请联系教师。';
        }
      } finally {
        pendingAiUsers.delete(user.id);
      }

      // 6) 落库 AI 回复 + 记录使用量
      const aiMsg = await prisma.message.create({
        data: {
          type: 'AI',
          classroomId: group.classroomId,
          groupId: group.id,
          documentId: payload.documentId,
          senderId: user.id,
          isAiReply: true,
          content: replyContent,
        },
      });
      await prisma.aiUsage.create({
        data: {
          classroomId: group.classroomId,
          groupId: group.id,
          userId: user.id,
          documentId: payload.documentId,
          promptChars: prompt.length,
          replyChars: replyContent.length,
          inputTokens: replyUsage?.inputTokens ?? 0,
          outputTokens: replyUsage?.outputTokens ?? 0,
        },
      });
      const aiOut = toChatMessage(aiMsg, 'AI 助手');
      io.to(userRoomOf(user.id)).emit('message:new', aiOut);
      io.to(teacherRoomOf(group.classroomId)).emit('message:new', aiOut);
    });
  });
}

// 解析引用快照 JSON（坏数据按无引用处理）
function parseQuote(raw: string | null): MessageQuote | null {
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as MessageQuote;
    return typeof q.id === 'string' && typeof q.senderName === 'string' ? q : null;
  } catch {
    return null;
  }
}

function toChatMessage(
  msg: {
    id: string;
    type: string;
    classroomId: string;
    groupId: string;
    documentId: string | null;
    senderId: string;
    isAiReply: boolean;
    content: string;
    filePath: string | null;
    fileOrigName: string | null;
    attachments: Prisma.JsonValue | null;
    quote: string | null;
    recalledAt: Date | null;
    createdAt: Date;
  },
  senderName: string,
): ChatMessage {
  return {
    id: msg.id,
    type: msg.type as MessageType,
    classroomId: msg.classroomId,
    groupId: msg.groupId,
    documentId: msg.documentId,
    senderId: msg.senderId,
    senderName: msg.isAiReply ? 'AI 助手' : senderName,
    isAiReply: msg.isAiReply,
    content: msg.content,
    filePath: msg.filePath,
    fileOrigName: msg.fileOrigName,
    attachments: parseChatAttachments(msg.attachments, msg.filePath, msg.fileOrigName),
    quote: parseQuote(msg.quote),
    recalledAt: msg.recalledAt ? msg.recalledAt.toISOString() : null,
    createdAt: msg.createdAt.toISOString(),
  };
}
