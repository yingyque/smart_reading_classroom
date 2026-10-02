#!/bin/bash
# 智慧阅读平台 - 一键启动脚本（macOS 双击运行）
# 双击本文件即可启动前后端服务，并自动打开浏览器。

# 切换到脚本所在目录（即项目根目录），无论从哪里双击都能正确定位
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "   智慧阅读平台 · 启动中"
echo "============================================"
echo "项目目录：$(pwd)"
echo ""

# ---- 1. 检查 Node 是否安装 ----
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装：https://nodejs.org/"
  echo "按任意键关闭窗口..."
  read -n 1
  exit 1
fi
echo "✅ Node 版本：$(node -v)"

# ---- 2. 检查依赖是否已安装，缺失则自动安装 ----
if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ]; then
  echo ""
  echo "⏳ 检测到依赖未安装，正在安装（首次运行需要几分钟）..."
  npm install
  npm --prefix server install --include=optional
  npm --prefix client install --include=optional
fi

# ---- 3. 确保 esbuild 平台二进制存在（tsx/vite 依赖它）----
if [ ! -d "server/node_modules/@esbuild" ]; then
  echo "⏳ 补装后端 esbuild 二进制..."
  npm --prefix server install @esbuild/darwin-arm64 --no-save --include=optional >/dev/null 2>&1
fi
if [ ! -d "client/node_modules/@esbuild" ]; then
  echo "⏳ 补装前端 esbuild 二进制..."
  npm --prefix client install @esbuild/darwin-arm64 --no-save --include=optional >/dev/null 2>&1
fi

# ---- 4. 初始化数据库（若不存在）----
if [ ! -f "server/prisma/dev.db" ]; then
  echo "⏳ 初始化数据库..."
  npm --prefix server run db:push
fi

echo ""
echo "🚀 正在启动前后端服务..."
echo "   后端 API：http://localhost:4000"
echo "   前端界面：http://localhost:5173  ← 在浏览器打开这个"
echo ""
echo "⚠️  请勿关闭此窗口，关闭即停止服务。"
echo "   停止服务：按 Control + C，或直接关闭窗口。"
echo "============================================"
echo ""

# ---- 5. 延迟几秒后自动打开浏览器到前端地址 ----
( sleep 6; open "http://localhost:5173" ) &

# ---- 6. 启动前后端（前台运行，日志实时显示在窗口里）----
npm run dev
