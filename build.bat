@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   工作台 · 构建
echo ============================================
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo   构建失败，请看上面的报错信息。
  pause
  exit /b 1
)
echo.
echo   构建完成。
pause
