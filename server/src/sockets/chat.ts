import { Server, Socket } from 'socket.io';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../middleware/auth';
import { AiContextMessage, buildSystemPrompt } from '../services/aiService';
import { runCodeBuddy, WorkspacePausedError } from '../services/containerService';
import { config } from '../config/env';
import {
  ChatMessage,
  JoinGroupPayload,
  JwtPayload,
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
      if (!content) return;

      const msg = await prisma.message.create({
        data: {
          type: 'PEER',
          classroomId: group.classroomId,
          groupId: group.id,
          documentId: payload.documentId,
          senderId: user.id,
          isAiReply: false,
          content,
        },
      });
      const out = toChatMessage(msg, user.name);
      io.to(roomOf(group.id)).emit('message:new', out);
      io.to(teacherRoomOf(group.classroomId)).emit('message:new', out);
    });

    // 学生向 AI 提问（学生↔AI）
    socket.on('ai:send', async (payload: SendAiMessagePayload) => {
      const group = await prisma.group.findUnique({ where: { id: payload.groupId } });
      if (!group) return;
      const content = (payload.content || '').trim();
      if (!content) return;

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
        },
      });
      const userOut = toChatMessage(userMsg, user.name);
      io.to(roomOf(group.id)).emit('message:new', userOut);
      io.to(teacherRoomOf(group.classroomId)).emit('message:new', userOut);

      // 2) 组装文献上下文与最近 AI 对话
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
        where: { groupId: group.id, type: 'AI' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const recentMessages: AiContextMessage[] = recent
        .reverse()
        .filter((m) => m.id !== userMsg.id)
        .map((m) => ({ role: m.isAiReply ? 'assistant' : 'user', content: m.content }));

      // 3) 检查学生是否已激活个人 AI Key
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
            content: '你的个人 AI 助手尚未激活：请在「AI 讨论」面板顶部输入教师发放的 Key，激活后即可开始讨论。',
          },
        });
        const hintOut = toChatMessage(hint, 'AI 助手');
        io.to(roomOf(group.id)).emit('message:new', hintOut);
        io.to(teacherRoomOf(group.classroomId)).emit('message:new', hintOut);
        return;
      }

      // 4) 组装 prompt 并路由到该学生的专属容器（CodeBuddy headless）
      socket.emit('ai:typing', { groupId: group.id });
      const docSnippet = (docContent ?? '').slice(0, config.ai.contextCharLimit);
      const promptParts: string[] = [buildSystemPrompt(docTitle, docSnippet)];
      for (const m of recentMessages) {
        promptParts.push(m.role === 'assistant' ? `[AI]：${m.content}` : `[学生]：${m.content}`);
      }
      promptParts.push(`[学生]：${content}\n\n请以 AI 讨论助手的身份直接回复上述最新问题。`);
      const prompt = promptParts.join('\n');

      let replyContent: string;
      try {
        replyContent = await runCodeBuddy(group.classroomId, user.id, prompt);
      } catch (err) {
        if (err instanceof WorkspacePausedError) {
          replyContent = '你的 AI 工作台已被教师暂停，暂时无法讨论。请联系教师重新开启。';
        } else {
          const e = err as Error & { stderr?: string };
          console.error('[socket] 容器 AI 调用失败:', e.message, e.stderr ? `stderr=${e.stderr}` : '');
          replyContent = '抱歉，你的 AI 助手暂时无法回复（容器启动或调用超时）。请稍后重试，若持续失败请联系教师。';
        }
      }

      // 5) 落库 AI 回复 + 记录使用量
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
        },
      });
      const aiOut = toChatMessage(aiMsg, 'AI 助手');
      io.to(roomOf(group.id)).emit('message:new', aiOut);
      io.to(teacherRoomOf(group.classroomId)).emit('message:new', aiOut);
    });
  });
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
    createdAt: msg.createdAt.toISOString(),
  };
}
