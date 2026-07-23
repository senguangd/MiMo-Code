@echo off
setlocal

cd /d %~dp0

REM Usage:
REM   build-local.bat <version>
REM
REM If no version is provided, uses 0.1.6.
REM
REM Environment variables (optional):
REM   ADPCLI_CHANNEL - Set channel name (default: current git branch)
REM   ADPCLI_BUMP    - Bump version: major, minor, or patch
REM   ADPCLI_RELEASE - Set to any value for release build

if "%1"=="" (
  set ADPCLI_VERSION=0.1.6
) else (
  set ADPCLI_VERSION=%1
)

echo ========================================
echo Adp Cli local Windows build
echo Version: %ADPCLI_VERSION%
echo Embed Web UI: yes
echo ========================================
echo.

echo [1/4] Installing dependencies without lifecycle scripts...
bun install --ignore-scripts --force --backend=copyfile
if %errorlevel% neq 0 (
  echo.
  echo Retry without --backend=copyfile...
  bun install --ignore-scripts --force
  if %errorlevel% neq 0 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo.
echo [2/4] Running required CLI postinstall only...
bun run --cwd packages/opencode fix-node-pty
if %errorlevel% neq 0 (
  echo fix-node-pty failed.
  pause
  exit /b 1
)

echo.
echo [3/4] Building local Windows exe with embedded Web UI...
bun run --cwd packages/opencode script/build.ts --single --skip-install
if %errorlevel% neq 0 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Generated exe:
where /r packages\opencode\dist adp.exe

echo.
echo Done.
pause
endlocal
