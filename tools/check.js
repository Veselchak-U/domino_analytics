import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
let failed = false;
for (const file of ['src', 'public', 'test', 'tools'].flatMap(dir => files(dir).filter(f => !f.includes(`ast-index${path.sep}`) && f.endsWith('.js')))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
// Project rule links must remain resolvable after adopting OpenSpec rules.
for (const file of ['AGENTS.md', ...files('.agents/rules').filter(f => f.endsWith('.md'))]) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(match[1])) continue;
    try { readFileSync(path.resolve(path.dirname(file), match[1])); }
    catch { console.error(`Нерабочая ссылка: ${file} → ${match[1]}`); failed = true; }
  }
}
process.exitCode = failed ? 1 : 0;
if (!failed) console.log('Синтаксис JavaScript и ссылки правил: OK');
