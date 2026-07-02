import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Megaphone, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type { PlannerWorkItem } from '../services/plannerApi';

/** Turn a status/label id ("in_progress") into a display label ("In Progress"). */
export const prettyStatus = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Seed Campaign-workflow status colors (display only; canonical colors live on
 *  the workflow config, surfaced in the Phase 5 settings panel). */
const STATUS_COLORS: Record<string, string> = {
  created: '#8b8b8b',
  planning: '#3b82f6',
  approval: '#f59e0b',
  approved: '#10b981',
  inprogress: '#6366f1',
  review: '#ec4899',
  scheduled: '#14b8a6',
  completed: '#22c55e',
  archived: '#525252',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8',
  normal: '#64748b',
  high: '#f59e0b',
  urgent: '#ef4444',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const color = STATUS_COLORS[status] || 'var(--text-muted)';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 700,
        color: '#fff',
        background: color,
        whiteSpace: 'nowrap',
      }}
    >
      {prettyStatus(status)}
    </span>
  );
};

export const Planner: React.FC = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const canCreate = role === 'admin' || role === 'internal';

  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await plannerApi.listAll();
      setItems(res.items);
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

  return (
    <div>
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
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
