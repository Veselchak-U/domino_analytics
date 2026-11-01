import { createApp, listenHost } from './server.js';
import { createFrontend } from './frontend.js';

const frontendPort = Number(process.env.PORT ?? 3210);
const backendPort = Number(process.env.BACKEND_PORT ?? (frontendPort + 1));
const backend = createApp({ databasePath: process.env.DATABASE_PATH ?? '.analysis/domino.sqlite',
  allowedOrigins: [`http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`, ...(process.env.DOMINO_ALLOWED_HOSTS ?? '').split(',').filter(Boolean).map(host => 'http://' + host)] });
const frontend = createFrontend({ backendUrl: `http://127.0.0.1:${backendPort}`, allowedHosts: (process.env.DOMINO_ALLOWED_HOSTS ?? '').split(',').filter(Boolean) });
async function listen(server, port, host) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
}
try {
  await listen(backend.server, backendPort, '127.0.0.1');
  await listen(frontend.server, frontendPort, listenHost());
  console.log(`Page available at: http://127.0.0.1:${frontendPort}`);
} catch (error) {
  console.error(`Не удалось запустить приложение: ${error.message}`);
  if (frontend.server.listening) await frontend.close();
  await backend.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  if (frontend.server.listening) await frontend.close();
  if (backend.server.listening) await backend.close();
  process.exit(0);
});
