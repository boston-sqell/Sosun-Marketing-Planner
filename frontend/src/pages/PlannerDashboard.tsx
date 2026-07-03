import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ClipboardList, Circle, Loader2, CheckCircle2 } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflow, PlannerWorkflowStatus } from '../services/plannerApi';
import { PlannerViewTabs } from '../components/PlannerViewTabs';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mockUsers } from '../mockData';
import type { UserItem } from '../types';
import { useAuth } from '../context/AuthContext';

const CATEGORY_COLOR: Record<string, string> = {
  todo: '#94a3b8',
  in_progress: '#f59e0b',
  done: '#10b981',
};

// ── KPI counter card ─────────────────────────────────────────────────────────
const KpiCard: React.FC<{ label: string; count: number; icon: React.ReactNode; color: string }> = ({
  label,
  count,
  icon,
  color,
}) => (
  <div
    className="section-card"
    style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 160px', minWidth: 160 }}
  >
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${color}1a`,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  </div>
);

// ── Status-breakdown donut (SVG, no chart lib — same circumference≈100 trick
//    Workload's completion ring already uses, extended to 3 stacked segments) ──
const StatusDonut: React.FC<{ todo: number; inProgress: number; done: number }> = ({ todo, inProgress, done }) => {
  const total = todo + inProgress + done;
  const r = 15.9155;
  const todoPct = total > 0 ? (todo / total) * 100 : 0;
  const progPct = total > 0 ? (inProgress / total) * 100 : 0;
  const donePct = total > 0 ? (done / total) * 100 : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <svg width="150" height="150" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--border)" strokeWidth="3.5" />
        {total > 0 && (
          <>
            <circle
              cx="18" cy="18" r={r} fill="none"
              stroke={CATEGORY_COLOR.todo} strokeWidth="3.5"
              strokeDasharray={`${todoPct} ${100 - todoPct}`}
              strokeDashoffset="25"
              style={{ transition: 'stroke-dasharray 0.3s ease' }}
            />
            <circle
              cx="18" cy="18" r={r} fill="none"
              stroke={CATEGORY_COLOR.in_progress} strokeWidth="3.5"
              strokeDasharray={`${progPct} ${100 - progPct}`}
              strokeDashoffset={25 - todoPct}
              style={{ transition: 'stroke-dasharray 0.3s ease' }}
            />
            <circle
              cx="18" cy="18" r={r} fill="none"
              stroke={CATEGORY_COLOR.done} strokeWidth="3.5"
              strokeDasharray={`${donePct} ${100 - donePct}`}
              strokeDashoffset={25 - todoPct - progPct}
              style={{ transition: 'stroke-dasharray 0.3s ease' }}
            />
          </>
        )}
        <text x="18" y="17.5" textAnchor="middle" style={{ fontSize: 7, fontWeight: 800, fill: 'var(--text)' }}>
          {total}
        </text>
        <text x="18" y="23" textAnchor="middle" style={{ fontSize: 3, fill: 'var(--text-muted)' }}>
          items
        </text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { label: 'To Do', count: todo, color: CATEGORY_COLOR.todo },
          { label: 'In Progress', count: inProgress, color: CATEGORY_COLOR.in_progress },
          { label: 'Done', count: done, color: CATEGORY_COLOR.done },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: row.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text)', fontWeight: 600, minWidth: 90 }}>{row.label}</span>
            <span style={{ color: 'var(--text-muted)' }}>
              {row.count} {total > 0 ? `(${Math.round((row.count / total) * 100)}%)` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── By-assignee bar chart (horizontal bars, no chart lib) ───────────────────
const AssigneeBarChart: React.FC<{ data: { uid: string; name: string; count: number }[] }> = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.count));

  if (data.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>No assigned items yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => (
        <div key={d.uid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 120,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 0,
            }}
            title={d.name}
          >
            {d.name}
          </div>
          <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 6, height: 16, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(d.count / max) * 100}%`,
                background: 'var(--primary)',
                height: '100%',
                borderRadius: 6,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ width: 22, textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            {d.count}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Dashboard page ────────────────────────────────────────────────────────────
export const PlannerDashboard: React.FC = () => {
  const { role } = useAuth();

  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [workflows, setWorkflows] = useState<PlannerWorkflow[]>([]);
  const [activeWfId, setActiveWfId] = useState<string | null>(null);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gate access to staff only — same rule as the Workload dashboard.
  const isStaff = role === 'admin' || role === 'internal';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, wfs, usersSnap] = await Promise.all([
        plannerApi.listAll(),
        plannerApi.config.workflows(),
        getDocs(collection(db, 'users')).catch(() => null),
      ]);
      setItems(itemsRes.items);
      setWorkflows(wfs);

      setActiveWfId((prev) => {
        if (prev && wfs.some((w) => w.id === prev)) return prev;
        const counts = new Map<string, number>();
        for (const it of itemsRes.items) counts.set(it.workflowId, (counts.get(it.workflowId) ?? 0) + 1);
        let best = wfs[0]?.id ?? null;
        let bestN = -1;
        for (const w of wfs) {
          const n = counts.get(w.id) ?? 0;
          if (n > bestN) { best = w.id; bestN = n; }
        }
        return best;
      });

      if (usersSnap) {
        const list = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserItem));
        setUsersList(list.length ? list : mockUsers);
      } else {
        setUsersList(mockUsers);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isStaff) load();
  }, [isStaff]);

  const activeWf = useMemo(() => workflows.find((w) => w.id === activeWfId) ?? null, [workflows, activeWfId]);

  const statusMetaMap = useMemo(() => {
    const map = new Map<string, PlannerWorkflowStatus>();
    if (activeWf) for (const s of activeWf.statuses) map.set(s.id, s);
    return map;
  }, [activeWf]);

  const activeItems = useMemo(
    () => items.filter((it) => it.workflowId === activeWfId),
    [items, activeWfId],
  );

  // Same listAll() fetch as every other planner view + client-side grouping —
  // no new Firestore queries (spec's Firestore-economics rule).
  const { todoCount, progressCount, doneCount } = useMemo(() => {
    let todo = 0, prog = 0, done = 0;
    for (const it of activeItems) {
      const cat = statusMetaMap.get(it.status)?.category || 'todo';
      if (cat === 'done') done++;
      else if (cat === 'in_progress') prog++;
      else todo++;
    }
    return { todoCount: todo, progressCount: prog, doneCount: done };
  }, [activeItems, statusMetaMap]);

  const assigneeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const it of activeItems) {
      const uids = it.assigneeUids ?? [];
      if (uids.length === 0) {
        unassigned++;
        continue;
      }
      for (const uid of uids) counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    const rows = Array.from(counts.entries()).map(([uid, count]) => {
      const user = usersList.find((u) => u.uid === uid);
      return { uid, name: user?.displayName || 'Unknown', count };
    });
    if (unassigned > 0) rows.push({ uid: 'unassigned', name: 'Unassigned', count: unassigned });
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [activeItems, usersList]);

  if (!isStaff) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c' }}>
          <AlertCircle size={20} />
          <span>Forbidden: You must be a staff member (admin or internal) to access the dashboard.</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <PlannerViewTabs />
        {workflows.length > 1 && (
          <select
            value={activeWfId ?? ''}
            onChange={(e) => setActiveWfId(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, background: 'var(--card)', color: 'var(--text)' }}
          >
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 14 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading dashboard…" />
      ) : !activeWf ? (
        <div className="section-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workflow configured. Run the planner seed script.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* KPI counters */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <KpiCard label="Total items" count={activeItems.length} icon={<ClipboardList size={20} />} color="#6366f1" />
            <KpiCard label="To Do" count={todoCount} icon={<Circle size={20} />} color={CATEGORY_COLOR.todo} />
            <KpiCard label="In Progress" count={progressCount} icon={<Loader2 size={20} />} color={CATEGORY_COLOR.in_progress} />
            <KpiCard label="Done" count={doneCount} icon={<CheckCircle2 size={20} />} color={CATEGORY_COLOR.done} />
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {/* Status breakdown donut */}
            <div className="section-card" style={{ padding: 20, flex: '1 1 380px', minWidth: 320 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 16px' }}>Tasks by status</h3>
              <StatusDonut todo={todoCount} inProgress={progressCount} done={doneCount} />
            </div>

            {/* By-assignee bar chart */}
            <div className="section-card" style={{ padding: 20, flex: '1 1 380px', minWidth: 320 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 16px' }}>Tasks by assignee</h3>
              <AssigneeBarChart data={assigneeBreakdown} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
