import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authRequired, AuthedRequest } from '../middleware/auth';
import { buildAnalytics } from '../services/analyticsService';

const router = Router();

// 简单的短 TTL 缓存，避免频繁全量聚合
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 5000;

// 课堂分析看板数据
router.get('/:classroomId', authRequired, async (req: AuthedRequest, res: Response) => {
  const key = req.params.classroomId;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return res.json(hit.data);
  }
  const data = await buildAnalytics(key);
  cache.set(key, { at: Date.now(), data });
  return res.json(data);
});

// 某小组历史消息（含 AI），支持回看
router.get('/:classroomId/messages/:groupId', authRequired, async (req: AuthedRequest, res: Response) => {
  const messages = await prisma.message.findMany({
    where: { classroomId: req.params.classroomId, groupId: req.params.groupId },
    include: { sender: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(
    messages.map((m) => ({
      id: m.id,
      type: m.type,
      classroomId: m.classroomId,
      groupId: m.groupId,
      documentId: m.documentId,
      senderId: m.senderId,
      senderName: m.sender.name,
      isAiReply: m.isAiReply,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

export default router;
