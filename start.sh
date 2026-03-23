#!/bin/bash
# 启动 HSP Agent Hub (后端 :3001 + 前端 :3000)
# 用法: ./start.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 启动 HSP Agent Hub"
echo ""

# 检查后端 .env
if [ ! -f "$ROOT/backend/.env" ]; then
  echo "❌ 缺少 backend/.env，请先复制 .env.example 并填写 ANTHROPIC_API_KEY"
  exit 1
fi

# 检查 API key
if grep -q "sk-ant-your-key-here" "$ROOT/backend/.env"; then
  echo "⚠️  请先在 backend/.env 中填写真实的 ANTHROPIC_API_KEY"
  exit 1
fi

echo "▶ 启动后端 (port 3001)..."
cd "$ROOT/backend" && npm run dev &
BACKEND_PID=$!

sleep 1

echo "▶ 启动前端 (port 3000)..."
cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ 服务已启动:"
echo "   前端: http://localhost:3000"
echo "   后端: http://localhost:3001/health"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 捕获 Ctrl+C，关闭两个进程
trap "echo ''; echo '停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

wait
