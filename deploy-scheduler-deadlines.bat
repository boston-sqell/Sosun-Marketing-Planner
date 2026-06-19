@echo off
echo ===================================================
echo Deploying Cloud Scheduler: Task Deadlines Check
echo ===================================================

REM Make sure to replace your service URL and SCHEDULER_KEY with the correct values if they differ.

set SERVICE_URL=https://sosun-sync-api-5l5xlbsztq-uc.a.run.app
set REGION=us-central1
set SCHEDULER_KEY=super-secret-cron-key-change-me

echo Creating or updating 'sosun-deadlines-cron'...
gcloud scheduler jobs create http sosun-deadlines-cron ^
  --schedule="0 9 * * *" ^
  --time-zone="Indian/Maldives" ^
  --uri="%SERVICE_URL%/api/tasks/check-deadlines" ^
  --http-method="GET" ^
  --headers="x-scheduler-key=%SCHEDULER_KEY%" ^
  --location="%REGION%" || ^
gcloud scheduler jobs update http sosun-deadlines-cron ^
  --schedule="0 9 * * *" ^
  --time-zone="Indian/Maldives" ^
  --uri="%SERVICE_URL%/api/tasks/check-deadlines" ^
  --http-method="GET" ^
  --headers="x-scheduler-key=%SCHEDULER_KEY%" ^
  --location="%REGION%"

echo Done! The deadline check will run daily at 9:00 AM (Maldives Time).
pause
