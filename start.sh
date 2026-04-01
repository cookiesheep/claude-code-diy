#!/usr/bin/env bash
# cookiesheep's claude-code 启动脚本

# API 配置 — 请填入你自己的 API 信息
export ANTHROPIC_API_KEY="YOUR_API_KEY_HERE"
export ANTHROPIC_BASE_URL="https://api.anthropic.com"   # 或你的第三方中转地址
export ANTHROPIC_MODEL="claude-haiku-4-5-20251001"       # 可选: claude-sonnet-4-20250514 等
export DISABLE_AUTOUPDATER="1"

# 交互模式: bash start.sh
# 打印模式: bash start.sh -p --bare "你的问题"
node "$(dirname "$0")/cli.js" "$@"
