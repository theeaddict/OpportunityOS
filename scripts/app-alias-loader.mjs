/**
 * Node module customization hook: resolves the app's `@/*` import alias
 * (defined in jsconfig.json, normally handled by Next.js's webpack config)
 * to the project root, so plain `node --test` can import app source files
 * that use `@/lib/...` imports without going through Next's bundler.
 */
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const target = specifier.startsWith('@/') ? new URL(specifier.slice(2), ROOT).href : specifier;
  try {
    return await nextResolve(target, context);
  } catch (err) {
    // Next's webpack resolver allows extensionless relative/aliased imports
    // ('./scenarios', '@/lib/constants'); plain Node ESM resolution does not.
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && !/\.[a-zA-Z]+$/.test(target)) {
      return nextResolve(`${target}.js`, context);
    }
    throw err;
  }
}

// Keep for callers that inspect the module's file path; unused otherwise.
export const rootPath = fileURLToPath(ROOT);
