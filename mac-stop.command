#!/bin/bash
echo "ポート3000で動作中のプロセスを検索しています..."
PID=$(lsof -ti:3000)

if [ -z "$PID" ]; then
  echo "起動中のサーバーが見つかりませんでした。"
else
  echo "プロセス $PID を終了します..."
  kill -9 $PID
  echo "終了しました。"
fi

echo ""
read -p "Enterキーを押すと閉じます..."