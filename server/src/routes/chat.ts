import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { authRequired, AuthedRequest } from '../middleware/auth';
import { config } from '../config/env';

// 聊天图片：小组讨论 / AI 讨论中随消息发送的图片
const router = Router();

// 图片目录（与文献上传共用 server-uploads 卷，子目录隔离）
const CHAT_DIR = path.join(config.uploadDir, 'chat');
if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

// mimetype → 扩展名白名单（双重校验，杜绝伪造扩展名）
const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

// 文件名规则（上传时生成，访问时校验，防路径穿越）
export const CHAT_IMAGE_NAME_RE = /^chat-[A-Za-z0-9_-]+\.(png|jpg|gif|webp)$/;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CHAT_DIR),
  filename: (_req, file, cb) => {
    const ext = IMAGE_EXT[file.mimetype] ?? '.png';
    cb(null, `chat-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('仅支持 PNG / JPG / GIF / WebP 图片'));
  },
});

// 上传聊天图片（登录即可，学生教师通用）
router.post('/image', authRequired, upload.single('file'), (req: AuthedRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  return res.json({ fileName: req.file.filename });
});

// 访问聊天图片（<img> 无法带 Authorization 头，authRequired 已支持 ?token= 查询参数）
router.get('/image/:fileName', authRequired, (req: AuthedRequest, res: Response) => {
  const name = req.params.fileName;
  if (!CHAT_IMAGE_NAME_RE.test(name)) {
    return res.status(400).json({ error: '参数错误' });
  }
  const filePath = path.join(CHAT_DIR, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '图片不存在' });
  }
  return res.sendFile(filePath);
});

export default router;
