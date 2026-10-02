import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { authRequired, roleRequired, AuthedRequest } from '../middleware/auth';
import { config } from '../config/env';
import { detectFileType, extractText } from '../services/documentParser';

const router = Router();

// 确保上传目录存在
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(safe);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (_req, file, cb) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (detectFileType(name)) cb(null, true);
    else cb(new Error('仅支持 PDF / Word(.docx) / 纯文本(.txt)'));
  },
});

// 教师上传文献
router.post(
  '/:classroomId/upload',
  authRequired,
  roleRequired('TEACHER'),
  upload.single('file'),
  async (req: AuthedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const fileType = detectFileType(originalName);
    if (!fileType) return res.status(400).json({ error: '不支持的文件格式' });

    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.classroomId } });
    if (!classroom || classroom.teacherId !== req.user!.id) {
      return res.status(403).json({ error: '无权操作此课堂' });
    }

    let content = '';
    try {
      content = await extractText(req.file.path, fileType);
    } catch (err) {
      console.error('[documents] 文本抽取失败:', (err as Error).message);
      content = '';
    }

    const title = (req.body.title as string) || originalName.replace(/\.[^.]+$/, '');
    const doc = await prisma.document.create({
      data: {
        classroomId: classroom.id,
        title,
        fileName: originalName,
        fileType,
        filePath: req.file.path,
        content,
      },
    });

    return res.json({
      id: doc.id,
      title: doc.title,
      fileType: doc.fileType,
      createdAt: doc.createdAt,
      contentLength: content.length,
    });
  },
);

// 原始文件（PDF 用于渲染）—— 必须注册在 /:classroomId 之前，避免被遮蔽
router.get('/doc/:docId/raw', authRequired, async (req: AuthedRequest, res: Response) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.docId } });
  if (!doc || !fs.existsSync(doc.filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  return res.sendFile(path.resolve(doc.filePath));
});

// 文献阅读内容（文本 + 元信息）—— 必须注册在 /:classroomId 之前，避免被遮蔽
router.get('/doc/:docId', authRequired, async (req: AuthedRequest, res: Response) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.docId } });
  if (!doc) return res.status(404).json({ error: '文献不存在' });
  return res.json({
    id: doc.id,
    title: doc.title,
    fileType: doc.fileType,
    fileName: doc.fileName,
    content: doc.content,
    createdAt: doc.createdAt,
  });
});

// 课堂文献列表
router.get('/:classroomId', authRequired, async (req: AuthedRequest, res: Response) => {
  const docs = await prisma.document.findMany({
    where: { classroomId: req.params.classroomId },
    select: { id: true, title: true, fileType: true, fileName: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(docs);
});

export default router;
