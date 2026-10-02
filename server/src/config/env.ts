import dotenv from 'dotenv';
import path from 'path';

// 优先读取 server/.env，其次项目根 .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`[config] 缺少必要环境变量: ${name}`);
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  ai: {
    baseURL: process.env.AI_BASE_URL ?? '',
    apiKey: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'gpt-3.5-turbo',
    contextCharLimit: Number(process.env.AI_CONTEXT_CHAR_LIMIT ?? 6000),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60000),
  },
  uploadDir: path.resolve(__dirname, '../../uploads'),
};

export function isAiConfigured(): boolean {
  return Boolean(config.ai.baseURL && config.ai.apiKey);
}
