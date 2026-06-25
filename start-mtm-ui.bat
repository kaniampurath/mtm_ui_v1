@echo off
setlocal

cd /d "%~dp0"

set "MTM_DB_USER=tradeuser"
set "MTM_DB_NAME=myts"

if "%MTM_DB_PASSWORD%"=="" (
  set /p "MTM_DB_PASSWORD=Enter MariaDB password for tradeuser: "
)

if "%MTM_DEFAULT_ADMIN_PASSWORD%"=="" (
  set /p "MTM_DEFAULT_ADMIN_PASSWORD=Enter default admin password, or press Enter to use app config: "
)

if "%MTM_EODHD_API_TOKEN%"=="" (
  set /p "MTM_EODHD_API_TOKEN=Enter EODHD token, or press Enter to skip live/RS download: "
)

echo.
echo Starting MyTradingMind UI from %CD%
echo Open http://127.0.0.1:4173/ after the server starts.
echo.

node server.js

endlocal
