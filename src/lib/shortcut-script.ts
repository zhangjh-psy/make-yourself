/**
 * 创建快捷方式用的 PowerShell 脚本（内嵌在代码里，不依赖外部文件）
 *
 * 说明：Windows PowerShell 5.1 读无 BOM 的 .ps1 会按 ANSI 解码，中文会乱码甚至语法出错，
 * 所以主程序把这段内容以 UTF-16LE + base64 通过 -EncodedCommand 传给 PowerShell。
 * 编码执行时 $MyInvocation.MyCommand.Path 为空，路径由主程序替换占位符传入：
 *   _TARGET_  要启动的文件（开发版 = 启动工作台.bat，打包版 = MakeYourself.exe）
 *   _WORKDIR_ 起始工作目录
 *   _ICON_    图标文件（可空）
 */
export const CREATE_SHORTCUT_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
$target = '_TARGET_'
$workdir = '_WORKDIR_'
$icon = '_ICON_'

if (-not (Test-Path $target)) { throw "找不到启动文件: $target" }

$shell = New-Object -ComObject WScript.Shell

function New-Shortcut([string]$path) {
  $sc = $shell.CreateShortcut($path)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $workdir
  $sc.Description = 'Make yourself · 离线个人工作台'
  if ($icon -ne '' -and (Test-Path $icon)) { $sc.IconLocation = "$icon,0" }
  $sc.WindowStyle = 7
  $sc.Save()
  Write-Output "created: $path"
}

New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Make yourself.lnk')
New-Shortcut (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Make yourself.lnk')
Write-Output 'done'
`;
