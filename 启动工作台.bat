@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" goto NORUNTIME

set NEEDBUILD=0
if not exist "dist\index.html" set NEEDBUILD=1
if not exist "dist-electron\main.js" set NEEDBUILD=1

if "%NEEDBUILD%"=="0" (
  for /f %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\needs-build.ps1"') do set NEEDBUILD=%%i
)

if "%NEEDBUILD%"=="1" (
  call npm run build >nul 2>&1
  if errorlevel 1 echo [WARN] build failed, starting previous version...
)

rem NOTE: %~dp0 already ends with a backslash. Writing "%~dp0" would escape the
rem closing quote and Electron would receive a path with a stray quote in it.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0

:NORUNTIME
echo.
echo   [ERROR] Runtime not found.
echo   Please run this once in this folder:  npm install --ignore-scripts
echo.
pause
exit /b 1
