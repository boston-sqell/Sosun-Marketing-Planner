@echo off
REM ============================================================
REM  One-time: backfill `createdAt` on legacy tasks so they
REM  appear in the new newest-first Tasks & Queue ordering.
REM  Requires Application Default Credentials:
REM    gcloud auth application-default login
REM  (or FIREBASE_SERVICE_ACCOUNT set in backend\.env)
REM ============================================================
cd /d "%~dp0backend"

echo Backfilling createdAt on tasks...
call npx ts-node scripts/backfillTaskCreatedAt.ts

if errorlevel 1 (
  echo.
  echo Backfill failed. If it's a credentials error, run:
  echo   gcloud auth application-default login
  echo then re-run this script.
)
pause
