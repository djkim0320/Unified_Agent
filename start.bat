@echo off
setlocal

cd /d "%~dp0"

set "PNPM_CMD=%APPDATA%\npm\pnpm.cmd"

if exist "%PNPM_CMD%" goto run

for %%I in (pnpm.cmd) do set "PNPM_CMD=%%~$PATH:I"
if defined PNPM_CMD goto run

echo [ERROR] pnpm.cmd was not found.
echo [ERROR] Install pnpm first, or add pnpm.cmd to PATH.
exit /b 1

:run
if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call "%PNPM_CMD%" install
  if errorlevel 1 exit /b %errorlevel%
)

echo [INFO] Ensuring better-sqlite3 is built...
call "%PNPM_CMD%" rebuild better-sqlite3
if errorlevel 1 exit /b %errorlevel%

echo [INFO] Opening browser...
start "" "http://127.0.0.1:5173"

echo [INFO] Starting development server...
call "%PNPM_CMD%" dev
exit /b %errorlevel%
