import crypto from 'crypto';
import { config } from '../config/env';

// AES-256-GCM 加密学生 AI Key，密钥从 JWT_SECRET 派生
// 存储格式：iv:tag:ciphertext（各段 base64）

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwtSecret).digest();
}

export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptKey(encrypted: string): string {
  const [ivB64, tagB64, dataB64] = encrypted.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('加密 Key 格式无效');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

// Key 指纹：相同明文恒定输出，用于「一个 Key 只能被一个学生使用」的唯一性校验
// （密文带随机 IV，同明文密文不同，无法直接建唯一索引）
export function keyFingerprint(plain: string): string {
  return crypto.createHmac('sha256', deriveKey()).update(plain.trim()).digest('hex');
}

// 教师端/学生端展示用掩码：sk-***xxxx（保留最后 4 位）
export function maskKey(plain: string): string {
  if (plain.length <= 6) return '***';
  return `${plain.slice(0, 3)}***${plain.slice(-4)}`;
}
