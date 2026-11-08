// 向共享 Key 池新增一个 Key（AES-256-GCM 加密入库，明文不落盘）
// 运行：npx tsx src/scripts/addSharedKey.ts <共享Key>
// 重复提交同一个 Key 视为更新（upsert），服务运行期间无需重启即生效（池子会从 DB 刷新）

import { prisma } from '../lib/prisma';
import { addSharedKey, listSharedKeys } from '../services/sharedKeyService';

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('用法：npx tsx src/scripts/addSharedKey.ts <共享Key>');
    process.exit(1);
  }
  await addSharedKey(key);
  const list = listSharedKeys();
  console.log(`共享 Key 池现有 ${list.length} 个：`);
  list.forEach((k, i) => console.log(`  ${i + 1}. ${k.masked}（指纹 ${k.fingerprint.slice(0, 12)}…）`));
}

main()
  .catch((err) => {
    console.error('添加失败:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
