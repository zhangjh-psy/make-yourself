/**
 * 把"私人开发版"的改动同步到"公开仓库版"。
 *
 * 为什么需要：这个项目维护两份
 *   私人版  C:\Users\Levi\Desktop\dhs\workbench     —— 日常使用 + 开发，包含私有文件和你的真实数据路径
 *   公开版  C:\Users\Levi\Desktop\make-yourself      —— 推到 GitHub 的那份，去掉私有内容
 *
 * 用法： npm run sync:public
 *
 * 它做的事：
 *   1. 把源码、配置、图标、文档复制过去（**不删**目标里已有的 .git，所以能直接 commit + push）
 *   2. 过滤掉私有内容（分享稿、个人使用说明、本机 npm 配置）
 *   3. 给公开版写一份干净的 .npmrc（不带本机缓存路径）
 *   4. 打印结果和 git 状态，方便确认这次改了什么
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SRC = path.resolve('C:/Users/Levi/Desktop/dhs/workbench');
const DST = path.resolve('C:/Users/Levi/Desktop/make-yourself');

/** 整目录复制的内容 */
const COPY_DIRS = ['src', 'electron', 'scripts', 'build'];

/** 单独复制的内容 */
const COPY_FILES = [
  'index.html',
  'float.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'electron-builder.yml',
  '.gitignore',
  'README.md',
  'ARCHITECTURE.md',
  'LICENSE',
  'build.bat',
  '启动工作台.bat',
];

/** 公开仓库里不该出现的东西（就算源目录里有也跳过） */
const EXCLUDE_FILES = new Set(['分享给朋友.md', '使用说明-详细版.md', '.npmrc']);

/** build 目录里只保留图标，设计过程的候选图不用进仓库 */
const BUILD_KEEP = /^(icon\.(ico|png)|icon\.256\.png|icon\.32\.png)$/;

const log = (msg) => console.log(`  ${msg}`);

if (!fs.existsSync(SRC)) {
  console.error(`找不到源目录：${SRC}`);
  process.exit(1);
}

console.log(`\n源：${SRC}\n→ 目标：${DST}\n`);

if (!fs.existsSync(DST)) {
  fs.mkdirSync(DST, { recursive: true });
  log('目标目录不存在，已新建（之后可以 git init）');
}

/* 1. 目录 */
for (const dir of COPY_DIRS) {
  const from = path.join(SRC, dir);
  if (!fs.existsSync(from)) continue;
  const to = path.join(DST, dir);
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const dstPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(srcPath, dstPath, { recursive: true });
      continue;
    }
    if (EXCLUDE_FILES.has(entry.name)) continue;
    if (dir === 'build' && !BUILD_KEEP.test(entry.name)) continue;
    fs.copyFileSync(srcPath, dstPath);
  }
  log(`同步 ${dir}/`);
}

/* 2. 单个文件 */
for (const file of COPY_FILES) {
  if (EXCLUDE_FILES.has(file)) continue;
  const from = path.join(SRC, file);
  if (!fs.existsSync(from)) {
    log(`跳过（源里没有）：${file}`);
    continue;
  }
  fs.copyFileSync(from, path.join(DST, file));
  log(`同步 ${file}`);
}

/* 3. 公开版专用的 .npmrc：不带本机缓存路径，只留镜像设置 */
const npmrc = [
  '# 国内镜像（可选）。网速正常的话可以删掉这个文件。',
  'registry=https://registry.npmmirror.com',
  'electron_mirror=https://npmmirror.com/mirrors/electron/',
  'electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/',
  'fund=false',
  'audit=false',
  '',
].join('\n');
fs.writeFileSync(path.join(DST, '.npmrc'), npmrc, 'utf8');
log('写入干净版 .npmrc');

/* 4. 清掉可能残留的私有文件、日志、构建产物 */
let cleaned = 0;
for (const junk of ['分享给朋友.md', '使用说明-详细版.md']) {
  const p = path.join(DST, junk);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    cleaned++;
  }
}
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.cache', '.npm-cache', 'dist', 'dist-electron', 'release'].includes(entry.name)) continue;
      walk(full);
    } else if (entry.name.endsWith('.log')) {
      fs.rmSync(full);
      cleaned++;
    }
  }
};
walk(DST);
if (cleaned) log(`清理了 ${cleaned} 个多余文件（私有文档 / 日志）`);

/* 5. 统计 + git 状态 */
const files = [];
const collect = (dir, prefix = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      collect(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    } else {
      files.push(`${prefix}${entry.name}`);
    }
  }
};
collect(DST);
const total = files.reduce((sum, f) => sum + fs.statSync(path.join(DST, f)).size, 0);
console.log(`\n完成：${files.length} 个文件，${(total / 1024).toFixed(1)} KB`);

if (fs.existsSync(path.join(DST, '.git'))) {
  try {
    const status = execSync('git status --short', { cwd: DST, encoding: 'utf8' }).trim();
    console.log('\ngit 状态（这些就是这次改动的文件）：');
    console.log(status ? status.split('\n').map((l) => `  ${l}`).join('\n') : '  （没有变化）');
  } catch {
    /* git 不可用就算了 */
  }
} else {
  console.log('\n提示：目标目录还不是 git 仓库。第一次要先在它里面执行 git init（或直接用 GitHub Desktop 添加本地仓库）。');
}
