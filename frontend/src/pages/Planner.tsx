import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Megaphone, AlertCircle, ChevronDown, ChevronRight, CornerDownRight, CheckSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi, buildStatusIndex, prettyStatus } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflowStatus, PlannerWorkflow } from '../services/plannerApi';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mockUsers } from '../mockData';
import type { UserItem } from '../types';
import { PlannerViewTabs } from '../components/PlannerViewTabs';
import { PlannerFilters } from '../components/PlannerFilters';
import { TaskWorkflowList } from '../features/tasks/TaskWorkflowList';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8',
  normal: '#64748b',
  high: '#f59e0b',
  urgent: '#ef4444',
};

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

export const Planner: React.FC = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canCreate = role === 'admin' || role === 'internal';

  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [workflows, setWorkflows] = useState<PlannerWorkflow[]>([]);
  const [activeWfId, setActiveWfId] = useState<string | null>(null);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [statusIndex, setStatusIndex] = useState<Map<string, Map<string, PlannerWorkflowStatus>>>(new Map());
  const [brands, setBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expand / collapse states
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

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
  const newDate = searchParams.get('newDate');

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
      setStatusIndex(buildStatusIndex(wfs));

      // Resolve active workflow
      let defaultWfId = wfs[0]?.id ?? null;
      if (itemsRes.items.length > 0) {
        const counts = new Map<string, number>();
        for (const it of itemsRes.items) counts.set(it.workflowId, (counts.get(it.workflowId) ?? 0) + 1);
        let bestN = -1;
        for (const w of wfs) {
          const n = counts.get(w.id) ?? 0;
          if (n > bestN) { defaultWfId = w.id; bestN = n; }
        }
      }
      setActiveWfId(defaultWfId);

      // Load users
      if (usersSnap) {
        const list = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserItem));
        setUsersList(list.length ? list : mockUsers);
      } else {
        setUsersList(mockUsers);
      }

      // Load brands
      if (brandsSnap) {
        setBrands(brandsSnap.docs.map(doc => doc.data().name));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadViews();
  }, []);

  const activeWf = useMemo(() => workflows.find((w) => w.id === activeWfId) ?? null, [workflows, activeWfId]);

  // Deep link from the calendar / legacy /tasks redirect (?newDate=YYYY-MM-DD):
  // switch to the absorbed Tasks workflow so TaskWorkflowList opens the creator.
  useEffect(() => {
    if (newDate && workflows.some((w) => w.id === 'wf_task')) {
      setActiveWfId('wf_task');
    }
  }, [newDate, workflows]);

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



  const toggleParent = (parentId: string) => {
    setExpandedParents(prev => ({ ...prev, [parentId]: !prev[parentId] }));
  };



  const statusMeta = (item: PlannerWorkItem) => statusIndex.get(item.workflowId)?.get(item.status);

  // Filtering logic client-side
  const { flatParents, subtasksIndex } = useMemo(() => {
    const parentChildrenMap = new Map<string, PlannerWorkItem[]>();
    const parentList: PlannerWorkItem[] = [];

    // Filter items based on active workflow AND filter criteria
    const activeItems = items.filter(it => {
      if (it.workflowId !== activeWfId) return false;
      if (filterBrand && !(it.brandIds ?? []).includes(filterBrand)) return false;
      if (filterStatus && it.status !== filterStatus) return false;
      if (filterAssignee && !(it.assigneeUids ?? []).includes(filterAssignee)) return false;
      if (filterLabel && !(it.labels ?? []).includes(filterLabel)) return false;
      return true;
    });

    // Build parent-child relationship
    for (const it of activeItems) {
      if (it.parentId) {
        if (!parentChildrenMap.has(it.parentId)) parentChildrenMap.set(it.parentId, []);
        parentChildrenMap.get(it.parentId)!.push(it);
      }
    }

    // Identify true parents in this list
    for (const it of activeItems) {
      if (!it.parentId || !activeItems.some(p => p.id === it.parentId)) {
        parentList.push(it);
      }
    }

    return { flatParents: parentList, subtasksIndex: parentChildrenMap };
  }, [items, activeWfId, filterBrand, filterStatus, filterAssignee, filterLabel]);

  // Extract unique labels present in items
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
      navigate('/planner/tasks');
    }
  };

  const handleSaveView = async (name: string, shared: boolean) => {
    try {
      const view = await plannerApi.views.create({
        name,
        spaceId: 'marketing',
        kind: 'list',
        filters: {
          brand: filterBrand || undefined,
          status: filterStatus || undefined,
          assignee: filterAssignee || undefined,
          label: filterLabel || undefined,
        },
        shared,
      });
      await loadViews();
      navigate(`/planner/tasks?viewId=${view.id}`);
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
      navigate('/planner/tasks');
    } catch (err) {
      alert('Failed to delete view');
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
  };

  const renderAssigneeAvatars = (uids?: string[]) => {
    if (!uids || uids.length === 0) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {uids.slice(0, 4).map((uid, i) => {
          const user = usersList.find(u => u.uid === uid);
          const name = user ? user.displayName : 'Unknown';
          const initials = getInitials(name);
          return (
            <div
              key={uid}
              title={name}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                border: '2px solid var(--card)',
                marginLeft: i > 0 ? -6 : 0,
                zIndex: 10 - i,
              }}
            >
              {initials}
            </div>
          );
        })}
        {uids.length > 4 && (
          <div
            title={`${uids.length - 4} more`}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: '#e2e8f0',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              border: '2px solid var(--card)',
              marginLeft: -6,
              zIndex: 5,
            }}
          >
            +{uids.length - 4}
          </div>
        )}
      </div>
    );
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  // "2026-07-04" -> "Jul 4", for compact range chips (monday-style "Jul 2 - 3").
  const formatShort = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderRow = (item: PlannerWorkItem, isSubtask = false) => {
    const isOverdue = item.dueDate && item.dueDate < todayStr && statusMeta(item)?.category !== 'done';
    const subtasks = subtasksIndex.get(item.id) || [];
    const hasSubtasks = subtasks.length > 0;
    const isExpanded = !!expandedParents[item.id];

    return (
      <div key={item.id}>
        <div
          onClick={() => navigate(`/planner/${item.id}`)}
          className="section-card hover-card"
          style={{
            padding: '10px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginLeft: isSubtask ? 28 : 0,
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
        >
          {isSubtask && <CornerDownRight size={14} style={{ color: 'var(--text-muted)' }} />}

          {!isSubtask && hasSubtasks ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleParent(item.id);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 4,
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            !isSubtask && <div style={{ width: 24 }} />
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title}
              </span>
              {hasSubtasks && (
                <span
                  title={`${subtasks.length} subtask(s)`}
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    padding: '2px 6px',
                    borderRadius: 6,
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  ⌗ {subtasks.length}
                </span>
              )}
              {item.checklist && item.checklist.length > 0 && (
                <span
                  title="Checklist progress"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <CheckSquare size={12} />
                  {item.checklist.filter(c => c.done).length}/{item.checklist.length}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
              {(item.brandIds ?? []).length > 0 && <span>{item.brandIds!.join(', ')}</span>}
              {item.labels && item.labels.map(l => (
                <span key={l} style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 10 }}>{l}</span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {item.dueDate && (
              <span
                style={{ fontSize: 12, fontWeight: 700, color: isOverdue ? 'var(--red)' : 'var(--text-muted)' }}
                title={item.startDate && item.startDate !== item.dueDate ? `${item.startDate} → ${item.dueDate}` : undefined}
              >
                {isOverdue ? '⚠ Overdue ' : ''}
                {item.startDate && item.startDate !== item.dueDate
                  ? `${formatShort(item.startDate)} – ${formatShort(item.dueDate)}`
                  : item.dueDate}
              </span>
            )}

            {item.priority && (
              <span style={{ color: PRIORITY_COLORS[item.priority], fontWeight: 700, textTransform: 'capitalize', fontSize: 12 }}>
                {item.priority}
              </span>
            )}

            {renderAssigneeAvatars(item.assigneeUids)}

            <select
              value=""
              onClick={(e) => e.stopPropagation()}
              onChange={async (e) => {
                const list = e.target.value as 'todo' | 'backlog' | 'draft';
                if (!list) return;
                try {
                  await plannerApi.todos.create(item.title, item.dueDate || null, list, item.id);
                  alert(`Task added to your workspace as ${list === 'todo' ? 'To Do' : list === 'backlog' ? 'Backlog' : 'Draft'}!`);
                } catch (err) {
                  alert('Failed to add task to workspace');
                }
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text-muted)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="">+ Workspace</option>
              <option value="todo">As To Do</option>
              <option value="backlog">As Backlog</option>
              <option value="draft">As Draft</option>
            </select>

            <StatusBadge status={item.status} meta={statusMeta(item)} />
          </div>
        </div>

        {/* Render child subtasks if expanded */}
        {!isSubtask && isExpanded && subtasks.map(sub => renderRow(sub, true))}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <PlannerViewTabs />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          {/* Layout Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button
               onClick={() => navigate('/planner/tasks')}
               style={{ background: 'var(--card)', color: 'var(--text)', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, boxShadow: 'var(--shadow-sm)', fontSize: 13 }}>
               List
            </button>
            <button
               onClick={() => navigate('/planner/board')}
               style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
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

      {activeWfId === 'wf_task' ? (
        <TaskWorkflowList newDate={newDate} />
      ) : (
      <>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Work Items</h3>
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
          <p style={{ margin: 0 }}>No work items yet.{canCreate ? ' Create your first item above.' : ''}</p>
        </div>
      ) : !activeWf ? (
        <div className="section-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workflow configured. Run the planner seed script.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {flatParents.map(parent => renderRow(parent))}

          {flatParents.length === 0 && (
            <div className="section-card" style={{ padding: '24px 16px', fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
              No work items match the filters.
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
};
