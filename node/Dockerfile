FROM node:16-alpine

WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制应用代码
COPY . .

# 创建必要的目录
RUN mkdir -p temp_uploads uploads

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["npm", "start"]