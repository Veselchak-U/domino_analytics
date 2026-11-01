import { readFileSync as read } from 'node:fs';
/** Legacy fixtures are unchanged on disk; this explicit synthetic time belongs to test copies only. */
export function readFileSync(file,options) {
  const raw=read(file,options);
  if(typeof raw==='string'&&/(?:real-game|kozel-game\.example)\.json$/.test(String(file)))return JSON.stringify({playedAt:'2026-09-12T19:30:00+03:00',...JSON.parse(raw)});
  return raw;
}
