import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { signToken, authRequired, AuthedRequest } from '../middleware/auth';
import { Role } from '../types';
import { config } from '../config/env';
import { encryptKey, keyFingerprint } from '../services/cryptoService';
import { sendMail } from '../services/mailService';

const router = Router();

// 忘记密码冷却：同一邮箱 60 秒内只允许申请一次（防双击/重复提交连发多封邮件）
const forgotCooldown = new Map<string, number>();
const FORGOT_COOLDOWN_MS = 60_000;

// 注册
router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: Role;
  };
  if (!name || !email || !password) {
    return res.status(400).json({ error: '请填写姓名、邮箱和密码' });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: '该邮箱已被注册' });
  }
  const hashed = await bcrypt.hash(password, 10);
  const resolvedRole: Role = role === 'TEACHER' ? 'TEACHER' : 'STUDENT';
  const data: {
    name: string;
    email: string;
    password: string;
    role: Role;
    aiKey?: string;
    aiKeyHash?: string;
  } = { name, email, password: hashed, role: resolvedRole };

  // 学生端统一共享 Key：注册时自动分配，免去手动输入
  if (resolvedRole === 'STUDENT' && config.workspace.apiKey) {
    data.aiKey = encryptKey(config.workspace.apiKey);
    data.aiKeyHash = keyFingerprint(config.workspace.apiKey);
  }

  const user = await prisma.user.create({ data });
  const token = signToken({ id: user.id, role: user.role as Role });
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// 登录
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: '请填写邮箱和密码' });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  const token = signToken({ id: user.id, role: user.role as Role });
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// 当前用户
router.get('/me', authRequired, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// 修改个人信息（目前支持改名）
router.patch('/profile', authRequired, async (req: AuthedRequest, res: Response) => {
  const { name } = req.body as { name?: string };
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: '姓名不能为空' });
  if (trimmed.length > 30) return res.status(400).json({ error: '姓名不能超过 30 个字符' });

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { name: trimmed },
  });
  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// 忘记密码：校验用户是否存在；存在则生成随机新密码，通过 Agent 邮箱发送给用户
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  const trimmed = (email || '').trim();
  if (!trimmed) {
    return res.status(400).json({ error: '请填写邮箱' });
  }

  // 冷却检查（同步 check-and-set，双击/并发请求只有第一个能通过）
  const now = Date.now();
  if (now - (forgotCooldown.get(trimmed) ?? 0) < FORGOT_COOLDOWN_MS) {
    return res.status(429).json({ error: '操作过于频繁，请 1 分钟后再试' });
  }
  forgotCooldown.set(trimmed, now);

  const user = await prisma.user.findUnique({ where: { email: trimmed } });
  if (!user) {
    return res.status(404).json({ error: '该邮箱尚未注册' });
  }

  const newPassword = randomBytes(8).toString('base64url');
  const oldHash = user.password;
  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, 10) },
  });

  try {
    await sendMail({
      to: user.email,
      subject: '智慧阅读平台：你的新密码',
      body:
        `你好，${user.name}：\n\n` +
        `你已申请重置智慧阅读平台的登录密码。新密码为：${newPassword}\n\n` +
        `请使用新密码登录平台，登录后建议在「设置」中修改为自己的密码。\n\n` +
        `如非本人操作，请及时联系教师或管理员。`,
    });
  } catch (err) {
    // 发信失败则回滚为原密码，避免用户被锁死；同时释放冷却便于立即重试
    forgotCooldown.delete(trimmed);
    await prisma.user.update({ where: { id: user.id }, data: { password: oldHash } });
    console.error('忘记密码邮件发送失败', err);
    return res.status(500).json({ error: '新密码邮件发送失败，请稍后再试' });
  }

  return res.json({ sent: true });
});

// 修改密码（设置里，需校验原密码）
router.patch('/password', authRequired, async (req: AuthedRequest, res: Response) => {
  const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请填写原密码和新密码' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const ok = await bcrypt.compare(oldPassword, user.password);
  if (!ok) {
    return res.status(400).json({ error: '原密码错误' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, 10) },
  });
  return res.json({ ok: true });
});

export default router;
