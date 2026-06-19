# News Sentinel — Smoke Test, Feeds & Social

## 1. Quick smoke test (first live run)

Run top to bottom. Each step has a clear pass signal.

**Deploy**
1. `deploy-backend.bat` → ends with "Backend deployed".
2. `deploy.bat` → builds, deploys hosting + rules + indexes. **Hard-refresh (Ctrl+Shift+R)** afterward.
3. Sign in as an **admin**. The sidebar shows **News Sentinel** (radar icon). Open it.

**Configure (Sources & Keywords tab)**
4. Add one known-good source: name `PSM` , URL `https://psmnews.mv/feed`. It appears in the list, toggle ON.
5. Add a keyword likely to hit today's news (for a first test use a common term like `Maldives`, mapped to no brand). Real brand keywords (Pascual, Shan, Sosun Fihaara…) can be added now too.

**Scan**
6. Press **Scan Now**. Button shows "Scanning…", then a toast: either *"N new mentions detected"* or *"no new mentions"*. No red error toast.
7. Open the **Queue** tab → mention cards appear with source badge, time, matched keyword chip, sentiment tag.

**Promote → verify the real task**
8. On a card, **＋ Add to Planner** → modal. Pick a brand + priority, Save.
9. Card moves to the **Planner** tab with an "Added" badge.
10. Go to **Tasks & Queue** → a new task exists (title `Press: …`, status *Idea*, the article URL in its asset link). This proves the transaction wrote a real task.

**Review actions**
11. Back in News Sentinel, **Dismiss** a queue card → it disappears. **Undo** an added card → returns to queue.

**Permission checks (the important ones)**
12. Sign in as **internal** → News Sentinel visible, but **no** Sources & Keywords tab (admin-only).
13. Sign in as **agency** → News Sentinel absent from nav; visiting `/news` redirects home.

**Failure signal to confirm graceful handling**
14. Add a deliberately bad source URL (e.g. `https://psmnews.mv/nope`), Scan Now. Result: scan still completes, other sources still work — the bad one is skipped (its error is in the summary, not a crash).

If 1–14 pass, the module is healthy.

---

## 2. Feeds to add

Paste these in **Sources & Keywords → News Sources**.

### Confirmed native RSS
| Source | Feed URL |
|---|---|
| PSM News (Dhivehi) | `https://psmnews.mv/feed` |
| PSM News (English) | `https://psmnews.mv/en/feed` |

### Native feed to try first (likely WordPress; the in-app scanner fetches server-side and usually succeeds even where a feed looks unreachable from a browser)
| Source | Try this feed URL |
|---|---|
| Edition.mv | `https://edition.mv/feed` |
| Avas | `https://avas.mv/feed` |
| Raajje (Dhivehi) | `https://raajje.mv/feed` |
| Raajje (English) | `https://raajje.mv/en/feed` |
| Vaguthu | `https://vaguthu.mv/feed` |
| Mihaaru | `https://mihaaru.com/feed` |

After adding one, press **Scan Now** — if "fetched" stays 0 for that source over a couple of runs, it has no usable feed; switch to the Google News fallback below.

### Guaranteed fallback — Google News RSS (works for ANY site, incl. oneonline.mv)
Use when a native feed is missing or blocked. Format:
```
https://news.google.com/rss/search?q=site:DOMAIN&hl=en-US&gl=US&ceid=US:en
```
Ready-to-paste:
| Source | Google News RSS URL |
|---|---|
| One Online | `https://news.google.com/rss/search?q=site:oneonline.mv&hl=en-US&gl=US&ceid=US:en` |
| Mihaaru | `https://news.google.com/rss/search?q=site:mihaaru.com&hl=en-US&gl=US&ceid=US:en` |
| Edition.mv | `https://news.google.com/rss/search?q=site:edition.mv&hl=en-US&gl=US&ceid=US:en` |
| Avas | `https://news.google.com/rss/search?q=site:avas.mv&hl=en-US&gl=US&ceid=US:en` |
| Raajje | `https://news.google.com/rss/search?q=site:raajje.mv&hl=en-US&gl=US&ceid=US:en` |
| Vaguthu | `https://news.google.com/rss/search?q=site:vaguthu.mv&hl=en-US&gl=US&ceid=US:en` |

**Even sharper:** a brand-scoped Google News feed cuts noise to near zero — it only returns articles already mentioning the brand:
```
https://news.google.com/rss/search?q=%22Sosun+Fihaara%22&hl=en-US&gl=US&ceid=US:en
https://news.google.com/rss/search?q=%22Pascual%22+Maldives&hl=en-US&gl=US&ceid=US:en
```

> Note: the scanner already matches keywords itself, so a broad `site:` feed plus your keyword list works fine. Brand-scoped feeds are just an optional way to pre-filter at the source.

---

## 3. Facebook & Instagram links

**Short answer: not via the current RSS scanner, and not cleanly via any official route.**

Meta removed public RSS years ago. There is no RSS feed for a Facebook Page or Instagram account. The only official access is the **Meta Graph API**, which requires a registered app, page access tokens, app review, and — critically — it only reads pages/accounts you own or have been granted permission to. It cannot monitor third-party news outlets' pages. Building that is a separate, heavier project and out of scope for a feed scanner.

**Practical ways to still catch what those outlets post socially:**
- **Monitor the news sites instead (recommended).** Outlets post the same stories to their site *and* to FB/IG. The Google News / native feeds above already capture those articles — you lose nothing of substance.
- **Bridge service (if you truly need the social post itself).** Tools like **RSS.app**, **RSSHub**, or **FetchRSS** generate an RSS URL from a *public* Facebook Page or Instagram profile. That URL drops straight into the scanner as a normal source — no code change needed. Caveats: it's against Meta's ToS in spirit, feeds break when Meta changes its markup, Instagram is especially locked down, and the reliable tiers are usually paid. Treat it as best-effort, not a system of record.

So: add the news feeds for coverage; reach for a bridge URL only if a specific FB/IG account posts things the outlets' own sites don't.

---

## 4. Edge cases — verified

The parser/matcher (`newsParse.ts`) is unit-tested: **15 core + 18 edge = 33 assertions, all passing.** Covered:

- Empty / malformed / truncated XML → returns `[]`, never throws.
- Items missing a title or a link (link-less items are skipped by the scan loop).
- Entity decoding — numeric (`&#8217;`) and named (`&quot;`, `&amp;`), plus CDATA and nested HTML stripped to clean text.
- **Regex-special keywords escaped** — `M.M.` matches literal `m.m.` but not `MXMY`; `AT&T` matches literally. *(This was a real bug caught here and fixed — the matcher now uses alphanumeric lookarounds instead of `\b`.)*
- Case-insensitive matching; **substring safety** — `Shan` never matches `Shandy`/`Shanghai`.
- **Dhivehi/Thaana text** — a Latin brand name embedded in Thaana script is matched correctly.
- Excerpt capped at 300 chars; whitespace normalized.
- Atom feeds with multiple `<link>` elements — the alternate `href` is taken.
- Dedup hash (`sha1(url)`) stable and collision-distinct, so re-detected articles never duplicate.

**Known limitation:** keywords whose *edge characters are accented Latin* (e.g. `Café`, `Häagen`) may mismatch at that edge, since the lookaround uses `[a-z0-9]`. None of Sosun's current brands are affected. Flag it if you ever add such a brand and I'll widen the character class.
