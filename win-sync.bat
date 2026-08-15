@echo off
cd /d "%~dp0"

echo GitHubから最新の状態を取得しています...
git pull
if errorlevel 1 (
  echo 更新の取得に失敗しました。インターネット接続を確認してください。
) else (
  echo 更新の取得が完了しました。
)

echo 依存パッケージを確認しています...
call npm --prefix server install

echo.
echo 完了しました。
pause