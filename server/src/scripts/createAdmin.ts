// 创建/更新管理员账号（ADMIN 角色不开放注册，只能由本脚本在服务器端生成）
// 用法：
//   npx tsx src/scripts/createAdmin.ts <email> <password> [name]
// 或环境变量：ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

async function main() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || '';
  const name = (process.argv[4] || process.env.ADMIN_NAME || '系统管理员').trim();

  if (!email || !password) {
    console.error('用法: npx tsx src/scripts/createAdmin.ts <email> <password> [name]');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('密码至少 6 位');
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { email }, data: { role: 'ADMIN', password: hashed } })
    : await prisma.user.create({ data: { name, email, password: hashed, role: 'ADMIN' } });

  console.log(`管理员账号已就绪: ${user.email} (${user.name}, role=${user.role})`);
}

main()
  .catch((err) => {
    console.error('创建管理员失败:', (err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
