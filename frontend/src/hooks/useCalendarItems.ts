import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { parseDate } from '../utils/dateUtils';
import { useBrandScope } from '../context/BrandScopeContext';
import type { CampaignData, EventData, TaskData } from '../types';

export type CalendarItemKind = 'campaign' | 'task' | 'event';

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  brands: string[];        // brand names
  start: Date;
  end: Date;               // single-day items: end === start
  status: string;
  raw: TaskData | CampaignData | EventData;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Live, brand-scoped union of campaigns, tasks and events.
 *
 * Subscribes to the three collections via onSnapshot (datasets are
 * team-scale; client-side filtering avoids composite-index churn and the
 * legacy string-date formats parse uniformly through parseDate). Items are
 * filtered to the [windowStart, windowEnd] range and the active brand scope,
 * then grouped per-day for O(1) cell rendering.
 */
export function useCalendarItems(windowStart: Date, windowEnd: Date) {
  const { anyInScope } = useBrandScope();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let pending = 3;
    const done = () => { if (--pending <= 0) setLoading(false); };

    const unsubs = [
      onSnapshot(collection(db, 'tasks'), snap => {
        setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as TaskData)));
        done();
      }),
      onSnapshot(collection(db, 'campaigns'), snap => {
        setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CampaignData)));
        done();
      }),
      onSnapshot(collection(db, 'events'), snap => {
        setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventData)));
        done();
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const items = useMemo<CalendarItem[]>(() => {
    const out: CalendarItem[] = [];

    for (const t of tasks) {
      const day = parseDate(t.scheduledDate);
      if (!day || day < windowStart || day > windowEnd) continue;
      if (!anyInScope([t.brand])) continue;
      out.push({
        id: t.id, kind: 'task', title: t.title, brands: [t.brand],
        start: day, end: day, status: t.status || 'Idea', raw: t,
      });
    }

    for (const c of campaigns) {
      const start = parseDate(c.startDate);
      const end = parseDate(c.endDate) || start;
      if (!start || !end || end < windowStart || start > windowEnd) continue;
      if (!anyInScope([c.brand])) continue;
      out.push({
        id: c.id, kind: 'campaign', title: c.name, brands: [c.brand],
        start, end, status: c.status || 'Planned', raw: c,
      });
    }

    for (const e of events) {
      const start = parseDate(e.startDate);
      const end = parseDate(e.endDate) || start;
      if (!start || !end || end < windowStart || start > windowEnd) continue;
      if (!anyInScope(e.brands)) continue;
      out.push({
        id: e.id, kind: 'event', title: e.name, brands: e.brands || [],
        start, end, status: e.status || 'Scoping', raw: e,
      });
    }

    return out;
  }, [tasks, campaigns, events, anyInScope, windowStart.getTime(), windowEnd.getTime()]);

  /** Items grouped by local yyyy-mm-dd key for O(1) cell lookups. */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const cursor = new Date(Math.max(+item.start, +windowStart));
      cursor.setHours(0, 0, 0, 0);
      const last = new Date(Math.min(+item.end, +windowEnd));
      for (; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
        const key = dayKey(cursor);
        const arr = map.get(key);
        if (arr) arr.push(item); else map.set(key, [item]);
      }
    }
    return map;
  }, [items, windowStart.getTime(), windowEnd.getTime()]);

  return { items, byDay, loading, dayKey };
}
