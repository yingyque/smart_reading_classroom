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
import { initSharedKeyPool, pickSharedKey } from './services/sharedKeyService';

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
  // 从数据库（SharedKey 表，加密字段）加载共享 Key 池，按轮询分配给学生的 AI 调用
  const poolCount = await initSharedKeyPool();
  // 兼容旧逻辑：注册自动绑定仍需要一个主共享 Key（取池内轮询到的第一个）
  config.workspace.apiKey = pickSharedKey()?.plain ?? '';
  if (poolCount > 0) {
    console.log(`[config] 已载入学生共享 Key 池：${poolCount} 个 Key 轮询分配`);
  } else {
    console.warn('[config] 共享 Key 池为空：新注册学生将无法自动分配 AI Key，请用 addSharedKey 脚本写入');
  }

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n智慧阅读平台后端已启动, 端口: ${config.port}`);
    console.log(`AI 接口状态: ${isAiConfigured() ? '已配置 ✓' : '未配置（请在 .env 填写 AI_BASE_URL / AI_API_KEY）'}\n`);
    // 学生 AI 容器常驻运行，暂停/开启完全由教师在端上控制
  });
}

bootstrap();
