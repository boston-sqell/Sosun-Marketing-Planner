import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflow, ApiError } from '../services/plannerApi';
import { PlannerViewTabs } from './Planner';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8',
  normal: '#64748b',
  high: '#f59e0b',
  urgent: '#ef4444',
};

export const PlannerBoard: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [workflows, setWorkflows] = useState<PlannerWorkflow[]>([]);
  const [activeWfId, setActiveWfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropBusy, setDropBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, wfs] = await Promise.all([plannerApi.listAll(), plannerApi.config.workflows()]);
      setItems(itemsRes.items);
      setWorkflows(wfs);
      // Default to the workflow with the most items (falls back to the first).
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activeWf = useMemo(() => workflows.find((w) => w.id === activeWfId) ?? null, [workflows, activeWfId]);

  const itemsByStatus = useMemo(() => {
    const map = new Map<string, PlannerWorkItem[]>();
    if (!activeWf) return map;
    for (const s of activeWf.statuses) map.set(s.id, []);
    for (const it of items) {
      if (it.workflowId !== activeWf.id) continue;
      (map.get(it.status) ?? map.set(it.status, []).get(it.status)!).push(it);
    }
    return map;
  }, [items, activeWf]);

  /** Drop = find a transition the actor may fire from the card's status to the
   *  target column's status, and fire it. Mirrors spec §5 (drag = transition). */
  const handleDrop = async (targetStatus: string) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const item = items.find((i) => i.id === id);
    if (!item || item.status === targetStatus) return;

    setDropBusy(true);
    setError(null);
    setNotice(null);
    try {
      const available = await plannerApi.transitions(id);
      const match = available.find((t) => t.to === targetStatus);
      if (!match) {
        const name = activeWf?.statuses.find((s) => s.id === targetStatus)?.name ?? targetStatus;
        setNotice(`No available move from "${item.title}" to ${name}.`);
        return;
      }
      await plannerApi.transition(id, match.id);
      await load();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.details?.length) {
        setNotice(`Can't move yet: ${apiErr.details.map((d) => d.message).join(' ')}`);
      } else {
        setError(err instanceof Error ? err.message : 'Move failed.');
      }
    } finally {
      setDropBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <PlannerViewTabs active="board" />
        {workflows.length > 1 && (
          <select
            value={activeWfId ?? ''}
            onChange={(e) => setActiveWfId(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 }}
          >
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {error && <Banner icon>{error}</Banner>}
      {notice && <Banner tone="warn">{notice}</Banner>}

      {loading ? (
        <LoadingSpinner message="Loading board…" />
      ) : !activeWf ? (
        <div className="section-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workflow configured. Run the planner seed script.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, opacity: dropBusy ? 0.7 : 1 }}>
          {activeWf.statuses.map((s) => {
            const colItems = itemsByStatus.get(s.id) ?? [];
            return (
              <div
                key={s.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(s.id)}
                style={{ flex: '0 0 260px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 10, minHeight: 120 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '2px 4px' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, display: 'inline-block' }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{colItems.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {colItems.map((it) => (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={() => setDraggingId(it.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => navigate(`/planner/${it.id}`)}
                      style={{
                        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12,
                        cursor: 'grab', boxShadow: 'var(--shadow-sm)', opacity: draggingId === it.id ? 0.5 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{it.title}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                        {(it.brandIds ?? []).length > 0 && <span>{it.brandIds!.join(', ')}</span>}
                        {it.dueDate && <span>Due {it.dueDate}</span>}
                        {it.priority && (
                          <span style={{ color: PRIORITY_COLORS[it.priority], fontWeight: 700, textTransform: 'capitalize' }}>{it.priority}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Banner: React.FC<{ children: React.ReactNode; icon?: boolean; tone?: 'error' | 'warn' }> = ({ children, tone = 'error' }) => {
  const styles = tone === 'warn'
    ? { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }
    : { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, borderRadius: 8, fontSize: 14, ...styles }}>
      <AlertCircle size={16} /> {children}
    </div>
  );
};
