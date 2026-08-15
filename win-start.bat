@echo off
cd /d "%~dp0"

if not exist "server\node_modules" (
  echo 初回起動のため、依存パッケージをインストールしています...
  call npm --prefix server install
)

call npm --prefix server run dev
pause