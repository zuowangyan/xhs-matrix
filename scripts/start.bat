@echo off
REM 生产模式：构建前端 + 后端，然后用 Electron 启动（Electron 会拉起内置后端并加载同源前端）
echo [xhs-matrix] 构建前端...
cd /d %~dp0..\frontend && call npm run build || goto :err
echo [xhs-matrix] 构建后端...
cd /d %~dp0..\backend-ts && call npm run build || goto :err
echo [xhs-matrix] 启动 Electron...
cd /d %~dp0..\electron && call npm start
goto :eof
:err
echo 构建失败，请检查错误。
pause
