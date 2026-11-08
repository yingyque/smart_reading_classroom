// 学生共享 AI Key 池：多个 Key 以加密形式存于数据库（SharedKey 表，AES-256-GCM，
// 密钥由 JWT_SECRET 派生），明文不落 .env / 环境变量。
// 运行期在进程内维护解密后的池子，按 round-robin 轮询分配，分摊并发限流压力；
// 某个 Key 被限流时可排除后取下一个（见 containerService 的重试逻辑）。

import { prisma } from '../lib/prisma';
import { decryptKey, encryptKey, keyFingerprint, maskKey } from './cryptoService';

export interface PoolKey {
  id: string;
  plain: string;
  fingerprint: string;
}

// 进程内池子：启动时从 DB 加载；增删 Key 时同步刷新
let pool: PoolKey[] = [];
let cursor = 0;

// 从 DB 加载启用的 Key 解密入池；表为空时走旧路径（从学生记录解密）自迁移
export async function initSharedKeyPool(): Promise<number> {
  const rows = await prisma.sharedKey.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
  if (rows.length > 0) {
    pool = rows
      .map((r) => {
        try {
          return { id: r.id, plain: decryptKey(r.encrypted), fingerprint: r.fingerprint };
        } catch {
          console.warn('[sharedKey] 解密失败，已跳过一条共享 Key:', r.id);
          return null;
        }
      })
      .filter((k): k is PoolKey => k !== null);
    return pool.length;
  }

  // 旧部署迁移：SharedKey 表为空时，从任意已绑定学生的记录解密出原共享 Key 写入表中
  const legacy = await prisma.user.findFirst({ where: { role: 'STUDENT', aiKey: { not: null } }, select: { aiKey: true } });
  if (!legacy?.aiKey) return 0;
  try {
    const plain = decryptKey(legacy.aiKey);
    await addSharedKey(plain);
    console.log('[sharedKey] 已将旧共享 Key 迁移入 Key 池');
    return pool.length;
  } catch {
    return 0;
  }
}

// 轮询取一个 Key；excludeFingerprints 用于限流重试时排除刚失败的 Key。
// 返回 null 表示池子为空（无可用共享 Key）
export function pickSharedKey(excludeFingerprints: string[] = []): PoolKey | null {
  if (pool.length === 0) return null;
  for (let i = 0; i < pool.length; i++) {
    const idx = cursor % pool.length;
    cursor = (cursor + 1) % pool.length;
    const k = pool[idx];
    if (!excludeFingerprints.includes(k.fingerprint)) return k;
  }
  return null;
}

export function poolSize(): number {
  return pool.length;
}

// 该指纹是否属于共享池（用于区分「学生个人 Key」与「自动绑定的共享 Key」）
export function isPoolKey(fingerprint: string): boolean {
  return pool.some((k) => k.fingerprint === fingerprint);
}

// 新增（或重复提交时刷新）一个共享 Key
export async function addSharedKey(plain: string): Promise<void> {
  const fingerprint = keyFingerprint(plain);
  await prisma.sharedKey.upsert({
    where: { fingerprint },
    update: { encrypted: encryptKey(plain), enabled: true },
    create: { encrypted: encryptKey(plain), fingerprint },
  });
  await initSharedKeyPool();
}

// 管理展示用：掩码列表
export function listSharedKeys(): { id: string; masked: string; fingerprint: string }[] {
  return pool.map((k) => ({ id: k.id, masked: maskKey(k.plain), fingerprint: k.fingerprint }));
}

// 删除一个共享 Key（学生容器内固化的旧 Key 在下次限流重试时会自动切换到池内其他 Key）
export async function removeSharedKey(id: string): Promise<void> {
  await prisma.sharedKey.delete({ where: { id } });
  await initSharedKeyPool();
}
