# cookiesheep's claude-code — 从源码恢复到本地运行全记录

> 本项目基于 Claude Code npm 包的 `cli.js.map` 恢复出的源码，经过大量修复使其能在 Node.js 环境下完整运行。
> 本文档记录了从"能构建但不能运行"到"完整交互式终端"的全部修复过程。

---

## 目录

1. [项目背景](#1-项目背景)
2. [初始状态](#2-初始状态)
3. [问题总览](#3-问题总览)
4. [修复详解](#4-修复详解)
5. [构建系统改造](#5-构建系统改造)
6. [快速开始](#6-快速开始)
7. [已知限制](#7-已知限制)

---

## 1. 项目背景

Claude Code 官方发布为 npm 包 `@anthropic-ai/claude-code`，内部使用 **Bun** 运行时构建为单文件 `cli.js`。
该仓库通过 source map (`cli.js.map`) 逆向恢复了源码结构（约 1888 个 TypeScript 文件），并补充了工程文件：

- `package.json` / `tsconfig.json`
- `build.mjs`（自定义构建脚本）
- `vendor/`（内置依赖）

**核心挑战**：原始代码为 Bun 环境设计，恢复后需要在标准 Node.js 下运行。

---

## 2. 初始状态

构建 (`bun run build`) 已经能成功：
- ✅ esbuild 转译 1888 个 TS 文件 → `dist/`
- ✅ 生成了 `cli.js` 入口
- ❌ `node cli.js` 立即报错

首次运行报错：
```
TypeError [ERR_INVALID_MODULE_SPECIFIER]: Invalid module ".ootstrapstate.js"
```

---

## 3. 问题总览

从首次报错到完整运行，共解决了 **11 类问题**：

| # | 问题类别 | 严重性 | 根因 |
|---|---------|--------|------|
| 1 | Windows 路径反斜杠 | 🔴 启动崩溃 | `path.relative()` 在 Windows 产生 `\` |
| 2 | ESM 裸路径缺扩展名 | 🔴 启动崩溃 | npm 包用无扩展名 import |
| 3 | 非 JS 文件被 import | 🔴 启动崩溃 | `.md`/`.txt` 等被当 ES module |
| 4 | 内部包 stub 缺命名导出 | 🔴 启动崩溃 | stub 只有 `export default null` |
| 5 | 恢复源码缺少函数 | 🟡 部分功能 | source map 恢复不完整 |
| 6 | ESM 中 require() 未定义 | 🔴 启动崩溃 | `"type": "module"` 下无 require |
| 7 | `bun:bundle` shim 提升问题 | 🔴 启动崩溃 | `const` 替换不被提升 |
| 8 | Commander 非法短标志 | 🔴 启动崩溃 | 恢复的 `-d2e` 不合法 |
| 9 | `require("src/...")` 未重写 | 🔴 交互崩溃 | build 漏处理 require + side-effect import |
| 10 | `require(".txt")` 不兼容 | 🔴 交互崩溃 | Node CJS 不能 require txt 文件 |
| 11 | `MACRO.*` 未替换 | 🔴 API 调用崩溃 | esbuild define 不完整 |

---

## 4. 修复详解

### 4.1 Windows 路径反斜杠（build.mjs）

**现象**：`".ootstrapstate.js"` — 莫名其妙的模块名
**根因**：`path.relative()` 在 Windows 返回 `..\\bootstrap\\state.js`，Node ESM 把 `\\` 当普通字符解析
**修复**：所有 `relative()` 调用后追加 `.replace(/\\\\/g, '/')`

```javascript
// 修复前
let rel = relative(fileDirRelToSrc, targetFromSrc);
// 修复后
let rel = relative(fileDirRelToSrc, targetFromSrc).replace(/\\/g, '/');
```

### 4.2 ESM 裸路径缺扩展名（node-esm-hooks.mjs）

**现象**：`Cannot find module '.../jsonc-parser/.../format'`
**根因**：部分 npm 包的 ESM 入口使用无扩展名 import，Node.js 严格 ESM 不自动补全
**修复**：创建自定义 ESM resolve hook，自动尝试 `.js`/`.mjs`/`/index.js` 后缀

```javascript
// node-esm-hooks.mjs — resolve hook
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (err) {
    // 尝试 .js, .mjs, /index.js 等后缀
    for (const ext of ['.js', '.mjs', '/index.js']) {
      const candidate = basePath + ext;
      if (await stat(candidate).catch(() => null)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    throw err;
  }
}
```

### 4.3 非 JS 文件被 import（node-esm-hooks.mjs）

**现象**：`Unknown file extension ".md"`
**根因**：代码中 `import "./foo.md"` 在 Bun 下返回文件内容，Node 不认识
**修复**：在 ESM load hook 中，把 `.md`/`.txt` 等返回为导出字符串的 ES module

```javascript
export async function load(url, context, nextLoad) {
  if (TEXT_EXTENSIONS.has(path.extname(url))) {
    const content = await readFile(fileURLToPath(url), 'utf-8');
    return { format: 'module', source: `export default ${JSON.stringify(content)};\n` };
  }
  return nextLoad(url, context);
}
```

### 4.4 内部包 stub 智能生成（build.mjs Step 3e）

**现象**：`SandboxManager does not provide an export named 'SandboxManager'`
**根因**：`@anthropic-ai/sandbox-runtime` 等内部包的 stub 只有 `export default null`，但代码导入命名导出
**修复**：
1. 扫描所有 dist 文件，提取每个内部包被 import 的命名导出
2. 自动生成匹配的 stub（class 用 class 导出，常量用 const 导出）
3. 对 `@anthropic-ai/sandbox-runtime` 使用手写 stub（需要完整静态方法）

```javascript
// SPECIAL_STUBS — 需要特殊处理的包
const SPECIAL_STUBS = {
  '@anthropic-ai/sandbox-runtime': `
export class SandboxManager {
  static isSupportedPlatform() { return false; }
  static isSandboxingEnabled() { return false; }
  static checkDependencies() { return { satisfied: false, errors: ['not available'] }; }
  // ... 其他静态方法
}`,
};
```

### 4.5 恢复源码缺少函数（build.mjs Step 3f）

**现象**：`does not provide an export named 'isReplBridgeActive'`
**根因**：source map 恢复不完整，部分函数在真实文件中丢失
**修复**：自动扫描所有 import/export 不匹配，在目标文件末尾追加 stub 函数
- 同时检查 `export *` 重导出链，避免误判

### 4.6 ESM 中 require() 未定义（build.mjs Step 3a2）

**现象**：`ReferenceError: require is not defined in ES module scope`
**根因**：原始代码有大量 lazy `require()`（用于条件加载），但 `"type": "module"` 下 require 不存在
**修复**：在所有使用 require 的文件开头注入 `createRequire` shim

```javascript
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);
```

### 4.7 bun:bundle shim 提升问题（build.mjs Step 3）

**现象**：`Cannot access 'feature' before initialization`
**根因**：`import { feature } from "bun:bundle"` 被替换为 `const feature = () => false`，但 import 有提升效果而 const 没有
**修复**：不在原位替换，而是删除原 import 行 + 在文件开头 prepend shim

### 4.8 require("src/...") 和 side-effect import 未重写

**现象**：`Cannot find package 'src'`
**根因**：build 脚本只重写了 `from "src/..."` 和 `import("src/...")`，遗漏了：
- `require("src/...")` — CJS 条件加载
- `import "src/..."` — 无 `from` 的 side-effect import

**修复**：在 build.mjs Step 3b 中增加两种模式的路径重写

### 4.9 require(".txt") Node 不兼容

**现象**：`Cannot read properties of undefined (reading 'trimEnd')`
**根因**：Bun 的 `require("./file.txt")` 返回文件内容字符串，Node CJS 的 require 不支持 .txt
**修复**：build 时将 `require("...txt")` 转换为 `readFileSync` + `import.meta.url`

### 4.10 MACRO.* 未完全替换

**现象**：`MACRO is not defined`
**根因**：esbuild define 只配了 4 个 MACRO 属性，但代码用了 7 个
**修复**：补全所有 MACRO define（BUILD_TIME, ISSUES_EXPLAINER, VERSION_CHANGELOG）

### 4.11 交互式对话框跳过

**现象**：`Class constructor Select cannot be invoked without 'new'`（已修复）+ Onboarding/Trust 弹窗
**修复**：
- 自动完成 Onboarding（设 theme + hasCompletedOnboarding）
- 自动信任当前目录
- 跳过所有需要交互式 Select 组件的对话框

---

## 5. 构建系统改造

`build.mjs` 最终包含以下步骤：

| 步骤 | 名称 | 作用 |
|------|------|------|
| 0 | Clean | 清理旧 dist/ |
| 1 | Discover | 发现所有 TS/TSX 源文件 |
| 2 | Transpile | esbuild 转译（含 MACRO define） |
| 3 | Patch bun:bundle | 替换 bun:bundle → `feature()` shim（prepend） |
| 3a2 | Inject require | 注入 createRequire shim |
| 3a3 | Convert txt require | `require(.txt)` → `readFileSync` |
| 3b | Rewrite src/ imports | `from/import/require "src/..."` → 相对路径 |
| 3c | Fix .jsx → .js | 修正 JSX 扩展名 |
| 3c2 | Strip .d.ts imports | 移除类型 import |
| 3d | Generate empty stubs | 缺失相对导入的空 stub |
| 3e | Internal package shims | @ant/* 等内部包 stub（含智能命名导出） |
| 3f | Patch missing exports | 自动补丁缺失的命名导出 |
| 3g | Require target stubs | 所有 require() 目标的 stub |
| 4 | Copy assets | 复制 JSON/MD/TXT 等资源 |
| 5 | Create cli.js | 生成入口（含 ESM hooks 注册） |
| 6 | Post-process | 修复 entrypoint catch、stdin 等待、对话框跳过 |

**重要**：`node build.mjs` 执行后无需任何手动操作，所有 stub 和补丁自动生成。

---

## 6. 快速开始

### 环境要求
- Node.js >= 18（推荐 20+）
- npm 或 bun（用于安装依赖）

### 安装

```bash
git clone <仓库地址>
cd claude-code
npm install
node build.mjs
```

### 配置 API

编辑 `start.ps1`（Windows PowerShell）或 `start.sh`（Bash），填入你的 API 配置：

```powershell
$env:ANTHROPIC_API_KEY = "你的API密钥"
$env:ANTHROPIC_BASE_URL = "https://你的中转地址"
$env:ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
```

支持的中转格式：任何兼容 Anthropic Messages API (`/v1/messages`) 的代理。

### 运行

```powershell
# 交互模式（TUI 终端界面）
.\start.ps1

# 打印模式（单次问答）
.\start.ps1 -p --bare "你的问题"

# 查看版本
node cli.js --version
# → 2.1.88 (cookiesheep's claude-code)
```

---

## 7. 已知限制

1. **Sandbox 功能不可用** — `@anthropic-ai/sandbox-runtime` 为内部包，已 stub 为禁用状态
2. **部分内部功能已 stub** — Proactive、Kairos、Bridge 等 Anthropic 内部功能返回空值
3. **ripgrep 二进制缺失** — GlobTool/GrepTool 依赖的 `rg.exe` 需要单独安装
4. **feature flags 全部关闭** — `feature("xxx")` 始终返回 false，部分实验功能不可用
5. **插件 hooks 验证** — 如果 `~/.claude` 中有官方 Claude Code 的 hooks 配置，可能报 ZodError 警告（不影响核心功能）

---

## 致谢

- 原始源码恢复：基于 Claude Code npm 包的 source map
- 运行时适配：从 Bun 到 Node.js 的完整迁移
- API 中转：支持第三方 Anthropic API 兼容代理

---

*cookiesheep's claude-code v2.1.88 — Built with determination* 🚀
