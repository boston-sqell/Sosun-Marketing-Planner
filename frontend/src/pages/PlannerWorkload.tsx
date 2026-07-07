import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, User, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflow, PlannerWorkflowStatus } from '../services/plannerApi';
import { configApi } from '../services/configApi';
import { PlannerViewTabs } from '../components/PlannerViewTabs';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mockUsers } from '../mockData';
import type { UserItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { useDraggable, useDroppable, DndContext, useSensors, useSensor, PointerSensor } from '@dnd-kit/core';

// ── Draggable Task Card ──────────────────────────────────────────────────────
const WorkloadTaskCard: React.FC<{
  item: PlannerWorkItem;
  statusMeta: PlannerWorkflowStatus | undefined;
  onClick: () => void;
}> = ({ item, statusMeta, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="workload-task-card"
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
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
        {item.title}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            background: statusMeta?.color || '#64748b',
          }}
        >
          {statusMeta?.name || item.status}
        </span>
        {item.dueDate && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Due {item.dueDate}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Droppable Workload Column (Assignee Card) ────────────────────────────────
const WorkloadColumn: React.FC<{
  uid: string; // 'unassigned' or actual user ID
  name: string;
  roleStr: string;
  items: PlannerWorkItem[];
  statusMetaMap: Map<string, PlannerWorkflowStatus>;
  workflowStatuses: PlannerWorkflowStatus[];
  onTaskClick: (id: string) => void;
}> = ({ uid, name, roleStr, items, statusMetaMap, workflowStatuses, onTaskClick }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: uid,
  });

  const [expanded, setExpanded] = useState(true);
  const [collapsedStatuses, setCollapsedStatuses] = useState<Record<string, boolean>>({});

  // Group items by status
  const itemsByStatus = useMemo(() => {
    const map = new Map<string, PlannerWorkItem[]>();
    for (const it of items) {
      const list = map.get(it.status) || [];
      list.push(it);
      map.set(it.status, list);
    }
    return map;
  }, [items]);

  // Determine active statuses in this column
  const activeStatuses = useMemo(() => {
    const statusesInWf = workflowStatuses || [];
    
    // Find any statuses that items have but aren't in the workflow list
    const extraStatuses = new Set<string>();
    for (const it of items) {
      if (!statusesInWf.some(s => s.id === it.status)) {
        extraStatuses.add(it.status);
      }
    }
    
    const combined = [
      ...statusesInWf.map(s => ({ id: s.id, name: s.name, color: s.color })),
      ...Array.from(extraStatuses).map(sid => ({ id: sid, name: sid.toUpperCase(), color: '#64748b' }))
    ];

    // Only return statuses that have items in this column
    return combined.filter(s => {
      const statusItems = itemsByStatus.get(s.id) || [];
      return statusItems.length > 0;
    });
  }, [workflowStatuses, items, itemsByStatus]);

  // Group items by category to calculate completion donut
  const { doneCount, todoCount, progressCount, total } = useMemo(() => {
    let done = 0;
    let todo = 0;
    let prog = 0;
    for (const it of items) {
      const cat = statusMetaMap.get(it.status)?.category || 'todo';
      if (cat === 'done') done++;
      else if (cat === 'in_progress') prog++;
      else todo++;
    }
    return { doneCount: done, todoCount: todo, progressCount: prog, total: items.length };
  }, [items, statusMetaMap]);

  const percentage = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const strokeDashoffset = 100 - percentage;

  // Build a stacked status bar representation
  const statusBar = useMemo(() => {
    if (total === 0) return null;
    const todoPct = (todoCount / total) * 100;
    const progPct = (progressCount / total) * 100;
    const donePct = (doneCount / total) * 100;
    return (
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--border)', margin: '8px 0' }}>
        <div style={{ width: `${todoPct}%`, background: '#94a3b8' }} title={`To Do: ${todoCount}`} />
        <div style={{ width: `${progPct}%`, background: '#f59e0b' }} title={`In Progress: ${progressCount}`} />
        <div style={{ width: `${donePct}%`, background: '#10b981' }} title={`Done: ${doneCount}`} />
      </div>
    );
  }, [todoCount, progressCount, doneCount, total]);

  const style: React.CSSProperties = {
    flex: '0 0 280px',
    background: isOver ? 'rgba(var(--primary-rgb), 0.05)' : 'var(--card)',
    border: isOver ? '2px dashed var(--primary)' : '1px solid var(--border)',
    borderRadius: 12,
    padding: 14,
    minHeight: '450px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    boxShadow: 'var(--shadow-sm)',
    transition: 'background 0.2s ease, border 0.2s ease',
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* Assignee Card Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: uid === 'unassigned' ? '#e2e8f0' : 'var(--primary)',
            color: uid === 'unassigned' ? '#64748b' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {uid === 'unassigned' ? <Users size={18} /> : <User size={18} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
            {roleStr}
          </div>
        </div>

        {/* Completion Ring */}
        <div style={{ width: 40, height: 40, flexShrink: 0 }}>
          <svg width="40" height="40" viewBox="0 0 36 36">
            <path
              style={{ stroke: 'var(--border)', strokeWidth: 3.5, fill: 'none' }}
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              style={{
                stroke: '#10b981',
                strokeWidth: 3.5,
                strokeDasharray: '100, 100',
                strokeDashoffset,
                fill: 'none',
                transition: 'stroke-dashoffset 0.3s ease',
              }}
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <text x="18" y="20.35" style={{ fontSize: '9px', fontWeight: 'bold', textAnchor: 'middle', fill: 'var(--text)' }}>
              {percentage}%
            </text>
          </svg>
        </div>
      </div>

      {/* Progress Breakdown */}
      <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
        <span>{total} item(s)</span>
        <span>{doneCount} done · {total - doneCount} active</span>
      </div>

      {statusBar}

      {/* Accordion Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--primary)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          alignSelf: 'flex-start',
          padding: '2px 0',
          marginBottom: 4,
        }}
      >
        {expanded ? 'Hide tasks' : 'Show tasks'}
      </button>

      {/* Draggable Task List */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
          {activeStatuses.map((statusObj) => {
            const statusItems = itemsByStatus.get(statusObj.id) || [];
            const isCollapsed = !!collapsedStatuses[statusObj.id];

            return (
              <div key={statusObj.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Status Group Header */}
                <button
                  onClick={() => setCollapsedStatuses(prev => ({ ...prev, [statusObj.id]: !prev[statusObj.id] }))}
                  className="workload-status-header"
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-light)', marginRight: 2 }}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </span>
                  
                  {/* Color-coded square badge */}
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: statusObj.color,
                      marginRight: 8,
                      flexShrink: 0,
                    }}
                  />
                  
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {statusObj.name}
                  </span>
                  
                  <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, marginLeft: 6 }}>
                    ({statusItems.length})
                  </span>
                </button>

                {/* Status Group Items */}
                {!isCollapsed && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      paddingLeft: 12,
                      borderLeft: `2px solid ${statusObj.color}22`,
                      marginLeft: 6,
                    }}
                  >
                    {statusItems.map((it) => (
                      <WorkloadTaskCard
                        key={it.id}
                        item={it}
                        statusMeta={statusMetaMap.get(it.status)}
                        onClick={() => onTaskClick(it.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {items.length === 0 && (
            <div style={{ flex: 1, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 8px', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
              No tasks assigned
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Workload Dashboard Page ──────────────────────────────────────────────────
export const PlannerWorkload: React.FC = () => {
  const navigate = useNavigate();
  const { role, profile } = useAuth();

  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [workflows, setWorkflows] = useState<PlannerWorkflow[]>([]);
  const [activeWfId, setActiveWfId] = useState<string | null>(null);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [agenciesList, setAgenciesList] = useState<string[]>(['Greyscale']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Gate access to staff only
  const isStaff = role === 'admin' || role === 'internal';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, wfs, usersSnap, configRes] = await Promise.all([
        plannerApi.listAll(),
        plannerApi.config.workflows(),
        getDocs(collection(db, 'users')).catch(() => null),
        configApi.get().catch(() => null),
      ]);
      setItems(itemsRes.items);
      setWorkflows(wfs);

      // Default active workflow
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

      if (configRes && configRes.agencies) {
        setAgenciesList(configRes.agencies);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workload dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isStaff) {
      load();
    }
  }, [isStaff]);

  const activeWf = useMemo(() => workflows.find((w) => w.id === activeWfId) ?? null, [workflows, activeWfId]);

  const statusMetaMap = useMemo(() => {
    const map = new Map<string, PlannerWorkflowStatus>();
    if (activeWf) {
      for (const s of activeWf.statuses) map.set(s.id, s);
    }
    return map;
  }, [activeWf]);

  // Group items by column: 'unassigned', 'internal', or agency name (lowercase)
  const itemsByAssignee = useMemo(() => {
    const map = new Map<string, PlannerWorkItem[]>();
    map.set('unassigned', []);
    map.set('internal', []);
    for (const a of agenciesList) {
      map.set(a.toLowerCase(), []);
    }

    const filtered = items.filter(it => it.workflowId === activeWfId);

    for (const it of filtered) {
      const uids = it.assigneeUids || [];
      const raw = it as any;
      const assignedToLegacy = raw.assignedTo || it.fields?.assignedTo;
      
      // Check legacy assignments
      let assignedToAgencyName: string | null = null;
      if (assignedToLegacy === 'Agency' || assignedToLegacy === 'Both') {
        assignedToAgencyName = 'Greyscale'; // Default agency name for legacy
      }

      // Check if it's assigned to any agency user
      const assignedAgencies = new Set<string>();
      let hasInternalAssignee = false;

      for (const uid of uids) {
        const u = usersList.find(x => x.uid === uid);
        if (u) {
          if (u.role === 'agency' || u.role === 'external_agency') {
            const agency = (u.agencyName || 'Greyscale').trim();
            assignedAgencies.add(agency.toLowerCase());
          } else {
            hasInternalAssignee = true;
          }
        }
      }

      if (assignedToAgencyName) {
        assignedAgencies.add(assignedToAgencyName.toLowerCase());
      }
      if (assignedToLegacy === 'Internal' || assignedToLegacy === 'Both') {
        hasInternalAssignee = true;
      }

      // Determine placement
      if (assignedAgencies.size === 0 && !hasInternalAssignee) {
        map.get('unassigned')!.push(it);
      } else {
        // Place in agency columns
        for (const agency of assignedAgencies) {
          if (map.has(agency)) {
            map.get(agency)!.push(it);
          } else {
            map.set(agency, [it]);
          }
        }
        // Place in internal column
        if (hasInternalAssignee) {
          map.get('internal')!.push(it);
        }
      }
    }
    return map;
  }, [items, usersList, agenciesList, activeWfId]);

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const itemId = String(active.id);
    const targetId = String(over.id);

    const item = items.find(i => i.id === itemId);
    if (!item) return;

    let nextUids: string[] = [];
    const updatePayload: any = {};

    if (targetId === 'unassigned') {
      nextUids = [];
      updatePayload.assignedTo = 'None';
    } else if (targetId === 'internal') {
      const isInternalUser = role === 'admin' || role === 'internal';
      nextUids = isInternalUser && profile?.uid ? [profile.uid] : [];
      updatePayload.assignedTo = 'Internal';
    } else {
      // Drop on an agency column (targetId is agency name in lowercase)
      const agencyNameLower = targetId.toLowerCase();
      const agencyUsers = usersList.filter(u => 
        (u.role === 'agency' || u.role === 'external_agency') &&
        (u.agencyName || 'Greyscale').toLowerCase() === agencyNameLower
      );
      nextUids = agencyUsers.map(u => u.uid);
      updatePayload.assignedTo = 'Agency';
    }

    updatePayload.assigneeUids = nextUids;

    // Optimistic Update
    const previousItems = [...items];
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, assigneeUids: nextUids, assignedTo: updatePayload.assignedTo } : i))
    );

    setUpdating(true);
    setError(null);
    try {
      await plannerApi.update(itemId, updatePayload);
      await load();
    } catch (err) {
      setItems(previousItems);
      setError(err instanceof Error ? err.message : 'Failed to reassign task.');
    } finally {
      setUpdating(false);
    }
  };

  if (!isStaff) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c' }}>
          <AlertCircle size={20} />
          <span>Forbidden: You must be a staff member (admin or internal) to access the workload dashboard.</span>
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
        <LoadingSpinner message="Loading workload dashboard…" />
      ) : !activeWf ? (
        <div className="section-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workflow configured. Run the planner seed script.
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16, opacity: updating ? 0.7 : 1 }}>
            {/* Unassigned column */}
            <WorkloadColumn
              uid="unassigned"
              name="Unassigned"
              roleStr="Awaiting Assignee"
              items={itemsByAssignee.get('unassigned') || []}
              statusMetaMap={statusMetaMap}
              workflowStatuses={activeWf.statuses}
              onTaskClick={(id) => navigate(`/planner/${id}`)}
            />

            {/* Internal column */}
            <WorkloadColumn
              uid="internal"
              name="Internal"
              roleStr="Internal Marketing"
              items={itemsByAssignee.get('internal') || []}
              statusMetaMap={statusMetaMap}
              workflowStatuses={activeWf.statuses}
              onTaskClick={(id) => navigate(`/planner/${id}`)}
            />

            {/* Agency columns */}
            {agenciesList.map((agency) => {
              const name = agency;
              const uid = agency.toLowerCase();
              return (
                <WorkloadColumn
                  key={uid}
                  uid={uid}
                  name={name}
                  roleStr="Agency"
                  items={itemsByAssignee.get(uid) || []}
                  statusMetaMap={statusMetaMap}
                  workflowStatuses={activeWf.statuses}
                  onTaskClick={(id) => navigate(`/planner/${id}`)}
                />
              );
            })}
          </div>
        </DndContext>
      )}
    </div>
  );
};
