import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { authRequired, AuthedRequest } from '../middleware/auth';
import { config } from '../config/env';

// 聊天附件：小组讨论 / AI 讨论中随消息发送的图片与文档（PDF / Word / PPT / Excel）
const router = Router();

// 附件目录（与文献上传共用 server-uploads 卷，子目录隔离）
const CHAT_DIR = path.join(config.uploadDir, 'chat');
if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

// mimetype → 扩展名白名单（双重校验，杜绝伪造扩展名）
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

// 允许的扩展名（老版 Office 二进制格式 .doc/.ppt/.xls 在部分浏览器 mimetype 为空或怪值，按扩展名兜底）
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);
const EXT_FIX: Record<string, string> = { jpeg: 'jpg' }; // 存储名统一用 jpg

// 从原始文件名取白名单内的小写扩展名（不含点）；非法返回 null
function allowedExtOf(originalName: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(originalName);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ALLOWED_EXTS.has(ext) ? (EXT_FIX[ext] ?? ext) : null;
}

// 文件名规则（上传时生成，访问时校验，防路径穿越）
export const CHAT_FILE_NAME_RE = /^chat-[A-Za-z0-9_-]+\.(png|jpg|gif|webp|pdf|doc|docx|ppt|pptx|xls|xlsx)$/;

// ===== 文件头（magic number）校验：按存储扩展名核对真实内容，防改名伪造 =====
// OLE2 复合文档头（旧版 Office 二进制 .doc/.ppt/.xls）
const isOle2 = (b: Buffer) =>
  b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
// ZIP 头 PK\x03\x04（新版 Office .docx/.pptx/.xlsx 本质是 zip）
const isZip = (b: Buffer) =>
  b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) && b[3] === 4;
const MAGIC_BY_EXT: Record<string, (head: Buffer) => boolean> = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.subarray(0, 3).toString('latin1') === 'GIF',
  webp: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  doc: isOle2,
  ppt: isOle2,
  xls: isOle2,
  docx: isZip,
  pptx: isZip,
  xlsx: isZip,
};

// 读文件前 12 字节核对签名（读不了按不匹配处理，调用方负责删文件）
function headMatches(filePath: string, check: (head: Buffer) => boolean): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(12);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    return check(head.subarray(0, n));
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// 落库的 attachments JSON → 规范附件数组（sockets 广播、历史消息、分析端共用）
// 旧消息没有 attachments 列时回退 filePath/fileOrigName；坏数据按无附件处理
export function parseChatAttachments(
  raw: unknown,
  filePath: string | null,
  fileOrigName: string | null,
): { path: string; origName: string | null }[] {
  if (Array.isArray(raw)) {
    const out: { path: string; origName: string | null }[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const p = (item as { path?: unknown }).path;
      const n = (item as { origName?: unknown }).origName;
      if (typeof p === 'string' && CHAT_FILE_NAME_RE.test(p)) {
        out.push({ path: p, origName: typeof n === 'string' ? n.slice(0, 200) : null });
      }
    }
    if (out.length) return out;
  }
  return filePath ? [{ path: filePath, origName: fileOrigName }] : [];
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CHAT_DIR),
  filename: (_req, file, cb) => {
    // 优先按 mimetype 定扩展名（防伪造），mimetype 缺失时按原始文件名兜底
    const ext = EXT_BY_MIME[file.mimetype]?.slice(1) ?? allowedExtOf(file.originalname);
    if (!ext) {
      return cb(new Error('仅支持 PNG / JPG / GIF / WebP 图片与 PDF / Word / PPT / Excel 文件'), '');
    }
    cb(null, `chat-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype] || allowedExtOf(file.originalname)) cb(null, true);
    else cb(new Error('仅支持 PNG / JPG / GIF / WebP 图片与 PDF / Word / PPT / Excel 文件'));
  },
});

// 统一取附件（正则已防路径穿越，不存在返回 404）
function sendChatFile(req: AuthedRequest, res: Response) {
  const name = req.params.fileName;
  if (!CHAT_FILE_NAME_RE.test(name)) {
    return res.status(400).json({ error: '参数错误' });
  }
  const filePath = path.join(CHAT_DIR, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  return res.sendFile(filePath);
}

// 上传聊天附件（登录即可，学生教师通用）
router.post('/file', authRequired, upload.single('file'), (req: AuthedRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  // 内容校验：文件头与扩展名不符（改名伪造 / 文件损坏）→ 删除已落盘文件并拒绝
  const ext = path.extname(req.file.filename).slice(1);
  const checkHead = MAGIC_BY_EXT[ext];
  if (checkHead && !headMatches(req.file.path, checkHead)) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      // 删除失败不影响响应（残留文件无法通过 CHAT_FILE_NAME_RE 之外的路径访问）
    }
    return res.status(400).json({
      error: `「${req.file.originalname}」内容与文件类型不符（扩展名可能被改动，或文件已损坏），请上传原文件`,
    });
  }
  return res.json({ fileName: req.file.filename });
});

// 访问聊天附件（<img>/<a> 无法带 Authorization 头，authRequired 已支持 ?token= 查询参数）
router.get('/file/:fileName', authRequired, sendChatFile);

// 旧版客户端兼容：升级部署瞬间仍在用的旧 bundle 走 /chat/image/ 取历史消息里的图片
router.get('/image/:fileName', authRequired, sendChatFile);

export default router;
