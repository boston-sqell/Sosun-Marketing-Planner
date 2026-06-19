@echo off
REM ============================================================
REM  One-time: seed News Sentinel sources + keywords.
REM    - newsSources: PSM native feed + Google News feeds for
REM      One Online, Mihaaru, Edition, Avas, Raajje, Vaguthu.
REM    - newsKeywords: one term per brand in the brands collection.
REM  Idempotent — safe to re-run; existing entries are skipped.
REM  Requires Application Default Credentials:
REM    gcloud auth application-default login
REM  (or FIREBASE_SERVICE_ACCOUNT set in backend\.env)
REM ============================================================
cd /d "%~dp0backend"

echo Seeding News Sentinel sources and keywords...
call npx ts-node scripts/seedNewsSources.ts

if errorlevel 1 (
  echo.
  echo Seed failed. If it's a credentials error, run:
  echo   gcloud auth application-default login
  echo then re-run this script.
)
pause
