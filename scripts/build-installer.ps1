# 离线安装包构建（Inno Setup）：把程序+依赖+Electron+Chromium 全打进 setup.exe
# 数据库为“干净库”(仅一个示例项目，无任何真实数据/密钥)。
# 数据运行时存于用户 AppData，更新(重装)不会被覆盖。
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$nodeRuntime = "C:\tools\node-v22.11.0-win-x64"
$msPlay = Join-Path $env:LOCALAPPDATA "ms-playwright"
$iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
$icon = "$repo\electron\build-resources\icon.ico"
$stageRoot = Join-Path (Split-Path -Parent $repo) "_pkg_inst"
$stage = Join-Path $stageRoot "app"
$outDir = Split-Path -Parent $repo
$stamp = Get-Date -Format "yyyyMMdd"
$env:PATH = "$nodeRuntime;$env:PATH"   # 让 npm/npx/node 用内置版本

function Rc($src, $dst, $xd) {
  # /R:3 /W:1 适度重试；/MT 多线程；不跳过文件
  $a = @($src, $dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:3", "/W:1", "/MT:8")
  if ($xd) { $a += "/XD"; $a += $xd }
  robocopy @a | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $src ($LASTEXITCODE)" }
}

Write-Host "== 1. 清理 staging ==" -ForegroundColor Cyan
if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "== 2. 程序代码（排除 node_modules，稍后用 npm 干净安装）==" -ForegroundColor Cyan
# 后端：dist + prisma + package.json/lock；排除 node_modules(稍后npm装) / data / src
Rc "$repo\backend-ts" "$stage\backend-ts" @("node_modules", "data", "src")
# 前端：只要构建产物 dist（后端同源托管它）
New-Item -ItemType Directory -Force -Path "$stage\frontend" | Out-Null
Rc "$repo\frontend\dist" "$stage\frontend\dist" @()
# Electron：排除 node_modules(稍后npm装)
Rc "$repo\electron" "$stage\electron" @("node_modules")
# 根文件
foreach ($f in @("启动.bat", "小红书矩阵.exe", "使用说明.txt", "运营规则说明.txt")) {
  if (Test-Path "$repo\$f") { Copy-Item "$repo\$f" "$stage\$f" -Force }
}

Write-Host "== 2b. 用 npm 干净安装依赖（保证完整，不缺文件）==" -ForegroundColor Cyan
Push-Location "$stage\backend-ts"
& npm install --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "后端 npm install 失败" }
# prisma CLI 是 devDep，被 --omit=dev 跳过，用 npx 临时拉起生成客户端
& npx --yes prisma@6.19.3 generate
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "prisma generate 失败" }
Pop-Location
Push-Location "$stage\electron"
# electron 在 electron/package.json 里属 devDependencies，必须完整安装(不能 --omit=dev)
& npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "electron npm install 失败" }
Pop-Location
# 把 electron.exe 改名为品牌名（任务管理器显示"小红书矩阵"而非"Electron"）
$elec = "$stage\electron\node_modules\electron\dist\electron.exe"
if (Test-Path $elec) { Copy-Item $elec "$stage\electron\node_modules\electron\dist\小红书矩阵.exe" -Force }
# 完整性校验：抽查关键文件，缺则报错
foreach ($chk in @(
  "$stage\backend-ts\node_modules\debug\src\index.js",
  "$stage\backend-ts\node_modules\@prisma\client\package.json",
  "$stage\backend-ts\node_modules\.prisma\client\index.js",
  "$stage\backend-ts\node_modules\better-sqlite3\package.json",
  "$stage\electron\node_modules\electron\dist\electron.exe"
)) {
  if (-not (Test-Path $chk)) { throw "依赖不完整，缺少: $chk" }
}
Write-Host "  依赖完整性校验通过" -ForegroundColor DarkGray

Write-Host "== 3. 内置 node 运行时 ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$stage\runtime\node\node_modules" | Out-Null
robocopy $nodeRuntime "$stage\runtime\node" /LEV:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "node 根目录复制失败" }
foreach ($m in @("npm", "corepack")) {
  if (Test-Path "$nodeRuntime\node_modules\$m") { Rc "$nodeRuntime\node_modules\$m" "$stage\runtime\node\node_modules\$m" @() }
}

Write-Host "== 4. 内置 Chromium (patchright chromium-1223) ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$stage\runtime\ms-playwright" | Out-Null
foreach ($b in @("chromium-1223", "winldd-1007")) {
  if (Test-Path "$msPlay\$b") {
    Rc "$msPlay\$b" "$stage\runtime\ms-playwright\$b" @()
  } else {
    Write-Host "  ! 缺少 $b（$msPlay）" -ForegroundColor Yellow
  }
}

Write-Host "== 5. 干净示例库 (seed) ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$stage\seed" | Out-Null
$seedDb = "$stage\seed\xhs_matrix.db"
Copy-Item "$repo\backend-ts\data\xhs_matrix.db" $seedDb -Force
$env:NODE_PATH = "$repo\backend-ts\node_modules"
& "$nodeRuntime\node.exe" "$repo\scripts\make-clean-db.js" $seedDb
if ($LASTEXITCODE -ne 0) { throw "干净库生成失败" }
Remove-Item "$seedDb-wal" -Force -ErrorAction SilentlyContinue
Remove-Item "$seedDb-shm" -Force -ErrorAction SilentlyContinue

Write-Host "== 6. 干净 .env (默认开局域网) ==" -ForegroundColor Cyan
$envText = "DATABASE_URL=`"file:./data/xhs_matrix.db`"`nPORT=4180`nLAN_ACCESS=1`n"
[System.IO.File]::WriteAllText("$stage\backend-ts\.env", $envText, (New-Object System.Text.UTF8Encoding $false))
# 安装包内不需要这些（由安装器负责）
Remove-Item "$stage\一键安装.bat","$stage\更新.bat" -Force -ErrorAction SilentlyContinue
Get-ChildItem $stage -Recurse -Include "*.log" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "== 7. 生成 Inno 脚本并编译 ==" -ForegroundColor Cyan
$iss = @"
[Setup]
AppId={{8F2A6C14-3D7B-4E59-9A1C-2B6E5F0D7A33}
AppName=小红书矩阵
AppVersion=1.0.0
AppPublisher=xhs-matrix
DefaultDirName={autopf}\小红书矩阵
DefaultGroupName=小红书矩阵
DisableProgramGroupPage=yes
OutputDir=$outDir
OutputBaseFilename=小红书矩阵_安装包_$stamp
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
SetupIconFile=$icon
UninstallDisplayIcon={app}\小红书矩阵.exe

[Files]
Source: "$stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\小红书矩阵"; Filename: "{app}\小红书矩阵.exe"
Name: "{group}\卸载小红书矩阵"; Filename: "{uninstallexe}"
Name: "{autodesktop}\小红书矩阵"; Filename: "{app}\小红书矩阵.exe"

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=xhs-matrix-4180 dir=in action=allow protocol=TCP localport=4180"; Flags: runhidden
Filename: "{app}\小红书矩阵.exe"; Description: "立即启动小红书矩阵"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=xhs-matrix-4180"; Flags: runhidden
"@
$issPath = Join-Path $stageRoot "installer.iss"
[System.IO.File]::WriteAllText($issPath, $iss, (New-Object System.Text.UTF8Encoding $true))

& $iscc $issPath
if ($LASTEXITCODE -ne 0) { throw "Inno 编译失败" }
$setup = Join-Path $outDir "小红书矩阵_安装包_$stamp.exe"
$mb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "`n✅ 安装包完成: $setup  ($mb MB)" -ForegroundColor Green
