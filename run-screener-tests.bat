@echo off
setlocal
cd /d "%~dp0"

REM Screener production readiness test runner.
REM Edit these values if your local server/auth changes.
if not defined MTM_QA_BASE set MTM_QA_BASE=http://127.0.0.1:4173
if not defined MTM_QA_ADMIN_USER set MTM_QA_ADMIN_USER=admin
if not defined MTM_QA_ADMIN_PASSWORD set MTM_QA_ADMIN_PASSWORD=admin123

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-screener.ps1" -BaseUrl "%MTM_QA_BASE%" -AdminUser "%MTM_QA_ADMIN_USER%" -AdminPassword "%MTM_QA_ADMIN_PASSWORD%"

endlocal