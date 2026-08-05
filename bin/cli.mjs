#!/usr/bin/env node

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const arg = process.argv[2];

if (arg === '-v' || arg === '--version') {
  console.log(`${pkg.name} ${pkg.version}`);
  process.exit(0);
}

if (arg === '-h' || arg === '--help') {
  console.log(`用法: bitable-helper [端口]

在本地启动静态服务，托管已构建的多维表格插件（默认端口 5173）。

选项:
  -h, --help     显示帮助
  -v, --version  显示版本号

示例:
  bitable-helper
  bitable-helper 8080
`);
  process.exit(0);
}

// 如果 dist 不存在，提示用户先构建
if (!existsSync(distDir)) {
  console.error('错误: dist 目录不存在，请先运行 npm run build 构建项目');
  process.exit(1);
}

const port = arg || '5173';
if (!/^\d+$/.test(port)) {
  console.error(`错误: 无效端口「${port}」。使用 bitable-helper --help 查看用法`);
  process.exit(1);
}

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
