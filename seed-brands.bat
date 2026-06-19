@echo off
REM ============================================================
REM  One-time: promote legacy brand names into the brands collection.
REM  Requires Application Default Credentials:
REM    gcloud auth application-default login
REM  (or FIREBASE_SERVICE_ACCOUNT set in backend\.env)
REM ============================================================
cd /d "%~dp0backend"

echo Seeding brands from settings/general, campaigns and tasks...
call npx ts-node scripts/seedBrands.ts

if errorlevel 1 (
  echo.
  echo Seed failed. If it's a credentials error, run:
  echo   gcloud auth application-default login
  echo then re-run this script.
)
pause
