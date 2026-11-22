import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { JwtPayload, Role } from '../types';

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload | null {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === 'string') return null;
  return decoded as JwtPayload;
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  // <img src> 等浏览器原生请求无法携带 Authorization 头，允许 ?token= 查询参数兜底
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
  if (!token) {
    res.status(401).json({ error: '未登录或令牌缺失' });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: '令牌无效' });
      return;
    }
    req.user = payload;
    next();
  } catch (err) {
    console.error('[auth] 令牌校验失败:', (err as Error).message);
    res.status(401).json({ error: '令牌无效或已过期' });
  }
}

export function roleRequired(role: Role) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== role) {
      res.status(403).json({ error: '无权限执行此操作' });
      return;
    }
    next();
  };
}
