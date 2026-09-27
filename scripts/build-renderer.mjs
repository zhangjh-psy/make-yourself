/**
 * 渲染进程构建脚本
 * 说明：这里直接用 esbuild 打包，不用 Vite —— Vite 在 Windows 上会调用 net use 探测
 * 真实路径，在某些受限环境下会被拒绝。esbuild 足够快、足够稳，产物也更小。
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

/**
 * 把 index.html / float.html 里的源码入口改写成打包产物。
 * 构建产物名与入口名一致：src/main.tsx -> index.js，src/float.tsx -> float.js
 */
const ENTRIES = [
  { html: 'index.html', pattern: '/src/main\\.tsx', to: './index.js' },
  { html: 'float.html', pattern: '/src/float\\.tsx', to: './float.js' },
];

function copyHtml({ html, pattern, to }) {
  const src = fs.readFileSync(path.join(root, html), 'utf8');
  const re = new RegExp(pattern, 'g');
  if (!re.test(src)) {
    throw new Error(`${html} 里没找到入口脚本 ${pattern}，构建脚本需要同步更新`);
  }
  const out = src.replace(new RegExp(pattern, 'g'), to);
  fs.writeFileSync(path.join(dist, html), out, 'utf8');
  console.log(`  ${html} → 入口改写为 ${to}`);
}

ENTRIES.forEach(copyHtml);

const options = {
  entryPoints: {
    index: path.join(root, 'src', 'main.tsx'),
    float: path.join(root, 'src', 'float.tsx'),
  },
  bundle: true,
  outdir: dist,
  format: 'esm',
  platform: 'browser',
  target: 'chrome130',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
  console.log('esbuild 正在监听文件变化…');
} else {
  await build(options);
  console.log('渲染进程构建完成 →', dist);
}
