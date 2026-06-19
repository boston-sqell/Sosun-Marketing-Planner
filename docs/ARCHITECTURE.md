# Sosun Marketing Planner — Architecture & Implementation Blueprint

> Anchored to the **existing** codebase: React 19 + Vite + TypeScript frontend, Firebase Auth/Firestore/Hosting, Express on Cloud Run (`backend/`), Google Drive DAM (`mediaAssets`). This document extends — it does not replace.

---

## 1. System Architecture & Database Schema

### Tech Stack Recommendation

Keep what exists; add only what the new modules demand.

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 19 + Vite + TS (existing) | Already built; Vite HMR is fast enough |
| Real-time data | Firestore `onSnapshot` listeners | Native push updates — packing statuses and distribution states sync live with zero infra |
| Backend | Express on Cloud Run (existing) + **Cloud Scheduler** | Scheduler triggers the monthly reporting engine via an authenticated route |
| Auth | Firebase Auth, custom claims `role: admin/internal/agency` (existing) | Already enforced in `firestore.rules` |
| Assets | Drive-backed `mediaAssets` index (existing) | Events and outlet distributions link to `mediaAssetId`, never duplicate bytes |
| Styling | Current CSS; Tailwind optional later | Don't restyle mid-build |
| State | React Context (brand scope) + Firestore listeners | No Redux needed; Firestore IS the global store |

**Architecture flow:**

```
React (Vite) ──onSnapshot──▶ Firestore ◀──Admin SDK── Express / Cloud Run
     │                          ▲                          ▲
     │ REST (ID token)          │                          │ HTTP (OIDC)
     └──────────────────────────┘                   Cloud Scheduler
                                                    (monthly reports)
Drive DAM ──metadata sync──▶ mediaAssets (read-only to clients)
```

### Entity-Relationship Schema (Firestore collections)

`→` denotes a document-ID reference ("foreign key").

```
brands/{brandId}
  name            string          // "Sosun Cola"
  code            string          // short slug "SCL" — used in report filenames
  principal       string          // international principal / supplier
  countryOfOrigin string
  color           string          // hex — calendar chips, dashboard accents
  logoAssetId     string? → mediaAssets
  defaultCurrency 'MVR' | 'USD'
  active          boolean
  createdAt       Timestamp

campaigns/{campaignId}            // EXISTING — migrate brand:string → brandId
  brandId         string → brands
  name, type, objective  string
  startDate, endDate     Timestamp
  status          'Planned'|'Active'|'Completed'|'Cancelled'
  platforms       string[]
  postsPlanned    number
  budgetPlanned   number
  budgetSpent     number          // denormalized rollup from budgetEntries
  notes           string

budgetEntries/{entryId}           // NEW — the spend ledger (single source of truth)
  brandId         string → brands
  campaignId      string? → campaigns
  eventId         string? → events
  category        'media'|'production'|'sponsorship'|'logistics'|'print'|'other'
  description     string
  amount          number
  currency        'MVR'|'USD'
  spentAt         Timestamp
  enteredByUid    string → users

events/{eventId}                  // NEW — trade shows, exhibitions, sponsorships
  name, venue, city      string
  type            'tradeshow'|'exhibition'|'sponsorship'|'activation'
  brandIds        string[] → brands     // multi-brand sponsorships
  startDate, endDate     Timestamp
  status          'Scoping'|'Confirmed'|'Preparing'|'Live'|'Wrapped'|'Reported'
  sponsorshipCost number
  expectedFootfall, leadsCaptured, salesAttributed  number
  ownerUid        string → users

  events/{eventId}/packingItems/{itemId}     // real-time packing board
    assetName     string
    mediaAssetId  string? → mediaAssets
    qty           number
    status        'requested'|'packed'|'shipped'|'on-site'|'returned'|'damaged'
    updatedByUid  string
    updatedAt     Timestamp

  events/{eventId}/logistics/{legId}
    kind          'shipment'|'booth'|'staffing'|'permit'
    description   string
    dueDate       Timestamp
    status        'pending'|'in-progress'|'done'
    cost          number

outlets/{outletId}                // NEW — retail locations
  name, code      string
  region, address string
  geo             GeoPoint
  tier            'A'|'B'|'C'
  contactName, contactPhone  string
  active          boolean

distributions/{distId}            // NEW — display assets at physical locations
  outletId        string → outlets
  brandId         string → brands
  assetName       string
  mediaAssetId    string? → mediaAssets   // artwork reference
  type            'shelf-strip'|'standee'|'poster'|'fridge'|'display-stand'
  qty             number
  status          'allocated'|'dispatched'|'installed'|'verified'|'removed'
  installedAt     Timestamp?
  verifiedByUid   string?
  photoAssetId    string? → mediaAssets   // installation proof photo
  updatedAt       Timestamp

reports/{reportId}                // NEW — generated monthly brand summaries
  brandId         string → brands
  period          string          // '2026-06'
  status          'generating'|'ready'|'failed'
  generatedAt     Timestamp
  payload         map             // slide-ready JSON (see §2.3)

users, tasks, mediaAssets, activities   // EXISTING — unchanged,
                                        // except tasks: add brandId → brands
```

**Why a `budgetEntries` ledger instead of editing `budget` fields:** every spend is one immutable row attributable to a brand and optionally a campaign or event. ROI, burn-rate, and variance all become aggregations — never reconciliations. `campaigns.budgetSpent` is a denormalized cache updated by the backend on write.

**Required composite indexes** (add to `firestore.indexes.json`):

```
campaigns:      brandId ASC, startDate ASC
tasks:          brandId ASC, scheduledDate ASC
events:         status ASC, startDate ASC
budgetEntries:  brandId ASC, spentAt DESC
distributions:  outletId ASC, status ASC
distributions:  brandId ASC, updatedAt DESC
```

**Security rules additions** (same role model as existing rules):

```
match /brands/{id}        { allow read: if isAuth(); allow write: if getRole() == 'admin'; }
match /budgetEntries/{id} { allow read: if isAuth();
                            allow create, update: if getRole() in ['admin','internal'];
                            allow delete: if getRole() == 'admin'; }
match /events/{id} {
  allow read: if isAuth();
  allow create, update: if getRole() in ['admin','internal'];
  allow delete: if getRole() == 'admin';
  match /packingItems/{p} { allow read: if isAuth();
                            allow write: if getRole() in ['admin','internal']; }
  match /logistics/{l}    { allow read: if isAuth();
                            allow write: if getRole() in ['admin','internal']; }
}
match /outlets/{id}       { allow read: if isAuth(); allow write: if getRole() in ['admin','internal']; }
match /distributions/{id} { allow read: if isAuth(); allow write: if getRole() in ['admin','internal']; }
match /reports/{id}       { allow read: if isAuth(); allow write: if false; } // backend-only
```

---

## 2. Core Feature Specifications & Code Blocks

### 2.1 The Multi-Brand Master Calendar

**Strategy:** one hook merges three live Firestore listeners (campaigns, tasks, events) into a unified `CalendarItem` stream, filtered by the global brand scope. Date-range bounding keeps reads cheap; brand colors come from the `brands` doc. Firestore `in` queries cap at 30 values — chunk if a portfolio ever exceeds that.

```ts
// frontend/src/hooks/useCalendarItems.ts
import { useEffect, useMemo, useState } from 'react';
import {
  collection, onSnapshot, query, where, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';

export type CalendarItemKind = 'campaign' | 'task' | 'event';

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  brandIds: string[];
  start: Date;
  end: Date;        // single-day items: end === start
  status: string;
}

const toDate = (v: unknown): Date | null => {
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === 'string' && v) return new Date(v);
  return null;
};

/** Live, brand-filtered union of campaigns, tasks and events for a window. */
export function useCalendarItems(
  brandIds: string[],        // [] = all brands
  windowStart: Date,
  windowEnd: Date,
) {
  const [campaigns, setCampaigns] = useState<CalendarItem[]>([]);
  const [tasks, setTasks] = useState<CalendarItem[]>([]);
  const [events, setEvents] = useState<CalendarItem[]>([]);

  useEffect(() => {
    const startTs = Timestamp.fromDate(windowStart);
    const endTs = Timestamp.fromDate(windowEnd);
    const unsubs: Array<() => void> = [];

    // Campaigns overlapping the window (startDate <= windowEnd; client trims tail)
    const cq = brandIds.length
      ? query(collection(db, 'campaigns'),
          where('brandId', 'in', brandIds.slice(0, 30)),
          where('startDate', '<=', endTs))
      : query(collection(db, 'campaigns'), where('startDate', '<=', endTs));

    unsubs.push(onSnapshot(cq, snap => {
      setCampaigns(snap.docs.flatMap(d => {
        const x = d.data();
        const start = toDate(x.startDate); const end = toDate(x.endDate);
        if (!start || !end || end < windowStart) return [];
        return [{ id: d.id, kind: 'campaign' as const, title: x.name,
                  brandIds: [x.brandId], start, end, status: x.status }];
      }));
    }));

    // Tasks scheduled inside the window
    const tq = brandIds.length
      ? query(collection(db, 'tasks'),
          where('brandId', 'in', brandIds.slice(0, 30)),
          where('scheduledDate', '>=', startTs),
          where('scheduledDate', '<=', endTs))
      : query(collection(db, 'tasks'),
          where('scheduledDate', '>=', startTs),
          where('scheduledDate', '<=', endTs));

    unsubs.push(onSnapshot(tq, snap => {
      setTasks(snap.docs.flatMap(d => {
        const x = d.data();
        const day = toDate(x.scheduledDate);
        if (!day) return [];
        return [{ id: d.id, kind: 'task' as const, title: x.title,
                  brandIds: [x.brandId], start: day, end: day, status: x.status }];
      }));
    }));

    // Events: array-contains-any cannot combine with 'in' — filter brands client-side
    const eq = query(collection(db, 'events'), where('startDate', '<=', endTs));
    unsubs.push(onSnapshot(eq, snap => {
      setEvents(snap.docs.flatMap(d => {
        const x = d.data();
        const start = toDate(x.startDate); const end = toDate(x.endDate);
        if (!start || !end || end < windowStart) return [];
        if (brandIds.length && !x.brandIds?.some((b: string) => brandIds.includes(b))) return [];
        return [{ id: d.id, kind: 'event' as const, title: x.name,
                  brandIds: x.brandIds ?? [], start, end, status: x.status }];
      }));
    }));

    return () => unsubs.forEach(u => u());
  }, [brandIds.join(','), windowStart.getTime(), windowEnd.getTime()]);

  /** Items grouped by yyyy-mm-dd for O(1) cell rendering. */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of [...campaigns, ...tasks, ...events]) {
      const cursor = new Date(Math.max(+item.start, +windowStart));
      const last = new Date(Math.min(+item.end, +windowEnd));
      for (; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
        const key = cursor.toISOString().slice(0, 10);
        (map.get(key) ?? map.set(key, []).get(key)!).push(item);
      }
    }
    return map;
  }, [campaigns, tasks, events]);

  return { byDay, all: [...campaigns, ...tasks, ...events] };
}
```

Wire into the existing `pages/CalendarView.tsx`: render a month grid, look up `byDay.get(dateKey)`, color each chip via the brand's `color`, and badge kind with an icon (lucide `Megaphone`/`CheckSquare`/`Tent`).

### 2.2 Event & Sponsorship Tracker

**Strategy:** the event doc is the header; `packingItems` is a real-time sub-board with a one-directional status pipeline (with `damaged` as an exception lane). Every status click is a direct Firestore write — all open devices (warehouse phone, venue laptop) converge in under a second via `onSnapshot`. ROI = attributed sales over total cost, where cost = sponsorship fee + logistics legs + ledger entries tagged with the `eventId`.

```ts
// frontend/src/features/events/packing.ts
export const PACKING_FLOW =
  ['requested', 'packed', 'shipped', 'on-site', 'returned'] as const;
export type PackingStatus = typeof PACKING_FLOW[number] | 'damaged';

export function nextStatus(s: PackingStatus): PackingStatus | null {
  const i = PACKING_FLOW.indexOf(s as typeof PACKING_FLOW[number]);
  return i >= 0 && i < PACKING_FLOW.length - 1 ? PACKING_FLOW[i + 1] : null;
}

export function eventROI(ev: {
  sponsorshipCost: number; salesAttributed: number;
}, logisticsCost: number, ledgerCost: number) {
  const totalCost = ev.sponsorshipCost + logisticsCost + ledgerCost;
  return {
    totalCost,
    roi: totalCost > 0 ? (ev.salesAttributed - totalCost) / totalCost : null,
  };
}
```

```tsx
// frontend/src/features/events/PackingBoard.tsx
import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { PACKING_FLOW, PackingStatus, nextStatus } from './packing';

interface PackingItem {
  id: string; assetName: string; qty: number; status: PackingStatus;
}

export default function PackingBoard({ eventId }: { eventId: string }) {
  const { profile } = useAuth();
  const [items, setItems] = useState<PackingItem[]>([]);

  useEffect(() =>
    onSnapshot(collection(db, 'events', eventId, 'packingItems'), snap =>
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as PackingItem)))),
    [eventId]);

  const advance = (item: PackingItem) => {
    const to = nextStatus(item.status);
    if (!to) return;
    // Fire-and-forget: onSnapshot reconciles every open client
    updateDoc(doc(db, 'events', eventId, 'packingItems', item.id), {
      status: to, updatedByUid: profile?.uid ?? null, updatedAt: serverTimestamp(),
    });
  };

  const lanes: PackingStatus[] = [...PACKING_FLOW, 'damaged'];
  return (
    <div className="packing-board" style={{ display: 'grid',
      gridTemplateColumns: `repeat(${lanes.length}, 1fr)`, gap: 12 }}>
      {lanes.map(lane => (
        <section key={lane}>
          <h4>{lane} ({items.filter(i => i.status === lane).length})</h4>
          {items.filter(i => i.status === lane).map(i => (
            <article key={i.id} className="packing-card">
              <strong>{i.assetName}</strong> ×{i.qty}
              {nextStatus(i.status) && (
                <button onClick={() => advance(i)}>→ {nextStatus(i.status)}</button>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
```

### 2.3 Automated Brand Reporting Engine

**Strategy:** Cloud Scheduler fires monthly (`0 6 1 * *`) at an OIDC-protected backend route. The route aggregates the ledger, campaigns, tasks, events, and distributions per brand for the closed month and writes a slide-ready JSON `payload` into `reports/`. Frontend renders it or exports it; the shape maps one-to-one onto deck sections.

```ts
// backend/src/services/reporting.ts
import { firestore } from 'firebase-admin';

const db = firestore();

export interface BrandMonthlyReport {
  brandId: string; brandName: string; period: string;     // '2026-06'
  spend: { total: number; byCategory: Record<string, number> };
  campaigns: { active: number; completed: number;
               budgetPlanned: number; budgetSpent: number };
  content: { published: number; overdue: number; byPlatform: Record<string, number> };
  events: Array<{ name: string; status: string; totalCost: number;
                  leads: number; salesAttributed: number; roi: number | null }>;
  retail: { outletsCovered: number; installed: number; verified: number };
}

export async function buildBrandReport(
  brandId: string, period: string,                         // 'YYYY-MM'
): Promise<BrandMonthlyReport> {
  const [y, m] = period.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));

  const brand = (await db.doc(`brands/${brandId}`).get()).data()!;

  // --- Spend ledger ---
  const ledger = await db.collection('budgetEntries')
    .where('brandId', '==', brandId)
    .where('spentAt', '>=', from).where('spentAt', '<', to).get();
  const byCategory: Record<string, number> = {};
  let total = 0;
  ledger.forEach(d => {
    const { category, amount } = d.data();
    byCategory[category] = (byCategory[category] ?? 0) + amount;
    total += amount;
  });

  // --- Campaigns touching the month ---
  const camps = await db.collection('campaigns')
    .where('brandId', '==', brandId).where('startDate', '<', to).get();
  const inMonth = camps.docs.map(d => d.data())
    .filter(c => c.endDate.toDate() >= from);

  // --- Content tasks published in the month ---
  const tasks = await db.collection('tasks')
    .where('brandId', '==', brandId)
    .where('scheduledDate', '>=', from).where('scheduledDate', '<', to).get();
  const byPlatform: Record<string, number> = {};
  let published = 0, overdue = 0;
  tasks.forEach(d => {
    const t = d.data();
    if (t.publishedDate || t.status === 'Published') {
      published++;
      (t.platforms ?? []).forEach((p: string) =>
        byPlatform[p] = (byPlatform[p] ?? 0) + 1);
    }
    if (t.overdue) overdue++;
  });

  // --- Events overlapping the month ---
  const evs = await db.collection('events')
    .where('brandIds', 'array-contains', brandId)
    .where('startDate', '<', to).get();
  const events = await Promise.all(evs.docs
    .filter(d => d.data().endDate.toDate() >= from)
    .map(async d => {
      const e = d.data();
      const legs = await d.ref.collection('logistics').get();
      const logisticsCost = legs.docs.reduce((s, l) => s + (l.data().cost ?? 0), 0);
      const eventLedger = await db.collection('budgetEntries')
        .where('eventId', '==', d.id).get();
      const ledgerCost = eventLedger.docs.reduce((s, l) => s + l.data().amount, 0);
      const totalCost = (e.sponsorshipCost ?? 0) + logisticsCost + ledgerCost;
      return {
        name: e.name, status: e.status, totalCost,
        leads: e.leadsCaptured ?? 0,
        salesAttributed: e.salesAttributed ?? 0,
        roi: totalCost > 0 ? (e.salesAttributed - totalCost) / totalCost : null,
      };
    }));

  // --- Retail distribution coverage ---
  const dists = await db.collection('distributions')
    .where('brandId', '==', brandId).get();
  const outletIds = new Set<string>();
  let installed = 0, verified = 0;
  dists.forEach(d => {
    const x = d.data();
    outletIds.add(x.outletId);
    if (x.status === 'installed') installed++;
    if (x.status === 'verified') verified++;
  });

  return {
    brandId, brandName: brand.name, period,
    spend: { total, byCategory },
    campaigns: {
      active: inMonth.filter(c => c.status === 'Active').length,
      completed: inMonth.filter(c => c.status === 'Completed').length,
      budgetPlanned: inMonth.reduce((s, c) => s + (c.budgetPlanned ?? 0), 0),
      budgetSpent: inMonth.reduce((s, c) => s + (c.budgetSpent ?? 0), 0),
    },
    content: { published, overdue, byPlatform },
    events,
    retail: { outletsCovered: outletIds.size, installed, verified },
  };
}
```

```ts
// backend/src/routes/reports.ts — wire into existing server.ts
import { Router } from 'express';
import { firestore } from 'firebase-admin';
import { buildBrandReport } from '../services/reporting';

export const reportsRouter = Router();

// POST /reports/run  — invoked by Cloud Scheduler (OIDC) or an admin user.
// Optional body: { period: '2026-05' }; defaults to the previous month.
reportsRouter.post('/run', async (req, res) => {
  const db = firestore();
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period: string = req.body?.period
    ?? `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

  const brands = await db.collection('brands').where('active', '==', true).get();
  const results = [];
  for (const b of brands.docs) {
    const ref = db.doc(`reports/${b.id}_${period}`);
    await ref.set({ brandId: b.id, period, status: 'generating',
                    generatedAt: firestore.FieldValue.serverTimestamp() });
    try {
      const payload = await buildBrandReport(b.id, period);
      await ref.set({ status: 'ready', payload }, { merge: true });
      results.push({ brandId: b.id, ok: true });
    } catch (err) {
      await ref.set({ status: 'failed', error: String(err) }, { merge: true });
      results.push({ brandId: b.id, ok: false });
    }
  }
  res.json({ period, results });
});
```

Scheduler setup (one-time):

```bash
gcloud scheduler jobs create http monthly-brand-reports \
  --schedule="0 6 1 * *" --time-zone="Indian/Maldives" \
  --uri="https://<cloud-run-url>/reports/run" --http-method=POST \
  --oidc-service-account-email=<scheduler-sa>@<project>.iam.gserviceaccount.com
```

---

## 3. UI/UX & Scannable Layout Blueprint

### The Executive Dashboard Layout

Extend the existing `pages/Dashboard.tsx` to a three-band grid, ruthless about hierarchy — numbers first, lists second, actions always visible:

```
┌──────────────────────────────────────────────────────────────┐
│ Brand scope pills: [All] [SCL] [SNF] [+]      [+ Quick add ▾]│
├──────────────┬──────────────┬──────────────┬─────────────────┤
│ Spend MTD    │ Active       │ Next event   │ Retail coverage │  ← Band 1: KPIs
│ vs budget %  │ campaigns    │ countdown +  │ installed/      │    (4 stat cards,
│ (sparkline)  │ + overdue ⚠  │ packing %    │ verified %      │     click → page)
├──────────────┴──────────────┼──────────────┴─────────────────┤
│ This week (calendar strip,  │ Event prep board               │  ← Band 2: work
│ 7-day slice of master cal)  │ (events in Preparing/Live,     │
│                             │  packing progress bars)        │
├─────────────────────────────┼────────────────────────────────┤
│ Latest reports (per brand,  │ Activity feed (existing        │  ← Band 3: output
│ status chip, View/Export)   │  activities collection)        │
└─────────────────────────────┴────────────────────────────────┘
```

Rules: KPI band answers "are we on track?" in <5 seconds; every card is a deep link; quick-action menu (new task / campaign / event / spend entry) reachable from anywhere; brand colors used as accents only, never as backgrounds for text.

### State & Filter Management

One global `BrandScopeContext` — the only true global UI state. Everything else is Firestore listeners keyed off it.

```tsx
// frontend/src/context/BrandScopeContext.tsx
import {
  createContext, useContext, useEffect, useMemo, useState, ReactNode,
} from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { db } from '../firebase/config';

export interface Brand { id: string; name: string; code: string; color: string; }

interface BrandScope {
  brands: Brand[];                 // full catalog (live)
  selected: string[];              // [] = all brands
  toggle: (id: string) => void;
  clear: () => void;
}

const Ctx = createContext<BrandScope | null>(null);

export function BrandScopeProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [params, setParams] = useSearchParams();
  const selected = useMemo(
    () => params.get('brands')?.split(',').filter(Boolean) ?? [], [params]);

  useEffect(() => onSnapshot(collection(db, 'brands'), snap =>
    setBrands(snap.docs.map(d => ({ id: d.id, ...d.data() } as Brand)))), []);

  const set = (ids: string[]) => setParams(prev => {
    const p = new URLSearchParams(prev);
    ids.length ? p.set('brands', ids.join(',')) : p.delete('brands');
    return p;
  }, { replace: true });

  const value = useMemo<BrandScope>(() => ({
    brands, selected,
    toggle: id => set(selected.includes(id)
      ? selected.filter(x => x !== id) : [...selected, id]),
    clear: () => set([]),
  }), [brands, selected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useBrandScope = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBrandScope outside provider');
  return v;
};
```

Why this shape: the selection lives in the **URL** (`?brands=scl,snf`), so portfolio views are shareable, survive refresh, and the back button works; switching brands re-parameterizes the existing `onSnapshot` queries — Firestore's local cache makes the swap feel instant, no page reloads, no manual cache layer to babysit.

---

## 4. Quick-Start Development Roadmap (7 Days)

Much of the fortress already stands (auth, roles, tasks, campaigns, calendar shell, DAM). This roadmap is an extension plan, not a rebuild.

**Day 1 — Brands become first-class.**
Create `brands` collection + admin CRUD page. One-time migration script (Admin SDK): scan `campaigns` and `tasks`, map each distinct `brand` string to a new brand doc, write `brandId` back (keep the old string field until Day 7). Add `BrandScopeProvider` to `App.tsx`, brand pills in `Header.tsx`. Deploy updated `firestore.rules` + indexes.

**Day 2 — Master calendar.**
Implement `useCalendarItems` and rebuild `CalendarView.tsx` as the merged month grid with brand colors and kind icons. Verify real-time: edit a task in a second browser tab, watch the chip move.

**Day 3 — Events module.**
`events` collection, list + detail pages, status pipeline header, `PackingBoard` with live lanes, logistics checklist with due dates and costs.

**Day 4 — Outlets & distributions.**
`outlets` CRUD (CSV import via the existing backend for the initial list), `distributions` tracker with status flow allocated → dispatched → installed → verified, link installation photos to `mediaAssets`. Region/tier coverage summary.

**Day 5 — Budget ledger.**
`budgetEntries` entry form (attachable to campaign or event), backend write hook that rolls up `campaigns.budgetSpent`, spend-vs-planned bars on campaign and event pages.

**Day 6 — Reporting engine.**
`reporting.ts` + `/reports/run` route, deploy to Cloud Run, create the Scheduler job, build the Reports page rendering `payload` (KPI tiles + per-section tables) with a "Regenerate" admin button and JSON export.

**Day 7 — Executive dashboard + hardening.**
Assemble the three-band dashboard from the pieces above. End-to-end test as each role (admin/internal/agency — agency should see nothing of budgets: add a rules check). Remove legacy `brand` string reads. Backfill one historical month's report. Deploy hosting + rules + indexes.

---

*The grand design is complete. Execute it in order; each day's output is independently shippable.*
