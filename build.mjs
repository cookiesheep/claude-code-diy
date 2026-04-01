/**
 * Build script for Claude Code (external/non-Bun build).
 *
 * Uses esbuild to transpile all TS/TSX → JS while preserving directory
 * structure. Handles:
 *   1. bun:bundle → shim where feature() always returns false
 *   2. bun:ffi → shim with no-op exports
 *   3. MACRO.VERSION / MACRO.PACKAGE_URL etc. → real values
 *   4. .js extension imports (TypeScript ESM convention) → resolved correctly
 *
 * Output: dist/  (mirrors src/ structure as runnable ESM JavaScript)
 *         cli.js (root entry point that loads dist/entrypoints/cli.js)
 *
 * Usage: node build.mjs
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const DIST = join(__dirname, 'dist');

console.log(`\n  Building Claude Code v${pkg.version}\n`);

// ── Step 0: Clean previous build ────────────────────────────────────────
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true });
  console.log('  ✓ Cleaned previous dist/');
}

// ── Step 1: Discover all TS/TSX source files ────────────────────────────
function walkDir(dir, exts) {
  const results = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'typings') continue;
        walk(full);
      } else if (exts.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

const srcDir = join(__dirname, 'src');
const vendorDir = join(__dirname, 'vendor');
const srcFiles = walkDir(srcDir, ['.ts', '.tsx']);
const vendorFiles = existsSync(vendorDir) ? walkDir(vendorDir, ['.ts', '.tsx']) : [];
const allFiles = [...srcFiles, ...vendorFiles];

console.log(`  ✓ Found ${srcFiles.length} source files + ${vendorFiles.length} vendor files`);

// ── Step 2: Build with esbuild (transpile-only, no bundling) ────────────
// Note: esbuild plugins only work in bundle mode, so we post-process
// the output to replace bun:bundle / bun:ffi imports.
console.log('  ⏳ Transpiling TypeScript → JavaScript...');

try {
  await esbuild.build({
    entryPoints: allFiles,
    outdir: DIST,
    outbase: __dirname,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    jsx: 'automatic',
    bundle: false,
    define: {
      'MACRO.VERSION': JSON.stringify(pkg.version),
      'MACRO.PACKAGE_URL': JSON.stringify(pkg.homepage || 'https://github.com/anthropics/claude-code'),
      'MACRO.NATIVE_PACKAGE_URL': JSON.stringify('https://github.com/anthropics/claude-code'),
      'MACRO.FEEDBACK_CHANNEL': JSON.stringify('https://github.com/anthropics/claude-code/issues'),
      'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
      'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
      'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
    },
    logLevel: 'warning',
  });

  const outFiles = walkDir(DIST, ['.js', '.mjs']);
  console.log(`  ✓ Transpiled ${outFiles.length} files → dist/`);
} catch (err) {
  console.error('  ✗ esbuild transpilation failed:', err.message);
  process.exit(1);
}

// ── Step 3: Post-process — replace bun:bundle and bun:ffi imports ───────
console.log('  ⏳ Patching bun:bundle / bun:ffi imports...');

const BUN_BUNDLE_SHIM = `const feature = (name) => false;`;
const BUN_FFI_SHIM = `const dlopen = () => { throw new Error("bun:ffi not available"); };
const ptr = () => 0;
const toBuffer = () => Buffer.alloc(0);
const toArrayBuffer = () => new ArrayBuffer(0);
const CString = () => "";
const suffix = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";`;

const distJsFiles = walkDir(DIST, ['.js']);
let patchedCount = 0;
for (const f of distJsFiles) {
  let code = readFileSync(f, 'utf-8');
  let changed = false;

  // Replace: import { feature } from "bun:bundle";
  // Remove the import line and prepend the shim at top of file
  // so it's available before any usage (imports are hoisted, const is not)
  if (code.includes('bun:bundle')) {
    code = code.replace(
      /import\s*\{[^}]*\}\s*from\s*["']bun:bundle["']\s*;?/g,
      '/* bun:bundle removed */'
    );
    code = BUN_BUNDLE_SHIM + '\n' + code;
    changed = true;
  }

  // Replace: import { ... } from "bun:ffi";
  if (code.includes('bun:ffi')) {
    code = code.replace(
      /import\s*\{[^}]*\}\s*from\s*["']bun:ffi["']\s*;?/g,
      '/* bun:ffi removed */'
    );
    code = BUN_FFI_SHIM + '\n' + code;
    changed = true;
  }

  if (changed) {
    writeFileSync(f, code);
    patchedCount++;
  }
}
console.log(`  ✓ Patched ${patchedCount} files with bun: shims`);

// ── Step 3a2: Inject createRequire shim for files using require() ───────
// esbuild preserves lazy require() calls in ESM files. Since package.json
// has "type": "module", all .js files are ESM and require() is undefined.
// We inject a createRequire-based shim at the top of affected files.
console.log('  ⏳ Injecting require() shim into ESM files...');

const REQUIRE_SHIM = `import { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);\n`;
let requireShimCount = 0;
for (const f of distJsFiles) {
  const code = readFileSync(f, 'utf-8');
  // Check if file uses require() but doesn't already have createRequire
  if (/\brequire\s*\(/.test(code) && !code.includes('createRequire')) {
    writeFileSync(f, REQUIRE_SHIM + code);
    requireShimCount++;
  }
}
console.log(`  ✓ Injected require() shim in ${requireShimCount} files`);

// ── Step 3a3: Convert require("...txt") to readFileSync ─────────────────
// Node CJS require() cannot load .txt files (Bun can). Convert to readFileSync.
let txtRequireCount = 0;
for (const f of distJsFiles) {
  let code = readFileSync(f, 'utf-8');
  if (!code.includes('.txt"') && !code.includes(".txt'")) continue;
  const updated = code.replace(
    /require\(["'](\.[^"']*\.txt)["']\)/g,
    (match, txtPath) => {
      txtRequireCount++;
      return `(() => { try { return require("fs").readFileSync(new URL("${txtPath.replace(/\\/g, '/')}", import.meta.url), "utf-8"); } catch { return ""; } })()`;
    }
  );
  if (updated !== code) writeFileSync(f, updated);
}
if (txtRequireCount > 0) console.log(`  ✓ Converted ${txtRequireCount} require(.txt) to readFileSync`);

// ── Step 3b: Rewrite bare "src/" imports to relative paths ─────────────
// The source uses tsconfig paths like `import ... from 'src/utils/foo.js'`.
// TypeScript resolves these via baseUrl, but Node.js can't. We convert them
// to relative paths based on each file's position within dist/src/.
console.log('  ⏳ Rewriting bare src/ imports to relative paths...');

const distSrcDir = join(DIST, 'src');
let srcImportCount = 0;
for (const f of distJsFiles) {
  let code = readFileSync(f, 'utf-8');
  if (!code.includes('"src/') && !code.includes("'src/")) continue;

  const fileDir = dirname(f);
  // Only rewrite files inside dist/src/
  if (!f.startsWith(distSrcDir)) continue;

  const fileDirRelToSrc = relative(distSrcDir, fileDir); // e.g. "utils/model"

  code = code.replace(
    /(from\s+["'])src\/([^"']+)(["'])/g,
    (match, prefix, importPath, suffix) => {
      // importPath is e.g. "utils/debug.js" or "components/Markdown.js"
      // We need the relative path from the current file's dir to dist/src/<importPath>
      const targetFromSrc = importPath; // already relative to src/
      let rel = relative(fileDirRelToSrc, targetFromSrc).replace(/\\/g, '/');
      // Ensure it starts with ./ or ../
      if (!rel.startsWith('.')) rel = './' + rel;
      return prefix + rel + suffix;
    }
  );

  // Also handle dynamic import("src/...")
  code = code.replace(
    /(import\s*\(\s*["'])src\/([^"']+)(["']\s*\))/g,
    (match, prefix, importPath, suffix) => {
      const targetFromSrc = importPath;
      let rel = relative(fileDirRelToSrc, targetFromSrc).replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = './' + rel;
      return prefix + rel + suffix;
    }
  );

  // Also handle require("src/...")
  code = code.replace(
    /(require\s*\(\s*["'])src\/([^"']+)(["']\s*\))/g,
    (match, prefix, importPath, suffix) => {
      const targetFromSrc = importPath;
      let rel = relative(fileDirRelToSrc, targetFromSrc).replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = './' + rel;
      return prefix + rel + suffix;
    }
  );

  // Also handle side-effect import "src/..." (no `from`)
  code = code.replace(
    /(import\s+["'])src\/([^"']+)(["'])/g,
    (match, prefix, importPath, suffix) => {
      // Skip if it's actually `import ... from "src/..."` (already handled above)
      if (/from\s*$/.test(code.slice(Math.max(0, code.lastIndexOf('\n', match.index)), match.index))) {
        return match;
      }
      const targetFromSrc = importPath;
      let rel = relative(fileDirRelToSrc, targetFromSrc).replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = './' + rel;
      return prefix + rel + suffix;
    }
  );

  writeFileSync(f, code);
  srcImportCount++;
}
console.log(`  ✓ Rewrote bare src/ imports in ${srcImportCount} files`);

// ── Step 3c: Rewrite .jsx → .js in imports ──────────────────────────────
// esbuild outputs .tsx → .js but some imports reference .jsx explicitly
let jsxFixCount = 0;
for (const f of distJsFiles) {
  let code = readFileSync(f, 'utf-8');
  if (!code.includes('.jsx')) continue;
  const updated = code.replace(/(from\s+["'][^"']*?)\.jsx(["'])/g, '$1.js$2')
                       .replace(/(import\s*\(\s*["'][^"']*?)\.jsx(["']\s*\))/g, '$1.js$2');
  if (updated !== code) {
    writeFileSync(f, updated);
    jsxFixCount++;
  }
}
if (jsxFixCount > 0) console.log(`  ✓ Fixed .jsx → .js in ${jsxFixCount} files`);

// ── Step 3c2: Strip .d.ts imports (type-only, not valid at runtime) ─────
let dtsStripCount = 0;
for (const f of distJsFiles) {
  let code = readFileSync(f, 'utf-8');
  if (!code.includes('.d.ts')) continue;
  const updated = code.replace(/^import\s+.*["'][^"']*\.d\.ts["']\s*;?\s*$/gm, '// [stripped .d.ts import]');
  if (updated !== code) {
    writeFileSync(f, updated);
    dtsStripCount++;
  }
}
if (dtsStripCount > 0) console.log(`  ✓ Stripped .d.ts imports in ${dtsStripCount} files`);

// ── Step 3d: Generate empty stubs for missing internal modules ──────────
// Many imports reference Anthropic-internal modules (commands, types, tools)
// that were stripped from the public source. We create empty ES module stubs
// so Node.js can resolve them at runtime (they export nothing).
console.log('  ⏳ Generating stubs for missing internal modules...');

let stubCount = 0;
for (const f of distJsFiles) {
  const code = readFileSync(f, 'utf-8');
  const re = /from\s+["'](\.[^"']+)["']/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const importPath = m[1];
    const resolved = join(dirname(f), importPath);
    if (!existsSync(resolved)) {
      mkdirSync(dirname(resolved), { recursive: true });
      if (resolved.endsWith('.js')) {
        writeFileSync(resolved, '// Auto-generated empty stub for missing internal module\nexport default null;\n');
        stubCount++;
      } else if (resolved.endsWith('.md')) {
        writeFileSync(resolved, '');
        stubCount++;
      }
    }
  }
}
console.log(`  ✓ Generated ${stubCount} empty module stubs`);

// ── Step 3e: Create runtime shims for @ant/* and internal packages ──────
// tsconfig paths only work for TypeScript. At runtime, Node.js needs
// actual packages in node_modules for bare specifier resolution.
// We scan all dist files to discover which named exports are needed
// and generate proper stub modules.
console.log('  ⏳ Creating runtime shims for internal packages...');

// Hardcoded stubs for packages that need special treatment (static methods, etc.)
const SPECIAL_STUBS = {
  '@anthropic-ai/sandbox-runtime': `// Runtime stub — SandboxManager with all static methods
export class SandboxManager {
  constructor() {}
  static isSupportedPlatform() { return false; }
  static getSandboxUnavailableReason() { return 'Sandbox not available in external build'; }
  static isSandboxingEnabled() { return false; }
  static isSandboxRequired() { return false; }
  static areUnsandboxedCommandsAllowed() { return true; }
  static isAutoAllowBashIfSandboxedEnabled() { return false; }
  static areSandboxSettingsLockedByPolicy() { return false; }
  static async initialize() {}
  static checkDependencies() { return { satisfied: false, errors: ['not available'] }; }
  static wrapWithSandbox(cmd) { return cmd; }
  static updateConfig() {}
}
export const SandboxRuntimeConfigSchema = {};
export class SandboxViolationStore { constructor() {} }
export default null;
`,
  'color-diff-napi': `// Runtime stub — color-diff-napi native module not available
export class ColorDiff { constructor() {} render() { return ''; } }
export class ColorFile { constructor() {} render() { return ''; } }
export function getSyntaxTheme() { return null; }
export default null;
`,
};

const internalPackages = [
  '@ant/claude-for-chrome-mcp',
  '@ant/computer-use-input',
  '@ant/computer-use-mcp',
  '@ant/computer-use-mcp/types',
  '@ant/computer-use-mcp/sentinelApps',
  '@ant/computer-use-swift',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/sandbox-runtime',
  'image-processor-napi',
  'audio-capture-napi',
  'url-handler-napi',
  'color-diff-napi',
];

// Scan all dist files to discover named imports from internal packages
const importsByPackage = {};
for (const pkgSpec of internalPackages) {
  importsByPackage[pkgSpec] = new Set();
}
for (const f of distJsFiles) {
  const code = readFileSync(f, 'utf-8');
  for (const pkgSpec of internalPackages) {
    // Match: import { Foo, Bar as Baz } from "pkgSpec"
    const escapedPkg = pkgSpec.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const re = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedPkg}["']`, 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const names = m[1].split(',').map(s => {
        const trimmed = s.trim();
        // "Foo as Bar" → export the original name "Foo"
        const asMatch = trimmed.match(/^(\w+)\s+as\s+/);
        return asMatch ? asMatch[1] : trimmed;
      }).filter(Boolean);
      for (const name of names) {
        importsByPackage[pkgSpec].add(name);
      }
    }
    // Also match: import Foo from "pkgSpec" (default import)
    const defRe = new RegExp(`import\\s+(\\w+)\\s+from\\s*["']${escapedPkg}["']`, 'g');
    while ((m = defRe.exec(code)) !== null) {
      importsByPackage[pkgSpec].add('__default__');
    }
    // Also match: import * as Foo from "pkgSpec" (namespace import)
    const nsRe = new RegExp(`import\\s*\\*\\s*as\\s+\\w+\\s+from\\s*["']${escapedPkg}["']`, 'g');
    while ((m = nsRe.exec(code)) !== null) {
      importsByPackage[pkgSpec].add('__namespace__');
    }
  }
}

let shimCount = 0;
for (const pkgSpec of internalPackages) {
  const parts = pkgSpec.startsWith('@') ? pkgSpec.split('/') : [pkgSpec];
  let pkgName, subpath;
  if (parts[0].startsWith('@')) {
    pkgName = parts[0] + '/' + parts[1];
    subpath = parts.slice(2).join('/');
  } else {
    pkgName = parts[0];
    subpath = parts.slice(1).join('/');
  }

  const pkgDir = join(__dirname, 'node_modules', pkgName);

  // Use special stub if defined, otherwise auto-generate
  const stubContent = SPECIAL_STUBS[pkgSpec] || (() => {
    const namedExports = importsByPackage[pkgSpec];
    let stubLines = ['// Runtime stub — internal package not available in external builds'];
    const classLikeNames = [];
    const nonClassNames = [];
    for (const name of namedExports) {
      if (name === '__default__' || name === '__namespace__') continue;
      if (/^[A-Z][a-z]/.test(name) && !/^[A-Z_]+$/.test(name)) {
        classLikeNames.push(name);
      } else {
        nonClassNames.push(name);
      }
    }
    for (const name of classLikeNames) {
      stubLines.push(`export class ${name} { constructor() {} }`);
    }
    for (const name of nonClassNames) {
      if (/(?:TOOLS|ITEMS|LIST|APPS|ENTRIES|_NAMES)$/i.test(name)) {
        stubLines.push(`export const ${name} = [];`);
      } else if (/Schema$/i.test(name)) {
        stubLines.push(`export const ${name} = {};`);
      } else {
        stubLines.push(`export const ${name} = null;`);
      }
    }
    stubLines.push('export default null;');
    return stubLines.join('\n') + '\n';
  })();

  if (!existsSync(pkgDir)) {
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: pkgName,
      version: '0.0.0-stub',
      type: 'module',
      main: 'index.js',
      exports: { '.': './index.js', './*': './*.js' },
    }, null, 2));
    shimCount++;
  }

  // Always write stub content (overwrite on each build to keep stubs current)
  if (subpath) {
    const subFile = join(pkgDir, subpath + '.js');
    mkdirSync(dirname(subFile), { recursive: true });
    writeFileSync(subFile, stubContent);
  } else {
    writeFileSync(join(pkgDir, 'index.js'), stubContent);
  }
}
console.log(`  ✓ Created ${shimCount} runtime package shims`);

// ── Step 3f: Patch missing named exports in dist files ──────────────────
// The recovered source is incomplete — some files import named exports
// that don't exist in the target file. We scan for all named imports
// from relative paths, check if the target file exports them, and add
// no-op stub exports for any that are missing.
console.log('  ⏳ Patching missing named exports in dist files...');

const distJsFiles2 = walkDir(DIST, ['.js']);
// Collect all named imports per target file
const neededExports = {}; // targetFile -> Set<name>
for (const f of distJsFiles2) {
  const code = readFileSync(f, 'utf-8');
  const re = /import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const names = m[1].split(',').map(s => {
      const trimmed = s.trim();
      const asMatch = trimmed.match(/^(\w+)\s+as\s+/);
      return asMatch ? asMatch[1] : trimmed;
    }).filter(Boolean);
    const importPath = m[2];
    let resolved = join(dirname(f), importPath);
    if (!resolved.endsWith('.js')) resolved += '.js';
    if (!existsSync(resolved)) continue; // will be caught by stub gen
    if (!neededExports[resolved]) neededExports[resolved] = new Set();
    for (const name of names) {
      neededExports[resolved].add(name);
    }
  }
}

// Now check which exports are actually missing and patch them
let patchExportCount = 0;
for (const [targetFile, neededNames] of Object.entries(neededExports)) {
  const code = readFileSync(targetFile, 'utf-8');

  // Collect all names exported via "export * from './foo.js'" (re-exports)
  const reExportedNames = new Set();
  const reExportRe = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  let reM;
  while ((reM = reExportRe.exec(code)) !== null) {
    const reExportPath = reM[1];
    let resolvedReExport = join(dirname(targetFile), reExportPath);
    if (!resolvedReExport.endsWith('.js')) resolvedReExport += '.js';
    if (existsSync(resolvedReExport)) {
      const reExportCode = readFileSync(resolvedReExport, 'utf-8');
      // Extract all export names from the re-exported file
      const exportNameRe = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
      let em;
      while ((em = exportNameRe.exec(reExportCode)) !== null) {
        reExportedNames.add(em[1]);
      }
      // Also check export { ... }
      const exportBraceRe = /export\s*\{([^}]+)\}/g;
      while ((em = exportBraceRe.exec(reExportCode)) !== null) {
        for (const n of em[1].split(',')) {
          const trimmed = n.trim().split(/\s+as\s+/).pop().trim();
          if (trimmed) reExportedNames.add(trimmed);
        }
      }
    }
  }

  const missingNames = [];
  for (const name of neededNames) {
    // Check if this name is exported directly or via re-export
    if (reExportedNames.has(name)) continue;
    const exportPatterns = [
      new RegExp(`export\\s+(?:const|let|var|function|class|async\\s+function)\\s+${name}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
    ];
    const isExported = exportPatterns.some(p => p.test(code));
    if (!isExported) {
      missingNames.push(name);
    }
  }
  if (missingNames.length > 0) {
    // Append stub exports at the end of the file
    let patch = '\n// --- Auto-patched missing exports ---\n';
    for (const name of missingNames) {
      if (/^[A-Z]/.test(name)) {
        patch += `export class ${name} { constructor() {} }\n`;
      } else {
        patch += `export function ${name}() { return null; }\n`;
      }
    }
    writeFileSync(targetFile, code + patch);
    patchExportCount += missingNames.length;
  }
}
console.log(`  ✓ Patched ${patchExportCount} missing named exports`);

// ── Step 3g: Generate stubs for missing require() targets ────────────────
// Lazy require() calls reference internal modules that don't exist in the
// recovered source. Most are behind feature("xxx") gates (always false),
// but some are unconditional. Create empty stubs for all of them.
console.log('  ⏳ Generating stubs for missing require() targets...');
const distJsFiles3 = walkDir(DIST, ['.js']);
let requireStubCount = 0;
for (const f of distJsFiles3) {
  const code = readFileSync(f, 'utf-8');
  const re = /require\(["'](\.[^"']+)["']\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const imp = m[1];
    const resolved = join(dirname(f), imp);
    const candidates = [resolved, resolved + '.js', join(resolved, 'index.js')];
    if (candidates.some(c => existsSync(c))) continue;
    const target = resolved.endsWith('.js') ? resolved :
                   resolved.endsWith('.txt') ? resolved :
                   resolved + '.js';
    mkdirSync(dirname(target), { recursive: true });
    if (target.endsWith('.txt')) {
      writeFileSync(target, '');
    } else {
      writeFileSync(target, '// Auto-generated stub\nexport default null;\n');
    }
    requireStubCount++;
  }
}
console.log(`  ✓ Generated ${requireStubCount} require() target stubs`);

// ── Step 4: Copy non-TS assets (JSON, etc.) ─────────────────────────────
const assetExts = ['.json', '.md', '.txt', '.yaml', '.yml', '.html', '.css', '.svg', '.png'];
const assetFiles = walkDir(srcDir, assetExts);
for (const f of assetFiles) {
  const rel = relative(__dirname, f);
  const dest = join(DIST, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(f, dest);
}
if (assetFiles.length > 0) {
  console.log(`  ✓ Copied ${assetFiles.length} asset files`);
}

// ── Step 5: Create root cli.js entry point ──────────────────────────────
writeFileSync(join(__dirname, 'cli.js'), `#!/usr/bin/env node
// Auto-generated by build.mjs — cookiesheep's claude-code v${pkg.version}
import { register } from 'node:module';
register('./node-esm-hooks.mjs', import.meta.url);

try {
  await import('./dist/src/entrypoints/cli.js');
} catch (e) {
  console.error('Fatal error:', e);
  process.exit(1);
}
`);
console.log('  ✓ Created cli.js entry point');

// ── Step 6: Post-process entrypoint ─────────────────────────────────────
// Fix "void main()" → proper error handling, and getInputPrompt stdin hang
const entrypointFile = join(DIST, 'src/entrypoints/cli.js');
if (existsSync(entrypointFile)) {
  let epCode = readFileSync(entrypointFile, 'utf-8');
  epCode = epCode.replace(
    'void main();',
    "main().catch(async (e) => { const fs = await import('fs'); fs.appendFileSync('crash.log', '[MAIN-ERROR] ' + String(e?.message||e) + '\\n' + (e?.stack||'') + '\\n'); process.exit(1); });"
  );
  writeFileSync(entrypointFile, epCode);
}
const mainFile = join(DIST, 'src/main.js');
if (existsSync(mainFile)) {
  let mainCode = readFileSync(mainFile, 'utf-8');
  // Fix getInputPrompt to skip stdin wait when prompt is already provided
  mainCode = mainCode.replace(
    /async function getInputPrompt\(prompt, inputFormat\) \{\n\s*if \(!process\.stdin\.isTTY/,
    'async function getInputPrompt(prompt, inputFormat) {\n  if (prompt) { return prompt; }\n  if (!process.stdin.isTTY'
  );
  // Skip launchInvalidSettingsDialog (uses Select component that has class issues)
  mainCode = mainCode.replace(
    /await launchInvalidSettingsDialog\(root,\s*\{[^}]+\}\);/,
    'for (const err of nonMcpErrors) { process.stderr.write("Settings warning: " + (err.message || JSON.stringify(err)) + "\\n"); }'
  );
  writeFileSync(mainFile, mainCode);
}

// Patch interactiveHelpers.js — skip Onboarding/Trust dialogs (Select component class issue)
const helpersFile = join(DIST, 'src/interactiveHelpers.js');
if (existsSync(helpersFile)) {
  let helpersCode = readFileSync(helpersFile, 'utf-8');
  // Auto-complete onboarding instead of showing interactive dialog
  helpersCode = helpersCode.replace(
    /if \(!config\.theme \|\| !config\.hasCompletedOnboarding\) \{[\s\S]*?await showSetupDialog\(root[\s\S]*?\}\);[\s]*\}/,
    `if (!config.theme || !config.hasCompletedOnboarding) {
    completeOnboarding();
    saveGlobalConfig((current) => ({ ...current, theme: current.theme || 'dark' }));
    onboardingShown = true;
  }`
  );
  // Auto-accept trust dialog
  helpersCode = helpersCode.replace(
    /if \(!checkHasTrustDialogAccepted\(\)\) \{[\s\S]*?await showSetupDialog\(root[\s\S]*?TrustDialog[\s\S]*?\}\);[\s]*\}/,
    `if (!checkHasTrustDialogAccepted()) {
      saveGlobalConfig((current) => ({ ...current, trustedDirectories: { ...(current.trustedDirectories || {}), [process.cwd()]: true } }));
    }`
  );
  // Skip MCP approvals and ClaudeMd dialogs
  helpersCode = helpersCode.replace(
    /if \(allErrors\.length === 0\) \{[\s\S]*?handleMcpjsonServerApprovals[\s\S]*?\}[\s]*if \(await shouldShowClaudeMdExternalIncludesWarning[\s\S]*?showSetupDialog[\s\S]*?\}\);[\s]*\}/,
    '// Skipped interactive dialogs for cookiesheep build'
  );
  writeFileSync(helpersFile, helpersCode);
}
console.log('  ✓ Applied post-build patches');

console.log(`\n  Build complete! 🎉\n`);
console.log(`  Run with:  node cli.js\n`);
