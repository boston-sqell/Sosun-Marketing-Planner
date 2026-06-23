@echo off
REM ============================================================
REM  Sosun Marketing Planner — Backend (Cloud Run) deploy
REM  Activates: /api/reports/run (reporting engine) and
REM             DELETE /api/users/:uid (admin user deletion)
REM  Requires: gcloud CLI logged in (gcloud auth login)
REM  ACCESS MODEL: Cloud Run is public (--allow-unauthenticated). The browser
REM  calls this API directly with a Firebase ID token, which Cloud Run IAM does
REM  NOT understand — a private service would 403 every browser request at the
REM  IAM layer before Express runs. Auth is enforced IN the app instead:
REM  every route runs requireAuth, which verifies the Firebase ID token AND a
REM  Firebase App Check token (enforced in production). Do not switch this to
REM  --no-allow-unauthenticated without putting an identity-aware proxy in front.
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
