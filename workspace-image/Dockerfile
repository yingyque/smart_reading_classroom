# 学生 AI 工作台镜像：Node + CodeBuddy CLI
# 容器不直接暴露端口，由平台通过 docker exec 调用 codebuddy headless 模式
FROM node:20-slim

# 注：构建容器内 80 端口不通且镜像无 CA 证书，注入宿主机 CA 包
COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# 全局安装 CodeBuddy CLI
RUN npm config set cafile /etc/ssl/certs/ca-certificates.crt \
 && npm install -g @tencent-ai/codebuddy-code \
 && npm cache clean --force

ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1

WORKDIR /workspace

# 保持容器存活，等待 exec 调用
CMD ["sleep", "infinity"]
