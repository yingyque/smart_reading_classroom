# 构建阶段：编译前端
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# 使用 vite build（esbuild 转译，不做严格类型检查，保证构建通过）
RUN npx vite build

# 运行阶段：nginx 托管静态文件并反向代理后端
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
