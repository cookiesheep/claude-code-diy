# cookiesheep's claude-code

基于 Claude Code 源码恢复的本地可运行版本，支持第三方 API 中转。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 构建

```bash
node build.mjs
```

### 3. 配置 API

编辑启动脚本，填入你的 API 密钥：

- **PowerShell** → `start.ps1`
- **Bash / macOS / Linux** → `start.sh`
- **CMD** → `start.bat`

```
ANTHROPIC_API_KEY=你的密钥
ANTHROPIC_BASE_URL=https://api.anthropic.com   # 或第三方中转地址
ANTHROPIC_MODEL=claude-haiku-4-5-20251001       # 模型名称
```

> 支持任何兼容 Anthropic Messages API (`/v1/messages`) 的代理服务。

### 4. 运行

```powershell
# PowerShell 交互模式
.\start.ps1

# 单次问答模式
.\start.ps1 -p --bare "你的问题"

# Bash
bash start.sh
```

## 环境要求

- **Node.js** >= 18（推荐 20+）
- **npm** 或 **bun**（安装依赖用）
- **Windows / macOS / Linux** 均支持

## 项目结构

```
├── src/              # 恢复的 TypeScript 源码（约 1888 个文件）
├── dist/             # 构建输出（node build.mjs 生成）
├── build.mjs         # 构建脚本（核心，包含所有适配逻辑）
├── node-esm-hooks.mjs # Node.js ESM 兼容层
├── cli.js            # 入口文件（构建自动生成）
├── start.ps1/.sh/.bat # 启动脚本
├── RECOVERY_GUIDE.md # 详细技术修复文档
└── package.json
```

## 技术说明

本项目从 Claude Code npm 包的 source map 恢复源码，并解决了以下关键问题使其在 Node.js 下运行：

- **Bun → Node 运行时适配**：`bun:bundle`/`bun:ffi` shim、`require()` 兼容、`.txt` 文件加载
- **ESM 兼容层**：自动解析无扩展名 import、处理非 JS 文件 import
- **内部依赖 stub**：`@anthropic-ai/sandbox-runtime` 等内部包的完整模拟
- **路径修复**：Windows 反斜杠、`src/` 裸路径重写（含 side-effect import）
- **构建自动化**：`node build.mjs` 一键完成所有适配，无需手动操作

详细技术文档见 [RECOVERY_GUIDE.md](./RECOVERY_GUIDE.md)。

## 免责声明

本项目仅供学习和研究用途。Claude Code 的原始代码版权归 Anthropic 所有。
使用本项目需要自行准备 Anthropic API 密钥或兼容的第三方 API 服务。
