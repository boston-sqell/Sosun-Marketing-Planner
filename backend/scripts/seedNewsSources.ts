/**
 * One-time, idempotent seed for News Sentinel.
 *
 * Seeds two collections:
 *   1. `newsSources` — a curated set of Maldivian news feeds. PSM has a
 *      confirmed native RSS feed; the other outlets are seeded with a Google
 *      News RSS `site:` search, which is guaranteed to work server-side and
 *      covers outlets that lack (or block) a native feed. You can later add
 *      native `/feed` URLs from the in-app Sources & Keywords tab.
 *   2. `newsKeywords` — one watch-term per brand in the `brands` collection,
 *      each mapped to that brand NAME (so mentions inherit the global brand
 *      filter). Falls back to a default house term if no brands exist yet.
 *
 * Idempotent: a source is skipped if its URL already exists; a keyword is
 * skipped if the term already exists (case-insensitive). Nothing is overwritten.
 *
 * Run from backend/:  npx ts-node scripts/seedNewsSources.ts
 * Requires FIREBASE_SERVICE_ACCOUNT in .env or Application Default Credentials.
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';

// Verified working Maldivian sources (audited live 2026-06-18).
//   'rss'  → native RSS/Atom feed (parsed directly).
//   'html' → server-rendered listing page; linkPattern matches article hrefs and
//            the anchor text is matched against keywords.
// True SPAs (Avas, Edition/Nuxt, Raajje) are omitted: they render client-side so
// the server returns no article links to scrape, and they expose no feed. For
// those, add a bridge URL (RSS.app / RSSHub) as an 'rss' source if needed.
type SeedSource = {
  name: string; url: string; type: 'rss' | 'html' | 'json'; linkPattern?: string;
  jsonItemsPath?: string; jsonTitleField?: string; jsonExcerptField?: string;
  jsonLinkField?: string; jsonDateField?: string; linkBase?: string; useProxy?: boolean;
};
const SOURCES: SeedSource[] = [
  // Recipe / food sites (post product recipes)
  { name: 'Lonumedhu',          url: 'https://lonumedhu.com/rss.xml',         type: 'rss' },
  { name: 'Tasty (The Spread)', url: 'https://tasty.mv/category/the-spread',  type: 'html', linkPattern: '/the-spread/[^/?#]+$' },
  // News — native Dhivehi/English feeds
  { name: 'PSM News (Dhivehi)', url: 'https://psmnews.mv/feed',    type: 'rss' },
  { name: 'PSM News (English)', url: 'https://psmnews.mv/en/feed', type: 'rss' },
  { name: 'Vaguthu',            url: 'https://vaguthu.mv/feed/',   type: 'rss', useProxy: true },
  // News — server-rendered HTML (scraped listing pages)
  // One Online is Cloudflare-blocked to Cloud Run → fetched via PROXY_URL.
  { name: 'One Online',         url: 'https://oneonline.mv/',        type: 'html', linkPattern: '/\\d{4,}$', useProxy: true },
  { name: 'Mihaaru',            url: 'https://mihaaru.com/',         type: 'html', linkPattern: '/[a-z-]+/\\d{4,}$' },
  { name: 'Mihaaru Business',   url: 'https://mihaaru.com/business', type: 'html', linkPattern: '/business/\\d{4,}$' },
  // News — JSON API (client-rendered SPA bridged via its own public API; {page} = paginatable for backfill)
  {
    name: 'Edition.mv', url: 'https://edge-api.edition.mv/api/edition/articles?page={page}', type: 'json',
    jsonItemsPath: 'data', jsonTitleField: 'headline', jsonExcerptField: 'summary',
    jsonLinkField: 'article_url', jsonDateField: 'datetime', linkBase: 'https://edition.mv',
  },
  // Raajje (client-rendered SPA, no scrapable HTML / keyed API → 401) — bridged via
  // an RSS.app feed built from its Business category (real headlines + /<id> links).
  { name: 'Raajje (Business)', url: 'https://rss.app/feeds/N1kOxUMRLTMmCXtx.xml', type: 'rss' },
  // Avas: also a client-rendered SPA with no public API. Add an RSS.app/RSSHub
  // bridge feed here as 'rss' when ready (point it at an Avas article-listing page).
];

// Seeded only if the brands collection is empty.
const FALLBACK_KEYWORDS = ['Sosun Fihaara'];

/**
 * Dhivehi (Thaana) spelling per brand → seeded as an ADDITIONAL keyword mapped
 * to the same brand, so Dhivehi-language articles are caught too. The matcher
 * is script-agnostic (NFC-normalized), so these match inside Thaana text.
 *
 * Only NON-EMPTY entries are seeded. Fill in the Thaana spelling for any brand
 * whose name appears in Dhivehi in the press. NOTE: many international product
 * brands are written in LATIN even in Dhivehi articles — those need no entry,
 * the Latin keyword already catches them. Do NOT use a bare common word like
 * ފިހާރަ ("shop") — always the full brand phrase.
 *
 * The map key must exactly match the brand NAME in the `brands` collection.
 */
const DHIVEHI_VARIANTS: Record<string, string> = {
  'Sosun Fihaara': 'ސޯސަން ފިހާރަ', // confirmed
  'Borges': 'ބޯޖެސް',
  'Bruggeman': 'ބްރުގްމަން',
  'Deli Sun': 'ޑެލި ސަން',
  'Good Knight': 'ގުޑް ނައިޓް',
  'Max Fly': 'މެކްސް ފްލައި',
  'Nawon': 'ނާވޮން',
  'Pascual': 'ޕެސްކުއަލް',
  'PastaZara': 'ޕާސްޓާ ޒާރާ',
  'Pillsbury': 'ޕިލްސްބަރީ',
  'Promina': 'ޕްރޮމިނާ',
  'Real Thai': 'ރިއަލް ތައި',
  'Remia': 'ރެމިއާ',
  'Shan': 'ޝާން',
  'Tai Sun': 'ޓައި ސަން',
  'Thai Sun': 'ތައި ސަން',
  'Youngs': 'ޔަންގްސް',
  'Zaara': 'ޒާރާ',
};

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function seedSources(): Promise<void> {
  const existing = await db.collection('newsSources').get();
  const existingUrls = new Set(existing.docs.map(d => d.data().url));

  let created = 0;
  for (const s of SOURCES) {
    if (existingUrls.has(s.url)) {
      console.log(`= source exists: ${s.name}`);
      continue;
    }
    const id = slugify(s.name) || slugify(s.url);
    const { name, url, type, linkPattern, jsonItemsPath, jsonTitleField,
            jsonExcerptField, jsonLinkField, jsonDateField, linkBase, useProxy } = s;
    await db.collection('newsSources').doc(id).set({
      id, name, url, type,
      ...(linkPattern ? { linkPattern } : {}),
      ...(jsonItemsPath ? { jsonItemsPath } : {}),
      ...(jsonTitleField ? { jsonTitleField } : {}),
      ...(jsonExcerptField ? { jsonExcerptField } : {}),
      ...(jsonLinkField ? { jsonLinkField } : {}),
      ...(jsonDateField ? { jsonDateField } : {}),
      ...(linkBase ? { linkBase } : {}),
      ...(useProxy ? { useProxy: true } : {}),
      enabled: true,
      createdAt: new Date().toISOString(),
      createdBy: 'seed-script',
    });
    console.log(`+ source created: newsSources/${id} (${s.name})`);
    created++;
  }
  console.log(`Sources: ${created} created, ${SOURCES.length - created} already existed.`);
}

async function seedKeywords(): Promise<void> {
  const brandsSnap = await db.collection('brands').get();
  const brandNames = brandsSnap.docs
    .map(d => d.data().name)
    .filter((n): n is string => typeof n === 'string' && !!n.trim())
    .map(n => n.trim());

  const pairs: { keyword: string; brand: string | null }[] = [];
  for (const name of brandNames) {
    pairs.push({ keyword: name, brand: name });           // Latin/native brand name
    const dv = DHIVEHI_VARIANTS[name]?.trim();
    if (dv) pairs.push({ keyword: dv, brand: name });      // Dhivehi spelling → same brand
  }

  if (pairs.length === 0) {
    for (const k of FALLBACK_KEYWORDS) {
      pairs.push({ keyword: k, brand: k });
      const dv = DHIVEHI_VARIANTS[k]?.trim();
      if (dv) pairs.push({ keyword: dv, brand: k });
    }
    console.log('No brands found — seeding fallback keyword(s).');
  }

  const existing = await db.collection('newsKeywords').get();
  const existingKw = new Set(existing.docs.map(d => String(d.data().keyword || '').toLowerCase()));

  let created = 0;
  for (const p of pairs) {
    if (existingKw.has(p.keyword.toLowerCase())) {
      console.log(`= keyword exists: ${p.keyword}`);
      continue;
    }
    const id = slugify(p.keyword) || `kw-${created}`;
    await db.collection('newsKeywords').doc(id).set({
      id,
      keyword: p.keyword,
      brand: p.brand,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    console.log(`+ keyword created: newsKeywords/${id} (${p.keyword} -> ${p.brand})`);
    created++;
    existingKw.add(p.keyword.toLowerCase());
  }
  console.log(`Keywords: ${created} created, ${pairs.length - created} already existed.`);
}

async function main() {
  await seedSources();
  await seedKeywords();
  console.log('News Sentinel seed complete.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
