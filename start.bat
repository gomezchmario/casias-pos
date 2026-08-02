@echo off
REM Casias Tire Shop Time Clock
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Setting up first run...
  call npm install --no-audit --no-fund
  if errorlevel 1 (echo Install failed. & pause & exit /b 1)
)

if not exist "data\timeclock.db" (
  call npm run setup
  if errorlevel 1 (echo Setup failed. & pause & exit /b 1)
)

if not exist ".next\BUILD_ID" (
  echo Building...
  call npm run build
  if errorlevel 1 (echo Build failed. & pause & exit /b 1)
)

start "TimeClock Server" /min cmd /c "npm start"
timeout /t 4 /nobreak >nul
start https://localhost:3000
