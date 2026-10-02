FROM node:20-slim

WORKDIR /app

# 安装 OpenSSL（Prisma engine 依赖）
# 注：构建容器内 80 端口不通且镜像无 CA 证书，注入宿主机 CA 包并改用 HTTPS 源
COPY certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Docker CLI（管理学生工作台容器，通过挂载的 docker.sock）
COPY --from=docker:26.1.3-cli /usr/local/bin/docker /usr/local/bin/docker

# 安装依赖（nodejieba 为可选依赖，安装失败会自动降级为简易分词）
# 注意：package.json 的 postinstall 会执行 prisma generate，需先拷贝 schema
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# 编译 TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 4000

# 启动前先同步数据库结构（PostgreSQL，连接串由环境变量 DATABASE_URL 提供）
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
