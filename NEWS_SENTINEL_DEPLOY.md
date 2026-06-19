# News Sentinel — Deployment Runbook

A brand-news monitoring module for the Sosun Marketing Planner. **Manual scans only** (no scheduler). Admin manages sources/keywords in-app; the queue feeds straight into the Tasks & Queue.

---

## 0. What ships
- **Backend:** `services/newsParse.ts` (RSS/Atom parse + match + sentiment, unit-tested 33/33), `services/newsScan.ts` (fetch + dedup write), `routes/news.ts` (`POST /api/news/scan`, admin/internal only), mounted in `server.ts`.
- **Frontend:** `pages/NewsSentinel.tsx` (route `/news`, nav for admin+internal), `services/newsApi.ts`, `styles/news.css`.
- **Rules/index:** `newsSources` + `newsKeywords` (admin-write), `newsMentions` (backend-create only); `newsMentions(status, createdAt desc)` index.
- **Seed:** `backend/scripts/seedNewsSources.ts` + `seed-news-sources.bat`.

**No new secrets or API keys.** Feeds are public RSS; the scan authenticates with existing Firebase login; the worker uses the Cloud Run service account already in place.

---

## 1. Credentials (one-time)
```
gcloud auth login                         # backend deploy (project sosun-marketing-planner-2026)
firebase login                            # hosting + rules + indexes
gcloud auth application-default login      # the seed script (Firestore Admin SDK)
```
**Guard existing Cloud Run env vars** — the backend won't boot without `MEDIA_TOKEN_SECRET`, and also relies on `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `FIREBASE_SERVICE_ACCOUNT` (or ADC), `CRON_SECRET`, `SPREADSHEET_ID`. The deploy preserves them (no env flags passed) — but verify after, per the past wipe incident.

---

## 2. Deploy (in order)

**1) Backend → Cloud Run**
```
deploy-backend.bat
```
**2) Health check** — confirm the service booted before continuing:
```
curl https://<cloud-run-url>/health        # expect {"status":"healthy",...}
```
**3) Frontend + Firestore rules + indexes**
```
deploy.bat
```
Then **hard-refresh the app (Ctrl+Shift+R)** — the PWA service worker otherwise serves the stale bundle.

**4) Seed sources + keywords** (idempotent; safe to re-run)
```
seed-news-sources.bat
```
Loads PSM's native feed + Google News feeds for One Online, Mihaaru, Edition, Avas, Raajje, Vaguthu, and one keyword per brand from the `brands` collection.

---

## 3. Verify (smoke test)
1. Sign in as **admin** → sidebar shows **News Sentinel** (radar icon).
2. **Sources & Keywords** tab lists the seeded sources + keywords.
3. Press **Scan Now** → toast reports new mentions or "no new mentions" (no red error).
4. **Queue** tab shows mention cards (source, time, keyword chip, sentiment).
5. **＋ Add to Planner** on a card → pick brand/priority → Save → card moves to **Planner**; a real task appears in **Tasks & Queue** (status *Idea*, article URL in asset link).
6. **Dismiss** / **Undo** behave.
7. **Role checks:** internal sees News Sentinel but no settings tab; agency can't reach `/news`.
8. **Graceful failure:** add a bad source URL, Scan Now → scan still completes, bad source skipped.

---

## 4. Notes & rollback
- **Feeds:** if a Google News source returns nothing for an outlet, try its native `https://<domain>/feed` from the settings tab (Cloud Run fetches server-side and often succeeds). edition.mv/avas.mv/raajje.mv(+`/en/feed`)/vaguthu.mv/mihaaru.com are worth trying natively; psmnews.mv native is confirmed.
- **Facebook/Instagram:** no native RSS; monitor the news sites (Google News covers their posted articles), or add an RSS.app/RSSHub bridge URL as a normal source if you must.
- **Rollback:** the feature is additive. To disable without redeploy, an admin toggles every source OFF (no scans return results) or hides the nav. To fully revert, redeploy the previous backend bundle and remove the `/news` route — no data migration involved; `newsMentions` are inert if unused.
- **Index build** may take a few minutes after `deploy.bat`; the current queue listener uses single-field ordering and does not depend on it.
