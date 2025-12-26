const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const MinIO = require("minio");
const dotenv = require("dotenv");
const httpProxy = require("http-proxy");
// 添加JWT库
const jwt = require("jsonwebtoken");
// 添加axios模块用于HTTP请求
const axios = require('axios');
const { generateOnlyOfficeToken } = require("./jwt-utils");
// 加载环境变量
dotenv.config({ path: path.join(__dirname, "../.env") });

const app = express();
const PORT = 8000;

// 从环境变量获取JWT密钥和头部配置，使用正确的环境变量名
const JWT_SECRET =
  process.env.ONLYOFFICE_JWT_SECRET || "my_secret_key_for_onlyoffice";
const JWT_HEADER = process.env.ONLYOFFICE_JWT_HEADER || "AuthorizationJwt";

// 全局请求日志中间件 - 在所有中间件之前添加
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// 设置CORS
app.use(cors());

// 解析JSON请求体
app.use(express.json());

// 确保临时上传目录存在（用于文件处理）

// 确保临时上传目录存在（用于文件处理）
const tempUploadDir = path.join(__dirname, "temp_uploads");
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// 配置MinIO客户端 - 使用专用账号
const minioClient = new MinIO.Client({
  endPoint: process.env.MINIO_ENDPOINT || "minio", // 使用容器名，这样在Docker网络中可以直接解析
  port: parseInt(process.env.MINIO_PORT || "9000"),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || "hekun", // 使用专用访问账号
  secretKey: process.env.MINIO_SECRET_KEY || "qqqqqqqq", // 使用专用访问密码
});

const bucketName = process.env.MINIO_BUCKET_NAME || "onlyoffice-documents";

// 配置multer使用内存存储
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// 确保MinIO桶存在
async function ensureBucketExists() {
  try {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(
        bucketName,
        process.env.MINIO_REGION || "us-east-1"
      );
      console.log(`Bucket '${bucketName}' created successfully`);

      // 只有在创建新桶时才设置桶策略
      await setBucketPolicy();
    } else {
      console.log(`Bucket '${bucketName}' already exists, skipping creation`);

      // 可选：是否对已存在的桶设置策略
      // 从环境变量读取配置，默认为false不设置
      const updateExistingPolicy =
        process.env.UPDATE_EXISTING_BUCKET_POLICY === "true";
      if (updateExistingPolicy) {
        console.log(`Updating policy for existing bucket '${bucketName}'`);
        await setBucketPolicy();
      }
    }
  } catch (error) {
    console.error("Error setting up MinIO bucket:", error);
  }
}

// 设置桶策略的辅助函数
async function setBucketPolicy() {
  try {
    await minioClient.setBucketPolicy(
      bucketName,
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      })
    );
    console.log(`Bucket policy for '${bucketName}' set successfully`);
  } catch (error) {
    console.error("Error setting bucket policy:", error);
  }
}

// 初始化MinIO桶
ensureBucketExists();
app.get("/health2", (req, res) => {
  res.json({ message: "POST请求成功", timestamp: new Date().getTime() });
});
// 测试POST路由
app.post("/test-post", (req, res) => {
  console.log("测试POST路由被调用");
  res.json({ message: "POST请求成功", timestamp: new Date().getTime() });
});

// 测试GET路由
app.get("/test-get", (req, res) => {
  console.log("测试GET路由被调用");
  res.json({ message: "GET请求成功", timestamp: new Date().getTime() });
});


// 文件上传接口 - 使用MinIO -集成token返回，config配置
/**
 * 生成 MinIO 预签名 GET URL
 * @param {string} bucketName - MinIO 桶名
 * @param {string} objectName - MinIO 中的对象名（如 onlyoffice-documents/1766543027603-）
 * @param {number} expires - URL 过期时间（单位：秒，示例为 7 天 = 604800 秒）
 * @returns {Promise<string>} 带签名的预签名 URL
 */
async function generatePresignedUrl(bucketName, objectName, expires = 604800) {
  try {
    // SDK 自动生成包含 X-Amz-* 签名参数的 URL
    const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, expires);
    console.log('生成的预签名 URL：', presignedUrl);
    return presignedUrl;
  } catch (err) {
    console.error('生成预签名 URL 失败：', err);
    throw err;
  }
}
app.post("/upload2", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    // 确保中文文件名正确处理，使用更安全的方式处理文件名，避免MinIO不支持的字符
    const timestamp = Date.now();
    // 使用正则表达式移除或替换MinIO不支持的特殊字符
    const safeOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '_');
    // const filename = timestamp + "-" + safeOriginalName;
    const filename = timestamp + "-";
    const fileStream = new Buffer(req.file.buffer, "binary");
    //从原始文件名中提取扩展名，而不是从mimetype中获取
    const originalFilename = req.file.originalname;
    const sign = await generatePresignedUrl(bucketName, filename);

    const extension = path.extname(originalFilename).toLowerCase().slice(1); // 获取扩展名并去除点号
    let documentType = extension;
    
    console.log(`原始文件名: ${originalFilename}, 提取的扩展名: ${extension}`);
    
    // 映射扩展名到OnlyOffice支持的documentType
    if (documentType === "docx" || documentType === "doc") {
      documentType = "word";
    } else if (documentType === "xlsx" || documentType === "xls") {
      documentType = "cell";
    } else if (documentType === "pptx" || documentType === "ppt") {
      documentType = "slide";
    } else if (documentType === "pdf") {
      documentType = "pdf";
    } else {
      documentType = "word";  // 默认设为word类型
    }
    // 上传文件到MinIO
    await minioClient.putObject(
      bucketName,
      filename,
      fileStream,
      req.file.size,
      { "Content-Type": req.file.mimetype }
    );

    // 生成可访问的文件URL
    const fileUrl = `/files/${filename}`;

    // 获取服务的基础URL，优先使用环境变量或动态配置
    const hostIp = process.env.HOST_IP || "localhost";
    const baseUrl = process.env.SERVER_BASE_URL || `http://${hostIp}:${PORT}`;
    let config = {
      document: {
        fileType: extension,
        key: `key-${timestamp}`,
        title: req.file.originalname,  // 使用原始文件名作为显示标题
        // url: `${sign}`,
        url: `${baseUrl}/downloadfile/key-${timestamp}`,
        // 明确指定下载URL为Node.js服务器的/downloadfile接口
        // downloadUrl: `${baseUrl}/downloadfile/key-${timestamp}`,
        // 【关键3】指定存储类型为自定义，告诉OnlyOffice不要用自身存储
        storageType: "Custom",
        // 【关键4】添加文件的最后修改时间（防止OnlyOffice缓存旧地址）
        modified: timestamp,
        key: `key-${timestamp}`,
      },
      documentType: documentType,

      editorConfig: {
        // 设置callbackURL以便OnlyOffice可以保存文档到Node.js服务器
        callbackUrl: `${baseUrl}/callback`,
        user: {
          id: "user-1",
          name: "用户",
        },
        mode: "edit",
        lang: "zh-CN",
        // 添加服务配置确保使用正确的URL
        services: {
          UrlConverter: {
            url: "",
            convCallbackUrl: "",
          },
        },
        // 【关键6】允许编辑器直接下载/访问外部文件
        permissions: {
          download: true,
          edit: true,
          access: true,
        },
       
      },
      // 【关键8】添加token，用于OnlyOffice安全验证
      // 注意：根据OnlyOffice文档，当启用token验证时，这里需要包含token参数
      height: "600px",
      width: "100%",
      // 【关键9】禁用OnlyOffice的自动代理（新增）
      disableBrowserCache: true,
    };
    config.token = generateOnlyOfficeToken(config);
    res.json({
      filename: filename,
      url: fileUrl,
      size: req.file.size,
      type: req.file.mimetype,
      // 生成OnlyOffice兼容的文档键，使用与filename相同的时间戳
      documentKey: `key-${timestamp}`,
      // 添加OnlyOffice兼容的完整下载URL，使用与filename相同的时间戳
      downloadUrl: `${baseUrl}/downloadfile/key-${timestamp}`,
      test: "test1111",
      // jwtToken: generateOnlyOfficeToken(document),
      config: config,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// 文件下载功能 - 从MinIO
app.get("/files/:filename", async (req, res) => {
  const filename = req.params.filename;

  try {
    // 检查文件是否存在
    const stat = await minioClient.statObject(bucketName, filename);

    // 设置响应头，解码文件名以显示正确的中文文件名
    const decodedFilename = decodeURIComponent(filename);
    res.setHeader(
      "Content-Type",
      stat.metaData["content-type"] || "application/octet-stream"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${decodedFilename}"`
    );
    res.setHeader("Content-Length", stat.size);

    // 从MinIO获取文件流
    const fileStream = await minioClient.getObject(bucketName, filename);
    fileStream.pipe(res);

    fileStream.on("error", (err) => {
      console.error("File stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream file" });
      }
    });
  } catch (error) {
    if (error.code === "NoSuchKey") {
      res.status(404).json({ error: "File not found" });
    } else {
      console.error("Download error:", error);
      res
        .status(500)
        .json({ error: "Internal server error: " + error.message });
    }
  }
});

// 使用app.route同时注册GET和POST路由
app
  .route("/downloadfile/key-:timestamp")
  .get(async (req, res) => {
    const timestamp = req.params.timestamp;
    console.log(`收到GET请求，时间戳: ${timestamp}`);
    await downloadFileByTimestamp(timestamp, req, res);
  })
  .post(async (req, res) => {
    const timestamp = req.params.timestamp;
    console.log(`收到POST请求，时间戳: ${timestamp}`);
    await downloadFileByTimestamp(timestamp, req, res);
  });

// 新增测试POST路由
app.post("/test-post", (req, res) => {
  console.log("测试POST路由被调用");
  res.json({ message: "POST请求成功", timestamp: new Date().getTime() });
});

// 共享的下载逻辑函数（保留但暂时不使用）
async function downloadFileByTimestamp(timestamp, req, res) {
  try {
    // 列出MinIO桶中的所有对象
    const objectsStream = minioClient.listObjectsV2(bucketName, "", true);

    // 查找匹配的文件
    let matchingFile = null;
    for await (const obj of objectsStream) {
      if (obj.name.includes(timestamp)) {
        matchingFile = obj.name;
        console.log(`找到匹配的文件: ${matchingFile}`);
        break;
      }
    }

    if (matchingFile) {
      // 获取文件统计信息
      const stat = await minioClient.statObject(bucketName, matchingFile);

      // 设置响应头
      const decodedFilename = decodeURIComponent(matchingFile);
      res.setHeader(
        "Content-Type",
        stat.metaData["content-type"] || "application/octet-stream"
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${decodedFilename}"`
      );
      res.setHeader("Content-Length", stat.size);

      // 从MinIO获取文件流
      const fileStream = await minioClient.getObject(bucketName, matchingFile);
      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        console.error("File stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file" });
        }
      });
    } else {
      console.log(`未找到时间戳为 ${timestamp} 的文件`);

      // 提供所有文件列表以便调试
      const allFiles = [];
      const stream = minioClient.listObjectsV2(bucketName, "", true);
      for await (const obj of stream) {
        allFiles.push(obj.name);
      }

      res.status(404).json({
        error: "File not found for the specified key",
        timestamp: timestamp,
        availableFiles: allFiles,
      });
    }
  } catch (error) {
    console.error("Error searching for file:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
}

// 添加获取文件MIME类型的辅助函数
function getContentTypeByExtension(extension) {
  const contentTypeMap = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
  };
  
  // 如果扩展名不以点开头，添加点
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  
  // 返回对应的MIME类型，如果没有找到则返回默认值
  return contentTypeMap[normalizedExtension.toLowerCase()] || 'application/octet-stream';
}

// 确保回调处理中也使用正确的URL处理
// OnlyOffice回调接口 - 使用MinIO保存文档
app.post("/callback", async (req, res) => {
  try {
    const body = req.body;

    // 记录回调数据
    console.log("OnlyOffice回调数据:", JSON.stringify(body, null, 2));

    // 检查状态
    if (body.status === 2) {
      // 状态2表示文档已准备好保存
      console.log("文档准备好保存:", body.key);

      // 从key中提取时间戳并找到对应的文件
      const timestamp = body.key.split("-").pop();
      const objectsStream = minioClient.listObjectsV2(bucketName, "", true);

      let matchingFile = null;
      for await (const obj of objectsStream) {
        if (obj.name.includes(timestamp)) {
          matchingFile = obj.name;
          break;
        }
      }

      // 如果需要，可以在这里实现文档内容的保存逻辑
      // 例如从OnlyOffice服务器获取更新后的文档内容并上传到MinIO
      if (matchingFile) {
        console.log(`找到对应的文件: ${matchingFile}`);

        // 如果有新的文档URL，可以下载并更新文件
        if (body.url) {
          console.log(`文档有更新，新URL: ${body.url}`);
          
          try {
            // 下载更新后的文档内容
            const response = await axios.get(body.url, {
              responseType: 'arraybuffer',
              headers: {
                'Content-Type': 'application/octet-stream'
              }
            });
            
            // 获取文档数据作为Buffer
            const buffer = Buffer.from(response.data, 'binary');
            
            console.log(`成功下载更新文档，大小: ${buffer.length} 字节`);
            
            // 从原文件名中提取信息
            const originalExtension = path.extname(matchingFile).toLowerCase();
            
            // 保存回MinIO，覆盖原文件
            await minioClient.putObject(
              bucketName,
              matchingFile,  // 使用相同的文件名，覆盖原文件
              buffer,
              buffer.length,
              { "Content-Type": getContentTypeByExtension(originalExtension) }
            );
            
            console.log(`成功将更新后的文档保存到MinIO: ${matchingFile}`);
            
            // 可选：创建一个新版本的文件，保留历史版本
            // const newVersionFile = matchingFile.replace(originalExtension, `-updated${Date.now()}${originalExtension}`);
            // await minioClient.putObject(bucketName, newVersionFile, buffer, buffer.length);
            // console.log(`创建了新版本文件: ${newVersionFile}`);
            
          } catch (downloadError) {
            console.error("下载并保存更新文档时出错:", downloadError);
            // 记录错误但不影响OnlyOffice的回调响应
          }
        }
      }
    }

    // 返回成功响应
    res.status(200).json({ error: 0 });
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({ error: 1 });
  }
});

// 添加一个文件列表接口，方便调试
app.get("/filelist", async (req, res) => {
  try {
    const files = [];
    const objectsStream = minioClient.listObjectsV2(bucketName, "", true);

    for await (const obj of objectsStream) {
      files.push({
        name: obj.name,
        size: obj.size,
        lastModified: obj.lastModified,
      });
    }

    res.json({
      bucket: bucketName,
      fileCount: files.length,
      files: files,
    });
  } catch (error) {
    console.error("Error listing files:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// 健康检查接口
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "Node.js File Server",
    port: PORT,
    minioBucket: bucketName,
    test: "打包成功",
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
========================================
Node.js 文件服务器已启动！
地址: http://localhost:${PORT}

可用端点:
- 测试GET路由:  GET  http://localhost:${PORT}/test-get
- 测试POST路由: POST http://localhost:${PORT}/test-post
- 文件上传:     POST http://localhost:${PORT}/upload
- 文件下载:     GET  http://localhost:${PORT}/files/{filename}
- OnlyOffice下载: GET http://localhost:${PORT}/downloadfile/key-{timestamp}
- 回调接口:     POST http://localhost:${PORT}/callback
- 文件列表:     GET  http://localhost:${PORT}/filelist
- 健康检查:     GET  http://localhost:${PORT}/health
========================================
`);
});



