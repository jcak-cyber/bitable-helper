#!/usr/bin/env node

import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const port = parseInt(process.argv[2]) || 5173;

async function start() {
  const server = await createServer({
    root,
    server: {
      host: '0.0.0.0',
      port,
      cors: true,
    },
  });

  await server.listen();
  server.printUrls();
}

start().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
