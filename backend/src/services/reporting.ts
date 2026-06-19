import { db } from './firestore';

/**
 * Monthly brand reporting engine.
 *
 * Aggregates the spend ledger, campaigns, content tasks, events and retail
 * distributions for one brand and one closed month into a slide-ready JSON
 * payload, persisted to reports/{slug}_{period}.
 *
 * Date convention: the app stores dates as 'YYYY-MM-DD' strings, so range
 * checks are plain lexicographic comparisons.
 */

export interface BrandMonthlyReport {
  brand: string;
  period: string; // 'YYYY-MM'
  spend: { total: number; byCategory: Record<string, number> };
  campaigns: { active: number; completed: number; budgetPlanned: number; budgetSpent: number };
  content: { published: number; overdue: number; byPlatform: Record<string, number> };
  events: Array<{
    name: string; status: string; totalCost: number;
    leads: number; salesAttributed: number; roi: number | null;
  }>;
  retail: { outletsCovered: number; installed: number; verified: number };
  /** Present on combined all-brands reports. */
  brandBreakdown?: Array<{ brand: string; spend: number; published: number; activeCampaigns: number }>;
}

/** Normalizes DD/MM/YYYY or YYYY-MM-DD to YYYY-MM-DD (empty if unparseable). */
function isoDate(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const parts = v.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return v.slice(0, 10);
}

export async function buildBrandReport(brandName: string, period: string): Promise<BrandMonthlyReport> {
  const from = `${period}-01`;
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  // --- Spend ledger ---
  const ledger = await db.collection('budgetEntries')
    .where('brand', '==', brandName).get();
  const byCategory: Record<string, number> = {};
  let total = 0;
  ledger.forEach(d => {
    const e = d.data();
    const date = isoDate(e.spentAt);
    if (date < from || date >= next) return;
    byCategory[e.category || 'other'] = (byCategory[e.category || 'other'] ?? 0) + (e.amount || 0);
    total += e.amount || 0;
  });

  // --- Campaigns overlapping the month ---
  const campsSnap = await db.collection('campaigns')
    .where('brand', '==', brandName).get();
  const camps = campsSnap.docs.map(d => d.data())
    .filter(c => {
      const start = isoDate(c.startDate);
      const end = isoDate(c.endDate) || start;
      return start && start < next && end >= from;
    });

  // --- Content tasks scheduled in the month ---
  const tasksSnap = await db.collection('tasks')
    .where('brand', '==', brandName).get();
  const byPlatform: Record<string, number> = {};
  let published = 0;
  let overdue = 0;
  tasksSnap.forEach(d => {
    const t = d.data();
    const date = isoDate(t.scheduledDate);
    if (!date || date < from || date >= next) return;
    if (t.publishedDate || t.status === 'Published') {
      published++;
      for (const p of (t.platforms || []) as string[]) {
        byPlatform[p] = (byPlatform[p] ?? 0) + 1;
      }
    }
    if (t.overdue) overdue++;
  });

  // --- Events overlapping the month ---
  const evsSnap = await db.collection('events')
    .where('brands', 'array-contains', brandName).get();
  const events: BrandMonthlyReport['events'] = [];
  for (const d of evsSnap.docs) {
    const e = d.data();
    const start = isoDate(e.startDate);
    const end = isoDate(e.endDate) || start;
    if (!start || start >= next || end < from) continue;

    const legs = await d.ref.collection('logistics').get();
    const logisticsCost = legs.docs.reduce((s, l) => s + (l.data().cost || 0), 0);
    const eventLedger = await db.collection('budgetEntries')
      .where('eventId', '==', d.id).get();
    const ledgerCost = eventLedger.docs.reduce((s, l) => s + (l.data().amount || 0), 0);
    const totalCost = (e.sponsorshipCost || 0) + logisticsCost + ledgerCost;
    const sales = e.salesAttributed || 0;

    events.push({
      name: e.name,
      status: e.status,
      totalCost,
      leads: e.leadsCaptured || 0,
      salesAttributed: sales,
      roi: totalCost > 0 ? (sales - totalCost) / totalCost : null,
    });
  }

  // --- Retail distribution coverage (current state) ---
  const distsSnap = await db.collection('distributions')
    .where('brand', '==', brandName).get();
  const outletIds = new Set<string>();
  let installed = 0;
  let verified = 0;
  distsSnap.forEach(d => {
    const x = d.data();
    if (x.status === 'installed' || x.status === 'verified') outletIds.add(x.outletId);
    if (x.status === 'installed') installed++;
    if (x.status === 'verified') verified++;
  });

  return {
    brand: brandName,
    period,
    spend: { total, byCategory },
    campaigns: {
      active: camps.filter(c => c.status === 'Active').length,
      completed: camps.filter(c => c.status === 'Completed').length,
      budgetPlanned: camps.reduce((s, c) => s + (c.budgetPlanned ?? c.budget ?? 0), 0),
      budgetSpent: camps.reduce((s, c) => s + (c.budgetSpent ?? 0), 0),
    },
    content: { published, overdue, byPlatform },
    events,
    retail: { outletsCovered: outletIds.size, installed, verified },
  };
}

/** Merges per-brand reports into one portfolio-wide report. */
export async function buildCombinedReport(brandNames: string[], period: string): Promise<BrandMonthlyReport> {
  const parts: BrandMonthlyReport[] = [];
  for (const b of brandNames) {
    parts.push(await buildBrandReport(b, period));
  }

  const merged: BrandMonthlyReport = {
    brand: 'All Brands',
    period,
    spend: { total: 0, byCategory: {} },
    campaigns: { active: 0, completed: 0, budgetPlanned: 0, budgetSpent: 0 },
    content: { published: 0, overdue: 0, byPlatform: {} },
    events: [],
    retail: { outletsCovered: 0, installed: 0, verified: 0 },
    brandBreakdown: [],
  };

  const seenEvents = new Set<string>();
  for (const p of parts) {
    merged.spend.total += p.spend.total;
    for (const [k, v] of Object.entries(p.spend.byCategory)) {
      merged.spend.byCategory[k] = (merged.spend.byCategory[k] ?? 0) + v;
    }
    merged.campaigns.active += p.campaigns.active;
    merged.campaigns.completed += p.campaigns.completed;
    merged.campaigns.budgetPlanned += p.campaigns.budgetPlanned;
    merged.campaigns.budgetSpent += p.campaigns.budgetSpent;
    merged.content.published += p.content.published;
    merged.content.overdue += p.content.overdue;
    for (const [k, v] of Object.entries(p.content.byPlatform)) {
      merged.content.byPlatform[k] = (merged.content.byPlatform[k] ?? 0) + v;
    }
    // Multi-brand events appear in several per-brand reports — count once.
    for (const e of p.events) {
      if (!seenEvents.has(e.name)) {
        seenEvents.add(e.name);
        merged.events.push(e);
      }
    }
    merged.retail.outletsCovered += p.retail.outletsCovered;
    merged.retail.installed += p.retail.installed;
    merged.retail.verified += p.retail.verified;
    merged.brandBreakdown!.push({
      brand: p.brand,
      spend: p.spend.total,
      published: p.content.published,
      activeCampaigns: p.campaigns.active,
    });
  }
  return merged;
}

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * Generates and persists reports.
 * - combined: one merged all-brands report (reports/all-brands_{period})
 * - brands:   per-brand reports for the given names only
 * - neither:  per-brand reports for every active brand (scheduler default)
 */
export async function runMonthlyReports(
  period: string,
  opts: { brands?: string[]; combined?: boolean } = {},
) {
  const brandsSnap = await db.collection('brands').where('active', '==', true).get();
  const allNames = brandsSnap.docs.map(d => d.data().name as string);
  const results: Array<{ brand: string; ok: boolean; error?: string }> = [];

  if (opts.combined) {
    const ref = db.collection('reports').doc(`all-brands_${period}`);
    await ref.set({
      brand: 'All Brands',
      period,
      status: 'generating',
      generatedAt: new Date().toISOString(),
    });
    try {
      const payload = await buildCombinedReport(allNames, period);
      await ref.set({ status: 'ready', payload }, { merge: true });
      results.push({ brand: 'All Brands', ok: true });
    } catch (err: any) {
      await ref.set({ status: 'failed', error: String(err?.message || err) }, { merge: true });
      results.push({ brand: 'All Brands', ok: false, error: String(err?.message || err) });
    }
    return results;
  }

  const targets = opts.brands?.length
    ? allNames.filter(n => opts.brands!.includes(n))
    : allNames;

  for (const brandName of targets) {
    const ref = db.collection('reports').doc(`${slugify(brandName)}_${period}`);
    await ref.set({
      brand: brandName,
      period,
      status: 'generating',
      generatedAt: new Date().toISOString(),
    });
    try {
      const payload = await buildBrandReport(brandName, period);
      await ref.set({ status: 'ready', payload }, { merge: true });
      results.push({ brand: brandName, ok: true });
    } catch (err: any) {
      await ref.set({ status: 'failed', error: String(err?.message || err) }, { merge: true });
      results.push({ brand: brandName, ok: false, error: String(err?.message || err) });
    }
  }
  return results;
}
