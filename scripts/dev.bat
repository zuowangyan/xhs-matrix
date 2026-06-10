@echo off
REM 开发模式：分别启动后端(4180) 和 前端 Vite(5273)，浏览器访问 http://127.0.0.1:5273
echo [xhs-matrix] 启动开发模式...
start "xhs-backend" cmd /k "cd /d %~dp0..\backend-ts && npm run start:dev"
start "xhs-frontend" cmd /k "cd /d %~dp0..\frontend && npm run dev"
echo 后端: http://127.0.0.1:4180   前端: http://127.0.0.1:5273
