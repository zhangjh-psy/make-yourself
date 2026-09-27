/**
 * 带进度输出的文件下载器（用 Node 自带的根证书，不依赖系统 curl）。
 *
 * 为什么需要它：某些受限环境下系统 curl / PowerShell 拿不到 Windows 证书库，
 * 下载 HTTPS 会直接失败；而 Node 自带根证书，能正常下。
 * 本项目用它手动安置 Electron 运行时（正常用户直接 npm install 即可，用不到）。
 *
 * 用法: node scripts/download.mjs <url> <outFile>
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const [, , url, outFile] = process.argv;
if (!url || !outFile) {
  console.error('用法: node scripts/download.mjs <url> <outFile>');
  process.exit(2);
}

const MAX_REDIRECTS = 8;

function get(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = target.startsWith('http://') ? http : https;
    const req = mod.get(
      target,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) workbench-setup',
          Accept: '*/*',
        },
        timeout: 60000,
      },
      (res) => {
        const { statusCode, headers } = res;
        if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error('重定向过多'));
          const next = new URL(headers.location, target).toString();
          return resolve(get(next, redirects + 1));
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} for ${target}`));
        }
        resolve(res);
      },
    );
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

const full = path.resolve(outFile);
fs.mkdirSync(path.dirname(full), { recursive: true });

const expected = Number(process.env.EXPECT_SIZE || 0);
let received = 0;
let lastPct = -1;

const res = await get(url);
const total = Number(res.headers['content-length'] || 0);
const out = fs.createWriteStream(full);

res.on('data', (chunk) => {
  received += chunk.length;
  if (total) {
    const pct = Math.floor((received / total) * 100);
    if (pct >= lastPct + 10) {
      lastPct = pct;
      console.log(`  ${pct}%  (${(received / 1048576).toFixed(1)} MB / ${(total / 1048576).toFixed(1)} MB)`);
    }
  }
});

await new Promise((resolve, reject) => {
  res.pipe(out);
  out.on('finish', resolve);
  out.on('error', reject);
  res.on('error', reject);
});

const size = fs.statSync(full).size;
console.log(`完成: ${full}  ${size} 字节`);
if (expected && size !== expected) {
  console.error(`大小不符，期望 ${expected} 实际 ${size}`);
  process.exit(3);
}
if (size === 0) process.exit(4);
