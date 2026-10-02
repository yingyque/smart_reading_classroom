import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken, authRequired, AuthedRequest } from '../middleware/auth';
import { Role } from '../types';

const router = Router();

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
  const user = await prisma.user.create({
    data: { name, email, password: hashed, role: role === 'TEACHER' ? 'TEACHER' : 'STUDENT' },
  });
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

export default router;
