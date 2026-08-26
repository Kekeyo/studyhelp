@echo off
setlocal
title StudyHelp

set "PROJECT_DIR=K:\AI\githubproject\studyhelpfinal1"

rem ===== Clash Proxy =====
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=localhost,127.0.0.1"

set "http_proxy=http://127.0.0.1:7890"
set "https_proxy=http://127.0.0.1:7890"
set "no_proxy=localhost,127.0.0.1"

set "NODE_USE_ENV_PROXY=1"

rem ===== Check project =====
if not exist "%PROJECT_DIR%\package.json" (
    echo [ERROR] Project not found:
    echo %PROJECT_DIR%
    pause
    exit /b 1
)

rem ===== Check Node =====
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

rem ===== Check npm =====
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found.
    pause
    exit /b 1
)

rem ===== Check Clash =====
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$c.Connect('127.0.0.1',7890);$c.Close();exit 0}catch{exit 1}" >nul 2>&1

if errorlevel 1 (
    echo [WARN] Clash is not running.
    echo [WARN] Vertex AI will not work.
    
    set "HTTP_PROXY="
    set "HTTPS_PROXY="
    set "http_proxy="
    set "https_proxy="
    set "NODE_USE_ENV_PROXY=0"
) else (
    echo [OK] Clash detected.
    echo [OK] Vertex AI proxy enabled.
)

rem ===== Release backend port =====
echo [INFO] Releasing port 5000...

for %%P in (5000) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
        taskkill /F /PID %%A >nul 2>&1
    )
)

timeout /t 2 /nobreak >nul

rem ===== Start project =====
cd /d "%PROJECT_DIR%"

echo.
echo ========================================
echo StudyHelp
echo Website : https://kekeyo.github.io/studyhelp/
echo Local ADC proxy: http://127.0.0.1:5000/
echo ========================================
echo.

rem ===== Open browser =====
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'https://kekeyo.github.io/studyhelp/'"

rem ===== Run local Vertex ADC proxy =====
npm run dev-backend

pause
endlocal
