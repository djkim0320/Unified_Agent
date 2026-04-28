@echo off
setlocal EnableExtensions

chcp 65001 >nul
cd /d "%~dp0"

set "APP_HOST=127.0.0.1"
set "API_PORT=8787"
set "DEV_WEB_PORT=5173"
set "API_URL=http://%APP_HOST%:%API_PORT%"
set "WEB_URL=%API_URL%"

echo [AetherOps] Starting local single-server stack...
echo [AetherOps] Root: %CD%

call :find_package_manager
if errorlevel 1 exit /b %errorlevel%

if not exist "package.json" (
  echo [ERROR] package.json was not found. Run this file from the project root.
  if not defined NO_PAUSE pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] node_modules not found. Installing dependencies with %PM_LABEL%...
  call "%PM_CMD%" install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    if not defined NO_PAUSE pause
    exit /b %errorlevel%
  )
)

call :cleanup_project_port %API_PORT%
if errorlevel 1 exit /b %errorlevel%
call :cleanup_project_port %DEV_WEB_PORT%
if errorlevel 1 exit /b %errorlevel%

echo [INFO] Rebuilding better-sqlite3 native binding if needed...
call "%PM_CMD%" rebuild better-sqlite3
if errorlevel 1 (
  echo [ERROR] better-sqlite3 rebuild failed.
  if not defined NO_PAUSE pause
  exit /b %errorlevel%
)

echo [INFO] Building web UI assets for single-server mode...
call "%PM_CMD%" exec -- vite build
if errorlevel 1 (
  echo [ERROR] Web UI build failed.
  if not defined NO_PAUSE pause
  exit /b %errorlevel%
)

echo [INFO] Launching AetherOps server on %API_URL% ...
start "AetherOps Server" /D "%CD%" "%ComSpec%" /c set "PORT=%API_PORT%" ^&^& call "%PM_CMD%" exec -- tsx server/index.ts

call :wait_for_url "%API_URL%/api/providers" "API server"
if errorlevel 1 exit /b %errorlevel%

call :wait_for_url "%WEB_URL%" "Web UI"
if errorlevel 1 exit /b %errorlevel%

echo [INFO] Opening browser: %WEB_URL%
start "" "%WEB_URL%"

echo.
echo [OK] AetherOps is running.
echo      API: %API_URL%
echo      UI : %WEB_URL%
echo.
echo Close the "AetherOps Server" window to stop the app.
echo This launcher window will close automatically.
exit /b 0

:find_package_manager
set "PM_CMD="
set "PM_LABEL="

if exist "%ProgramFiles%\nodejs\npm.cmd" (
  set "PM_CMD=%ProgramFiles%\nodejs\npm.cmd"
  set "PM_LABEL=npm"
  exit /b 0
)

for %%I in (npm.cmd) do (
  if not "%%~$PATH:I"=="" (
    set "PM_CMD=%%~$PATH:I"
    set "PM_LABEL=npm"
    exit /b 0
  )
)

if exist "%APPDATA%\npm\pnpm.cmd" (
  set "PM_CMD=%APPDATA%\npm\pnpm.cmd"
  set "PM_LABEL=pnpm"
  exit /b 0
)

for %%I in (pnpm.cmd) do (
  if not "%%~$PATH:I"=="" (
    set "PM_CMD=%%~$PATH:I"
    set "PM_LABEL=pnpm"
    exit /b 0
  )
)

echo [ERROR] npm.cmd or pnpm.cmd was not found.
echo [ERROR] Install Node.js first, then run start.bat again.
if not defined NO_PAUSE pause
exit /b 1

:cleanup_project_port
set "CHECK_PORT=%~1"
echo [INFO] Checking port %CHECK_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=(Resolve-Path '.').Path;" ^
  "$conn=Get-NetTCPConnection -LocalPort %CHECK_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "if(-not $conn){ exit 0 }" ^
  "$ownerPid=[int]$conn.OwningProcess;" ^
  "$proc=Get-CimInstance Win32_Process -Filter \"ProcessId=$ownerPid\" -ErrorAction SilentlyContinue;" ^
  "$cmd=if($proc){ [string]$proc.CommandLine } else { '' };" ^
  "$isThisProject=$cmd -like ('*' + $root + '*');" ^
  "$isKnownDev=$cmd -like '*server/index.ts*' -or $cmd -like '*vite*5173*' -or $cmd -like '*dist/server/index.js*';" ^
  "if($isThisProject -or $isKnownDev){" ^
  "  Write-Host ('[INFO] Stopping previous AetherOps process on port %CHECK_PORT%: PID ' + $ownerPid);" ^
  "  Stop-Process -Id $ownerPid -Force;" ^
  "  Start-Sleep -Milliseconds 800;" ^
  "  exit 0" ^
  "}" ^
  "Write-Host ('[ERROR] Port %CHECK_PORT% is already used by PID ' + $ownerPid);" ^
  "Write-Host ('[ERROR] Command line: ' + $cmd);" ^
  "Write-Host '[ERROR] Stop that process first, or change APP/API ports before running this batch file.';" ^
  "exit 2"

if errorlevel 1 (
  if not defined NO_PAUSE pause
  exit /b %errorlevel%
)
exit /b 0

:wait_for_url
set "URL=%~1"
set "LABEL=%~2"
echo [INFO] Waiting for %LABEL%...

for /L %%I in (1,1,45) do (
  curl.exe --silent --show-error --output NUL --max-time 2 "%URL%" >nul 2>nul
  if not errorlevel 1 (
    echo [OK] %LABEL% is ready.
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)

echo [ERROR] %LABEL% did not become ready at %URL%.
echo [ERROR] Check the matching command window for details.
if not defined NO_PAUSE pause
exit /b 1
