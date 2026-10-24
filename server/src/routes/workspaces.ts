import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authRequired, roleRequired, AuthedRequest } from '../middleware/auth';
import {
  activateKey,
  ensureWorkspace,
  getByUser,
  listByClassroom,
  pauseWorkspace,
  resumeWorkspace,
  setClassroomPaused,
} from '../services/containerService';
import { decryptKey, maskKey } from '../services/cryptoService';

const router = Router();

// 校验教师对该课堂的所有权
async function assertClassroomOwner(classroomId: string, teacherId: string): Promise<boolean> {
  const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
  return Boolean(classroom && classroom.teacherId === teacherId);
}

// 学生提交/更新 AI Key（激活个人 AI 助手）
router.post('/:classroomId/key', authRequired, async (req: AuthedRequest, res: Response) => {
  const { key } = req.body as { key?: string };
  const plain = (key ?? '').trim();
  if (!plain || plain.length < 8) {
    return res.status(400).json({ error: '请输入有效的 AI Key' });
  }

  // 校验学生确实加入了该课堂（有 Workspace 或小组成员记录）
  const classroomId = req.params.classroomId;
  const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom) return res.status(404).json({ error: '课堂不存在' });

  await ensureWorkspace(classroomId, req.user!.id);
  try {
    await activateKey(req.user!.id, plain);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === '该 AI Key 已被其他学生使用') {
      return res.status(409).json({ error: msg });
    }
    return res.status(500).json({ error: msg || 'Key 激活失败' });
  }

  const state = await getByUser(classroomId, req.user!.id);
  return res.json({ ...state, keyMask: maskKey(plain) });
});

// 学生查询自己在某课堂的工作台状态
router.get('/:classroomId/me', authRequired, async (req: AuthedRequest, res: Response) => {
  const state = await getByUser(req.params.classroomId, req.user!.id);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const keyMask = user?.aiKey ? maskKey(decryptKey(user.aiKey)) : null;
  return res.json({ ...state, keyMask });
});

// 教师暂停/开启某个学生的容器
async function setPaused(req: AuthedRequest, res: Response, paused: boolean): Promise<void> {
  const { classroomId, workspaceId } = req.params;
  if (!(await assertClassroomOwner(classroomId, req.user!.id))) {
    res.status(403).json({ error: '无权操作此课堂' });
    return;
  }
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws || ws.classroomId !== classroomId) {
    res.status(404).json({ error: '工作台不存在' });
    return;
  }
  try {
    if (paused) {
      await pauseWorkspace(ws.id);
    } else {
      await resumeWorkspace(ws.id);
    }
    res.json({ id: ws.id, status: paused ? 'PAUSED' : 'RUNNING' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || '操作失败' });
  }
}

router.post('/:classroomId/:workspaceId/pause', authRequired, roleRequired('TEACHER'), (req: AuthedRequest, res: Response) => setPaused(req, res, true));
router.post('/:classroomId/:workspaceId/resume', authRequired, roleRequired('TEACHER'), (req: AuthedRequest, res: Response) => setPaused(req, res, false));

// 教师批量暂停/开启整个课堂的容器
router.post('/:classroomId/pause-all', authRequired, roleRequired('TEACHER'), async (req: AuthedRequest, res: Response) => {
  const classroomId = req.params.classroomId;
  const paused = (req.body as { paused?: boolean })?.paused !== false;
  if (!(await assertClassroomOwner(classroomId, req.user!.id))) {
    return res.status(403).json({ error: '无权操作此课堂' });
  }
  try {
    const count = await setClassroomPaused(classroomId, paused);
    return res.json({ affected: count, paused });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message || '操作失败' });
  }
});

// 教师查看某课堂的全部 AI 容器
router.get('/:classroomId', authRequired, roleRequired('TEACHER'), async (req: AuthedRequest, res: Response) => {
  const classroomId = req.params.classroomId;
  const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom || classroom.teacherId !== req.user!.id) {
    return res.status(403).json({ error: '无权查看此课堂' });
  }
  const containers = await listByClassroom(classroomId);
  return res.json({
    total: containers.length,
    running: containers.filter((c) => c.status === 'RUNNING').length,
    containers,
  });
});

export default router;
