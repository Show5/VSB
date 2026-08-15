#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "server/node_modules" ]; then
  echo "初回起動のため、依存パッケージをインストールしています..."
  npm --prefix server install
fi

echo "サーバーを起動しています..."
npm --prefix server run dev