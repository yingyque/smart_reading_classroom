import { execFile } from 'child_process';
import { config } from '../config/env';
import { prisma } from '../lib/prisma';
import { decryptKey, encryptKey, keyFingerprint, maskKey } from './cryptoService';
import { isPoolKey, pickSharedKey, poolSize } from './sharedKeyService';
import { runWithSlot } from './execQueue';

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

function docker(
  args: string[],
  timeoutMs = 30000,
  // 可选 stdin 输入：用于 docker exec -i 把超长内容（如 prompt）管道传给容器内进程，
  // 绕开 argv 单参数 128KB（MAX_ARG_STRLEN）上限
  input?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        (err as Error & { stderr?: string }).stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
    if (input !== undefined && child.stdin) {
      // 进程提前退出时 stdin.write 可能 EPIPE，忽略即可（退出码由回调捕获）
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    }
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

// 容器内 Node 堆上限：容器内存限 448m。实测 codebuddy 进程 RSS 峰值约 300MB，
// 堆上限 256MB 既能留出堆外开销余量，也不会触发 CLI 自带的低内存保护
// （该保护要求堆剩余 headroom ≥ 64MB，堆上限 150MB 时会直接拒答）
function nodeOptsArgs(): string[] {
  return ['-e', 'NODE_OPTIONS=--max-old-space-size=256'];
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
}async function createContainer(name: string, plainKey: string | null): Promise<void> {
  await docker([
    'create',
    '--name', name,
    // 内存下限不能低于 ~350m：codebuddy 进程 RSS 峰值约 300MB，低于此会被内核 OOM kill
    '--memory', '448m',
    '--memory-swap', '448m',
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

  // 有效 key：优先用学生自己保存的 key，未配置时从共享 Key 池轮询取一个
  const owner = await prisma.user.findUnique({ where: { id: userId } });
  const effectiveKey = owner?.aiKey ? decryptKey(owner.aiKey) : (pickSharedKey()?.plain ?? null);

  if (!ws) {
    const containerName = containerNameFor(classroomId, userId);
    try {
      await createContainer(containerName, effectiveKey);
    } catch (err) {
      // 并发 join 时可能重名冲突，忽略后继续查询
      if (!await containerExists(containerName)) throw err;
    }
    ws = await prisma.workspace.create({
      data: { classroomId, userId, containerName, status: WORKSPACE_STATUS.CREATED },
    });
  } else if (!(await containerExists(ws.containerName))) {
    // 自愈：容器意外丢失，用有效 key 重建
    await createContainer(ws.containerName, effectiveKey);
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { status: WORKSPACE_STATUS.CREATED },
    });
    ws = { ...ws, status: WORKSPACE_STATUS.CREATED };
  }
  return { id: ws.id, containerName: ws.containerName, status: ws.status };
}

// 学生提交 key：加密入库 + 重建其所有容器（注入新的 CODEBUDDY_API_KEY）
// 一个 Key 只能绑定一个学生：同一账号重复提交同一个 Key 允许（视为更新），他人已占用则拒绝
export async function activateKey(userId: string, key: string): Promise<void> {
  const fingerprint = keyFingerprint(key);
  // 共享 Key 池内的 Key：允许所有学生使用，不做唯一性限制
  if (!isPoolKey(fingerprint)) {
    const owner = await prisma.user.findFirst({ where: { aiKeyHash: fingerprint } });
    if (owner && owner.id !== userId) {
      throw new Error('该 AI Key 已被其他学生使用');
    }
  }

  const encrypted = encryptKey(key);
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { aiKey: encrypted, aiKeyHash: fingerprint },
    });
  } catch (err) {
    // 并发提交同一个 Key 时唯一索引兜底
    if ((err as { code?: string }).code === 'P2002') {
      throw new Error('该 AI Key 已被其他学生使用');
    }
    throw err;
  }

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
// 全局并发队列：每个 exec 峰值 ~300MB，全班同时提问必须排队；
// onQueuePosition(0) 表示已获得执行权，>0 为排队位次（供前端展示）
export async function runCodeBuddy(
  classroomId: string,
  userId: string,
  prompt: string,
  onQueuePosition?: (pos: number) => void,
): Promise<{ text: string; usage: CbUsage | null }> {
  const ws = await ensureWorkspace(classroomId, userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.aiKey && poolSize() === 0) {
    throw new Error('AI Key 未激活');
  }
  if (ws.status === WORKSPACE_STATUS.PAUSED) {
    throw new WorkspacePausedError();
  }

  return runWithSlot(
    async () => {
      // 首次使用（或容器意外退出）时唤醒，之后保持常驻。
      // start 也必须在并发坑位内：50 个容器同时 start 同样是资源冲击
      if (ws.status !== WORKSPACE_STATUS.RUNNING || !(await isRunning(ws.containerName))) {
        await docker(['start', ws.containerName]);
        await prisma.workspace.update({
          where: { id: ws.id },
          data: { status: WORKSPACE_STATUS.RUNNING, lastActiveAt: new Date() },
        });
      }

      try {
        // Key 在 exec 时注入（对存量容器即时生效）。共享 Key 按轮询分配，
        // 触发限流时自动切换池内下一个 Key 重试（每个 Key 至多试一次）；
        // 学生个人 Key（非池内指纹）不参与轮询，限流时直接把错误反馈给学生
        const personal = user?.aiKey && !isPoolKey(keyFingerprint(decryptKey(user.aiKey)));
        const maxAttempts = personal ? 1 : Math.max(1, poolSize());
        const excluded: string[] = [];
        let lastErr: Error | null = null;
        for (let i = 0; i < maxAttempts; i++) {
          const apiKey = resolveRequestKey(user, excluded);
          if (!apiKey) break;
          try {
            console.log(`[container] ${ws.containerName} exec 使用 Key ${maskKey(apiKey)}`);
            return await execCodeBuddy(ws.containerName, prompt, apiKey);
          } catch (err) {
            lastErr = err as Error;
            if (!personal && isRateLimited(err)) {
              excluded.push(keyFingerprint(apiKey));
              console.warn(`[container] Key ${maskKey(apiKey)} 触发限流，切换下一个共享 Key 重试`);
              continue;
            }
            throw err;
          }
        }
        throw lastErr ?? new Error('AI Key 未激活');
      } finally {
        await prisma.workspace.update({
          where: { id: ws.id },
          data: { lastActiveAt: new Date() },
        });
      }
    },
    onQueuePosition,
  );
}

// 本次请求使用的 Key：学生个人 Key（非池内指纹）固定使用；否则从共享池轮询
function resolveRequestKey(user: { aiKey: string | null } | null, exclude: string[]): string | null {
  if (user?.aiKey) {
    const plain = decryptKey(user.aiKey);
    if (!isPoolKey(keyFingerprint(plain))) return plain;
  }
  return pickSharedKey(exclude)?.plain ?? null;
}

// 限流特征：codebuddy 把上游错误（429 / rate limit / quota）输出到 stderr
function isRateLimited(err: unknown): boolean {
  const e = err as Error & { stderr?: string };
  const msg = `${e?.message ?? ''}\n${e?.stderr ?? ''}`;
  return /429|rate.?limit|too many requests|quota/i.test(msg);
}

// codebuddy --output-format json 返回的 token 用量
export interface CbUsage {
  inputTokens: number;
  outputTokens: number;
}

// 容器内 headless 调用 CodeBuddy；Key 与模型一样在 exec 时动态注入
// --output-format json：末尾 result 项带真实 token 用量（usage.input_tokens / output_tokens）
async function execCodeBuddy(
  containerName: string,
  prompt: string,
  apiKey: string,
): Promise<{ text: string; usage: CbUsage | null }> {
  // prompt 与输出均经容器内临时文件中转（学生容器单用户使用、全局队列串行，文件名固定无并发冲突）：
  // ① prompt 作为 argv 传递受内核单参数 128KB（MAX_ARG_STRLEN）上限，超长文献（5 万中文字符
  //   ≈ 150KB UTF-8）会直接 spawn E2BIG，学生端表现为「容器启动或调用超时」，故改走
  //   docker exec -i 的 stdin 先 cat 落盘；
  // ② codebuddy 向管道写超过 64KB 的输出时会在退出时截断（不等 flush，数据滞留管道缓冲区外丢失），
  //   故输出同样先落盘、再由 cat 正常回传（cat 无此问题）。
  const { stdout, stderr } = await docker(
    [
      'exec',
      '-i',
      // 覆盖容器创建时固化的模型与 Key，保证配置变更/轮询切换对已有容器立即生效
      ...modelEnvArgs(),
      // 堆上限压在 448m 容器限额以内：让 Node 先 GC/报 OOM，而不是整个容器被内核 kill
      ...nodeOptsArgs(),
      '-e', `CODEBUDDY_API_KEY=${apiKey}`,
      containerName,
      'sh', '-c',
      'cat > /tmp/cb-p.txt && codebuddy -p --output-format json -y < /tmp/cb-p.txt > /tmp/cb-out.json 2>/tmp/cb-err; ec=$?; cat /tmp/cb-out.json; if [ -s /tmp/cb-err ]; then cat /tmp/cb-err >&2; fi; exit $ec',
    ],
    config.workspace.execTimeoutMs,
    prompt,
  );
  const out = stdout.trim();

  // JSON 输出：数组，含 user/assistant message 与末尾的 result（真实 token 用量）
  const parsed = parseCodeBuddyJson(out);
  if (parsed) {
    const { text, usage, isError, errorText } = parsed;
    if (isError && !text) {
      // codebuddy 把真实错误（额度/鉴权/模型不可用等）放在 result 里，透传给上层
      const detail = errorText || stderr.trim();
      const e = new Error(detail || 'AI 调用失败') as Error & { isAiError?: boolean };
      e.isAiError = true;
      throw e;
    }
    if (text) return { text, usage };
  } else if (out) {
    // 兜底：非 JSON 输出按纯文本回复处理（旧版本 codebuddy）
    return { text: out, usage: null };
  }

  // codebuddy 把真实错误（额度/鉴权/模型不可用等）输出到 stderr 且 stdout 为空，
  // 这里把真实错误抛给上层，避免向用户展示误导性的「AI 未返回内容」
  const detail = stderr.trim();
  if (detail) {
    const e = new Error(detail) as Error & { isAiError?: boolean };
    e.isAiError = true;
    throw e;
  }
  return { text: '（AI 未返回内容）', usage: null };
}

// 解析 codebuddy 的 JSON 输出；非 JSON（空/纯文本）返回 null
function parseCodeBuddyJson(out: string): {
  text: string;
  usage: CbUsage | null;
  isError: boolean;
  errorText: string;
} | null {
  if (!out) return null;
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    return null;
  }
  const items = (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
  const result = items.find((i) => i?.type === 'result') as
    | { is_error?: boolean; result?: unknown; usage?: { input_tokens?: number; output_tokens?: number } }
    | undefined;
  const assistant = items.find((i) => i?.type === 'message' && i?.role === 'assistant') as
    | { content?: Array<{ type?: string; text?: string }> }
    | undefined;
  const text = (assistant?.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('')
    .trim();
  const usage = result?.usage
    ? {
        inputTokens: result.usage.input_tokens ?? 0,
        outputTokens: result.usage.output_tokens ?? 0,
      }
    : null;
  const errorText = typeof result?.result === 'string' ? result.result : '';
  return { text, usage, isError: result?.is_error === true, errorText };
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

// 管理员删除某个学生的 AI 工作台：销毁容器并删除记录
// 学生再次提问或重新加入课堂时会自动重建（见 ensureWorkspace）
export async function removeWorkspace(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error('工作台不存在');
  await docker(['rm', '-f', ws.containerName]).catch(() => undefined);
  await prisma.workspace.delete({ where: { id: ws.id } });
}

// 容器的真实运行状态（docker 视角）。DB 状态可能因服务器重启/容器异常而与实际情况不符
export interface ContainerRuntime {
  exists: boolean;
  running: boolean;
  // docker 的 State：running | exited | created | paused | missing | unknown
  state: string;
}

// 批量核对真实状态：一次 docker ps 调用拿到全部 src-ws- 容器，避免逐个 inspect
export async function inspectRuntime(names: string[]): Promise<Record<string, ContainerRuntime>> {
  const result: Record<string, ContainerRuntime> = {};
  for (const n of names) result[n] = { exists: false, running: false, state: 'missing' };
  if (names.length === 0) return result;

  let stdout = '';
  try {
    ({ stdout } = await docker(
      ['ps', '-a', '--filter', 'name=src-ws-', '--format', '{{.Names}}\t{{.State}}'],
      30000,
    ));
  } catch (err) {
    console.error('[container] docker ps 失败:', (err as Error).message);
    for (const n of names) result[n] = { exists: false, running: false, state: 'unknown' };
    return result;
  }

  const actual = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [name, state] = line.split('\t');
    if (name && state) actual.set(name.trim(), state.trim());
  }
  for (const n of names) {
    const state = actual.get(n);
    if (state) result[n] = { exists: true, running: state === 'running', state };
  }
  return result;
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
