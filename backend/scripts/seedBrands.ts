/**
 * One-time, idempotent brand promotion script.
 *
 * Collects every distinct brand name from:
 *   1. settings/general.brands (the legacy config list)
 *   2. campaigns.brand
 *   3. tasks.brand
 * and creates a `brands/{slug}` document for each name that doesn't already
 * have one. Existing brand docs are never overwritten. Legacy `brand` string
 * fields on campaigns/tasks are left untouched (the app filters by name).
 *
 * Run from backend/:  npx ts-node scripts/seedBrands.ts
 * Requires FIREBASE_SERVICE_ACCOUNT in .env or Application Default Credentials.
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';

const PALETTE = ['#7C6FF0', '#E2574C', '#2E9E6B', '#D98E04', '#1A66C2', '#C53070', '#0E8C8C', '#6B4FA1'];

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main() {
  const names = new Set<string>();

  // 1. Legacy config list
  const cfg = await db.collection('settings').doc('general').get();
  for (const b of (cfg.data()?.brands ?? []) as string[]) {
    if (b && b.trim()) names.add(b.trim());
  }

  // 2 + 3. Distinct strings in campaigns and tasks
  for (const coll of ['campaigns', 'tasks']) {
    const snap = await db.collection(coll).get();
    snap.forEach(d => {
      const b = d.data().brand;
      if (typeof b === 'string' && b.trim()) names.add(b.trim());
    });
  }

  console.log(`Found ${names.size} distinct brand names:`, [...names]);

  const existing = await db.collection('brands').get();
  const existingNames = new Set(existing.docs.map(d => d.data().name));

  let created = 0;
  let i = existing.size;
  for (const name of names) {
    if (existingNames.has(name)) {
      console.log(`= exists: ${name}`);
      continue;
    }
    const id = slugify(name);
    await db.collection('brands').doc(id).set({
      name,
      code: name.split(/\s+/).map(w => w[0]).join('').slice(0, 4).toUpperCase(),
      principal: '',
      countryOfOrigin: '',
      color: PALETTE[i % PALETTE.length],
      active: true,
      createdAt: new Date().toISOString(),
    });
    console.log(`+ created: brands/${id} (${name})`);
    created++;
    i++;
  }

  console.log(`Done. ${created} brand(s) created, ${names.size - created} already existed.`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
