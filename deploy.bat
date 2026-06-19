@echo off
REM ============================================================
REM  Sosun Marketing Planner — Frontend + Rules deploy
REM  Builds the frontend first, then deploys frontend/dist,
REM  Firestore rules & indexes.
REM  Requires: firebase CLI logged in (firebase login)
REM ============================================================
cd /d "%~dp0"

echo Building frontend...
cd frontend
call npm run build
if errorlevel 1 (
  echo.
  echo Build FAILED — fix the errors above, nothing was deployed.
  pause
  exit /b 1
)
cd ..

echo Deploying hosting + Firestore rules + indexes...
call firebase deploy --only hosting,firestore:rules,firestore:indexes

if errorlevel 1 (
  echo.
  echo Deploy failed. If you are not logged in, run:  firebase login
) else (
  echo.
  echo Done! Hard-refresh the app ^(Ctrl+Shift+R^) to see the new build.
  echo Reminder: run seed-brands.bat once if the brand pills are still empty.
)
pause
