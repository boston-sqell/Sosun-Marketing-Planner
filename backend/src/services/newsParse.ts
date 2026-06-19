import * as crypto from 'crypto';

/**
 * Pure feed-parsing & keyword-matching helpers for the News Sentinel scan.
 * No Firestore / network dependency — kept separate so the parsing logic is
 * unit-testable in isolation.
 */

export const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

export const stripTags = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function tagContent(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

export interface FeedItem {
  title: string;
  link: string;
  excerpt: string;
  date?: string;   // ISO-ish publish date when known (JSON sources) — used for backfill cutoff
}

/** Parse RSS 2.0 (<item>) or Atom (<entry>) into a flat item list. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // RSS 2.0
  const rssBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of rssBlocks) {
    const title = stripTags(tagContent(block, 'title'));
    const link = stripTags(tagContent(block, 'link'));
    const desc = stripTags(tagContent(block, 'description') || tagContent(block, 'content:encoded'));
    if (title || link) items.push({ title, link, excerpt: desc.slice(0, 300) });
  }
  if (items.length) return items;

  // Atom
  const atomBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of atomBlocks) {
    const title = stripTags(tagContent(block, 'title'));
    const linkAttr = block.match(/<link[^>]*href=["']([^"']+)["']/i);
    const link = linkAttr ? decodeEntities(linkAttr[1]) : stripTags(tagContent(block, 'id'));
    const desc = stripTags(tagContent(block, 'summary') || tagContent(block, 'content'));
    if (title || link) items.push({ title, link, excerpt: desc.slice(0, 300) });
  }
  return items;
}

/**
 * Scrape article links from a listing/section HTML page (for server-rendered
 * outlets that have no RSS feed, e.g. One Online, Mihaaru). Extracts each
 * `<a href>` whose resolved path matches `linkPattern` (a regex string); when no
 * pattern is given, falls back to a headline-length heuristic. The anchor text
 * becomes the matchable title/excerpt and the resolved absolute URL the link.
 */
export function parseHtmlLinks(html: string, baseUrl: string, linkPattern?: string): FeedItem[] {
  let re: RegExp | null = null;
  if (linkPattern) {
    try { re = new RegExp(linkPattern); } catch { re = null; }
  }
  const out: FeedItem[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const rawHref = m[1];
    const text = stripTags(m[2]);
    if (!text || text.length < 8) continue;

    let abs: string, path: string;
    try {
      const u = new URL(rawHref, baseUrl);
      abs = u.href;
      path = u.pathname;
    } catch {
      continue;
    }

    if (re) {
      if (!re.test(path) && !re.test(abs)) continue;
    } else if (text.length < 25) {
      continue; // heuristic: only headline-length anchors when no pattern
    }

    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ title: text.slice(0, 160), link: abs, excerpt: text.slice(0, 300) });
  }
  return out;
}

/** Config describing how to extract articles from a JSON API response. */
export interface JsonConfig {
  itemsPath?: string;    // dot path to the array (e.g. "data"); empty = root is the array
  titleField?: string;   // default "title"
  excerptField?: string; // optional secondary text for matching
  linkField?: string;    // default "url"
  dateField?: string;    // optional publish-date field (enables backfill cutoff)
  linkBase?: string;     // prepended to relative links (e.g. "https://edition.mv")
}

function getPath(obj: any, path?: string): any {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * Parse an article list from a JSON API response (for client-rendered SPAs that
 * expose a public JSON endpoint, e.g. Edition's Laravel paginator). Field names
 * and the array path are config-driven so one adapter serves any such API.
 */
export function parseJsonItems(jsonText: string, cfg: JsonConfig): FeedItem[] {
  let root: any;
  try { root = JSON.parse(jsonText); } catch { return []; }
  const arr = getPath(root, cfg.itemsPath);
  if (!Array.isArray(arr)) return [];

  const titleF = cfg.titleField || 'title';
  const linkF = cfg.linkField || 'url';
  const out: FeedItem[] = [];
  for (const it of arr) {
    if (it == null || typeof it !== 'object') continue;
    const title = String(getPath(it, titleF) ?? '').trim();
    const excerpt = cfg.excerptField ? String(getPath(it, cfg.excerptField) ?? '').trim() : '';
    const rawLink = String(getPath(it, linkF) ?? '').trim();
    if (!rawLink) continue;

    let link = rawLink;
    if (!/^https?:\/\//i.test(rawLink)) {
      const base = (cfg.linkBase || '').replace(/\/+$/, '');
      link = base + (rawLink.startsWith('/') ? rawLink : '/' + rawLink);
    }
    const date = cfg.dateField ? String(getPath(it, cfg.dateField) ?? '').trim() || undefined : undefined;
    out.push({ title, link, excerpt: excerpt.slice(0, 300), date });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Term {
  kw: string;
  brand: string | null;
  re: RegExp;
}

/**
 * Fold text for matching: lower-case (no-op on Thaana) + Unicode NFC.
 * NFC normalization is what makes Dhivehi reliable — an outlet may store Thaana
 * consonant+vowel-sign sequences in a different normalization form than the
 * keyword was typed in; without this they wouldn't compare equal.
 */
const fold = (s: string) => s.toLowerCase().normalize('NFC');

/**
 * Build a case-insensitive, script-agnostic matcher for a keyword.
 *
 * Uses alphanumeric lookarounds rather than `\b` so that keywords whose edges
 * are punctuation (e.g. "M.M.", "AT&T") still match, while still refusing
 * substring hits ("Shan" must not match "Shandy"/"Shanghai"). The `[a-z0-9]`
 * guards only exclude Latin alphanumerics, so Dhivehi/Thaana keywords match
 * correctly inside Thaana text. Keyword and haystack are both folded (lower +
 * NFC), so no `i` flag is needed and Dhivehi compares reliably.
 */
export function buildTerm(keyword: string, brand: string | null): Term | null {
  const kw = keyword.trim();
  if (!kw) return null;
  return { kw, brand, re: new RegExp(`(?<![a-z0-9])${escapeRe(fold(kw))}(?![a-z0-9])`) };
}

/** Returns the terms that match anywhere in the (folded) haystack. */
export function matchTerms(haystack: string, terms: Term[]): Term[] {
  const lc = fold(haystack);
  return terms.filter((t) => t.re.test(lc));
}

// Heuristic sentiment — best-effort, dependency-free.
const POS = ['surge', 'popular', 'growth', 'expand', 'success', 'award', 'launch', 'gain', 'strong', 'praise', 'top', 'win', 'record'];
const NEG = ['recall', 'ban', 'lawsuit', 'fine', 'shortage', 'complaint', 'contamina', 'fraud', 'decline', 'fail', 'scandal', 'warning', 'shut'];

export function sentimentOf(text: string): 'positive' | 'neutral' | 'negative' {
  const lc = text.toLowerCase();
  let score = 0;
  for (const w of POS) if (lc.includes(w)) score++;
  for (const w of NEG) if (lc.includes(w)) score--;
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}
