import { randomBytes } from 'crypto';
import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authRequired, roleRequired, AuthedRequest } from '../middleware/auth';
import { buildAnalytics } from '../services/analyticsService';
import {
  inspectRuntime,
  listByClassroom,
  pauseWorkspace,
  removeWorkspace,
  resumeWorkspace,
  setClassroomPaused,
} from '../services/containerService';

// 管理员端：全局视角查看教师、课堂与各课堂下的 AI 工作台容器
const router = Router();

router.use(authRequired, roleRequired('ADMIN'));

// 各课堂的容器汇总：总数 / 各状态数 / 已激活 Key 数
async function containerSummaryByClassroom(): Promise<
  Map<string, { total: number; running: number; paused: number; created: number; keyActivated: number }>
> {
  const empty = () => ({ total: 0, running: 0, paused: 0, created: 0, keyActivated: 0 });
  const map = new Map<string, ReturnType<typeof empty>>();

  const [statusRows, keyRows] = await Promise.all([
    prisma.workspace.groupBy({ by: ['classroomId', 'status'], _count: { _all: true } }),
    prisma.workspace.findMany({
      where: { user: { aiKey: { not: null } } },
      select: { classroomId: true },
    }),
  ]);

  for (const row of statusRows) {
    const cur = map.get(row.classroomId) ?? empty();
    cur.total += row._count._all;
    if (row.status === 'RUNNING') cur.running += row._count._all;
    else if (row.status === 'PAUSED') cur.paused += row._count._all;
    else cur.created += row._count._all;
    map.set(row.classroomId, cur);
  }
  for (const row of keyRows) {
    const cur = map.get(row.classroomId) ?? empty();
    cur.keyActivated += 1;
    map.set(row.classroomId, cur);
  }
  return map;
}

// 某课堂的全部学生 id：GroupMember ∪ Workspace
// （学生在教师首次分组前加入时没有 GroupMember 记录，需由 Workspace 补齐，同 classroom.ts 的处理）
async function studentIdsOfClassroom(classroomId: string): Promise<string[]> {
  const [members, workspaces] = await Promise.all([
    prisma.groupMember.findMany({
      where: { group: { classroomId } },
      select: { userId: true },
    }),
    prisma.workspace.findMany({ where: { classroomId }, select: { userId: true } }),
  ]);
  return Array.from(new Set([...members, ...workspaces].map((m) => m.userId)));
}

// 统计失败不应挡住详情展示
async function safeAnalytics(classroomId: string) {
  try {
    return await buildAnalytics(classroomId);
  } catch (err) {
    console.error('[admin] analytics 失败:', (err as Error).message);
    return null;
  }
}

// 总览统计
router.get('/overview', async (_req: AuthedRequest, res: Response) => {
  const [teacherCount, studentCount, classroomCount, containerTotal, runningCount, pausedCount, keyCount] =
    await Promise.all([
      prisma.user.count({ where: { role: 'TEACHER' } }),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.classroom.count(),
      prisma.workspace.count(),
      prisma.workspace.count({ where: { status: 'RUNNING' } }),
      prisma.workspace.count({ where: { status: 'PAUSED' } }),
      prisma.workspace.count({ where: { user: { aiKey: { not: null } } } }),
    ]);

  return res.json({
    teacherCount,
    studentCount,
    classroomCount,
    containers: {
      total: containerTotal,
      running: runningCount,
      paused: pausedCount,
      created: containerTotal - runningCount - pausedCount,
      keyActivated: keyCount,
    },
  });
});

// 全部教师（含其课堂数与名下容器情况）
router.get('/teachers', async (_req: AuthedRequest, res: Response) => {
  const [teachers, summary] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'TEACHER' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        taughtClassrooms: { select: { id: true } },
      },
    }),
    containerSummaryByClassroom(),
  ]);

  const zero = { total: 0, running: 0, paused: 0, created: 0, keyActivated: 0 };
  return res.json(
    teachers.map((t) => {
      const agg = t.taughtClassrooms.reduce(
        (acc, c) => {
          const s = summary.get(c.id) ?? zero;
          acc.total += s.total;
          acc.running += s.running;
          acc.paused += s.paused;
          acc.created += s.created;
          acc.keyActivated += s.keyActivated;
          return acc;
        },
        { ...zero },
      );
      return {
        id: t.id,
        name: t.name,
        email: t.email,
        createdAt: t.createdAt,
        classroomCount: t.taughtClassrooms.length,
        containers: agg,
      };
    }),
  );
});

// 全部学生（含加入课堂数与容器状态）
router.get('/students', async (_req: AuthedRequest, res: Response) => {
  const [students, memberships, workspaces] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'STUDENT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, aiKey: true, createdAt: true },
    }),
    prisma.groupMember.findMany({
      select: { userId: true, group: { select: { classroomId: true } } },
    }),
    prisma.workspace.findMany({ select: { userId: true, classroomId: true, status: true } }),
  ]);

  const classroomsByUser = new Map<string, Set<string>>();
  const containersByUser = new Map<string, { total: number; running: number; paused: number }>();

  for (const m of memberships) {
    const set = classroomsByUser.get(m.userId) ?? new Set<string>();
    set.add(m.group.classroomId);
    classroomsByUser.set(m.userId, set);
  }
  for (const w of workspaces) {
    const set = classroomsByUser.get(w.userId) ?? new Set<string>();
    set.add(w.classroomId);
    classroomsByUser.set(w.userId, set);

    const cur = containersByUser.get(w.userId) ?? { total: 0, running: 0, paused: 0 };
    cur.total += 1;
    if (w.status === 'RUNNING') cur.running += 1;
    else if (w.status === 'PAUSED') cur.paused += 1;
    containersByUser.set(w.userId, cur);
  }

  return res.json(
    students.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      createdAt: s.createdAt,
      keyActivated: Boolean(s.aiKey),
      classroomCount: classroomsByUser.get(s.id)?.size ?? 0,
      containers: containersByUser.get(s.id) ?? { total: 0, running: 0, paused: 0 },
    })),
  );
});

// 教师详情：基本信息 + 名下课堂 + 课堂内学生名单（跨课堂去重）
router.get('/teachers/:id', async (req: AuthedRequest, res: Response) => {
  const teacher = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!teacher || teacher.role !== 'TEACHER') {
    return res.status(404).json({ error: '教师不存在' });
  }

  const [classrooms, summary, workspaceUsers] = await Promise.all([
    prisma.classroom.findMany({
      where: { teacherId: teacher.id },
      orderBy: { createdAt: 'desc' },
      include: {
        groups: {
          orderBy: { createdAt: 'asc' },
          include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
        },
        _count: { select: { documents: true } },
      },
    }),
    containerSummaryByClassroom(),
    prisma.workspace.findMany({
      where: { classroom: { teacherId: teacher.id } },
      select: {
        classroomId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const zero = { total: 0, running: 0, paused: 0, created: 0, keyActivated: 0 };
  // cid -> 学生去重集合（分组记录 ∪ 工作台记录）
  const studentsByClassroom = new Map<string, Map<string, { id: string; name: string; email: string }>>();
  for (const c of classrooms) {
    const map = new Map<string, { id: string; name: string; email: string }>();
    for (const g of c.groups) {
      for (const m of g.members) map.set(m.user.id, m.user);
    }
    studentsByClassroom.set(c.id, map);
  }
  for (const w of workspaceUsers) {
    const map = studentsByClassroom.get(w.classroomId);
    if (map) map.set(w.user.id, w.user);
  }

  // 跨课堂去重的学生名单，并带上其所属课堂
  const all = new Map<string, { id: string; name: string; email: string; classrooms: { id: string; name: string }[] }>();
  for (const c of classrooms) {
    for (const s of studentsByClassroom.get(c.id)?.values() ?? []) {
      const cur = all.get(s.id) ?? { ...s, classrooms: [] as { id: string; name: string }[] };
      cur.classrooms.push({ id: c.id, name: c.name });
      all.set(s.id, cur);
    }
  }

  return res.json({
    teacher: { id: teacher.id, name: teacher.name, email: teacher.email, createdAt: teacher.createdAt },
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      createdAt: c.createdAt,
      groupCount: c.groups.length,
      documentCount: c._count.documents,
      studentCount: studentsByClassroom.get(c.id)?.size ?? 0,
      containers: summary.get(c.id) ?? { ...zero },
    })),
    students: Array.from(all.values()),
  });
});

// 全部课堂（含任课教师与容器情况）
router.get('/classrooms', async (_req: AuthedRequest, res: Response) => {
  const [classrooms, summary] = await Promise.all([
    prisma.classroom.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        _count: { select: { groups: true, documents: true } },
      },
    }),
    containerSummaryByClassroom(),
  ]);

  return res.json(
    classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      groupCount: c.groupCount,
      createdAt: c.createdAt,
      teacher: c.teacher,
      groupCountActual: c._count.groups,
      documentCount: c._count.documents,
      containers: summary.get(c.id) ?? {
        total: 0,
        running: 0,
        paused: 0,
        created: 0,
        keyActivated: 0,
      },
    })),
  );
});

// 课堂详情：分组与成员 + 文献 + 容器 + AI 活跃统计（verify=1 时核对 Docker 真实状态）
router.get('/classrooms/:id', async (req: AuthedRequest, res: Response) => {
  const classroom = await prisma.classroom.findUnique({
    where: { id: req.params.id },
    include: {
      teacher: { select: { id: true, name: true, email: true } },
      groups: {
        orderBy: { createdAt: 'asc' },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, aiKey: true } } },
          },
        },
      },
      documents: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, fileType: true, createdAt: true },
      },
    },
  });
  if (!classroom) return res.status(404).json({ error: '课堂不存在' });

  const containers = await listByClassroom(classroom.id);
  const [analytics, runtime] = await Promise.all([
    safeAnalytics(classroom.id),
    req.query.verify === '1' ? inspectRuntime(containers.map((c) => c.containerName)) : null,
  ]);

  return res.json({
    classroom: {
      id: classroom.id,
      name: classroom.name,
      code: classroom.code,
      groupCount: classroom.groupCount,
      createdAt: classroom.createdAt,
      teacher: classroom.teacher,
    },
    groups: classroom.groups.map((g) => ({
      id: g.id,
      name: g.name,
      members: g.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        keyActivated: Boolean(m.user.aiKey),
      })),
    })),
    documents: classroom.documents,
    containers,
    studentCount: await studentIdsOfClassroom(classroom.id).then((ids) => ids.length),
    analytics,
    runtime: runtime ?? undefined,
    verifiedAt: runtime ? new Date() : undefined,
  });
});

// 学生详情：基本信息 + 加入的课堂（含小组与容器）+ 活跃情况
router.get('/students/:id', async (req: AuthedRequest, res: Response) => {
  const student = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, email: true, role: true, aiKey: true, createdAt: true },
  });
  if (!student || student.role !== 'STUDENT') {
    return res.status(404).json({ error: '学生不存在' });
  }

  const [memberships, workspaces, aiQuestions, peerMessages] = await Promise.all([
    prisma.groupMember.findMany({
      where: { userId: student.id },
      include: {
        group: {
          include: {
            classroom: { include: { teacher: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.workspace.findMany({
      where: { userId: student.id },
      include: { classroom: { include: { teacher: { select: { id: true, name: true } } } } },
    }),
    prisma.message.count({ where: { senderId: student.id, type: 'AI', isAiReply: false } }),
    prisma.message.count({ where: { senderId: student.id, type: 'PEER', isAiReply: false } }),
  ]);

  type Entry = {
    id: string;
    name: string;
    code: string;
    teacherName: string;
    groupName: string | null;
    container: {
      workspaceId: string;
      containerName: string;
      status: string;
      keyActivated: boolean;
      lastActiveAt: Date;
    } | null;
  };
  const map = new Map<string, Entry>();

  for (const m of memberships) {
    const c = m.group.classroom;
    map.set(c.id, {
      id: c.id,
      name: c.name,
      code: c.code,
      teacherName: c.teacher.name,
      groupName: m.group.name,
      container: null,
    });
  }
  let lastActiveAt: Date | null = null;
  for (const w of workspaces) {
    const c = w.classroom;
    const entry = map.get(c.id) ?? {
      id: c.id,
      name: c.name,
      code: c.code,
      teacherName: c.teacher.name,
      groupName: null,
      container: null,
    };
    entry.container = {
      workspaceId: w.id,
      containerName: w.containerName,
      status: w.status,
      keyActivated: student.aiKey !== null,
      lastActiveAt: w.lastActiveAt,
    };
    map.set(c.id, entry);
    if (!lastActiveAt || w.lastActiveAt > lastActiveAt) lastActiveAt = w.lastActiveAt;
  }

  return res.json({
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
      createdAt: student.createdAt,
      keyActivated: Boolean(student.aiKey),
    },
    classrooms: Array.from(map.values()),
    lastActiveAt,
    aiQuestions,
    peerMessages,
  });
});

// 某课堂下的全部容器；verify=1 时额外核对 docker 真实状态
router.get('/classrooms/:id/containers', async (req: AuthedRequest, res: Response) => {
  const classroom = await prisma.classroom.findUnique({
    where: { id: req.params.id },
    include: { teacher: { select: { id: true, name: true, email: true } } },
  });
  if (!classroom) return res.status(404).json({ error: '课堂不存在' });

  const containers = await listByClassroom(classroom.id);
  const payload: Record<string, unknown> = {
    classroom: {
      id: classroom.id,
      name: classroom.name,
      code: classroom.code,
      teacher: classroom.teacher,
    },
    total: containers.length,
    running: containers.filter((c) => c.status === 'RUNNING').length,
    paused: containers.filter((c) => c.status === 'PAUSED').length,
    keyActivated: containers.filter((c) => c.keyActivated).length,
    containers,
  };

  if (req.query.verify === '1') {
    payload.runtime = await inspectRuntime(containers.map((c) => c.containerName));
    payload.verifiedAt = new Date();
  }
  return res.json(payload);
});

// 管理员暂停/开启任意容器
async function setPaused(req: AuthedRequest, res: Response, paused: boolean): Promise<void> {
  try {
    if (paused) {
      await pauseWorkspace(req.params.workspaceId);
    } else {
      await resumeWorkspace(req.params.workspaceId);
    }
    res.json({ id: req.params.workspaceId, status: paused ? 'PAUSED' : 'RUNNING' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || '操作失败' });
  }
}

router.post('/containers/:workspaceId/pause', async (req: AuthedRequest, res: Response) => {
  await setPaused(req, res, true);
});
router.post('/containers/:workspaceId/resume', async (req: AuthedRequest, res: Response) => {
  await setPaused(req, res, false);
});

// 管理员删除某个学生的 AI 工作台（容器 + 记录），学生下次提问会自动重建
router.delete('/containers/:workspaceId', async (req: AuthedRequest, res: Response) => {
  try {
    await removeWorkspace(req.params.workspaceId);
    return res.json({ id: req.params.workspaceId, deleted: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message || '删除失败' });
  }
});

// 管理员重置教师/学生密码：不传 password 时随机生成一个
router.post('/users/:id/reset-password', async (req: AuthedRequest, res: Response) => {
  const raw = (req.body as { password?: unknown })?.password;
  const provided = typeof raw === 'string' ? raw.trim() : '';
  const password = provided || randomBytes(6).toString('base64url');

  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'ADMIN') return res.status(403).json({ error: '管理员密码不可在此重置' });

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(password, 10) },
  });

  return res.json({ id: user.id, name: user.name, email: user.email, password });
});

// 管理员整课堂批量暂停/开启
router.post('/classrooms/:id/pause-all', async (req: AuthedRequest, res: Response) => {
  const paused = (req.body as { paused?: boolean })?.paused !== false;
  try {
    const count = await setClassroomPaused(req.params.id, paused);
    return res.json({ affected: count, paused });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message || '操作失败' });
  }
});

export default router;
