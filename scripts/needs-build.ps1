# 判断"要不要重新构建"：源码比构建产物新就输出 1，否则输出 0。
#
# 被「启动工作台.bat」调用：双击启动时先问一次，只有代码真的改过才重新构建，
# 否则直接启动（省掉每次 1 秒的等待）。改动过 src / electron / scripts 里任何
# .ts/.tsx/.css/.html/.json/.mjs，或者改了 index.html、float.html、package.json，
# 都会被认为是"需要重建"。
#
# 取自身目录用 $PSScriptRoot，**不要**用 $MyInvocation.MyCommand.Path ——
# 从批处理用 powershell -File 调用时后者可能是空值，会导致 Split-Path 报错。
# 再留一个兜底：万一两个都拿不到（极少见），就当"需要构建"，宁可多建一次。
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $root) { Write-Output '1'; exit 0 }
$root = Split-Path -Parent $root
$outputs = @(
  (Join-Path $root 'dist\index.html'),
  (Join-Path $root 'dist-electron\main.js')
)
$newestOutput = ($outputs | Where-Object { Test-Path $_ } | ForEach-Object { (Get-Item $_).LastWriteTime } | Sort-Object -Descending | Select-Object -First 1)
if (-not $newestOutput) { Write-Output '1'; exit 0 }

$roots = @('src', 'electron', 'scripts') | ForEach-Object { Join-Path $root $_ }
$files = @()
foreach ($r in $roots) {
  if (Test-Path $r) { $files += Get-ChildItem -Path $r -Recurse -File -ErrorAction SilentlyContinue }
}
foreach ($f in @('index.html', 'float.html', 'package.json')) {
  $p = Join-Path $root $f
  if (Test-Path $p) { $files += Get-Item $p }
}
$newestSource = ($files | Where-Object { $_.Extension -in '.ts', '.tsx', '.css', '.html', '.json', '.mjs' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime

if ($newestSource -and $newestSource -gt $newestOutput) { Write-Output '1' } else { Write-Output '0' }
