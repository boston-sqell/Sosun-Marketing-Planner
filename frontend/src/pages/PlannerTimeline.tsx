import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflow, PlannerWorkflowStatus } from '../services/plannerApi';
import { PlannerViewTabs } from '../components/PlannerViewTabs';
import { PlannerFilters } from '../components/PlannerFilters';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mockUsers } from '../mockData';
import type { UserItem } from '../types';

// Helper to format Date objects as YYYY-MM-DD
const formatDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const r = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${r}`;
};

// Helper to parse YYYY-MM-DD to Date
const parseDateStr = (s: string): Date => {
  const parts = s.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
};

// Helper to get number of days between two dates
const getDaysBetween = (start: Date, end: Date): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / msPerDay);
};

// Helper to add days to a date
const addDays = (d: Date, days: number): Date => {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
};

// Helper to generate cubic Bezier path for timeline dependency lines
const getPathD = (x1: number, y1: number, x2: number, y2: number): string => {
  if (x2 >= x1 + 10) {
    const cp1x = x1 + Math.max(20, (x2 - x1) / 2);
    const cp2x = x2 - Math.max(20, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
  } else {
    const offset = 25;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x1 + offset} ${midY}, ${(x1 + x2) / 2} ${midY} C ${x2 - offset} ${midY}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
  }
};

export const PlannerTimeline: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [items, setItems] = useState<PlannerWorkItem[]>([]);
  const [workflows, setWorkflows] = useState<PlannerWorkflow[]>([]);
  const [activeWfId, setActiveWfId] = useState<string | null>(null);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  
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

  // Date window state (default: 30 days starting from 5 days ago)
  const [windowStart, setWindowStart] = useState<Date>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return addDays(today, -5);
  });
  
  const windowDaysCount = 30; // Display 30 columns
  
  const windowEnd = useMemo(() => addDays(windowStart, windowDaysCount - 1), [windowStart]);

  // Editing state for rescheduled item date pickers
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [editingDates, setEditingDates] = useState<Record<string, { start: string; due: string }>>({});

  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [items]);

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

      if (brandsSnap) {
        setBrands(brandsSnap.docs.map(doc => doc.data().name));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline.');
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

  // Group active workflow items into scheduled and unscheduled based on filters
  const { scheduledItems, unscheduledItems } = useMemo(() => {
    // Filter items client-side
    const activeItems = items.filter(it => {
      if (it.workflowId !== activeWfId) return false;
      if (filterBrand && !(it.brandIds ?? []).includes(filterBrand)) return false;
      if (filterStatus && it.status !== filterStatus) return false;
      if (filterAssignee && !(it.assigneeUids ?? []).includes(filterAssignee)) return false;
      if (filterLabel && !(it.labels ?? []).includes(filterLabel)) return false;
      return true;
    });

    const scheduled: PlannerWorkItem[] = [];
    const unscheduled: PlannerWorkItem[] = [];
    
    for (const it of activeItems) {
      if (it.startDate && it.dueDate) {
        scheduled.push(it);
      } else {
        unscheduled.push(it);
      }
    }
    return { scheduledItems: scheduled, unscheduledItems: unscheduled };
  }, [items, activeWfId, filterBrand, filterStatus, filterAssignee, filterLabel]);

  const itemRowIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    scheduledItems.forEach((it, index) => {
      map.set(it.id, index);
    });
    return map;
  }, [scheduledItems]);

  const connections = useMemo(() => {
    const list: { id: string; predId: string; succId: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    if (!containerWidth) return list;

    for (const succ of scheduledItems) {
      const succRowIndex = itemRowIndexMap.get(succ.id);
      if (succRowIndex === undefined) continue;

      const dependsOn = succ.dependsOn || [];
      for (const predId of dependsOn) {
        const pred = scheduledItems.find(x => x.id === predId);
        if (!pred) continue;

        const predRowIndex = itemRowIndexMap.get(predId);
        if (predRowIndex === undefined) continue;

        // Parse start and end dates
        const predDue = parseDateStr(pred.dueDate!);
        const succStart = parseDateStr(succ.startDate!);

        // Calculate column indices
        const predEndCol = getDaysBetween(windowStart, predDue);
        const succStartCol = getDaysBetween(windowStart, succStart);

        // x1 = end edge of predecessor
        const x1 = ((predEndCol + 1) / windowDaysCount) * containerWidth;
        const y1 = predRowIndex * 48 + 24;

        // x2 = start edge of successor
        const x2 = (succStartCol / windowDaysCount) * containerWidth;
        const y2 = succRowIndex * 48 + 24;

        list.push({
          id: `${predId}-${succ.id}`,
          predId,
          succId: succ.id,
          x1,
          y1,
          x2,
          y2
        });
      }
    }
    return list;
  }, [scheduledItems, itemRowIndexMap, windowStart, containerWidth]);

  // Generate array of Dates in the current window
  const daysInWindow = useMemo(() => {
    const list: Date[] = [];
    for (let i = 0; i < windowDaysCount; i++) {
      list.push(addDays(windowStart, i));
    }
    return list;
  }, [windowStart]);

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
      navigate('/planner/timeline');
    }
  };

  const handleSaveView = async (name: string, shared: boolean) => {
    try {
      const view = await plannerApi.views.create({
        name,
        spaceId: 'marketing',
        kind: 'timeline',
        filters: {
          brand: filterBrand || undefined,
          status: filterStatus || undefined,
          assignee: filterAssignee || undefined,
          label: filterLabel || undefined,
        },
        shared,
      });
      await loadViews();
      navigate(`/planner/timeline?viewId=${view.id}`);
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
      navigate('/planner/timeline');
    } catch (err) {
      alert('Failed to delete view');
    }
  };

  // Navigation handlers
  const shiftWindow = (days: number) => {
    setWindowStart(prev => addDays(prev, days));
  };

  const jumpToToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setWindowStart(addDays(today, -5));
  };

  // Commit date edits
  const handleDateChange = async (itemId: string, field: 'startDate' | 'dueDate', val: string) => {
    if (!val) return;
    const item = items.find(it => it.id === itemId);
    if (!item) return;

    let nextStart = field === 'startDate' ? val : item.startDate || val;
    let nextDue = field === 'dueDate' ? val : item.dueDate || val;

    if (nextStart > nextDue) {
      if (field === 'startDate') {
        nextDue = nextStart;
      } else {
        nextStart = nextDue;
      }
    }

    const prevItems = [...items];
    setItems(prev =>
      prev.map(it => (it.id === itemId ? { ...it, startDate: nextStart, dueDate: nextDue } : it))
    );

    setUpdatingId(itemId);
    setError(null);

    try {
      await plannerApi.update(itemId, { startDate: nextStart, dueDate: nextDue });
      await load();
    } catch (err) {
      setItems(prevItems);
      setError(err instanceof Error ? err.message : 'Failed to update dates.');
    } finally {
      setUpdatingId(null);
    }
  };

  // Inline schedule an unscheduled item
  const handleScheduleUnscheduled = async (itemId: string, start: string, due: string) => {
    if (!start || !due) return;
    setUpdatingId(itemId);
    setError(null);
    try {
      await plannerApi.update(itemId, { startDate: start, dueDate: due });
      setEditingDates(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule item.');
    } finally {
      setUpdatingId(null);
    }
  };

  const statusMetaMap = useMemo(() => {
    const map = new Map<string, PlannerWorkflowStatus>();
    if (activeWf) {
      for (const s of activeWf.statuses) map.set(s.id, s);
    }
    return map;
  }, [activeWf]);

  const getStatusColor = (item: PlannerWorkItem) => {
    return statusMetaMap.get(item.status)?.color || '#64748b';
  };

  const todayIso = formatDateStr(new Date());

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <PlannerViewTabs />
        
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: 13 }} onClick={jumpToToday}>
            Today
          </button>
          <div style={{ display: 'inline-flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
            <button
              onClick={() => shiftWindow(-7)}
              style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', display: 'flex', color: 'var(--text)' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
              {windowStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {windowEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <button
              onClick={() => shiftWindow(7)}
              style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', display: 'flex', color: 'var(--text)' }}
            >
              <ChevronRight size={16} />
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

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 14 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading timeline…" />
      ) : !activeWf ? (
        <div className="section-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workflow configured. Run the planner seed script.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Timeline Grid Container */}
          <div
            className="section-card"
            style={{
              padding: 0,
              overflowX: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--card)',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', minWidth: 900 }}>
              {/* Task Title Column (Left Sidebar) */}
              <div
                style={{
                  width: 250,
                  flexShrink: 0,
                  borderRight: '1px solid var(--border)',
                  background: 'var(--bg)',
                  zIndex: 2,
                }}
              >
                <div style={{ height: 44, borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Scheduled Tasks
                </div>
                
                {/* Task Titles */}
                <div>
                  {scheduledItems.map((it) => (
                    <div
                      key={it.id}
                      onClick={() => navigate(`/planner/${it.id}`)}
                      style={{
                        height: 48,
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 13,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      className="hover-bg-muted"
                      title={it.title}
                    >
                      {it.title}
                    </div>
                  ))}
                  {scheduledItems.length === 0 && (
                    <div style={{ padding: '24px 16px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                      No scheduled tasks.
                    </div>
                  )}
                </div>
              </div>

              {/* Grid timeline area */}
              <div style={{ flex: 1, position: 'relative' }}>
                {/* Grid Column Headers (Dates) */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${windowDaysCount}, 1fr)`,
                    height: 44,
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg)',
                  }}
                >
                  {daysInWindow.map((d, index) => {
                    const isToday = formatDateStr(d) === todayIso;
                    return (
                      <div
                        key={index}
                        style={{
                          borderRight: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: isToday ? 800 : 500,
                          color: isToday ? 'var(--primary)' : 'var(--text-muted)',
                          background: isToday ? 'rgba(var(--primary-rgb), 0.05)' : 'none',
                        }}
                      >
                        <span style={{ fontWeight: 800 }}>{d.getDate()}</span>
                        <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Grid rows */}
                <div style={{ position: 'relative' }} ref={containerRef}>
                  {/* Today indicator vertical line */}
                  {daysInWindow.some(d => formatDateStr(d) === todayIso) && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${(daysInWindow.findIndex(d => formatDateStr(d) === todayIso) / windowDaysCount) * 100}%`,
                        width: 2,
                        background: 'var(--red)',
                        opacity: 0.5,
                        zIndex: 1,
                        pointerEvents: 'none',
                      }}
                    />
                  )}

                  {/* Dynamic SVG Dependency Connections */}
                  <svg
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      zIndex: 2,
                      overflow: 'visible',
                    }}
                  >
                    <defs>
                      <marker
                        id="timeline-arrow"
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--purple)" />
                      </marker>
                    </defs>
                    {connections.map((conn) => {
                      const isHighlighted = hoveredItemId ? (conn.predId === hoveredItemId || conn.succId === hoveredItemId) : false;
                      return (
                        <path
                          key={conn.id}
                          d={getPathD(conn.x1, conn.y1, conn.x2, conn.y2)}
                          fill="none"
                          stroke="var(--purple)"
                          strokeWidth={isHighlighted ? 3 : 1.5}
                          markerEnd="url(#timeline-arrow)"
                          opacity={isHighlighted ? 1 : 0.4}
                          className="timeline-connection-line"
                        />
                      );
                    })}
                  </svg>

                  {/* Task Grid Rows */}
                  {scheduledItems.map((it) => {
                    const start = parseDateStr(it.startDate!);
                    const due = parseDateStr(it.dueDate!);

                    let startColIndex = getDaysBetween(windowStart, start);
                    let endColIndex = getDaysBetween(windowStart, due);

                    const isVisible = !(endColIndex < 0 || startColIndex >= windowDaysCount);

                    return (
                      <div
                        key={it.id}
                        onMouseEnter={() => setHoveredItemId(it.id)}
                        onMouseLeave={() => setHoveredItemId(null)}
                        style={{
                          height: 48,
                          borderBottom: '1px solid var(--border)',
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          background: 'repeating-linear-gradient(90deg, transparent, transparent 39px, var(--border) 39px, var(--border) 40px)',
                        }}
                      >
                        {isVisible && (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${Math.max(0, (startColIndex / windowDaysCount) * 100)}%`,
                              right: `${Math.max(0, 100 - ((endColIndex + 1) / windowDaysCount) * 100)}%`,
                              height: 28,
                              background: getStatusColor(it),
                              borderRadius: 6,
                              boxShadow: 'var(--shadow-sm)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 10px',
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              opacity: updatingId === it.id ? 0.6 : 1,
                              transition: 'left 0.2s ease, right 0.2s ease',
                              cursor: 'pointer',
                            }}
                            onClick={() => navigate(`/planner/${it.id}`)}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {it.title} ({it.startDate} to {it.dueDate})
                            </span>
                            
                            {/* Hover controls for date adjustments */}
                            {hoveredItemId === it.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: 'absolute',
                                  right: 4,
                                  background: 'var(--card)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 4,
                                  padding: 2,
                                  display: 'flex',
                                  gap: 4,
                                  alignItems: 'center',
                                }}
                              >
                                <input
                                  type="date"
                                  value={it.startDate || ''}
                                  title="Start Date"
                                  onChange={(e) => handleDateChange(it.id, 'startDate', e.target.value)}
                                  style={{ border: 'none', background: 'none', fontSize: 10, padding: 2, color: 'var(--text)' }}
                                />
                                <span style={{ color: 'var(--text-muted)' }}>–</span>
                                <input
                                  type="date"
                                  value={it.dueDate || ''}
                                  title="Due Date"
                                  onChange={(e) => handleDateChange(it.id, 'dueDate', e.target.value)}
                                  style={{ border: 'none', background: 'none', fontSize: 10, padding: 2, color: 'var(--text)' }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {scheduledItems.length === 0 && (
                    <div style={{ height: 60, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
                      Timeline empty
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Unscheduled Tasks Tray */}
          <div className="section-card" style={{ padding: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontWeight: 800, fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={16} />
              <span>Unscheduled Items ({unscheduledItems.length})</span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unscheduledItems.map((it) => {
                const dates = editingDates[it.id] || { start: '', due: '' };
                return (
                  <div
                    key={it.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg)',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 200 }}>
                      {it.title}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Start:</span>
                        <input
                          type="date"
                          value={dates.start}
                          onChange={(e) => setEditingDates(prev => ({ ...prev, [it.id]: { ...dates, start: e.target.value } }))}
                          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Due:</span>
                        <input
                          type="date"
                          value={dates.due}
                          onChange={(e) => setEditingDates(prev => ({ ...prev, [it.id]: { ...dates, due: e.target.value } }))}
                          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={() => handleScheduleUnscheduled(it.id, dates.start, dates.due)}
                        disabled={updatingId === it.id || !dates.start || !dates.due}
                      >
                        Schedule
                      </button>
                    </div>
                  </div>
                );
              })}
              {unscheduledItems.length === 0 && (
                <div style={{ padding: '16px', border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                  All items are scheduled on the timeline.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
