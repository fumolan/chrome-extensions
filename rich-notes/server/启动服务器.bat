@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 22.5 以上版本：https://nodejs.org/
  pause
  exit /b 1
)
rem 判断是否需要 pg / mysql 驱动（环境变量或 .env 里配置了 postgres / mysql）
set NEED_DRIVER=0
if defined DB_DRIVER set NEED_DRIVER=1
if exist .env (
  findstr /r /i /c:"DB_DRIVER=postgres" /c:"DB_DRIVER=mysql" .env >nul 2>nul && set NEED_DRIVER=1
)
if "%NEED_DRIVER%"=="1" (
  if not exist node_modules (
    echo 检测到使用 PostgreSQL/MySQL，首次需要安装数据库驱动...
    call npm install
    if errorlevel 1 (
      echo [错误] 驱动安装失败，请检查网络后重试，或改用默认的 sqlite。
      pause
      exit /b 1
    )
  )
)
echo 正在启动富文本笔记数据库服务器（数据库配置见 .env 文件，默认 sqlite）...
echo 服务地址: http://localhost:3001
echo 在扩展的设置中选择 REST 服务器模式并填入上述地址即可
node server.js
pause
