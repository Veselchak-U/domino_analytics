import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('установка, повреждённый релиз, неудачное обновление и откат', t => {
  let bash = process.env.BASH_EXECUTABLE ?? 'bash';
  if (process.platform === 'win32') {
    const gitPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
    const candidate = gitPath && path.resolve(gitPath, '../../../bin/bash.exe');
    if (candidate && existsSync(candidate)) bash = candidate;
  }
  if (spawnSync(bash, ['--version'], { encoding: 'utf8' }).error) return t.skip('Bash недоступен');
  const parent = path.resolve('.analysis/vm-tests');
  mkdirSync(parent, { recursive: true });
  let workspace = mkdtempSync(path.join(parent, 'run-'));
  if (process.platform === 'win32') workspace = workspace.replaceAll('\\', '/').replace(/^([A-Z]):/i, (_, drive) => '/' + drive.toLowerCase());
  const result = spawnSync(bash, ['test/vm-deployment.sh', workspace], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /VM lifecycle:/);
});
