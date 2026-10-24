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

// 支持配置多个前端来源（逗号分隔），用于本地开发 + 线上域名共存
const rawOrigins = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const clientOrigins = rawOrigins
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // 兼容旧用法：单值仍可用；CORS 处用 clientOrigins 做白名单匹配
  clientOrigin: clientOrigins[0] ?? 'http://localhost:5173',
  clientOrigins,
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  ai: {
    baseURL: process.env.AI_BASE_URL ?? '',
    apiKey: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'gpt-3.5-turbo',
    contextCharLimit: Number(process.env.AI_CONTEXT_CHAR_LIMIT ?? 6000),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60000),
  },
  workspace: {
    // 学生工作台容器镜像
    image: process.env.WORKSPACE_IMAGE ?? 'smart-reading-workspace:latest',
    // 预制的 AI 接口字段（学生只需输入 key）
    aiBaseURL: process.env.WORKSPACE_AI_BASE_URL || process.env.AI_BASE_URL || '',
    // 学生端统一共享 Key（所有学生共用，免输入）。
    // 注意：明文绝不落盘/不进环境变量，仅以加密形式存于数据库；运行时由启动时从 DB 解密填充（见 index.ts）
    apiKey: '',
    aiModel: process.env.WORKSPACE_AI_MODEL || process.env.AI_MODEL || 'glm-5',
    // 单次 codebuddy exec 超时（长文献上下文较慢，放宽以免被掐断）
    execTimeoutMs: Number(process.env.WORKSPACE_EXEC_TIMEOUT_MS ?? 300000),
  },
  uploadDir: path.resolve(__dirname, '../../uploads'),
};

export function isAiConfigured(): boolean {
  return Boolean(config.ai.baseURL && config.ai.apiKey);
}
