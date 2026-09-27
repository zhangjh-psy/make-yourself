/**
 * 把仓库里的 PowerShell 脚本统一转成「UTF-8 带 BOM」。
 *
 * 为什么需要：Windows PowerShell 5.1 读取无 BOM 的 .ps1 会按本地 ANSI 代码页解码，
 * 脚本里的中文（包括"启动工作台.bat"这种中文文件名）会乱码，甚至报语法错误。
 * 带 BOM 后 PowerShell 就会正确按 UTF-8 解码。
 *
 * 用法： node scripts/fix-ps1-encoding.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts');
const BOM = '\uFEFF';

let changed = 0;
for (const name of fs.readdirSync(dir)) {
  if (!name.toLowerCase().endsWith('.ps1')) continue;
  const file = path.join(dir, name);
  let text = fs.readFileSync(file, 'utf8');
  if (text.startsWith(BOM)) {
    console.log(`  已是 UTF-8 BOM：${name}`);
    continue;
  }
  text = BOM + text;
  fs.writeFileSync(file, text, 'utf8');
  console.log(`  已加 BOM：${name}`);
  changed++;
}
console.log(changed ? `完成，改了 ${changed} 个文件` : '完成，无需修改');
