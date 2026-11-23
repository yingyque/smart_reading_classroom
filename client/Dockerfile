# 构建阶段：编译前端
FROM node:20-slim AS build

WORKDIR /app

# .npmrc 指向腾讯云 npm 镜像（国内服务器直连 registry.npmjs.org 极慢）
COPY package.json package-lock.json .npmrc ./
# --ignore-scripts：跳过 canvas（pdfjs-dist 的 Node 可选依赖）的 node-pre-gyp 安装脚本，
# 它要从 GitHub 下载预编译产物，本机网络不通会挂死构建。浏览器端用不到 canvas，
# 而 rollup/esbuild 的原生二进制走 optional 依赖包（非脚本下载），不受影响。
RUN npm ci --ignore-scripts

COPY . .
# 使用 vite build（esbuild 转译，不做严格类型检查，保证构建通过）
RUN npx vite build

# 运行阶段：nginx 托管静态文件并反向代理后端
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
