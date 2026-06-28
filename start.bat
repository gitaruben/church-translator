@echo off
echo.
echo  -----------------------------------------------
echo   Church Live Translator
echo  -----------------------------------------------
echo.
echo  Checking for Node.js...
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo  ERROR: Node.js is not installed!
  echo  Download it free from: https://nodejs.org
  echo  Install it, then double-click this file again.
  pause
  exit /b
)

echo  Installing packages (only needed first time)...
call npm install

echo.
echo  Starting server...
echo.
node server.js

pause
