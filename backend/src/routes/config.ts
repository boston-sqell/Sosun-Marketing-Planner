import { Router } from 'express';
import { db } from '../services/firestore';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { ensureSheet, writeAllRows } from '../services/sheets';

const router = Router();
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1P8d6WWEmSNLLkdu8kMzPQuBq_nbboVaHIP7-JUYwNpg';
const CONFIG_DOC = db.collection('settings').doc('general');

const DEFAULT_BRANDS = ['Sosun Fihaara', 'Sosun Cook', 'Sosun Book'];
const DEFAULT_PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'WhatsApp Status'];

// All config routes require an authenticated user.
router.use(requireAuth);

/** Trims, drops empties, and de-duplicates a string list (preserving order). */
function cleanList(arr: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const s = String(v).trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

async function readConfig(): Promise<{ brands: string[]; platforms: string[] }> {
  const snap = await CONFIG_DOC.get();
  const data = snap.exists ? snap.data()! : {};
  return {
    brands: Array.isArray(data.brands) ? data.brands : DEFAULT_BRANDS,
    platforms: Array.isArray(data.platforms) ? data.platforms : DEFAULT_PLATFORMS,
  };
}

/** Best-effort mirror of brands/platforms to a CONFIG tab in the spreadsheet.
 *  Returns an error string if the sheet write failed (Firestore is authoritative). */
async function syncConfigToSheet(brands: string[], platforms: string[]): Promise<string | null> {
  try {
    await ensureSheet(SPREADSHEET_ID, 'CONFIG');
    const max = Math.max(brands.length, platforms.length);
    const rows: string[][] = [];
    for (let i = 0; i < max; i++) rows.push([brands[i] || '', platforms[i] || '']);
    await writeAllRows(SPREADSHEET_ID, 'CONFIG!A1:B', ['Brands', 'Platforms'], rows);
    return null;
  } catch (e: any) {
    console.error('Config sheet sync failed:', e.message);
    return e.message || 'Sheet sync failed';
  }
}

// GET current config (any authenticated user).
router.get('/', async (_req, res, next) => {
  try {
    res.json({ success: true, config: await readConfig() });
  } catch (e) {
    next(e);
  }
});

// Update brands/platforms (admin only) → Firestore (authoritative) + best-effort Sheet.
router.put('/', requireRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const { brands, platforms } = req.body || {};
    const current = await readConfig();
    const updated = {
      brands: Array.isArray(brands) ? cleanList(brands) : current.brands,
      platforms: Array.isArray(platforms) ? cleanList(platforms) : current.platforms,
    };
    await CONFIG_DOC.set(updated, { merge: true });
    const sheetError = await syncConfigToSheet(updated.brands, updated.platforms);
    res.json({ success: true, config: updated, sheetSynced: !sheetError, sheetError });
  } catch (e) {
    next(e);
  }
});

export default router;
