import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { config, isAiConfigured } from './config/env';
import authRoutes from './routes/auth';
import classroomRoutes from './routes/classroom';
import documentRoutes from './routes/documents';
import analyticsRoutes from './routes/analytics';
import workspaceRoutes from './routes/workspaces';
import adminRoutes from './routes/admin';
import { registerChatHandlers } from './sockets/chat';
import { getSharedStudentKey } from './services/sharedKeyService';

const app = express();
const server = http.createServer(app);

// CORS 白名单：允许配置的前端来源；无 Origin（同源/服务器直连）放行
const corsOrigin = (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => {
  if (!origin || config.clientOrigins.includes(origin)) {
    cb(null, true);
  } else {
    cb(new Error(`CORS 拒绝来源: ${origin}`));
  }
};

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: isAiConfigured() });
});

app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/shimin', adminRoutes);

// 统一错误处理（含 multer 错误）
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err.message);
    res.status(400).json({ error: err.message || '服务器错误' });
  },
);

const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
});
registerChatHandlers(io);

// 云平台（Render 等）要求监听 0.0.0.0 和平台分配的 PORT
async function bootstrap() {
  // 从数据库（加密字段）解析统一共享 Key 并填入运行期配置，避免明文落盘
  const sharedKey = await getSharedStudentKey();
  if (sharedKey) {
    config.workspace.apiKey = sharedKey;
    console.log('[config] 已载入学生统一共享 Key（来自数据库加密字段）');
  } else {
    console.warn('[config] 未找到学生统一共享 Key：新注册学生将无法自动分配 AI Key，请用 set-shared-key 脚本写入');
  }

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n智慧阅读平台后端已启动, 端口: ${config.port}`);
    console.log(`AI 接口状态: ${isAiConfigured() ? '已配置 ✓' : '未配置（请在 .env 填写 AI_BASE_URL / AI_API_KEY）'}\n`);
    // 学生 AI 容器常驻运行，暂停/开启完全由教师在端上控制
  });
}

bootstrap();
