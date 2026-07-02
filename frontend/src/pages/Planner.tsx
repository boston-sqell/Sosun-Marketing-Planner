import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Megaphone, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi, buildStatusIndex, prettyStatus } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflowStatus } from '../services/plannerApi';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8',
  normal: '#64748b',
  high: '#f59e0b',
  urgent: '#ef4444',
};

/** Renders a status pill using the workflow-defined name/color when known,
 *  falling back to a prettified id + neutral colour. */
export const StatusBadge: React.FC<{ status: string; meta?: PlannerWorkflowStatus }> = ({ status, meta }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: 700,
      color: '#fff',
      background: meta?.color || '#64748b',
      whiteSpace: 'nowrap',
    }}
  >
    {meta?.name || prettyStatus(status)}
  </span>
);

/** List / Board view toggle, shared by both planner views. */
export const PlannerViewTabs: React.FC<{ active: 'list' | 'board' }> = ({ active }) => {
  const navigate = useNavigate();
  const tab = (key: 'list' | 'board', label: string, path: string) => (
    <button
      onClick={() => navigate(path)}
      style={{
        border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        background: active === key ? 'var(--card)' : 'transparent',
        color: active === key ? 'var(--text)' : 'var(--text-muted)',
        boxShadow: active === key ? 'var(--shadow-sm)' : 'none',
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg)', padding: 4, borderRadius: 10, border: '1px solid var(--border)' }}>
      {tab('list', 'List', '/planner')}
      {tab('board', 'Board', '/planner/board')}
    </div>
  );
};

export const Planner: React.FC = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const canCreate = role === 'admin' || role === 'internal';

  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [statusIndex, setStatusIndex] = useState<Map<string, Map<string, PlannerWorkflowStatus>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, workflows] = await Promise.all([plannerApi.listAll(), plannerApi.config.workflows()]);
      setItems(itemsRes.items);
      setStatusIndex(buildStatusIndex(workflows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const item = await plannerApi.create({ typeId: 'campaign', title, spaceId: 'marketing' });
      setNewTitle('');
      navigate(`/planner/${item.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create work item.');
    } finally {
      setCreating(false);
    }
  };

  const statusMeta = (item: PlannerWorkItem) => statusIndex.get(item.workflowId)?.get(item.status);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <PlannerViewTabs active="list" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Work Items</h3>
        {canCreate && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="New campaign title…"
              style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, minWidth: 220 }}
            />
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newTitle.trim()}>
              <Plus size={16} /><span>{creating ? 'Creating…' : 'New campaign'}</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 14 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading work items…" />
      ) : items.length === 0 ? (
        <div className="section-card" style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Megaphone size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
          <p style={{ margin: 0 }}>No work items yet.{canCreate ? ' Create your first campaign above.' : ''}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.id}
              className="section-card"
              onClick={() => navigate(`/planner/${item.id}`)}
              style={{ padding: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                  {(item.brandIds ?? []).length > 0 && <span>{item.brandIds!.join(', ')}</span>}
                  {item.dueDate && <span>Due {item.dueDate}</span>}
                  {item.priority && (
                    <span style={{ color: PRIORITY_COLORS[item.priority], fontWeight: 700, textTransform: 'capitalize' }}>
                      {item.priority}
                    </span>
                  )}
                </div>
              </div>
              <StatusBadge status={item.status} meta={statusMeta(item)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
