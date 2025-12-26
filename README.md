# OnlyOffice + MinIO 文档协作平台

这是一个基于 Docker 容器化的 OnlyOffice 文档协作平台，集成了 MinIO 对象存储、PostgreSQL 数据库、Redis 缓存和 RabbitMQ 消息队列，提供完整的在线文档编辑、协作和存储解决方案。

## node版本

node -v
v22.21.1



## 项目架构

项目采用微服务架构，由以下核心组件组成：

- **OnlyOffice Document Server** - 提供在线文档编辑和协作功能
- **Node.js 后端服务** - 处理文件上传下载、用户认证和回调处理
- **MinIO 对象存储** - 存储文档文件，提供高可用的存储服务
- **PostgreSQL 数据库** - 存储 OnlyOffice 的配置和状态信息
- **Redis 缓存** - 提高系统响应速度和性能
- **RabbitMQ 消息队列** - 处理服务间的消息通信
- **Nginx 反向代理** - （可选）用于请求转发和负载均衡

## 功能特点

- **在线文档编辑** - 支持 Word、Excel、PowerPoint 等格式的在线编辑
- **文档协作** - 多人实时协作编辑文档
- **文件管理** - 上传、下载、预览文档
- **安全认证** - 支持 JWT 令牌认证机制
- **对象存储集成** - 与 MinIO 无缝集成，提供可靠的文件存储
- **文档格式转换** - 支持多种文档格式的转换
- **Docker 容器化** - 所有服务均容器化，便于部署和管理

## 快速开始

### 环境要求

- Docker 和 Docker Compose 已安装
- 至少 2GB RAM（推荐 4GB+）
- 至少 10GB 磁盘空间
- 操作系统：Windows、Linux 或 macOS

### 安装与部署

1. **克隆仓库**

   ```bash
   git clone <repository-url>
   cd Docker-Onlyoffice-Monorepo
   ```

   ```

2. **启动服务**

   使用 Docker Compose 启动所有服务：

   ```bash
   # Windows (PowerShell)
   ./start_all_services.ps1
   
   # 或使用标准 Docker Compose 命令
   docker-compose up -d
   ```

3. **验证服务启动**

   服务启动后，可以通过以下地址访问：
   - OnlyOffice 文档服务器: http://localhost:28080
   - MinIO 控制台: http://localhost:29001
   - Node.js 后端 API: http://localhost:8000
   - PostgreSQL: localhost:25432
   - Redis: localhost:26379
   - RabbitMQ 管理界面: http://localhost:45672

4. 验证服务状态运行测试脚本

   项目包含一个测试脚本 `test_services.ps1`，用于验证所有服务是否正常运行。

   ```bash
   # Windows (PowerShell)
    powershell -ExecutionPolicy Bypass -File d:\docker-data\test-simple.ps1
   ```

   脚本将检查以下服务：
   - OnlyOffice 文档服务器
   - MinIO 存储服务
   - Node.js 后端服务
   - PostgreSQL 数据库
   - Redis 缓存
   - RabbitMQ 消息队列

   如果所有服务都正常运行，将输出 "All services are up and running!"。

## 环境变量配置

主要环境变量说明（详细配置见 `.env`）：

### MinIO 配置
```
MINIO_ROOT_USER=admin                 # MinIO 管理员用户名
MINIO_ROOT_PASSWORD=admin123          # MinIO 管理员密码
MINIO_BUCKET_NAME=onlyoffice          # 文档存储桶名称
MINIO_REGION=us-east-1                # 存储区域
MINIO_PORT=29000                      # API 端口
MINIO_CONSOLE_PORT=29001              # 控制台端口
```

### OnlyOffice 配置
```
ONLYOFFICE_PORT=28080                 # OnlyOffice 服务端口
ONLYOFFICE_JWT_ENABLED=false          # 是否启用 JWT 认证
ONLYOFFICE_JWT_SECRET=my_secret_key   # JWT 密钥
```

### 数据库配置
```
POSTGRES_DB=onlyoffice                # 数据库名称
POSTGRES_USER=onlyoffice              # 数据库用户名
POSTGRES_PASSWORD=onlyoffice_pass     # 数据库密码
```

## API 使用指南

### 文件上传接口

```
POST /upload2
Content-Type: multipart/form-data
```

参数：
- `file`: 要上传的文件

返回：
- 包含文件信息和 OnlyOffice 配置的 JSON 对象

示例响应：
```json
{
  "filename": "1766543027603-",
  "url": "/files/1766543027603-",
  "size": 10240,
  "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "documentKey": "key-1766543027603",
  "downloadUrl": "http://localhost:8000/downloadfile/key-1766543027603",
  "config": {...}  // OnlyOffice 编辑器配置
}
```

### 文件下载接口

```
GET /files/:filename
```

参数：
- `filename`: 文件名

### 文档回调接口

```
POST /callback
Content-Type: application/json
```

用于 OnlyOffice 保存文档时的回调处理。

### 文件列表接口

```
GET /filelist
```

返回所有已上传文件的列表。

### 健康检查接口

```
GET /health
```

检查服务是否正常运行。

## OnlyOffice 集成

### 在前端页面集成 OnlyOffice 编辑器

1. 引入 OnlyOffice JavaScript 库

```html
<script src="http://localhost:28080/web-apps/apps/api/documents/api.js"></script>
```

2. 创建编辑器容器

```html
<div id="editor"></div>
```

3. 初始化编辑器

```javascript
// 上传文件后获取的配置
const config = {...}; // 从 /upload2 接口获取的 config 对象

// 初始化编辑器
const docEditor = new DocsAPI.DocEditor("editor", config);
```

## 项目目录结构

```
Docker-Onlyoffice-Monorepo/
├── .env.fixed              # 环境变量配置示例
├── .env.alternative        # 可选环境变量配置
├── docker-compose.yml      # Docker Compose 配置
├── node/                   # Node.js 后端服务
│   ├── index.js            # 主程序
│   ├── jwt-utils.js        # JWT 工具
│   ├── package.json        # 依赖配置
│   ├── uploads/            # 本地文件存储（临时）
│   └── temp_uploads/       # 临时上传目录
├── minio/                  # MinIO 配置和数据
│   ├── config/             # MinIO 配置
│   ├── data/               # MinIO 数据目录
│   └── data_backup/        # MinIO 数据备份
├── onlyoffice/             # OnlyOffice 数据
│   ├── data/               # 配置和证书
│   ├── fonts/              # 字体文件
│   └── plugins/            # 插件
├── onlyoffice-config/      # OnlyOffice 配置文件
│   └── local.json          # 主配置文件
├── postgres/               # PostgreSQL 数据
├── rabbitmq/               # RabbitMQ 数据
├── redis/                  # Redis 数据
├── start_all_services.ps1  # Windows 启动脚本
└── testDoc/                # 测试文档
```

## 常见问题与解决方案

### 文件上传失败

- 检查 MinIO 服务是否正常运行
- 验证 `MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY` 配置是否正确
- 确认存储桶权限设置正确

### OnlyOffice 编辑器无法加载

- 检查 OnlyOffice 服务状态
- 验证 `callbackUrl` 配置是否可从 OnlyOffice 容器访问
- 检查跨域配置是否正确

### 文档保存问题

- 验证回调接口 `/callback` 是否正常工作
- 检查文件权限设置
- 查看 Node.js 和 OnlyOffice 日志获取详细错误信息

## 性能优化

1. **增加内存配置** - 根据并发用户数调整容器内存限制
2. **配置 Redis 缓存** - 启用缓存提高响应速度
3. **MinIO 性能调优** - 根据需求调整 MinIO 配置
4. **使用 Nginx 反向代理** - 配置适当的缓存和压缩策略

## 安全性建议

1. **启用 JWT 认证** - 设置 `ONLYOFFICE_JWT_ENABLED=true`
2. **使用 HTTPS** - 配置 SSL/TLS 证书
3. **限制 IP 访问** - 在 `onlyoffice-config/local.json` 中配置允许的 IP 地址
4. **定期备份数据** - 特别是 MinIO 存储的数据和 PostgreSQL 数据库
5. **更新密码和密钥** - 不要使用默认的密码和密钥

## 许可证

[MIT License](LICENSE)

## 作者

OnlyOffice + MinIO 文档协作平台开发团队

## 更新日志

### v1.0.0
- 初始版本发布
- 集成 OnlyOffice 和 MinIO
- 实现基本的文件上传下载功能
- 支持文档在线编辑和协作