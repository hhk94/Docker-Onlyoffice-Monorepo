<#
.SYNOPSIS
OnlyOffice环境一键启动脚本（Windows PowerShell）
.DESCRIPTION
自动清理端口、启动Docker容器、Node.js服务、HTML静态服务器
#>

# 解决PowerShell执行策略限制（可选，根据系统配置调整）
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction SilentlyContinue

# 颜色配置
$cyan = "Cyan"
$yellow = "Yellow"
$green = "Green"
$red = "Red"
$gray = "Gray" # 新增灰色，用于等待提示

Write-Host "`n=====================================" -ForegroundColor $cyan
Write-Host "OnlyOffice 环境启动脚本" -ForegroundColor $cyan
Write-Host "=====================================" -ForegroundColor $cyan

# 获取脚本所在目录（解决相对路径问题，支持任意目录执行）
$SCRIPT_DIR = $PSScriptRoot
if (-not $SCRIPT_DIR) {
    $SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
}
Set-Location $SCRIPT_DIR
Write-Host "`n当前工作目录: $SCRIPT_DIR" -ForegroundColor $yellow

<#
.SYNOPSIS
检查并停止占用指定端口的进程（精确匹配端口，避免误杀）
#>
function Stop-ProcessUsingPort {
    param(
        [Parameter(Mandatory=$true)]
        [int]$port
    )

    Write-Host "`n检查端口 $port 是否被占用..." -ForegroundColor $yellow
    # 使用PowerShell原生命令获取端口占用，精确匹配端口，避免findstr的模糊匹配问题
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $processIds = $connections.OwningProcess | Select-Object -Unique
        foreach ($pid in $processIds) {
            if ($pid -eq 0) { continue } # 跳过系统进程PID 0
            try {
                $process = Get-Process -Id $pid -ErrorAction Stop
                Write-Host "端口 $port 被进程 $($process.Name) (PID: $pid) 占用，正在停止..." -ForegroundColor $red
                $process | Stop-Process -Force -ErrorAction Stop
                Write-Host "成功停止进程 $($process.Name) (PID: $pid)" -ForegroundColor $green
            } catch {
                Write-Host "停止进程 PID: $pid 失败: $_" -ForegroundColor $red
            }
        }
    } else {
        Write-Host "端口 $port 未被占用" -ForegroundColor $green
    }
}

# 1. 清理占用关键端口的进程
Write-Host "`n[1/4] 清理占用端口的进程..." -ForegroundColor $yellow
$ports = 8000, 8080, 8081, 9000 # 需要检查的端口列表
foreach ($port in $ports) {
    Stop-ProcessUsingPort -port $port
}

# 2. 启动Docker容器服务
Write-Host "`n[2/4] 启动Docker容器服务..." -ForegroundColor $yellow
$dockerComposePath = Join-Path -Path $SCRIPT_DIR -ChildPath "docker-compose.yml"
if (Test-Path $dockerComposePath) {
    Write-Host "启动所有Docker容器..."
    docker-compose up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Docker容器启动成功！" -ForegroundColor $green
        Write-Host "容器状态：" -ForegroundColor $yellow
        docker-compose ps
    } else {
        Write-Host "Docker容器启动失败！" -ForegroundColor $red
        exit 1
    }
} else {
    Write-Host "docker-compose.yml 文件不存在（路径：$dockerComposePath）！" -ForegroundColor $red
    exit 1
}

<#
.SYNOPSIS
等待Docker容器就绪（检查指定容器的健康状态或端口监听）
#>
function Wait-DockerContainerReady {
    param(
        [Parameter(Mandatory=$true)]
        [string]$containerName,
        [int]$timeout = 300, # 超时时间（秒）
        [int]$checkInterval = 2 # 检查间隔（秒）
    )

    $elapsed = 0
    Write-Host "`n等待容器 $containerName 就绪（超时时间：$timeout 秒）..." -ForegroundColor $yellow
    while ($elapsed -lt $timeout) {
        # 检查容器是否正在运行且健康（如果有健康检查）
        $containerStatus = docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' $containerName 2>&1
        if ($containerStatus -match "running (healthy|starting)") {
            Write-Host "容器 $containerName 已就绪" -ForegroundColor $green
            return $true
        } elseif ($containerStatus -match "running") {
            # 无健康检查时，仅检查是否运行
            Write-Host "容器 $containerName 已启动（无健康检查）" -ForegroundColor $green
            return $true
        }
        Start-Sleep -Seconds $checkInterval
        $elapsed += $checkInterval
        Write-Host "等待中...（已耗时 $elapsed 秒）" -ForegroundColor $gray
    }
    Write-Host "容器 $containerName 启动超时！" -ForegroundColor $red
    return $false
}

# 等待Docker容器初始化（智能等待，而非固定30秒）
$containerNames = "onlyoffice", "minio", "postgres" # 根据你的docker-compose.yml中的容器名调整
foreach ($name in $containerNames) {
    if (-not (Wait-DockerContainerReady -containerName $name -timeout 60)) {
        exit 1
    }
}

# 3. 启动Node.js服务
Write-Host "`n[3/4] 启动Node.js服务..." -ForegroundColor $yellow
$nodeDir = Join-Path -Path $SCRIPT_DIR -ChildPath "node"
$nodeEntry = Join-Path -Path $nodeDir -ChildPath "index.js"
if (Test-Path $nodeEntry) {
    Set-Location $nodeDir
    Write-Host "当前Node.js工作目录: $nodeDir" -ForegroundColor $yellow

    # 检查并安装依赖
    $nodeModules = Join-Path -Path $nodeDir -ChildPath "node_modules"
    if (!(Test-Path $nodeModules)) {
        Write-Host "Node.js依赖不存在，正在安装..." -ForegroundColor $yellow
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Node.js依赖安装失败！" -ForegroundColor $red
            exit 1
        }
    }

    # 启动Node.js服务（指定工作目录，避免路径问题）
    Write-Host "启动Node.js服务..." -ForegroundColor $yellow
    Start-Process powershell -WorkingDirectory $nodeDir -ArgumentList "npm start" -WindowStyle Maximized -ErrorAction Stop
    Write-Host "等待10秒让Node.js服务启动..." -ForegroundColor $yellow
    Start-Sleep -Seconds 10

    # 回到脚本目录
    Set-Location $SCRIPT_DIR
} else {
    Write-Host "Node.js服务文件不存在（路径：$nodeEntry）！" -ForegroundColor $red
    exit 1
}

# 4. 启动HTML页面的HTTP服务器
Write-Host "`n[4/4] 启动HTML页面HTTP服务器..." -ForegroundColor $yellow
$htmlFile = Join-Path -Path $SCRIPT_DIR -ChildPath "onlyoffice-client.html"
if (Test-Path $htmlFile) {
    # 兼容Python命令（优先使用python3，其次python，最后py -3）
    $pythonCmd = "python3"
    if (-not (Get-Command $pythonCmd -ErrorAction SilentlyContinue)) {
        $pythonCmd = "python"
        if (-not (Get-Command $pythonCmd -ErrorAction SilentlyContinue)) {
            $pythonCmd = "py -3"
            if (-not (Get-Command $pythonCmd -ErrorAction SilentlyContinue)) {
                Write-Host "未找到Python环境！请安装Python并添加到环境变量。" -ForegroundColor $red
                exit 1
            }
        }
    }

    # 启动Python HTTP服务器（指定工作目录为脚本目录）
    Write-Host "使用命令: $pythonCmd -m http.server 8081" -ForegroundColor $yellow
    Start-Process powershell -WorkingDirectory $SCRIPT_DIR -ArgumentList "$pythonCmd -m http.server 8081" -WindowStyle Maximized -ErrorAction Stop
    Write-Host "等待5秒让HTTP服务器启动..." -ForegroundColor $yellow
    Start-Sleep -Seconds 5

    Write-Host "HTML页面服务已启动在 http://localhost:8081/onlyoffice-client.html" -ForegroundColor $green
} else {
    Write-Host "onlyoffice-client.html 文件不存在（路径：$htmlFile）！" -ForegroundColor $red
    exit 1
}

# 启动完成信息
Write-Host "`n=====================================" -ForegroundColor $cyan
Write-Host "所有服务启动完成！" -ForegroundColor $green
Write-Host "=====================================" -ForegroundColor $cyan
Write-Host "访问地址：" -ForegroundColor $yellow
Write-Host "1. OnlyOffice 编辑器界面: http://localhost:8081/onlyoffice-client.html" -ForegroundColor $green
Write-Host "2. OnlyOffice 服务器: http://localhost:8080" -ForegroundColor $green
Write-Host "3. Node.js API服务: http://localhost:8000" -ForegroundColor $green
Write-Host "4. MinIO 控制台: http://localhost:9000" -ForegroundColor $green
Write-Host "`n请在浏览器中打开编辑器界面开始使用！" -ForegroundColor $yellow
Write-Host "=====================================" -ForegroundColor $cyan

# 暂停以查看输出（兼容所有终端，处理异常）
Write-Host "`n按任意键继续..." -ForegroundColor $yellow
try {
    $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null
} catch {
    # 如果ReadKey失败，使用Read-Host替代
    Read-Host | Out-Null
}