import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authRequired, roleRequired, AuthedRequest } from '../middleware/auth';
import { ensureWorkspace } from '../services/containerService';

const router = Router();

// 生成 6 位课堂码
function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// 教师创建课堂
router.post('/', authRequired, roleRequired('TEACHER'), async (req: AuthedRequest, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name) return res.status(400).json({ error: '请填写课堂名称' });

  let code = genCode();
  // 避免极小概率冲突
  while (await prisma.classroom.findUnique({ where: { code } })) {
    code = genCode();
  }

  const classroom = await prisma.classroom.create({
    data: { name, code, teacherId: req.user!.id },
  });
  return res.json(classroom);
});

// 教师查看自己的课堂列表
router.get('/mine', authRequired, roleRequired('TEACHER'), async (req: AuthedRequest, res: Response) => {
  const classrooms = await prisma.classroom.findMany({
    where: { teacherId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { groups: true, documents: true } } },
  });
  return res.json(classrooms);
});

// 学生凭课堂码加入
router.post('/join', authRequired, async (req: AuthedRequest, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code) return res.status(400).json({ error: '请输入课堂码' });

  const classroom = await prisma.classroom.findUnique({
    where: { code: code.toUpperCase() },
    include: { groups: { include: { members: true } } },
  });
  if (!classroom) return res.status(404).json({ error: '课堂码无效' });

  // 为该学生创建专属 AI 工作台容器（幂等；失败不阻断加入流程）
  ensureWorkspace(classroom.id, req.user!.id).catch((err) => {
    console.error('[classroom] 创建工作台容器失败:', (err as Error).message);
  });

  // 已在某组则直接返回
  const existing = await prisma.groupMember.findFirst({
    where: { userId: req.user!.id, group: { classroomId: classroom.id } },
    include: {
      group: { include: { members: { include: { user: { select: { id: true, name: true } } } } } },
    },
  });
  if (existing) {
    return res.json({ classroom: { id: classroom.id, name: classroom.name }, group: existing.group });
  }

  // 未分组阶段：先登记为无组成员（放入临时"待分组"集合）。
  // 这里策略：若已有分组，则加入人数最少的组；否则提示等待教师分组。
  if (classroom.groups.length > 0) {
    const target = classroom.groups.reduce((min, g) =>
      g.members.length < min.members.length ? g : min,
    );
    await prisma.groupMember.create({
      data: { groupId: target.id, userId: req.user!.id },
    });
    const fullGroup = await prisma.group.findUnique({
      where: { id: target.id },
      include: { members: { include: { user: { select: { id: true, name: true } } } } },
    });
    return res.json({ classroom: { id: classroom.id, name: classroom.name }, group: fullGroup });
  }

  return res.json({
    classroom: { id: classroom.id, name: classroom.name },
    group: null,
    message: '已加入课堂，等待教师分组',
  });
});

// 教师设定组数并随机分组（对课堂内所有已加入学生重新随机分配）
router.post('/:id/group', authRequired, roleRequired('TEACHER'), async (req: AuthedRequest, res: Response) => {
  const classroomId = req.params.id;
  const { groupCount } = req.body as { groupCount?: number };
  const count = Number(groupCount);
  if (!count || count < 1) return res.status(400).json({ error: '请填写有效的组数' });

  const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom || classroom.teacherId !== req.user!.id) {
    return res.status(403).json({ error: '无权操作此课堂' });
  }

  // 收集课堂内所有学生：已分组的成员 + 已创建工作台容器的加入者
  // （学生在教师首次分组前加入时没有 GroupMember 记录，需从 Workspace 补齐）
  const [existingMembers, workspaceUsers] = await Promise.all([
    prisma.groupMember.findMany({
      where: { group: { classroomId } },
      select: { userId: true },
    }),
    prisma.workspace.findMany({
      where: { classroomId },
      select: { userId: true },
    }),
  ]);
  const studentIds = Array.from(
    new Set([...existingMembers, ...workspaceUsers].map((m) => m.userId)),
  );

  // 清除旧分组
  await prisma.group.deleteMany({ where: { classroomId } });

  // 创建新组
  const groups = [];
  for (let i = 0; i < count; i++) {
    const g = await prisma.group.create({
      data: { name: `第 ${i + 1} 组`, classroomId },
    });
    groups.push(g);
  }

  // 随机打乱学生并轮流分配，保证均衡
  const shuffled = studentIds.sort(() => Math.random() - 0.5);
  for (let i = 0; i < shuffled.length; i++) {
    await prisma.groupMember.create({
      data: { groupId: groups[i % count].id, userId: shuffled[i] },
    });
  }

  await prisma.classroom.update({ where: { id: classroomId }, data: { groupCount: count } });

  const result = await prisma.group.findMany({
    where: { classroomId },
    include: { members: { include: { user: { select: { id: true, name: true } } } } },
  });
  return res.json(result);
});

// 课堂详情（含分组名单）—教师用
router.get('/:id', authRequired, async (req: AuthedRequest, res: Response) => {
  const classroom = await prisma.classroom.findUnique({
    where: { id: req.params.id },
    include: {
      groups: { include: { members: { include: { user: { select: { id: true, name: true } } } } } },
      documents: { select: { id: true, title: true, fileType: true, createdAt: true } },
    },
  });
  if (!classroom) return res.status(404).json({ error: '课堂不存在' });
  return res.json(classroom);
});

// 学生查询自己在某课堂的小组
router.get('/:id/my-group', authRequired, async (req: AuthedRequest, res: Response) => {
  const member = await prisma.groupMember.findFirst({
    where: { userId: req.user!.id, group: { classroomId: req.params.id } },
    include: {
      group: {
        include: { members: { include: { user: { select: { id: true, name: true } } } } },
      },
    },
  });
  if (!member) return res.status(404).json({ error: '尚未分组' });
  return res.json(member.group);
});

export default router;
