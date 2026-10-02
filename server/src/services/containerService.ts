import { execFile } from 'child_process';
import { config } from '../config/env';
import { prisma } from '../lib/prisma';
import { decryptKey, encryptKey } from './cryptoService';

// 学生 AI 工作台容器编排：通过 docker CLI（execFile 数组传参，无 shell 注入风险）
// 容器内安装 CodeBuddy CLI，由平台通过 docker exec headless 调用

const WORKSPACE_STATUS = {
  CREATED: 'CREATED',
  RUNNING: 'RUNNING',
  // 教师手动暂停：容器常驻不销毁，但学生提问时不再自动唤醒
  PAUSED: 'PAUSED',
} as const;

// 学生提问时容器被教师暂停：需给出区别于"调用失败"的明确提示
export class WorkspacePausedError extends Error {
  constructor() {
    super('WORKSPACE_PAUSED');
    this.name = 'WorkspacePausedError';
  }
}

function docker(args: string[], timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        (err as Error & { stderr?: string }).stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function containerNameFor(classroomId: string, userId: string): string {
  return `src-ws-${classroomId.slice(0, 8)}-${userId.slice(0, 8)}`;
}

async function containerExists(name: string): Promise<boolean> {
  try {
    await docker(['inspect', name]);
    return true;
  } catch {
    return false;
  }
}

async function isRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await docker(['inspect', '-f', '{{.State.Running}}', name]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

// 模型相关环境变量：每次调用动态注入，改配置后无需重建容器即可生效
function modelEnvArgs(): string[] {
  const m = config.workspace.aiModel;
  return [
    '-e', `CODEBUDDY_MODEL=${m}`,
    '-e', `CODEBUDDY_SMALL_FAST_MODEL=${m}`,
    '-e', `CODEBUDDY_BIG_SLOW_MODEL=${m}`,
  ];
}

// 组装容器环境变量（预制字段 + 学生 key）
function buildEnvArgs(plainKey: string | null): string[] {
  const env: Record<string, string> = {
    CODEBUDDY_BASE_URL: config.workspace.aiBaseURL,
    CODEBUDDY_IS_SANDBOX: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
  };
  if (plainKey) env.CODEBUDDY_API_KEY = plainKey;
  return [...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), ...modelEnvArgs()];
}

async function createContainer(name: string, plainKey: string | null): Promise<void> {
  await docker([
    'create',
    '--name', name,
    '--memory', '350m',
    '--memory-swap', '350m',
    ...buildEnvArgs(plainKey),
    config.workspace.image,
    'sleep', 'infinity',
  ]);
}

// 确保 (classroom, student) 的容器存在：DB 有记录但容器丢失时自愈重建
export async function ensureWorkspace(classroomId: string, userId: string): Promise<{
  id: string;
  containerName: string;
  status: string;
}> {
  let ws = await prisma.workspace.findUnique({
    where: { classroomId_userId: { classroomId, userId } },
  });

  if (!ws) {
    const containerName = containerNameFor(classroomId, userId);
    try {
      await createContainer(containerName, null);
    } catch (err) {
      // 并发 join 时可能重名冲突，忽略后继续查询
      if (!await containerExists(containerName)) throw err;
    }
    ws = await prisma.workspace.create({
      data: { classroomId, userId, containerName, status: WORKSPACE_STATUS.CREATED },
    });
  } else if (!(await containerExists(ws.containerName))) {
    // 自愈：容器意外丢失，用已保存的 key 重建
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const plainKey = user?.aiKey ? decryptKey(user.aiKey) : null;
    await createContainer(ws.containerName, plainKey);
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { status: WORKSPACE_STATUS.CREATED },
    });
    ws = { ...ws, status: WORKSPACE_STATUS.CREATED };
  }
  return { id: ws.id, containerName: ws.containerName, status: ws.status };
}

// 学生提交 key：加密入库 + 重建其所有容器（注入新的 CODEBUDDY_API_KEY）
export async function activateKey(userId: string, key: string): Promise<void> {
  const encrypted = encryptKey(key);
  await prisma.user.update({ where: { id: userId }, data: { aiKey: encrypted } });

  const workspaces = await prisma.workspace.findMany({ where: { userId } });
  for (const ws of workspaces) {
    await docker(['rm', '-f', ws.containerName]).catch(() => undefined);
    await createContainer(ws.containerName, key);
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { status: WORKSPACE_STATUS.CREATED },
    });
  }
}

// 在学生容器内 headless 调用 CodeBuddy 生成回复
// 容器一旦启动便常驻（无闲置自动停止），仅教师可暂停/开启
export async function runCodeBuddy(
  classroomId: string,
  userId: string,
  prompt: string,
): Promise<string> {
  const ws = await ensureWorkspace(classroomId, userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.aiKey) {
    throw new Error('AI Key 未激活');
  }
  if (ws.status === WORKSPACE_STATUS.PAUSED) {
    throw new WorkspacePausedError();
  }

  // 首次使用（或容器意外退出）时唤醒，之后保持常驻
  if (ws.status !== WORKSPACE_STATUS.RUNNING || !(await isRunning(ws.containerName))) {
    await docker(['start', ws.containerName]);
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { status: WORKSPACE_STATUS.RUNNING, lastActiveAt: new Date() },
    });
  }

  try {
    const { stdout } = await docker(
      [
        'exec',
        // 覆盖容器创建时固化的模型，保证配置变更对已有容器立即生效
        ...modelEnvArgs(),
        ws.containerName,
        'codebuddy', '-p', prompt, '--output-format', 'text', '-y',
      ],
      config.workspace.execTimeoutMs,
    );
    return stdout.trim() || '（AI 未返回内容）';
  } finally {
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { lastActiveAt: new Date() },
    });
  }
}

// 教师控制：暂停某个学生的容器（容器保留，可随时开启）
export async function pauseWorkspace(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error('工作台不存在');
  await docker(['stop', ws.containerName]).catch(() => undefined);
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { status: WORKSPACE_STATUS.PAUSED },
  });
}

// 教师控制：开启某个学生的容器（容器丢失则自愈重建）
export async function resumeWorkspace(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error('工作台不存在');
  await ensureWorkspace(ws.classroomId, ws.userId);
  await docker(['start', ws.containerName]);
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { status: WORKSPACE_STATUS.RUNNING, lastActiveAt: new Date() },
  });
}

// 教师控制：整课堂批量暂停/开启，返回处理数量
export async function setClassroomPaused(classroomId: string, paused: boolean): Promise<number> {
  const list = await prisma.workspace.findMany({ where: { classroomId } });
  for (const ws of list) {
    if (paused) {
      await pauseWorkspace(ws.id);
    } else {
      await resumeWorkspace(ws.id);
    }
  }
  return list.length;
}

// 教师端：某课堂全部容器列表
export async function listByClassroom(classroomId: string) {
  const list = await prisma.workspace.findMany({
    where: { classroomId },
    include: { user: { select: { id: true, name: true, email: true, aiKey: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return list.map((ws) => ({
    id: ws.id,
    studentName: ws.user.name,
    studentEmail: ws.user.email,
    containerName: ws.containerName,
    status: ws.status,
    keyActivated: Boolean(ws.user.aiKey),
    lastActiveAt: ws.lastActiveAt,
    createdAt: ws.createdAt,
  }));
}

// 学生端：自己在某课堂的容器状态
export async function getByUser(classroomId: string, userId: string) {
  const ws = await prisma.workspace.findUnique({
    where: { classroomId_userId: { classroomId, userId } },
  });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return {
    exists: Boolean(ws),
    status: ws?.status ?? null,
    keyActivated: Boolean(user?.aiKey),
  };
}
