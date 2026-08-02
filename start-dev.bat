@echo off
REM Development launcher — uses Next dev server with hot reload.
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)

if not exist "data\timeclock.db" (
  echo Setting up database...
  call npm run setup
)

echo.
echo === DEV MODE === http://localhost:3000
echo.
call npm run dev
