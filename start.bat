@echo off
REM ---------------------------------------------------------------
REM  Task Management Application - one-click launcher (Windows)
REM ---------------------------------------------------------------
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on your PATH.
  echo   Install it from https://nodejs.org/ ^(LTS^) and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the Task Manager backend...
echo   Your browser will open at http://localhost:3000
echo.

REM Open the app shortly after the server starts.
start "" /b cmd /c "timeout /t 2 >nul & start "" http://localhost:3000"

node server.js

echo.
echo   Server stopped.
pause
