#!/bin/bash
cd "$(dirname "$0")"

echo "GitHubから最新の状態を取得しています..."
if git pull; then
  echo "更新の取得が完了しました。"
else
  echo "更新の取得に失敗しました。インターネット接続を確認してください。"
fi

echo "依存パッケージを確認しています..."
npm --prefix server install

echo ""
read -p "Enterキーを押すと閉じます..."