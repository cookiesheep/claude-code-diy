// Custom ESM resolve hook for Node.js
// Handles extensionless imports that fail under strict ESM resolution
// (common with packages designed for bundlers like Bun or webpack)

import { stat } from 'fs/promises';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const EXT_CANDIDATES = ['.js', '.mjs', '.cjs', '/index.js', '/index.mjs'];

// File extensions that should be treated as text/data imports (not JS)
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html', '.css', '.svg', '.yaml', '.yml']);

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND' && err.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
      throw err;
    }

    // Only try to fix relative/absolute file imports, not bare specifiers
    if (!context.parentURL) throw err;

    // If specifier already has a known extension, don't retry
    if (/\.(m?[jt]sx?|json|node|wasm)$/.test(specifier)) throw err;

    const parentPath = fileURLToPath(context.parentURL);
    const parentDir = path.dirname(parentPath);

    // Resolve the specifier relative to the parent
    let basePath;
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      basePath = path.resolve(parentDir, specifier);
    } else {
      // bare specifier — let Node handle it
      throw err;
    }

    for (const ext of EXT_CANDIDATES) {
      const candidate = basePath + ext;
      try {
        await stat(candidate);
        return nextResolve(pathToFileURL(candidate).href, context);
      } catch {
        // not found, try next
      }
    }

    throw err;
  }
}

export async function load(url, context, nextLoad) {
  const ext = path.extname(url);
  if (TEXT_EXTENSIONS.has(ext)) {
    // Load text files as modules that export the file content as default
    const filePath = fileURLToPath(url);
    let content;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      content = '';
    }
    return {
      format: 'module',
      source: `export default ${JSON.stringify(content)};\n`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
