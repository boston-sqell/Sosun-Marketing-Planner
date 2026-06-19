# News Sentinel — Scraping Proxy (Cloudflare bypass)

One Online and Vaguthu block Cloud Run's datacenter IP at the Cloudflare edge (HTTP 403). A user-agent change can't beat that — the request must come from a residential/rendering proxy. The backend now supports this: any source with `useProxy: true` is fetched through **`PROXY_URL`**; every other source fetches directly (so you only spend proxy credits on the two blocked sites).

## 1. Pick a proxy that bypasses Cloudflare
Any service with a `?url=` endpoint works. All have free tiers (~1,000 requests/month — plenty: 2 sources × 1 daily scan ≈ 60/month). Use the **Cloudflare/stealth** option each one offers:

| Service | `PROXY_URL` template (put your key in, keep `{url}` literal) |
|---|---|
| **Scrape.do** | `https://api.scrape.do/?token=YOUR_TOKEN&super=true&url={url}` |
| **ScrapingBee** | `https://app.scrapingbee.com/api/v1/?api_key=YOUR_KEY&stealth_proxy=true&url={url}` |
| **ScraperAPI** | `https://api.scraperapi.com/?api_key=YOUR_KEY&render=true&url={url}` |

`{url}` is a placeholder — the backend URL-encodes each target site into it. Leave it exactly as `{url}`.

## 2. Set PROXY_URL on Cloud Run
The value contains `&` and `{ }`, which are painful to escape in a shell. **Easiest: the Cloud Run console** —
Cloud Run → `sosun-sync-api` → *Edit & Deploy New Revision* → **Variables & Secrets** → add:
```
PROXY_URL = <the full template from the table above>
```
Deploy. (This is also the safest way to avoid the env-var-wipe issue — the console preserves existing vars.)

CLI alternative (quote the whole value):
```
gcloud run services update sosun-sync-api --project sosun-marketing-planner-2026 --region us-central1 ^
  --update-env-vars "^||^PROXY_URL=https://api.scrape.do/?token=YOUR_TOKEN&super=true&url={url}"
```
(The `^||^` sets `||` as the delimiter so the `&` in the value isn't treated as a separator.)

## 3. Re-seed + redeploy + scan
1. `deploy-backend.bat` (ships the proxy-aware fetch) → `/health`.
2. `deploy.bat` + hard-refresh (adds the "Fetch via proxy" toggle + PROXY tag).
3. Re-seed (project-pinned) — sets `useProxy: true` on One Online and Vaguthu.
4. News Sentinel → **Scan Now**. One Online and Vaguthu should now **disappear from the error list** and contribute articles.

## Notes
- If they still 403 after this, your proxy tier isn't bypassing Cloudflare — switch on the service's stealth/super/render flag (the `&super=true` / `&stealth_proxy=true` / `&render=true` above).
- To proxy any other source later, just tick **Fetch via proxy** when adding it (or set `useProxy: true` on its doc). No redeploy needed — it's read per-scan.
- Proxied fetches use a 30s timeout (vs 12s direct), since rendering proxies are slower.
- `PROXY_URL` unset → proxied sources fall back to a direct fetch (i.e. the current 403). Nothing breaks; they just stay blocked until you set it.
