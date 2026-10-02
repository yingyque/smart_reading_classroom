// 后端服务地址配置
// 开发环境：留空，走 Vite 代理（vite.config.ts 中已配置 /api 与 /socket.io 代理到本地后端）
// 生产环境：在 Vercel 配置环境变量 VITE_API_BASE_URL = 你的 Render 后端完整地址
//   例如 https://smart-reading-server.onrender.com
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

// REST 接口前缀
export const API_PREFIX = `${API_BASE_URL}/api`;

// Socket.io 连接目标：生产用后端完整地址，开发用同源（走代理）
export const SOCKET_URL = API_BASE_URL || '/';
