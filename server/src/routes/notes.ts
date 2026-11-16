import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authRequired, roleRequired, AuthedRequest } from '../middleware/auth';

const router = Router();

// 学生是否已加入课堂：GroupMember ∪ Workspace 二者其一即算（与 classroom.ts 的口径一致）
async function isClassroomMember(classroomId: string, userId: string): Promise<boolean> {
  const [ws, member] = await Promise.all([
    prisma.workspace.findFirst({ where: { classroomId, userId } }),
    prisma.groupMember.findFirst({ where: { userId, group: { classroomId } } }),
  ]);
  return !!(ws || member);
}

// 学生本人笔记列表（仅本人可见；时间线按 updatedAt 倒序）
router.get('/:classroomId/mine', authRequired, async (req: AuthedRequest, res: Response) => {
  const { classroomId } = req.params;
  if (!(await isClassroomMember(classroomId, req.user!.id))) {
    return res.status(403).json({ error: '你尚未加入此课堂' });
  }
  const notes = await prisma.note.findMany({
    where: { classroomId, userId: req.user!.id },
    include: { document: { select: { title: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return res.json(
    notes.map((n) => ({
      id: n.id,
      documentId: n.documentId,
      documentTitle: n.document?.title ?? null,
      content: n.content,
      kind: n.kind,
      quote: n.quote,
      page: n.page,
      rects: n.rects,
      color: n.color,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  );
});

// 高亮选区矩形校验：JSON 数组，每项为 0~1 的数值 x/y/w/h
function parseHighlightRects(raw: unknown): { x: number; y: number; w: number; h: number }[] | null {
  if (typeof raw !== 'string') return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || !arr.length || arr.length > 500) return null;
  for (const it of arr) {
    if (typeof it !== 'object' || it === null) return null;
    const { x, y, w, h } = it as Record<string, unknown>;
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  }
  return arr as { x: number; y: number; w: number; h: number }[];
}

const HIGHLIGHT_COLORS = new Set(['blue', 'green', 'yellow']);

// 学生新增笔记（自动关联当前正在阅读的文献）
router.post('/:classroomId', authRequired, async (req: AuthedRequest, res: Response) => {
  const { classroomId } = req.params;
  if (!(await isClassroomMember(classroomId, req.user!.id))) {
    return res.status(403).json({ error: '你尚未加入此课堂' });
  }
  const {
    content,
    documentId,
    kind,
    quote,
    page,
    rects,
    color,
  } = req.body as {
    content?: unknown;
    documentId?: unknown;
    kind?: unknown;
    quote?: unknown;
    page?: unknown;
    rects?: unknown;
    color?: unknown;
  };
  const isHighlight = kind === 'highlight';
  // 普通笔记必须有内容；高亮笔记 content 是评论、允许为空（以 quote 为正文）
  if (!isHighlight && (typeof content !== 'string' || !content.trim())) {
    return res.status(400).json({ error: '笔记内容不能为空' });
  }
  if (isHighlight) {
    if (typeof quote !== 'string' || !quote.trim()) {
      return res.status(400).json({ error: '高亮内容不能为空' });
    }
    if (typeof documentId !== 'string') {
      return res.status(400).json({ error: '高亮必须关联文献' });
    }
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: '页码参数错误' });
    }
    if (!parseHighlightRects(rects)) {
      return res.status(400).json({ error: '高亮区域数据错误' });
    }
    if (typeof color !== 'string' || !HIGHLIGHT_COLORS.has(color)) {
      return res.status(400).json({ error: '高亮颜色错误' });
    }
  }
  // 若关联文献，必须是本课堂的文献（防跨课堂注入）
  if (documentId != null) {
    if (typeof documentId !== 'string') {
      return res.status(400).json({ error: '参数错误' });
    }
    const doc = await prisma.document.findFirst({
      where: { id: documentId, classroomId },
      select: { id: true },
    });
    if (!doc) return res.status(400).json({ error: '文献不存在' });
  }
  const note = await prisma.note.create({
    data: {
      classroomId,
      userId: req.user!.id,
      documentId: typeof documentId === 'string' ? documentId : null,
      content: typeof content === 'string' ? content.trim() : '',
      kind: isHighlight ? 'highlight' : 'text',
      quote: isHighlight ? (quote as string).trim() : null,
      page: isHighlight ? (page as number) : null,
      rects: isHighlight ? (rects as string) : null,
      color: isHighlight ? (color as string) : null,
    },
  });
  return res.json({ id: note.id, createdAt: note.createdAt });
});

// 学生修改自己的笔记（高亮笔记的 content 是评论，允许清空）
router.put('/:classroomId/:noteId', authRequired, async (req: AuthedRequest, res: Response) => {
  const { classroomId, noteId } = req.params;
  const { content } = req.body as { content?: unknown };
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || note.classroomId !== classroomId) {
    return res.status(404).json({ error: '笔记不存在' });
  }
  if (note.userId !== req.user!.id) {
    return res.status(403).json({ error: '只能修改自己的笔记' });
  }
  if (typeof content !== 'string' || (note.kind === 'text' && !content.trim())) {
    return res.status(400).json({ error: '笔记内容不能为空' });
  }
  await prisma.note.update({
    where: { id: note.id },
    data: { content: content.trim() },
  });
  return res.json({ ok: true });
});

// 学生删除自己的笔记
router.delete('/:classroomId/:noteId', authRequired, async (req: AuthedRequest, res: Response) => {
  const { classroomId, noteId } = req.params;
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || note.classroomId !== classroomId) {
    return res.status(404).json({ error: '笔记不存在' });
  }
  if (note.userId !== req.user!.id) {
    return res.status(403).json({ error: '只能删除自己的笔记' });
  }
  await prisma.note.delete({ where: { id: note.id } });
  return res.json({ ok: true });
});

// 教师查看全课堂学生笔记（分析看板用，只读）
router.get(
  '/:classroomId',
  authRequired,
  roleRequired('TEACHER'),
  async (req: AuthedRequest, res: Response) => {
    const { classroomId } = req.params;
    const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
    if (!classroom || classroom.teacherId !== req.user!.id) {
      return res.status(403).json({ error: '无权操作此课堂' });
    }
    const notes = await prisma.note.findMany({
      where: { classroomId },
      include: {
        user: { select: { id: true, name: true } },
        document: { select: { title: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { updatedAt: 'desc' }],
    });
    return res.json(
      notes.map((n) => ({
        id: n.id,
        userId: n.user.id,
        studentName: n.user.name,
        documentId: n.documentId,
        documentTitle: n.document?.title ?? null,
        content: n.content,
        kind: n.kind,
        quote: n.quote,
        page: n.page,
        rects: n.rects,
        color: n.color,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    );
  },
);

export default router;
