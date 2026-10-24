// 统一共享 Key 解析：仅以加密形式存于数据库（User.aiKey，AES-256-GCM，密钥由 JWT_SECRET 派生），
// 不在 .env / docker-compose / 环境变量中保存明文。运行时从任意已分配该 Key 的学生记录解密得到。

import { prisma } from '../lib/prisma';
import { decryptKey } from './cryptoService';

// 从已分配共享 Key 的学生记录中解密出明文 Key；找不到则返回 null
export async function getSharedStudentKey(): Promise<string | null> {
  const ref = await prisma.user.findFirst({
    where: { role: 'STUDENT', aiKey: { not: null } },
    select: { aiKey: true },
  });
  if (!ref?.aiKey) return null;
  try {
    return decryptKey(ref.aiKey);
  } catch {
    return null;
  }
}
