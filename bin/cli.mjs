#!/usr/bin/env node

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

// 如果 dist 不存在，提示用户先构建
if (!existsSync(distDir)) {
  console.error('错误: dist 目录不存在，请先运行 npm run build 构建项目');
  process.exit(1);
}

const port = process.argv[2] || '5173';

// 通过 package.json 定位 sirv-cli 包根，再拼接其声明的 bin 入口，
// 规避 exports 字段对子路径的限制以及跨平台 .bin 扩展名问题
const sirvPkgPath = require.resolve('sirv-cli/package.json');
const sirvPkg = require('sirv-cli/package.json');
const sirvBin = resolve(dirname(sirvPkgPath), sirvPkg.bin.sirv);

// 托管 dist 静态产物，启用 CORS（飞书 iframe 需要）和 SPA 回退
const child = spawn(
  process.execPath,
  [sirvBin, distDir, '--port', port, '--cors', '--single', '--host'],
  { stdio: 'inherit' },
);

child.on('exit', (code) => process.exit(code ?? 0));
