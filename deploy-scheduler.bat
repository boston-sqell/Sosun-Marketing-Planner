@echo off
REM ============================================================
REM  News Sentinel - daily automatic scan via Cloud Scheduler.
REM
REM  PREREQUISITES (do these ONCE first):
REM   1) gcloud auth login
REM   2) Set SCHEDULER_KEY in the Cloud Run service env to the SAME value as
REM      KEY below (the backend rejects the scheduler without it):
REM        gcloud run services update sosun-sync-api ^
REM          --project sosun-marketing-planner-2026 --region us-central1 ^
REM          --update-env-vars SCHEDULER_KEY=your-long-random-secret
REM      (--update-env-vars MERGES; it will not wipe your other env vars.)
REM   3) Edit RUN_URL and KEY below.
REM
REM  Runs daily at 06:00 Maldives time. Re-run this file to update the job.
REM ============================================================
set PROJECT=sosun-marketing-planner-2026
set REGION=us-central1
set RUN_URL=https://sosun-sync-api-410260420639.us-central1.run.app/api/news/scan
set KEY=sentinel-job-super-secret-12345

echo Creating daily scan job (06:00 Maldives)...
call gcloud scheduler jobs create http news-sentinel-daily ^
  --project %PROJECT% --location %REGION% ^
  --schedule "0 6 * * *" --time-zone "Indian/Maldives" ^
  --uri "%RUN_URL%" --http-method POST ^
  --headers "Content-Type=application/json,x-scheduler-key=%KEY%" ^
  --message-body "{}" ^
  --attempt-deadline 540s

if errorlevel 1 (
  echo.
  echo Create failed ^(job may already exist^). Updating instead...
  call gcloud scheduler jobs update http news-sentinel-daily ^
    --project %PROJECT% --location %REGION% ^
    --schedule "0 6 * * *" --time-zone "Indian/Maldives" ^
    --uri "%RUN_URL%" --http-method POST ^
    --update-headers "x-scheduler-key=%KEY%" ^
    --message-body "{}"
)
echo.
echo Done. Verify / run once now from the Cloud Scheduler console, or:
echo   gcloud scheduler jobs run news-sentinel-daily --project %PROJECT% --location %REGION%
pause
