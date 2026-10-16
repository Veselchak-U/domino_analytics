import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.join(root, 'tools/ast-index/node_modules/.bin', process.platform === 'win32' ? 'ast-index.cmd' : 'ast-index');
if (!existsSync(binary)) {
  console.error('Установите AST Index: npm ci --prefix tools/ast-index');
  process.exit(1);
}
// ast-index 3.55 update scans node_modules in this non-Git checkout on Windows.
// Rebuild respects include/exclude and is inexpensive for this small codebase.
const action = process.argv[2] ?? 'rebuild';
if (!['update', 'rebuild', 'stats'].includes(action)) throw new Error('Допустимы update, rebuild, stats');
const result = spawnSync(process.platform === 'win32' ? `"${binary}"` : binary, [action], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, AST_INDEX_CACHE_DIR: path.join(root, '.analysis/ast-index-cache') },
});
process.exit(result.status ?? 1);
