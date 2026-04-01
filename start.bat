@echo off
REM cookiesheep's claude-code 启动脚本

REM API 配置 — 请填入你自己的 API 信息
set ANTHROPIC_API_KEY=YOUR_API_KEY_HERE
set ANTHROPIC_BASE_URL=https://api.anthropic.com
set ANTHROPIC_MODEL=claude-haiku-4-5-20251001
set DISABLE_AUTOUPDATER=1

REM 交互模式: start.bat
REM 打印模式: start.bat -p --bare "你的问题"
node "%~dp0cli.js" %*
