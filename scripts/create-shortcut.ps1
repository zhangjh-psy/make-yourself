# 手动创建「工作台」快捷方式（桌面 + 开始菜单）
#
# 平时不需要用这个脚本：程序里「设置 → 数据 → 在桌面创建快捷方式」点一下就行。
# 这个文件是给"程序打不开、想手动建快捷方式"的情况准备的。
#
# 用法（在本文件夹打开 PowerShell 执行）：
#     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
#
# 提示：Windows PowerShell 5.1 按 ANSI 解码无 BOM 的 .ps1 文件，中文可能乱码，
#       如果执行报奇怪的语法错，请改用程序里的按钮，或先把本文件另存为「UTF-8 带 BOM」。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$target = Join-Path $root '启动工作台.bat'
$icon = Join-Path $root 'build\icon.ico'

if (-not (Test-Path $target)) { throw "找不到启动脚本：$target" }

$shell = New-Object -ComObject WScript.Shell

function New-Shortcut([string]$path) {
  $sc = $shell.CreateShortcut($path)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $root
  $sc.Description = 'Make yourself'
  if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
  $sc.WindowStyle = 7
  $sc.Save()
  Write-Output "created: $path"
}

New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Make yourself.lnk')
New-Shortcut (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Make yourself.lnk')
Write-Output 'done'
