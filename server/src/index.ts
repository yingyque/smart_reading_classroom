import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { config, isAiConfigured } from './config/env';
import authRoutes from './routes/auth';
import classroomRoutes from './routes/classroom';
import documentRoutes from './routes/documents';
import analyticsRoutes from './routes/analytics';
import { registerChatHandlers } from './sockets/chat';

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: isAiConfigured() });
});

app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/analytics', analyticsRoutes);

// 统一错误处理（含 multer 错误）
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err.message);
    res.status(400).json({ error: err.message || '服务器错误' });
  },
);

const io = new Server(server, {
  cors: { origin: config.clientOrigin, credentials: true },
});
registerChatHandlers(io);

server.listen(config.port, () => {
  console.log(`\n智慧阅读平台后端已启动: http://localhost:${config.port}`);
  console.log(`AI 接口状态: ${isAiConfigured() ? '已配置 ✓' : '未配置（请在 .env 填写 AI_BASE_URL / AI_API_KEY）'}\n`);
});
