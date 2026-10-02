# 部署指南：把平台上线给学生用（教室 8 次课堂活动）

本指南带你把平台部署到云端，让学生在教室里通过一个固定网址访问。
整体架构：

- 前端（React）→ 部署到 **Vercel**，学生打开的网址就是这个
- 后端（Express + Socket.io）→ 部署到 **Render**
- 数据库（PostgreSQL）→ 由 **Render** 免费提供，数据长期保留
- AI → 你的 DeepSeek（或其他 OpenAI 兼容）API Key，填在 Render 后端环境变量里

全程使用免费额度即可，适合 30-60 人同时在线的课堂规模。

---

## 准备工作（约 10 分钟）

1. 一个 GitHub 账号（已有：仓库 `yingyque/smart_reading_classroom`）
2. 注册 [Render](https://render.com) 账号 —— 用 GitHub 登录最方便
3. 注册 [Vercel](https://vercel.com) 账号 —— 同样用 GitHub 登录
4. 准备好你的 AI 接口信息：
   - `AI_BASE_URL`（如 `https://api.deepseek.com/v1`）
   - `AI_API_KEY`（你的密钥，务必不要发给别人或提交到代码里）
   - `AI_MODEL`（如 `deepseek-chat`）

---

## 第一步：部署后端 + 数据库（Render）

1. 登录 Render，点右上角 **New +** → **Blueprint**。
2. 选择你的 GitHub 仓库 `smart_reading_classroom`。Render 会自动读取仓库根目录的 `render.yaml`，
   显示将要创建的两个资源：
   - 数据库 `smart-reading-db`
   - Web 服务 `smart-reading-server`
3. 点击 **Apply**。Render 开始创建数据库并构建后端（首次约 3-5 分钟）。
4. 构建完成后，进入 `smart-reading-server` 服务 → **Environment** 标签，填入这几个值：
   - `AI_BASE_URL` = 你的接口地址
   - `AI_API_KEY` = 你的密钥
   - `AI_MODEL` = 你的模型名
   - `CLIENT_ORIGIN` = **先留空，等第二步拿到 Vercel 域名后回来填**
   （`DATABASE_URL`、`JWT_SECRET` 已由 render.yaml 自动生成，无需手动填）
5. 记下后端地址，形如：`https://smart-reading-server.onrender.com`
   在浏览器打开 `https://smart-reading-server.onrender.com/api/health`，
   看到 `{"ok":true,"aiConfigured":true}` 就说明后端 + 数据库 + AI 都正常。

> 若 `aiConfigured` 为 false，说明 AI 的两个变量没填对，回第 4 步检查。

---

## 第二步：部署前端（Vercel）

1. 登录 Vercel，点 **Add New...** → **Project**，导入仓库 `smart_reading_classroom`。
2. 在配置页：
   - **Root Directory** 设为 `client`（点 Edit 选择 client 目录）。
   - Framework 会自动识别为 Vite。
   - 展开 **Environment Variables**，添加一个：
     - Name：`VITE_API_BASE_URL`
     - Value：第一步记下的后端地址，例如 `https://smart-reading-server.onrender.com`
       （不要带结尾斜杠）
3. 点 **Deploy**，等待约 1-2 分钟。
4. 部署完成后拿到前端网址，形如：`https://smart-reading-classroom.vercel.app`
   —— **这就是发给学生的网址。**

---

## 第三步：把前后端连起来（关键，别漏）

1. 回到 Render 的 `smart-reading-server` → **Environment**。
2. 把 `CLIENT_ORIGIN` 填为你的 Vercel 网址，例如：
   `https://smart-reading-classroom.vercel.app`
   （如需本地也能连，可填多个，用英文逗号隔开：
   `http://localhost:5173,https://smart-reading-classroom.vercel.app`）
3. 保存，Render 会自动重启后端（约 1 分钟）。

完成后，打开 Vercel 前端网址，注册一个教师账号测试登录、建课堂、上传文献、学生加入、AI 讨论是否正常。

---

## 上课使用流程

1. 课前：你用教师账号登录，创建课堂、上传本次文献、分好组，拿到课堂码。
2. 上课：把前端网址 + 课堂码写在投影上，学生各自用手机/电脑打开网址，注册/登录后输入课堂码加入。
3. 8 次课的数据（账号、讨论记录、文献文本）都存在 Render 的 Postgres 里，持续保留，随时回看。

---

## 必须知道的几个限制与建议

1. **Render 免费后端会"休眠"**：15 分钟无访问后自动休眠，下次访问需等约 30-50 秒唤醒。
   - 建议：每次上课前 5 分钟，自己先打开一次网址把它"叫醒"。
   - 若觉得影响体验，可升级 Render 的付费实例（约 7 美元/月）避免休眠。

2. **上传的 PDF 原文件在后端重启后会丢失**：
   - 文献的**纯文本内容**（AI 用的、页面阅读用的）存在数据库里，**不会丢**。
   - 丢的只是"查看 PDF 原版"功能依赖的原始文件。Render 免费实例磁盘是临时的。
   - 建议：若需要长期保留 PDF 原件，在 Render 给服务加一块持久磁盘（Disk），
     或改用对象存储（如 S3）。需要的话我可以帮你改成持久磁盘方案。

3. **AI 费用**：学生用得越多，调用你的 API Key 越多。建议在 AI 服务商后台给这个 Key 设消费上限。

4. **数据库免费额度**：Render 免费 Postgres 容量有限（通常 1GB），8 次课的文本数据远远够用。
   注意免费数据库有效期政策（Render 政策可能调整），如长期使用建议关注到期提醒或升级。

---

## 本地开发仍然可用

本次改动不影响你本地开发：

```bash
npm run dev
```

本地前端不设 `VITE_API_BASE_URL`，会自动走 `vite.config.ts` 里的代理连本地后端。
注意：由于数据库已切换为 PostgreSQL，本地若要运行后端，需要本地装一个 PostgreSQL 并在
`server/.env` 配好 `DATABASE_URL`；或把 `server/prisma/schema.prisma` 的 provider
临时改回 `sqlite` 做本地调试。
