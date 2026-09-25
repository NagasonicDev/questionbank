@echo off
setlocal
cd /d "%~dp0"

echo == Local Question Bank ==
echo.

set "LOGS_DIR=%~dp0logs"
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

rem Get a timestamp for the server log name (locale-safe via PowerShell).
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"`) do set "TS=%%t"
set "SERVER_LOG=%LOGS_DIR%\server-%TS%.log"
set "SETUP_LOG=%LOGS_DIR%\setup.log"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required but wasn't found on your PATH.
    echo Install it from https://nodejs.org and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm wasn't found on your PATH. It ships with Node.js - install Node.js
    echo from https://nodejs.org and try again.
    pause
    exit /b 1
)

if not exist frontend\node_modules (
    echo Installing frontend dependencies ^(first run only, this can take a minute^)...
    pushd frontend
    call npm install --silent >>"%SETUP_LOG%" 2>&1
    popd
    if errorlevel 1 (
        echo Frontend dependency install failed. See the log file:
        echo    %SETUP_LOG%
        pause
        exit /b 1
    )
)

echo Building the frontend ^(picks up any code changes^)...
pushd frontend
call npm run build --silent >>"%SETUP_LOG%" 2>&1
popd
if errorlevel 1 (
    echo Frontend build failed. See the log file:
    echo    %SETUP_LOG%
    pause
    exit /b 1
)

echo.
echo Starting the app at http://localhost:8420 ...
echo (Leave this window open while you use the app. Close it to stop the app.)
echo (Output is being saved to: %SERVER_LOG%)
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul && start "" http://localhost:8420/questionbank/""

pushd frontend
call npx vite preview --port 8420 --strictPort >>"%SERVER_LOG%" 2>&1
popd

if errorlevel 1 (
    echo.
    echo ==================================================================
    echo The app exited with an error. The full log is saved here:
    echo    %SERVER_LOG%
    echo.
    echo --- last 40 lines of the log ---
    powershell -NoProfile -Command "Get-Content -Tail 40 '%SERVER_LOG%'"
    echo ==================================================================
    pause
)
