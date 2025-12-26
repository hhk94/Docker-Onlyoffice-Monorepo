# test-simple.ps1 - 修复版服务测试（解决语法错误+编码兼容）
# 注意：请将脚本文件保存为【UTF-8 with BOM】编码，避免中文乱码

# 设置控制台编码为UTF-8，确保中文正常显示
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=== 服务连接测试 ===" -ForegroundColor Cyan
Write-Host "开始时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# 创建全局哈希表存储环境变量
$global:EnvVars = @{}

# 从.env文件读取环境变量
function Load-EnvironmentVariables($EnvFilePath) {
    if (Test-Path $EnvFilePath) {
        Write-Host "从 $EnvFilePath 加载环境变量..." -ForegroundColor Blue
        $lines = Get-Content -Path $EnvFilePath -Encoding UTF8
        
        foreach ($line in $lines) {
            # 跳过注释行和空行
            if ($line -match '^\s*#' -or $line -match '^\s*$') {
                continue
            }
            
            # 解析环境变量
            if ($line -match '^([^=]+)=(.+)$') {
                $key = $matches[1].Trim()
                $value = $matches[2].Trim()
                
                # 移除可能的引号
                if ($value -match '^["\''](.+)["\'']$') {
                    $value = $matches[1]
                }
                
                # 存储到哈希表
                $global:EnvVars[$key] = $value
                Write-Host "  已加载: $key = $value" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Host "警告: 在 $EnvFilePath 未找到.env文件，使用默认值。" -ForegroundColor Yellow
    }
}

# 加载.env文件
$envFilePath = Join-Path -Path (Get-Location).Path -ChildPath ".env"
Load-EnvironmentVariables $envFilePath

# 修复点1：定义docker-compose命令（兼容新版Docker的docker compose）
$dockerComposeCmd = if (Get-Command "docker-compose" -ErrorAction SilentlyContinue) {
    "docker-compose"
} else {
    "docker compose"
}

# 修复点2：获取docker-compose项目名称（用于匹配容器名称，默认是当前目录名）
$composeProjectName = (Get-Location).Name
# 可选：如果你的docker-compose有自定义项目名，取消下面注释并修改
# $composeProjectName = "your-custom-project-name"

# 辅助函数：根据服务名获取完整容器名
function Get-ContainerName {
    param(
        [string]$ServiceName
    )
    # 尝试匹配 项目名_服务名_1 或 服务名 格式的容器名
    $containerName = docker ps --format "{{.Names}}" | Where-Object { $_ -match "^($composeProjectName_)?$ServiceName(\d+)?$" } | Select-Object -First 1
    if (-not $containerName) {
        # 如果没找到运行中的容器，返回原始服务名（用于提示）
        return $ServiceName
    }
    return $containerName
}

# 1. 检查容器状态
Write-Host "1. 容器状态检查:" -ForegroundColor Green
try {
    Invoke-Expression "$dockerComposeCmd ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"
} catch {
    Write-Host "  警告: 无法执行docker-compose ps，可能是当前目录没有docker-compose.yml文件或Docker未启动" -ForegroundColor Yellow
}
Write-Host ""

# 2. 测试端口连通性
Write-Host "2. 端口连通性测试:" -ForegroundColor Green

# 使用从.env读取的端口值，如果不存在则使用默认值
$onlyOfficePort = if ($global:EnvVars.ContainsKey("ONLYOFFICE_HTTP_PORT")) { $global:EnvVars["ONLYOFFICE_HTTP_PORT"] } else { 8080 }
$minioApiPort = if ($global:EnvVars.ContainsKey("MINIO_API_PORT")) { $global:EnvVars["MINIO_API_PORT"] } else { 9000 }
$minioConsolePort = if ($global:EnvVars.ContainsKey("MINIO_CONSOLE_PORT")) { $global:EnvVars["MINIO_CONSOLE_PORT"] } else { 9001 }
$postgresPort = if ($global:EnvVars.ContainsKey("POSTGRES_EXTERNAL_PORT")) { $global:EnvVars["POSTGRES_EXTERNAL_PORT"] } else { 5432 }
$rabbitmqAmqpPort = if ($global:EnvVars.ContainsKey("RABBITMQ_AMQP_EXTERNAL_PORT")) { $global:EnvVars["RABBITMQ_AMQP_EXTERNAL_PORT"] } else { 5672 }
$rabbitmqManagementPort = if ($global:EnvVars.ContainsKey("RABBITMQ_MANAGEMENT_EXTERNAL_PORT")) { $global:EnvVars["RABBITMQ_MANAGEMENT_EXTERNAL_PORT"] } else { 15672 }
$redisPort = if ($global:EnvVars.ContainsKey("REDIS_EXTERNAL_PORT")) { $global:EnvVars["REDIS_EXTERNAL_PORT"] } else { 63800 }

$ports = @(
    @{Name="OnlyOffice"; Port=$onlyOfficePort; Type="HTTP"},
    @{Name="MinIO API"; Port=$minioApiPort; Type="HTTP"},
    @{Name="MinIO Console"; Port=$minioConsolePort; Type="HTTP"},
    @{Name="PostgreSQL"; Port=$postgresPort; Type="TCP"},
    @{Name="RabbitMQ AMQP"; Port=$rabbitmqAmqpPort; Type="TCP"},
    @{Name="RabbitMQ Management"; Port=$rabbitmqManagementPort; Type="HTTP"},
    @{Name="Redis"; Port=$redisPort; Type="TCP"}
)

Write-Host "  使用环境变量或默认端口配置:" -ForegroundColor DarkGray
Write-Host "  - OnlyOffice: $onlyOfficePort" -ForegroundColor DarkGray
Write-Host "  - MinIO API: $minioApiPort" -ForegroundColor DarkGray
Write-Host "  - MinIO Console: $minioConsolePort" -ForegroundColor DarkGray
Write-Host "  - PostgreSQL: $postgresPort" -ForegroundColor DarkGray
Write-Host "  - RabbitMQ AMQP: $rabbitmqAmqpPort" -ForegroundColor DarkGray
Write-Host "  - RabbitMQ Management: $rabbitmqManagementPort" -ForegroundColor DarkGray
Write-Host "  - Redis: $redisPort" -ForegroundColor DarkGray

foreach ($item in $ports) {
    Write-Host "  $($item.Name) (端口: $($item.Port))" -NoNewline
    try {
        # 修复点3：优化Test-NetConnection的判断逻辑（兼容不同PowerShell版本）
        $result = Test-NetConnection -ComputerName localhost -Port $item.Port -WarningAction SilentlyContinue -ErrorAction Stop
        if ($result.TcpTestSucceeded -eq $true) {
            Write-Host " - 连接成功" -ForegroundColor Green
        } else {
            Write-Host " - 连接失败" -ForegroundColor Red
        }
    } catch {
        Write-Host " - 测试错误/端口未开放" -ForegroundColor Red
    }
}
Write-Host ""

# 3. 检查容器内部状态
Write-Host "3. 容器内部状态检查:" -ForegroundColor Green
$services = @(
    @{Name="postgres"; Command="psql -U onlyoffice -d onlyoffice -c 'SELECT version();'"},
    @{Name="redis"; Command="redis-cli ping"},
    @{Name="rabbitmq"; Command="rabbitmq-diagnostics ping"},
    @{Name="minio"; Command="curl -s http://localhost:9000/minio/health/live"}
)

foreach ($service in $services) {
    $containerName = Get-ContainerName -ServiceName $service.Name
    Write-Host "  $($service.Name) (容器: $containerName): " -NoNewline
    try {
        # 修复点4：移除多余的右括号，解决语法错误；统一使用sh -c包裹命令
        $result = docker exec $containerName sh -c "$($service.Command)" 2>&1
        # 修复点5：判断LASTEXITCODE（兼容容器内命令的返回值）
        if ($LASTEXITCODE -eq 0 -or $result -match "PONG|OK|PostgreSQL") {
            Write-Host "运行正常" -ForegroundColor Green
        } else {
            Write-Host "可能存在问题 (返回: $($result.ToString().Trim()))" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "无法连接/容器未运行" -ForegroundColor Red
    }
}
Write-Host ""

# 4. OnlyOffice 特殊测试
Write-Host "4. OnlyOffice 连接测试:" -ForegroundColor Green
Write-Host "  请在浏览器中手动访问: http://localhost:$onlyOfficePort" -ForegroundColor White
Write-Host "  如果无法访问，请检查以下内容:" -ForegroundColor White
Write-Host "  - OnlyOffice 容器是否运行: docker ps | findstr onlyoffice" -ForegroundColor White
Write-Host "  - OnlyOffice 日志: docker logs $(Get-ContainerName -ServiceName 'onlyoffice') --tail 20" -ForegroundColor White
Write-Host ""

# 5. MinIO 配置测试
Write-Host "5. MinIO 访问信息:" -ForegroundColor Green
Write-Host "  控制台地址: http://localhost:$minioConsolePort" -ForegroundColor White
Write-Host "  用户名: admin" -ForegroundColor White
Write-Host "  密码: admin123" -ForegroundColor White
Write-Host "  请在浏览器中手动登录并创建存储桶" -ForegroundColor White
Write-Host ""

# 6. 显示访问信息汇总
Write-Host "=== 访问信息汇总 ===" -ForegroundColor Cyan
Write-Host "1. OnlyOffice 文档服务: http://localhost:$onlyOfficePort" -ForegroundColor White
Write-Host "2. MinIO 对象存储控制台: http://localhost:$minioConsolePort" -ForegroundColor White
Write-Host "   - 用户名: admin" -ForegroundColor White
Write-Host "   - 密码: admin123" -ForegroundColor White
Write-Host "3. RabbitMQ 消息队列管理: http://localhost:$rabbitmqManagementPort" -ForegroundColor White
Write-Host "   - 用户名: guest" -ForegroundColor White
Write-Host "   - 密码: guest" -ForegroundColor White
Write-Host "4. PostgreSQL 数据库: localhost:$postgresPort" -ForegroundColor White
Write-Host "   - 数据库: onlyoffice" -ForegroundColor White
Write-Host "   - 用户: onlyoffice" -ForegroundColor White
Write-Host "   - 密码: onlyoffice_pass" -ForegroundColor White
Write-Host "5. Redis 缓存服务器: localhost:$redisPort" -ForegroundColor White
Write-Host "   - 协议: Redis" -ForegroundColor White
if ($global:EnvVars.ContainsKey('REDIS_PASSWORD')) {
    Write-Host "   - 密码: $($global:EnvVars['REDIS_PASSWORD'])" -ForegroundColor White
} else {
    Write-Host "   - 密码: redis_pass" -ForegroundColor White
}
Write-Host ""

Write-Host "结束时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow
Write-Host "=== 测试脚本完成 ===" -ForegroundColor Cyan