@echo off
title スコアボード終了
echo ポート3000で動作中のプロセスを検索しています...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
	echo プロセス %%a を終了します...
	taskkill /F /PID %%a
	set FOUND=1
)

if %FOUND%==0 (
	echo 起動中のサーバーが見つかりませんでした。
) else (
	echo 終了しました。
)

pause