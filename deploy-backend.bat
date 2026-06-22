@echo off
REM ============================================================
REM  Sosun Marketing Planner — Backend (Cloud Run) deploy
REM  Activates: /api/reports/run (reporting engine) and
REM             DELETE /api/users/:uid (admin user deletion)
REM  Requires: gcloud CLI logged in (gcloud auth login)
REM ============================================================
cd /d "%~dp0backend"

echo Deploying backend to Cloud Run (sosun-sync-api, us-central1)...
call gcloud run deploy sosun-sync-api --source . --region us-central1 --project sosun-marketing-planner-2026 --allow-unauthenticated --update-env-vars NODE_ENV=production

if errorlevel 1 (
  echo.
  echo Deploy failed. If you are not logged in, run:  gcloud auth login
) else (
  echo.
  echo Backend deployed. Reports generation and user deletion are now live.
)
pause
