import { db } from './firestore';
import {
  sha1, parseFeed, parseHtmlLinks, parseJsonItems,
  buildTerm, matchTerms, sentimentOf,
  type Term, type FeedItem, type JsonConfig,
} from './newsParse';
import { sendPushToRoles } from './pushService';

/**
 * News Sentinel scan engine. Reads admin-managed `newsSources` + `newsKeywords`,
 * fetches each source, matches brand keywords, de-dups by sha1(url) and writes new
 * `newsMentions`. Source types:
 *   'rss'  → RSS/Atom feed
 *   'html' → server-rendered listing page (scrape <a> links by pattern)
 *   'json' → JSON API (config-driven), paginatable for backfill
 *
 * A backfill run (backfillDays) paginates JSON sources back ~N days so the app
 * can be populated on first use; afterwards a normal scan grabs only the latest.
 */

const BACKFILL_MAX_PAGES = 30; // safety cap per source (×per_page articles)

// Node 18+/22 global fetch — typed loosely to avoid a DOM lib dependency.
const httpFetch = (globalThis as any).fetch as (
  url: string,
  init?: any,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Route a fetch through a scraping proxy when the source needs it. Cloudflare
 * blocks Cloud Run's datacenter IP outright (403) for some sites (One Online,
 * Vaguthu) — a residential/rendering proxy bypasses that. PROXY_URL is a template
 * containing `{url}`; the target URL is URL-encoded into it, which fits the
 * `?url=` style of ScraperAPI / ScrapingBee / Scrape.do / most proxies, e.g.:
 *   https://api.scraperapi.com/?api_key=KEY&url={url}
 *   https://app.scrapingbee.com/api/v1/?api_key=KEY&render_js=false&url={url}
 * If PROXY_URL is unset, proxied sources fall back to a direct fetch.
 */
function proxify(url: string, useProxy: boolean, render = true): string {
  let tmpl = process.env.PROXY_URL;
  if (!useProxy || !tmpl) return url;
  // RSS/JSON feeds are static XML/JSON — rendering them in a headless browser
  // wastes proxy credits and time and can exceed the fetch timeout (e.g. Vaguthu's
  // RSS feed aborting at 30s). Strip render for non-HTML sources; keep it for HTML
  // pages behind anti-bot that genuinely need JS execution (e.g. One Online).
  if (!render) tmpl = tmpl.replace(/&render=true/i, '');
  return tmpl.includes('{url}')
    ? tmpl.replace('{url}', encodeURIComponent(url))
    : tmpl + encodeURIComponent(url);
}

async function fetchUrl(url: string, useProxy = false, render = true): Promise<string> {
  const target = proxify(url, useProxy, render);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), useProxy ? 30000 : 12000); // proxies are slower
  try {
    const res = await httpFetch(target, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,dv;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export interface ScanSummary {
  sources: number;
  keywords: number;
  fetched: number;
  written: number;
  backfillDays?: number;
  errors: { source: string; error: string }[];
}

/** Match a batch of items, dedup, and write new mentions. Returns count written. */
async function writeMatches(
  items: FeedItem[], terms: Term[], sourceName: string,
): Promise<number> {
  let written = 0;
  for (const it of items) {
    if (!it.link) continue;
    const matched = matchTerms(`${it.title} ${it.excerpt}`, terms);
    if (!matched.length) continue;

    const id = sha1(it.link);
    const ref = db.collection('newsMentions').doc(id);
    if ((await ref.get()).exists) continue; // idempotent dedup — never resets status

    const sentimentScore = sentimentOf(`${it.title} ${it.excerpt}`);

    const now = new Date();
    await ref.set({
      title: it.title || '(untitled)',
      url: it.link,
      urlHash: id,
      source: sourceName,
      excerpt: it.excerpt,
      matchedKeywords: [...new Set(matched.map((m) => m.kw))],
      brands: [...new Set(matched.map((m) => m.brand).filter((b): b is string => !!b))],
      sentiment: sentimentScore,
      detectedAt: now.toISOString(),
      date: (it.date && it.date.slice(0, 10)) || now.toISOString().slice(0, 10),
      status: 'new',
      createdAt: now.toISOString(),
    });

    sendPushToRoles(['admin', 'agency'], {
      title: '🗞️ New Mention Detected',
      body: `A new article was found for your tracked keywords: ${it.title}`,
      url: '/news',
      tag: `news-${id}`,
    }).catch(err => console.error('News push failed:', err));

    written++;
  }
  return written;
}

export async function runNewsScan(opts: { backfillDays?: number } = {}): Promise<ScanSummary> {
  const backfillDays = opts.backfillDays && opts.backfillDays > 0 ? opts.backfillDays : undefined;

  const [srcSnap, kwSnap] = await Promise.all([
    db.collection('newsSources').where('enabled', '==', true).get(),
    db.collection('newsKeywords').where('enabled', '==', true).get(),
  ]);

  const terms: Term[] = kwSnap.docs
    .map((d) => buildTerm(String(d.get('keyword') || ''), (d.get('brand') as string) || null))
    .filter((t): t is Term => !!t);

  const summary: ScanSummary = {
    sources: srcSnap.size, keywords: terms.length,
    fetched: 0, written: 0, backfillDays, errors: [],
  };
  if (!terms.length) return summary;

  const cutoff = backfillDays ? Date.now() - backfillDays * 86400000 : 0;

  for (const srcDoc of srcSnap.docs) {
    const src = srcDoc.data();
    const name = String(src.name || src.url || 'source');
    const type = String(src.type || 'rss');
    const useProxy = src.useProxy === true;
    // Only HTML pages need JS rendering through the proxy; RSS/JSON feeds are
    // static and render=true just makes them slow enough to time out.
    const renderProxy = type === 'html';
    try {
      if (type === 'json') {
        const cfg: JsonConfig = {
          itemsPath: src.jsonItemsPath, titleField: src.jsonTitleField,
          excerptField: src.jsonExcerptField, linkField: src.jsonLinkField,
          dateField: src.jsonDateField, linkBase: src.linkBase,
        };
        const url = String(src.url);
        const paginated = url.includes('{page}');
        const maxPages = backfillDays && paginated ? BACKFILL_MAX_PAGES : 1;
        for (let page = 1; page <= maxPages; page++) {
          const pageUrl = paginated ? url.replace('{page}', String(page)) : url;
          const items = parseJsonItems(await fetchUrl(pageUrl, useProxy, renderProxy), cfg);
          if (!items.length) break;
          summary.fetched += items.length;
          summary.written += await writeMatches(items, terms, name);
          // backfill cutoff: stop once the whole page is older than the window
          if (cutoff && items.every((it) => it.date && Date.parse(it.date) < cutoff)) break;
          if (!paginated) break;
        }
      } else {
        const body = await fetchUrl(String(src.url), useProxy, renderProxy);
        const items = type === 'html'
          ? parseHtmlLinks(body, String(src.url), src.linkPattern ? String(src.linkPattern) : undefined)
          : parseFeed(body);
        summary.fetched += items.length;
        summary.written += await writeMatches(items, terms, name);
      }
    } catch (e: any) {
      summary.errors.push({ source: name, error: e?.message || String(e) });
      console.warn(`News scan: source "${name}" failed:`, e?.message);
    }
  }

  return summary;
}
