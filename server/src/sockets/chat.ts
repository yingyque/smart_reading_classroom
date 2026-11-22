import { Server, Socket } from 'socket.io';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../middleware/auth';
import { AiContextMessage, buildSystemPrompt, describeChatImage } from '../services/aiService';
import {
  runCodeBuddy,
  WorkspacePausedError,
} from '../services/containerService';
import { QueueTimeoutError } from '../services/execQueue';
import { config } from '../config/env';
import { CHAT_IMAGE_NAME_RE } from '../routes/chat';
import {
  ChatMessage,
  JoinGroupPayload,
  JwtPayload,
  MessageQuote,
  MessageType,
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

// 校验聊天图片文件名（上传接口生成，防路径穿越）；非法返回 null
function validChatImage(name: unknown): string | null {
  return typeof name === 'string' && CHAT_IMAGE_NAME_RE.test(name) ? name : null;
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
      const imagePath = validChatImage(payload.imagePath);
      // 引用快照：被引消息必须是同小组的 PEER 消息
      // （AI 对话是学生私聊，引用进小组会泄露内容，故不允许）
      let quote: MessageQuote | null = null;
      let quotedSenderId: string | null = null;
      if (payload.quoteId) {
        const src = await prisma.message.findUnique({
          where: { id: payload.quoteId },
          include: { sender: { select: { name: true } } },
        });
        if (src && src.type === 'PEER' && src.groupId === group.id) {
          quotedSenderId = src.senderId;
          quote = {
            id: src.id,
            senderName: src.sender.name,
            content: src.content,
            hasImage: !!src.imagePath,
          };
        }
      }
      // 纯图片 / 纯引用消息允许无文字
      if (!content && !imagePath && !quote) return;

      const msg = await prisma.message.create({
        data: {
          type: 'PEER',
          classroomId: group.classroomId,
          groupId: group.id,
          documentId: payload.documentId,
          senderId: user.id,
          isAiReply: false,
          content,
          imagePath: imagePath ?? null,
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
          snippet: quote.content ? quote.content.slice(0, 60) : '[图片]',
        });
      }
    });

    // 学生向 AI 提问（学生↔AI）
    socket.on('ai:send', async (payload: SendAiMessagePayload) => {
      const group = await prisma.group.findUnique({ where: { id: payload.groupId } });
      if (!group) return;
      const content = (payload.content || '').trim();
      const imagePath = validChatImage(payload.imagePath);
      if (!content && !imagePath) return;

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
          imagePath: imagePath ?? null,
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
          content: m.imagePath && !m.content ? '[图片]' : m.content,
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
      // 随消息带图时：server 端先用视觉模型把图片转成文字描述，再写进 prompt。
      // 不再走「docker cp 进容器 + Read 工具看图」：上游网关拒绝 tool 结果里的
      // 图片块（400 messages[3].content[0].type），该路径对所有模型都不可用。
      let imageNote = '';
      if (imagePath) {
        const desc = await describeChatImage(imagePath);
        imageNote = desc
          ? `\n（学生随消息发送了一张图片，图片内容描述如下：\n${desc}\n请结合图片内容与学生的问题进行讨论。）`
          : '\n（学生随消息发送了一张图片，但图片内容暂时无法识别，请告知学生稍后重试。）';
      }
      promptParts.push(`[学生]：${content}${imageNote}\n\n请以 AI 讨论助手的身份直接回复上述最新问题。`);
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
    imagePath: string | null;
    quote: string | null;
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
    imagePath: msg.imagePath,
    quote: parseQuote(msg.quote),
    createdAt: msg.createdAt.toISOString(),
  };
}
