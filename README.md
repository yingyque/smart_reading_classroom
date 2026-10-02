# 智慧阅读 · 研究生课堂文献协作平台

面向研究生课堂的「智慧阅读 + 小组协作 + AI 讨论 + 数据可视化」教学平台。教师上传文献，50+ 学生加入课堂后被随机分组，在沉浸式「左读右聊」界面中边读文献边与小组成员及 AI 讨论。平台完整记录「学生↔学生」与「学生↔AI」两类对话，并产出词云、活跃度时间线、小组互动网络、小组对比与个人画像。

## 技术栈

- 前端：React 18 + TypeScript + Vite + Tailwind CSS + Recharts + ECharts + socket.io-client
- 后端：Node.js + Express + TypeScript + Socket.IO + Prisma
- 数据库：SQLite（本地零配置，可平滑迁移到 PostgreSQL）
- 文献解析：pdf-parse（PDF）、mammoth（docx）、原生读取（txt）
- 中文分词：nodejieba（可选，安装失败时自动降级为简易分词）
- AI：OpenAI 兼容 Chat Completions 接口（后端代理，密钥不暴露前端）

## 目录结构

```
smart-reading-platform/
├── server/   # 后端 Express + Socket.IO + Prisma
└── client/   # 前端 React + Vite
```

## 快速开始

### 1. 安装依赖

```bash
# 根目录
npm install
# 后端
cd server && npm install
# 前端
cd ../client && npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `server/.env`，填写你的 AI 接口信息：

```bash
cp .env.example server/.env
```

```ini
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=请替换为随机字符串
DATABASE_URL="file:./dev.db"

# OpenAI 兼容接口（通义/DeepSeek/Kimi/本地部署等）
AI_BASE_URL=https://your-endpoint/v1
AI_API_KEY=your-api-key
AI_MODEL=your-model-name
```

> 未配置 AI 时平台仍可运行，AI 讨论会返回友好提示。

### 3. 初始化数据库

```bash
cd server
npx prisma generate
npx prisma migrate dev --name init
```

### 4. 启动

在根目录一键并发启动前后端：

```bash
npm run dev
```

- 后端：http://localhost:4000
- 前端：http://localhost:5173

## 使用流程

1. 教师注册登录 → 新建课堂（得到 6 位课堂码）→ 上传文献 → 设定组数一键随机分组。
2. 学生注册登录 → 输入课堂码加入 → 等待分组 → 进入阅读室。
3. 阅读室：左侧阅读文献，右侧切换「小组讨论 / AI 讨论」实时交流。
4. 教师进入「分析看板」查看词云、时间线、互动网络、小组对比与个人画像，教师在线时看板随新消息自动刷新。

## 安全说明

- 所有 REST 与 Socket 连接均需 JWT 鉴权，Socket 握手校验令牌。
- AI 密钥仅存于后端 `.env`，经后端代理调用，不下发前端。
- 密码使用 bcrypt 哈希存储。
- 生产部署前请替换 `JWT_SECRET`，并通过 HTTPS 暴露服务。
