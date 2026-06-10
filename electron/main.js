// xhs-matrix Electron 壳
// 职责：拉起内置 NestJS 后端 -> 等待健康检查 -> 加载同源前端（http://127.0.0.1:PORT）
// 桌面端与局域网浏览器端跑同一份前端，行为完全一致。
const { app, BrowserWindow, shell, Menu } = require('electron')
try { app.setName('小红书矩阵') } catch (e) {}
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const net = require('net')
const fs = require('fs')

let PORT = process.env.PORT || '4180' // 可能被自动换成空闲端口

// 检测端口是否空闲（绑全网卡，兼顾局域网模式）
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port)
  })
}
// 从 start 起找一个空闲端口（最多往后试 50 个）
async function findFreePort(start) {
  const s = parseInt(start, 10) || 4180
  for (let p = s; p < s + 50; p++) {
    if (await isPortFree(p)) return String(p)
  }
  return String(s)
}
const APP_ROOT = path.join(__dirname, '..')
const BACKEND_DIR = path.join(APP_ROOT, 'backend-ts')
const BACKEND_ENTRY = path.join(BACKEND_DIR, 'dist', 'main.js')

let backendProc = null
let mainWindow = null

function isWritable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true } catch { return false }
}

// 数据目录：安装到 Program Files(不可写)→ 用户 AppData(更新不被覆盖)；开发/便携(可写)→ 就地 backend-ts/data
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR
  if (isWritable(BACKEND_DIR)) return path.join(BACKEND_DIR, 'data')
  return path.join(app.getPath('appData'), 'xhs-matrix', 'data')
}

// 首次运行：把安装目录里的示例库 seed 播种到数据目录（已存在则不动，保证更新不覆盖数据）
function seedIfNeeded(dataDir) {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const db = path.join(dataDir, 'xhs_matrix.db')
    const seed = path.join(APP_ROOT, 'seed', 'xhs_matrix.db')
    if (!fs.existsSync(db) && fs.existsSync(seed)) fs.copyFileSync(seed, db)
  } catch (e) {}
}

// 组装后端运行环境（数据目录 / 数据库路径 / 内置浏览器）
function buildBackendEnv() {
  const dataDir = resolveDataDir()
  seedIfNeeded(dataDir)
  const env = {
    ...process.env,
    PORT,
    DATA_DIR: dataDir,
    DATABASE_URL: 'file:' + path.join(dataDir, 'xhs_matrix.db'),
  }
  // 安装包内置的 Chromium（存在才指过去；开发环境没有则用系统默认 ms-playwright）
  const bundled = path.join(APP_ROOT, 'runtime', 'ms-playwright')
  if (fs.existsSync(bundled)) env.PLAYWRIGHT_BROWSERS_PATH = bundled
  return { env, dataDir }
}

function startBackend() {
  // 用【内置/系统 node】拉起后端，而非 Electron 内置 node：
  // 否则原生模块(better-sqlite3) 会因 Electron 的 ABI(NODE_MODULE_VERSION) 不匹配而加载失败。
  // 关键：优先用安装包内置 node 的【绝对路径】，不依赖 PATH（安装版 PATH 里没有 node 会导致后端起不来）。
  const bundledNode = path.join(APP_ROOT, 'runtime', 'node', 'node.exe')
  const nodeBin = process.env.BACKEND_NODE || (fs.existsSync(bundledNode) ? bundledNode : 'node')
  const useShell = (nodeBin === 'node') // 绝对路径(可能含空格)时不走 shell，避免解析错误
  const { env, dataDir } = buildBackendEnv()
  // 后端日志写入【数据目录】(一定可写)，而不是安装目录(Program Files 不可写)
  let outFd = 'ignore'
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    outFd = fs.openSync(path.join(dataDir, 'backend.log'), 'a')
  } catch (e) {
    outFd = 'ignore'
  }
  backendProc = spawn(nodeBin, [BACKEND_ENTRY], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', outFd, outFd],
    shell: useShell, // 绝对路径直接执行；仅回退系统 node 时用 shell 从 PATH 解析
  })
  backendProc.on('exit', (code) => {
    console.log(`[backend] 退出 code=${code}`)
  })
}

function waitForBackend(timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port: PORT, path: '/api/v1/health', timeout: 2000 },
        (res) => {
          if (res.statusCode === 200) return resolve()
          retry()
        },
      )
      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error('后端启动超时'))
      setTimeout(tick, 500)
    }
    tick()
  })
}

function applyAutoLaunch() {
  // 开机自启：默认关闭，可由设置写入的配置开启（避免擅自自启）。
  const openAtLogin = process.env.OPEN_AT_LOGIN === '1'
  try {
    app.setLoginItemSettings({ openAtLogin, args: [] })
  } catch (e) {
    console.warn('设置开机自启失败:', e.message)
  }
}

let APP_URL = `http://127.0.0.1:${PORT}`

// 内置启动页/错误页（data URL，无需后端即可显示，避免"白屏")
function pageHtml(title, msg, showRetry) {
  const retryBtn = showRetry
    ? `<button onclick="location.href='${APP_URL}'" style="margin-top:18px;padding:8px 22px;border:none;border-radius:6px;background:#ff2442;color:#fff;font-size:14px;cursor:pointer">重试打开</button>`
    : `<div class="sp"></div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#1f1f28;color:#eee;font-family:"Microsoft YaHei",sans-serif}
  .box{text-align:center;max-width:80%}.t{font-size:20px;font-weight:600;margin-bottom:10px}.m{font-size:14px;color:#aaa;line-height:1.7}
  .sp{margin:22px auto 0;width:34px;height:34px;border:3px solid #444;border-top-color:#ff2442;border-radius:50%;animation:r 1s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}</style></head>
  <body><div class="box"><div class="t">${title}</div><div class="m">${msg}</div>${retryBtn}</div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '小红书 AI 矩阵运营系统',
    icon: path.join(__dirname, 'build-resources', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  })
  // 先显示启动页（不再白屏），后端就绪后再切到应用
  mainWindow.loadURL(pageHtml('小红书矩阵 · 正在启动…', '首次启动较慢（杀毒软件会扫描程序，约 1-3 分钟），请耐心等待，无需操作。'))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// 后端就绪后加载应用；超时则显示错误页 + 日志路径
async function loadAppWhenReady() {
  try {
    await waitForBackend(180000) // 最多等 3 分钟（兼顾新机首启被杀毒扫描）
    if (mainWindow) mainWindow.loadURL(APP_URL)
  } catch (e) {
    const logHint = '日志位置：%LOCALAPPDATA%\\\\xhs-matrix\\\\data\\\\backend.log'
    if (mainWindow) {
      mainWindow.loadURL(pageHtml(
        '后端启动失败',
        '请稍后点"重试"；若仍失败，多为缺少运行库或被杀毒拦截。<br/>' + logHint,
        true,
      ))
    }
  }
}

// 单实例锁：再次双击/启动时，不再多开后端抢 4180（避免端口打架导致窗口"未响应"），
// 而是聚焦已经打开的窗口。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (!gotLock) return // 已有实例在跑，本进程直接退出
  Menu.setApplicationMenu(null) // 彻底移除应用菜单栏
  applyAutoLaunch()
  createWindow()        // 立即显示启动页（不白屏）
  PORT = await findFreePort(PORT)             // 4180 被占用则自动换端口
  APP_URL = `http://127.0.0.1:${PORT}`
  startBackend()
  loadAppWhenReady()    // 后端就绪后再切到应用

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function killBackendTree() {
  if (backendProc && backendProc.pid) {
    try {
      // shell:true 下 backendProc 是 cmd 壳，必须按 PID 杀整棵进程树，否则 node 残留占用端口
      require('child_process').execSync(`taskkill /pid ${backendProc.pid} /T /F`, { stdio: 'ignore' })
    } catch (e) {
      try { backendProc.kill() } catch (_) {}
    }
  }
}
app.on('before-quit', killBackendTree)
app.on('quit', killBackendTree)
process.on('exit', killBackendTree)
