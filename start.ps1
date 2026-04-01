# cookiesheep's claude-code 启动脚本 (PowerShell)

# API 配置 — 请填入你自己的 API 信息
$env:ANTHROPIC_API_KEY = "YOUR_API_KEY_HERE"
$env:ANTHROPIC_BASE_URL = "https://api.anthropic.com"   # 或你的第三方中转地址
$env:ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"       # 可选: claude-sonnet-4-20250514 等
$env:DISABLE_AUTOUPDATER = "1"

Write-Host "Starting cookiesheep's claude-code..." -ForegroundColor Cyan
node "$PSScriptRoot\cli.js" @args
Write-Host "Process exited with code: $LASTEXITCODE" -ForegroundColor Yellow
