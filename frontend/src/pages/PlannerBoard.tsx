import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, CheckSquare } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflow, ApiError, PlannerWorkflowStatus } from '../services/plannerApi';
import { PlannerViewTabs } from '../components/PlannerViewTabs';
import { PlannerFilters } from '../components/PlannerFilters';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mockUsers } from '../mockData';
import type { UserItem } from '../types';
import { useDraggable, useDroppable, DndContext, useSensors, useSensor, PointerSensor } from '@dnd-kit/core';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8',
  normal: '#64748b',
  high: '#f59e0b',
  urgent: '#ef4444',
};

const todayStr = new Date().toISOString().slice(0, 10);

const getInitials = (name?: string) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
};

const renderAssigneeAvatars = (uids: string[] | undefined, usersList: UserItem[]) => {
  if (!uids || uids.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {uids.slice(0, 3).map((uid, i) => {
        const user = usersList.find(u => u.uid === uid);
        const name = user ? user.displayName : 'Unknown';
        const initials = getInitials(name);
        return (
          <div
            key={uid}
            title={name}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--primary)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              border: '2px solid var(--card)',
              marginLeft: i > 0 ? -5 : 0,
              zIndex: 10 - i,
            }}
          >
            {initials}
          </div>
        );
      })}
      {uids.length > 3 && (
        <div
          title={`${uids.length - 3} more`}
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#e2e8f0',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            border: '2px solid var(--card)',
            marginLeft: -5,
            zIndex: 5,
          }}
        >
          +{uids.length - 3}
        </div>
      )}
    </div>
  );
};

// ── Draggable Card Component ──────────────────────────────────────────────────
const KanbanCard: React.FC<{
  item: PlannerWorkItem;
  usersList: UserItem[];
  workflowStatus: PlannerWorkflowStatus | undefined;
  onClick: () => void;
}> = ({ item, usersList, workflowStatus, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 999 : 1,
  };

  const isOverdue = item.dueDate && item.dueDate < todayStr && workflowStatus?.category !== 'done';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="kanban-card"
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if (transform && (Math.abs(transform.x) > 3 || Math.abs(transform.y) > 3)) {
          e.preventDefault();
          return;
        }
        onClick();
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
        {item.title}
      </div>

      {item.labels && item.labels.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {item.labels.map(l => (
            <span
              key={l}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1px 5px',
                fontSize: 10,
                color: 'var(--text-muted)'
              }}
            >
              {l}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          {item.dueDate && (
            <span
              style={{
                fontWeight: 700,
                color: isOverdue ? 'var(--red)' : 'var(--text-muted)',
                background: isOverdue ? '#fef2f2' : 'transparent',
                padding: isOverdue ? '2px 4px' : 0,
                borderRadius: isOverdue ? 4 : 0,
              }}
            >
              {isOverdue ? '⚠ ' : ''}{item.dueDate}
            </span>
          )}

          {item.checklist && item.checklist.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <CheckSquare size={12} />
              {item.checklist.filter(c => c.done).length}/{item.checklist.length}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.priority && item.priority !== 'normal' && (
            <span style={{ color: PRIORITY_COLORS[item.priority], fontWeight: 700, textTransform: 'capitalize', fontSize: 11 }}>
              {item.priority}
            </span>
          )}
          {renderAssigneeAvatars(item.assigneeUids, usersList)}
        </div>
      </div>
    </div>
  );
};

// ── Droppable Column Component ────────────────────────────────────────────────
const KanbanColumn: React.FC<{
  status: PlannerWorkflowStatus;
  isDimmed: boolean;
  itemCount: number;
  children: React.ReactNode;
}> = ({ status, isDimmed, itemCount, children }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
  });

  const style: React.CSSProperties = {
    flex: '0 0 280px',
    background: isOver ? 'rgba(var(--primary-rgb), 0.05)' : 'var(--bg)',
    border: isOver ? '2px dashed var(--primary)' : '1px solid var(--border)',
    borderRadius: 12,
    padding: 12,
    minHeight: '480px',
    opacity: isDimmed ? 0.4 : 1,
    filter: isDimmed ? 'grayscale(0.4)' : 'none',
    transition: 'opacity 0.2s ease, border 0.2s ease, background 0.2s ease',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: status.color, display: 'inline-block' }} />
        <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>{status.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{itemCount}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {children}
      </div>
    </div>
  );
};

// ── Main Board Component ──────────────────────────────────────────────────────
export const PlannerBoard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [workflows, setWorkflows] = useState<PlannerWorkflow[]>([]);
  const [activeWfId, setActiveWfId] = useState<string | null>(null);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [allowedStatuses, setAllowedStatuses] = useState<string[]>([]);
  const [fetchingAllowed, setFetchingAllowed] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);

  // Filter states
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterLabel, setFilterLabel] = useState('');

  // Saved views state
  const [savedViews, setSavedViews] = useState<any[]>([]);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const viewId = searchParams.get('viewId');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const loadViews = async () => {
    try {
      const list = await plannerApi.views.list('marketing');
      setSavedViews(list);
    } catch (err) {
      console.error('Failed to load views:', err);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, wfs, usersSnap, brandsSnap] = await Promise.all([
        plannerApi.listAll(),
        plannerApi.config.workflows(),
        getDocs(collection(db, 'users')).catch(() => null),
        getDocs(collection(db, 'brands')).catch(() => null),
      ]);
      setItems(itemsRes.items);
      setWorkflows(wfs);
      
      // Default to workflow with most items
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
        const list = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserItem));
        setUsersList(list.length ? list : mockUsers);
      } else {
        setUsersList(mockUsers);
      }

      if (brandsSnap) {
        setBrands(brandsSnap.docs.map(doc => doc.data().name));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadViews();
  }, []);

  const activeWf = useMemo(() => workflows.find((w) => w.id === activeWfId) ?? null, [workflows, activeWfId]);

  // Sync filters if a saved view is active
  const activeSavedView = useMemo(() => savedViews.find(v => v.id === viewId), [savedViews, viewId]);

  useEffect(() => {
    if (activeSavedView) {
      const f = activeSavedView.filters || {};
      setFilterBrand(f.brand || '');
      setFilterStatus(f.status || '');
      setFilterAssignee(f.assignee || '');
      setFilterLabel(f.label || '');
    }
  }, [activeSavedView]);

  const itemsByStatus = useMemo(() => {
    const map = new Map<string, PlannerWorkItem[]>();
    if (!activeWf) return map;
    for (const s of activeWf.statuses) map.set(s.id, []);
    
    // Filter items
    const filtered = items.filter(it => {
      if (it.workflowId !== activeWf.id) return false;
      if (filterBrand && !(it.brandIds ?? []).includes(filterBrand)) return false;
      if (filterStatus && it.status !== filterStatus) return false;
      if (filterAssignee && !(it.assigneeUids ?? []).includes(filterAssignee)) return false;
      if (filterLabel && !(it.labels ?? []).includes(filterLabel)) return false;
      return true;
    });

    for (const it of filtered) {
      (map.get(it.status) ?? map.set(it.status, []).get(it.status)!).push(it);
    }
    return map;
  }, [items, activeWf, filterBrand, filterStatus, filterAssignee, filterLabel]);

  // Extract unique labels
  const labelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.labels) {
        for (const l of it.labels) set.add(l);
      }
    }
    return Array.from(set);
  }, [items]);

  const activeFilterCount = [filterBrand, filterStatus, filterAssignee, filterLabel].filter(Boolean).length;

  const clearFilters = () => {
    setFilterBrand('');
    setFilterStatus('');
    setFilterAssignee('');
    setFilterLabel('');
    if (viewId) {
      navigate('/planner/board');
    }
  };

  const handleSaveView = async (name: string, shared: boolean) => {
    try {
      const view = await plannerApi.views.create({
        name,
        spaceId: 'marketing',
        kind: 'board',
        filters: {
          brand: filterBrand || undefined,
          status: filterStatus || undefined,
          assignee: filterAssignee || undefined,
          label: filterLabel || undefined,
        },
        shared,
      });
      await loadViews();
      navigate(`/planner/board?viewId=${view.id}`);
    } catch (err) {
      alert('Failed to save view');
    }
  };

  const handleDeleteActiveView = async () => {
    if (!viewId) return;
    if (!window.confirm('Delete this saved view?')) return;
    try {
      await plannerApi.views.delete(viewId);
      await loadViews();
      navigate('/planner/board');
    } catch (err) {
      alert('Failed to delete view');
    }
  };

  const handleDragStart = async (event: any) => {
    const { active } = event;
    const itemId = String(active.id);
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    setDraggingId(itemId);
    setAllowedStatuses([]);
    setFetchingAllowed(true);

    try {
      const transitions = await plannerApi.transitions(itemId);
      setAllowedStatuses(transitions.map(t => t.to));
    } catch (err) {
      console.error('Failed to fetch allowed transitions:', err);
    } finally {
      setFetchingAllowed(false);
    }
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    setDraggingId(null);
    setAllowedStatuses([]);
    
    if (!over) return;
    
    const itemId = String(active.id);
    const targetStatus = String(over.id);
    const item = items.find((i) => i.id === itemId);
    if (!item || item.status === targetStatus) return;

    // Optimistic Update
    const previousItems = [...items];
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status: targetStatus } : i))
    );

    setDropBusy(true);
    setError(null);
    setNotice(null);

    try {
      const available = await plannerApi.transitions(itemId);
      const match = available.find((t) => t.to === targetStatus);
      if (!match) {
        setItems(previousItems);
        const name = activeWf?.statuses.find((s) => s.id === targetStatus)?.name ?? targetStatus;
        setNotice(`No available move from "${item.title}" to ${name}.`);
        return;
      }
      await plannerApi.transition(itemId, match.id);
      await load();
    } catch (err) {
      setItems(previousItems);
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

  const statusMetaMap = useMemo(() => {
    const map = new Map<string, PlannerWorkflowStatus>();
    if (activeWf) {
      for (const s of activeWf.statuses) map.set(s.id, s);
    }
    return map;
  }, [activeWf]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <PlannerViewTabs />
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          {/* Layout Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button 
               onClick={() => navigate('/planner/tasks')} 
               style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
               List
            </button>
            <button 
               onClick={() => navigate('/planner/board')} 
               style={{ background: 'var(--card)', color: 'var(--text)', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, boxShadow: 'var(--shadow-sm)', fontSize: 13 }}>
               Board
            </button>
          </div>

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
      </div>

      <PlannerFilters
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        brandOptions={brands}
        statusOptions={activeWf ? activeWf.statuses : []}
        userOptions={usersList}
        labelOptions={labelOptions}
        filterBrand={filterBrand}
        setFilterBrand={setFilterBrand}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        filterAssignee={filterAssignee}
        setFilterAssignee={setFilterAssignee}
        filterLabel={filterLabel}
        setFilterLabel={setFilterLabel}
        clearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        onSaveView={handleSaveView}
        activeSavedViewName={activeSavedView?.name}
        onDeleteActiveView={handleDeleteActiveView}
      />

      {error && <Banner icon>{error}</Banner>}
      {notice && <Banner tone="warn">{notice}</Banner>}

      {loading ? (
        <LoadingSpinner message="Loading board…" />
      ) : !activeWf ? (
        <div className="section-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workflow configured. Run the planner seed script.
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, opacity: dropBusy ? 0.7 : 1 }}>
            {activeWf.statuses.map((s) => {
              const colItems = itemsByStatus.get(s.id) || [];
              const isCurrentCol = draggingId && items.find(i => i.id === draggingId)?.status === s.id;
              const isAllowed = isCurrentCol || allowedStatuses.includes(s.id);
              const isDimmed = !!draggingId && !fetchingAllowed && !isAllowed;

              return (
                <KanbanColumn key={s.id} status={s} isDimmed={isDimmed} itemCount={colItems.length}>
                  {colItems.map((it) => (
                    <KanbanCard
                      key={it.id}
                      item={it}
                      usersList={usersList}
                      workflowStatus={statusMetaMap.get(it.status)}
                      onClick={() => navigate(`/planner/${it.id}`)}
                    />
                  ))}
                  {colItems.length === 0 && (
                    <div style={{ flex: 1, border: '1px dashed var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 8px', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                      Drop items here
                    </div>
                  )}
                </KanbanColumn>
              );
            })}
          </div>
        </DndContext>
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
