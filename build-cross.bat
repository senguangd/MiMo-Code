@echo off
setlocal

cd /d %~dp0

REM Usage:
REM   build-cross.bat version
REM
REM If no version is provided, uses 0.1.6.
REM
REM Builds Windows, Linux, and macOS packages from Windows.

REM
REM Environment variables (optional):
REM   MIMOCODE_CHANNEL - Set channel name (default: current git branch)
REM   MIMOCODE_BUMP    - Bump version: major, minor, or patch
REM   MIMOCODE_RELEASE - Set to any value for release build

if [%1]==[] (
  set MIMOCODE_VERSION=0.1.6
) else (
  set MIMOCODE_VERSION=%1
)

echo ========================================
echo MiMo Code cross build: Windows + Linux + macOS
echo Version: %MIMOCODE_VERSION%
echo Embed Web UI: yes
echo Target OS: win32,linux,darwin
echo ========================================
echo.

echo [1/3] Installing dependencies without lifecycle scripts...
bun install --ignore-scripts --backend=copyfile --frozen-lockfile
if errorlevel 1 (
  echo.
  echo Retry without --backend=copyfile...
  bun install --ignore-scripts --frozen-lockfile
  if errorlevel 1 (
    echo Dependency install failed.
    exit /b 1
  )
)

echo.
echo.
echo Cleaning previous build artifacts and stale mimo.exe processes...
taskkill /F /IM mimo.exe >nul 2>nul
if exist packages\opencode\dist (
  powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQA9ACcAUwB0AG8AcAAnADsAIABmAG8AcgAgACgAJABpAD0AMQA7ACAAJABpACAALQBsAGUAIAA1ADsAIAAkAGkAKwArACkAIAB7ACAAdAByAHkAIAB7ACAAUgBlAG0AbwB2AGUALQBJAHQAZQBtACAALQBMAGkAdABlAHIAYQBsAFAAYQB0AGgAIAAnAHAAYQBjAGsAYQBnAGUAcwBcAG8AcABlAG4AYwBvAGQAZQBcAGQAaQBzAHQAJwAgAC0AUgBlAGMAdQByAHMAZQAgAC0ARgBvAHIAYwBlADsAIABlAHgAaQB0ACAAMAAgAH0AIABjAGEAdABjAGgAIAB7ACAAaQBmACAAKAAkAGkAIAAtAGUAcQAgADUAKQAgAHsAIAB0AGgAcgBvAHcAIAB9ADsAIABTAHQAYQByAHQALQBTAGwAZQBlAHAAIAAtAFMAZQBjAG8AbgBkAHMAIAAyACAAfQAgAH0A
  if errorlevel 1 (
    echo Failed to clean packages\opencode\dist.
    exit /b 1
  )
)
echo.
echo [2/3] Building Windows, Linux, and macOS binaries with embedded Web UI...
bun run --cwd packages/opencode script/build.ts
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

echo.
echo [3/3] Verifying generated Windows, Linux, and macOS artifacts...
if not exist packages\opencode\dist\mimocode-windows-x64\bin\mimo.exe (
  echo Missing expected Windows x64 artifact: packages\opencode\dist\mimocode-windows-x64\bin\mimo.exe
  exit /b 1
)
if not exist packages\opencode\dist\mimocode-linux-x64\bin\mimo (
  echo Missing expected Linux x64 artifact: packages\opencode\dist\mimocode-linux-x64\bin\mimo
  exit /b 1
)
if not exist packages\opencode\dist\mimocode-darwin-x64\bin\mimo (
  echo Missing expected macOS x64 artifact: packages\opencode\dist\mimocode-darwin-x64\bin\mimo
  exit /b 1
)
if not exist packages\opencode\dist\mimocode-darwin-arm64\bin\mimo (
  echo Missing expected macOS arm64 artifact: packages\opencode\dist\mimocode-darwin-arm64\bin\mimo
  exit /b 1
)

echo Windows artifacts:
for /d %%D in (packages\opencode\dist\mimocode-windows-*) do (
  if exist %%D\bin\mimo.exe echo   %%~nxD\bin\mimo.exe
)
echo Linux artifacts:
for /d %%D in (packages\opencode\dist\mimocode-linux-*) do (
  if exist %%D\bin\mimo echo   %%~nxD\bin\mimo
)
echo macOS artifacts:
for /d %%D in (packages\opencode\dist\mimocode-darwin-*) do (
  if exist %%D\bin\mimo echo   %%~nxD\bin\mimo
)

echo.
echo Done.
endlocal




