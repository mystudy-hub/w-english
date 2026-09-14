import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

let server;
try {
  // Own the HTTP server directly instead of an npm/cmd process tree on Windows.
  if (process.argv[2] === 'test') {
    const { preview } = await import('vite');
    server = await preview({ configFile: resolve('vite.config.ts'), mode: 'preview', preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
  }
  const child = spawn(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), ...process.argv.slice(2)], {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || resolve('.cache/ms-playwright') },
  });
  process.exitCode = await new Promise((resolveExit) => {
    child.once('error', (error) => { console.error(error.message); resolveExit(1); });
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolveClose) => server.httpServer.close(resolveClose));
  }
}
