# News Sentinel — Integration Blueprint
**Target:** Sosun Marketing Planner (React 19 + Vite + TS · Firestore · Firebase Auth custom claims · Express on Cloud Run)
**Goal:** Promote the standalone prototype into a server-driven, admin-governed module with sources managed from the admin panel.

---

## 1. Verdict on the prototype

It is a competent storefront with no engine behind it. As a *single-user demo* it works; as a *team feature* it collapses. The failings, ranked by severity:

| # | Flaw | Why it matters | Fix |
|---|------|----------------|-----|
| 1 | **State lives in `localStorage`** | Per-browser, per-device. Two staff see two different queues; nothing is shared, nothing survives a cache clear. | Move all state to Firestore. |
| 2 | **Scan runs in the browser** | "Auto-scan only works while this tab is open" — worthless for monitoring. | Server-side scan on a schedule (Cloud Scheduler → Cloud Run). |
| 3 | **CORS makes direct scraping impossible** | The prototype admits this and falls back to fake data. | The Cloud Run sync-service is mandatory, not optional. |
| 4 | **`innerHTML` with external article text** | Titles/excerpts from news sites injected raw → **stored XSS**. A malicious headline runs script in your admin's session. | Escape all external strings (`textContent` / sanitiser). Non-negotiable. |
| 5 | **Sources & keywords editable by anyone** | You want admin-only via the admin panel. | Gate writes behind the `admin` custom claim + Firestore rules. |
| 6 | **"Add to Planner" writes a fake object** | `plannerTask` is a localStorage stub — never touches your real `tasks` collection. | Write a real `tasks` doc (name-string brand, `createdAt` ISO) in a transaction. |
| 7 | **`Math.random()` demo data** | Obvious, but: delete it entirely. | Remove `DEMO_ARTICLES` and the random subset logic. |
| 8 | **`matchedKeyword` is singular** | One article often mentions several brands. | `matchedKeywords: string[]` + `brands: string[]`. |
| 9 | **Dedup is an in-memory `Set` of URLs** | Resets every load; same article re-detected forever. | Persist a `urlHash` and dedup server-side. |
| 10 | **Scraping HTML by hand** | Brittle and legally grey vs. each outlet's ToS. | Prefer **RSS feeds** and news APIs over HTML scraping (see §4). |

Keep the UI — it is genuinely good. Replace everything below the chrome.

---

## 2. Target architecture

```
Cloud Scheduler (cron, e.g. every 1h)
        │  OIDC-authenticated POST
        ▼
Cloud Run  /internal/news/scan      ← the worker
        │  reads enabled sources + keywords from Firestore (admin-managed)
        │  fetches each source (RSS first, HTML/API fallback)
        │  matches keywords → dedups by urlHash → writes new mentions
        ▼
Firestore  newsSources / newsKeywords / newsMentions
        ▲                                   ▲
        │ admin CRUD (admin claim)          │ realtime listener
        │                                   │
   Admin Panel  ────────────────────►  News Sentinel page (internal/admin)
                                            │ "Add to Planner"
                                            ▼
                                       tasks collection (existing)
```

The browser never scans. It only **reads** mentions and **acts** on them.

---

## 3. Firestore data model

Follow house conventions: brands referenced by **name string**, dates as `'YYYY-MM-DD'`, plus a full ISO timestamp for ordering.

### `newsSources` (admin-managed)
```ts
{
  id: string,
  name: string,            // display: "Avas"
  type: 'rss' | 'html' | 'api',
  url: string,             // RSS/feed URL or page URL
  enabled: boolean,
  createdAt: string,       // ISO
  createdBy: string,       // uid
}
```

### `newsKeywords` (admin-managed; ties a watch-term to a brand name-string)
```ts
{
  id: string,
  keyword: string,         // "Pascual"  (case-insensitive match)
  brand: string | null,    // brand NAME string, aligns with BrandScopeContext / ?brands=
  enabled: boolean,
  createdAt: string,
}
```
*Alternative:* fold this into the existing `brands` collection as `monitorKeywords: string[]`. A separate collection is cleaner if you want aliases/misspellings without polluting brand records.

### `newsMentions` (written by the worker, read by the app)
```ts
{
  id: string,
  title: string,
  url: string,
  urlHash: string,             // sha1(url) — dedup key, also used as doc id
  source: string,              // newsSources.name
  excerpt: string,
  matchedKeywords: string[],
  brands: string[],            // resolved brand name-strings
  sentiment?: 'positive' | 'neutral' | 'negative',
  detectedAt: string,          // ISO timestamp
  date: string,                // 'YYYY-MM-DD' (parse via dateUtils.parseDate)
  status: 'new' | 'added' | 'dismissed',
  plannerTaskId?: string,      // link back into tasks
  createdAt: string,           // ISO — for orderBy('createdAt','desc')
}
```
Use `urlHash` as the document ID so a re-detected article is an idempotent upsert, never a duplicate.

---

## 4. The sync service (Cloud Run worker)

Add routes to your **existing Cloud Run Express backend** (don't spin a new service unless you want isolation like the inventory sync-service). Three endpoints:

- `POST /internal/news/scan` — the scheduled worker. Auth: OIDC service-account token from Cloud Scheduler (verify the audience), **not** a user token.
- `GET/POST/DELETE /api/admin/news/sources` and `.../keywords` — admin CRUD. Auth: verify Firebase ID token, require `admin` custom claim.
- `POST /api/news/mentions/:id/add-to-planner` — transactional: create `tasks` doc + flip mention `status` to `'added'`. Auth: `internal` or `admin`.

### Scan logic (sketch)
```ts
import Parser from 'rss-parser';
import crypto from 'crypto';

const parser = new Parser();
const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

export async function runScan(db: FirebaseFirestore.Firestore) {
  const [sources, keywords] = await Promise.all([
    db.collection('newsSources').where('enabled','==',true).get(),
    db.collection('newsKeywords').where('enabled','==',true).get(),
  ]);
  const terms = keywords.docs.map(d => ({
    kw: d.get('keyword').toLowerCase(),
    brand: d.get('brand') as string | null,
  }));

  let written = 0;
  for (const s of sources.docs) {
    const src = s.data();
    let items: { title: string; link: string; excerpt: string }[] = [];

    if (src.type === 'rss') {
      const feed = await parser.parseURL(src.url);
      items = feed.items.map(i => ({
        title: i.title ?? '',
        link: i.link ?? '',
        excerpt: (i.contentSnippet ?? i.content ?? '').slice(0, 300),
      }));
    }
    // 'html' → fetch + cheerio selectors; 'api' → provider call. RSS first.

    for (const it of items) {
      const hay = `${it.title} ${it.excerpt}`.toLowerCase();
      const matched = terms.filter(t =>
        new RegExp(`\\b${t.kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(hay)
      );
      if (!matched.length || !it.link) continue;

      const id = hash(it.link);
      const ref = db.collection('newsMentions').doc(id);
      if ((await ref.get()).exists) continue;           // dedup

      const now = new Date();
      await ref.set({
        title: it.title, url: it.link, urlHash: id, source: src.name,
        excerpt: it.excerpt,
        matchedKeywords: [...new Set(matched.map(m => m.kw))],
        brands: [...new Set(matched.map(m => m.brand).filter(Boolean))],
        detectedAt: now.toISOString(),
        date: now.toISOString().slice(0,10),            // 'YYYY-MM-DD'
        status: 'new',
        createdAt: now.toISOString(),
      });
      written++;
    }
  }
  return { written };
}
```

**Source strategy:** Maldivian outlets (edition.mv, avas.mv, mihaaru.com) generally expose RSS — prefer it. For broad coverage without per-site scraping, a **Google News RSS query** (`https://news.google.com/rss/search?q=%22Sosun+Fihaara%22&hl=en`) or a news API (NewsAPI / GDELT) gives you keyword search across many outlets in one call and sidesteps most ToS/CORS pain. Reserve `type:'html'` + cheerio for the few sources with no feed.

`rss-parser`, `cheerio` are the only new deps.

---

## 5. Admin panel wiring

Add a **"News Monitoring"** section to the admin settings, rendered only when the user holds the `admin` claim. It is plain CRUD over `newsSources` and `newsKeywords` — reuse your existing admin table/form patterns. The prototype's Settings tab (keyword chips, source chips) is the exact UI; just point its handlers at the admin API instead of `localStorage`, and hide the tab for non-admins.

Firestore rules:
```
match /newsSources/{id} {
  allow read:  if isInternalOrAdmin();
  allow write: if isAdmin();
}
match /newsKeywords/{id} {
  allow read:  if isInternalOrAdmin();
  allow write: if isAdmin();
}
match /newsMentions/{id} {
  allow read:   if isInternalOrAdmin();
  allow update: if isInternalOrAdmin();   // status changes
  allow create, delete: if false;          // worker uses Admin SDK, bypasses rules
}
```

---

## 6. Frontend changes

Strip the `localStorage` layer; the React state shape barely changes.

- **Queue/Planner tabs:** `onSnapshot` on `newsMentions` filtered by `status` and (optionally) `BrandScopeContext` so the global `?brands=` filter applies for free.
- **Add to Planner modal:** on confirm, call `POST /api/news/mentions/:id/add-to-planner`. The backend transaction creates the `tasks` doc (brand as name-string, `createdAt` ISO so it sorts correctly in Tasks & Queue) and sets `mention.status='added'`, `plannerTaskId`.
- **Dismiss / Undo:** a one-field `update` on the mention.
- **Escape everything:** render `title`/`excerpt` with `textContent` or a sanitiser — never the current `innerHTML` template. This closes the XSS hole.
- **Manual "Scan Now":** keep it, but have it POST to the worker (admin only) rather than scanning in-browser.
- Delete `DEMO_ARTICLES`, the `Math.random` subset, and the browser `scanSchedule`/`setTimeout` auto-scan.

---

## 7. Cloud Run + Scheduler setup

### Deploy the backend (with the new routes)
```bash
gcloud run deploy sosun-planner-api \
  --source . \
  --region <REGION> \
  --service-account sosun-api@<PROJECT>.iam.gserviceaccount.com \
  --update-env-vars NEWS_SCAN_AUDIENCE=https://<run-url>/internal/news/scan
```

> **Heed the inventory-wipe scars.** `gcloud run deploy` has previously *replaced* env vars and crash-looped a poller on a missing variable. Use `--update-env-vars` (merge) — never re-deploy without re-supplying the full env, and confirm the service comes up healthy before walking away.

### Service account for the worker
Grant the run service account `roles/datastore.user` so the Admin SDK can write `newsMentions`.

### Cloud Scheduler job (server-side schedule — the real one)
```bash
gcloud scheduler jobs create http news-sentinel-scan \
  --schedule "0 * * * *" \
  --uri "https://<run-url>/internal/news/scan" \
  --http-method POST \
  --oidc-service-account-email scheduler@<PROJECT>.iam.gserviceaccount.com \
  --oidc-token-audience "https://<run-url>/internal/news/scan" \
  --location <REGION>
```

In `/internal/news/scan`, verify the incoming OIDC token's audience matches before running. That keeps the public URL from being scanned by strangers.

### Build verification (mount-sync quirk)
Per house procedure: stage sources in `/tmp`, `npm ci` fresh Linux `node_modules` there (do **not** symlink the Windows-native mounted modules), then `npx tsc -b` / `npx vite build`. After deploying a new frontend bundle the user must **hard-refresh (Ctrl+Shift+R)** or the PWA service worker serves the stale build.

---

## 8. Recommended build order

1. Firestore collections + rules (`newsSources`, `newsKeywords`, `newsMentions`).
2. Admin CRUD endpoints + admin-panel section (admin claim gated).
3. Cloud Run `/internal/news/scan` worker with RSS parsing + dedup.
4. Cloud Scheduler job (start hourly; tune later).
5. Rewire the prototype: Firestore listeners, escaped rendering, real "Add to Planner" transaction.
6. Delete all demo/random/in-browser-scan code.
7. Verify build in `/tmp` stage; deploy; hard-refresh.

---

### Optional flourishes
- **Sentiment tag** on each mention — **shipped** as a dependency-free heuristic in `newsParse.ts`.
- **Per-brand digest** email/notification on high-priority mentions.
- **Audit log** of admin source/keyword changes — you already enabled Firestore data-write audit logging after the wipe; extend the habit here.

---

## 9. As-built (2026-06-18)

What actually shipped differs from the blueprint above in two deliberate ways.

**Manual scans only — no scheduler.** Per your decision, there is no Cloud Scheduler job and no cron/OIDC path. `POST /api/news/scan` is guarded simply by `requireAuth` + `requireRole('admin','internal')` and is fired by the **Scan Now** button. Ignore §7's Cloud Scheduler subsection.

**Files delivered**
- Backend: `services/newsParse.ts` (pure RSS/Atom parse + match + sentiment + sha1 — unit-tested **15/15**), `services/newsScan.ts` (Firestore read + fetch + dedup write), `routes/news.ts` (manual scan endpoint), mounted in `server.ts`.
- Frontend: `pages/NewsSentinel.tsx` (route `/news`, nav for admin+internal), `services/newsApi.ts` (Scan Now), `styles/news.css`. "Add to Planner" is a client `runTransaction` creating a real `tasks` doc and flipping the mention to `added`.
- Rules + index: `newsSources`/`newsKeywords` (admin-write) and `newsMentions` (backend-create only) added to `firestore.rules`; `newsMentions(status, createdAt desc)` composite index added.

**Source note — oneonline.mv.** The site is a JavaScript-rendered SPA with **no public RSS feed** at any standard path (`/rss`, `/feed`, `/en/rss`, `/sitemap.xml` all empty; contact is news@oneonline.mv). A direct feed source therefore won't work. Use a **Google News RSS search** as the source instead — paste this as a source URL in the settings tab:

```
https://news.google.com/rss/search?q=site:oneonline.mv&hl=en-US&gl=US&ceid=US:en
```

…or scope it to a brand, e.g. `q=%22Sosun+Fihaara%22`. Cloud Run fetches Google News server-side without issue. The parser was verified against exactly this Google-News RSS shape (CDATA-wrapped HTML descriptions, entity-encoded titles, redirect `link` URLs) — all extracted correctly. The same applies to any feedless outlet (edition.mv/avas.mv/mihaaru.com expose native RSS and can be added directly).
