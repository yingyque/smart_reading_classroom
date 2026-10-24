// 一次性脚本：将全部 STUDENT 的 AI Key 改写为后端统一共享 Key
// 运行：npx tsx src/scripts/setSharedKey.ts <共享Key>
// 说明：Key 通过命令行参数传入（不写入任何文件）；统一共享 Key 后多个学生共用同一指纹，
//       故需先移除 aiKeyHash 的唯一索引（见 prisma db push）。运行后重启服务即可从 DB 载入该 Key。

import { prisma } from '../lib/prisma';
import { encryptKey, keyFingerprint } from '../services/cryptoService';

async function main() {
  // 优先取命令行参数（明文不落盘），其次兼容环境变量
  const key = process.argv[2] || process.env.STUDENT_API_KEY;
  if (!key) {
    console.error('用法：npx tsx src/scripts/setSharedKey.ts <共享Key>');
    process.exit(1);
  }
  const enc = encryptKey(key);
  const fp = keyFingerprint(key);
  const result = await prisma.user.updateMany({
    where: { role: 'STUDENT' },
    data: { aiKey: enc, aiKeyHash: fp },
  });
  console.log(`已将 ${result.count} 名学生的 AI Key 改写为统一共享 Key`);
}

main()
  .catch((err) => {
    console.error('改写失败:', err);
    process.exit(1);
  });
