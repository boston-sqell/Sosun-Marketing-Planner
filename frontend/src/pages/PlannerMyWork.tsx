/**
 * My Workspace — the planner's per-user landing page (/planner).
 *
 * Person-first view: a private to-do list (plannerPersonalTodos, visible only
 * to the signed-in user) alongside everything the planner engine assigns to
 * them (work items + approvals). Team-wide views live in the other tabs.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Inbox,
  ListTodo,
  Plus,
  Trash2,
} from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi, buildStatusIndex } from '../services/plannerApi';
import type { PersonalTodo, PlannerWorkItem, PlannerWorkflowStatus } from '../services/plannerApi';
import { StatusBadge } from './Planner';
import { PlannerViewTabs } from '../components/PlannerViewTabs';

const todayStr = () => new Date().toISOString().slice(0, 10);

const isOverdue = (due?: string | null) => !!due && due < todayStr();
const isDueSoon = (due?: string | null) => {
  if (!due) return false;
  const t = todayStr();
  if (due < t) return false;
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  return due <= soon.toISOString().slice(0, 10);
};

const fmtDue = (due: string) => {
  const t = todayStr();
  if (due === t) return 'Today';
  const d = new Date(`${due}T00:00:00`);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const PlannerMyWork: React.FC = () => {
  const navigate = useNavigate();

  // Assigned work + approvals (planner engine)
  const [assigned, setAssigned] = useState<PlannerWorkItem[]>([]);
  const [awaiting, setAwaiting] = useState<PlannerWorkItem[]>([]);
  const [statusIndex, setStatusIndex] = useState<Map<string, Map<string, PlannerWorkflowStatus>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Personal to-dos
  const [todos, setTodos] = useState<PersonalTodo[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);
  const [newTodo, setNewTodo] = useState('');
  const [newDue, setNewDue] = useState('');
  const [adding, setAdding] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [activeTab, setActiveTab] = useState<'todo' | 'backlog' | 'draft'>('todo');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [mine, workflows] = await Promise.all([plannerApi.myWork(), plannerApi.config.workflows()]);
        setAssigned(mine.assigned);
        setAwaiting(mine.awaitingApproval);
        setStatusIndex(buildStatusIndex(workflows));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load your work.');
      } finally {
        setLoading(false);
      }
    })();
    (async () => {
      try {
        setTodos(await plannerApi.todos.list());
      } catch {
        /* to-dos are non-critical; the assigned sections still render */
      } finally {
        setTodosLoading(false);
      }
    })();
  }, []);

  // ── Personal to-do actions (optimistic) ────────────────────────────────────

  const addTodo = async () => {
    const text = newTodo.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const todo = await plannerApi.todos.create(text, newDue || null, activeTab);
      setTodos((prev) => [todo, ...prev]);
      setNewTodo('');
      setNewDue('');
    } catch {
      alert('Failed to add to-do');
    } finally {
      setAdding(false);
    }
  };

  const toggleTodo = async (todo: PersonalTodo) => {
    const done = !todo.done;
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done } : t)));
    try {
      await plannerApi.todos.update(todo.id, { done });
    } catch {
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: !done } : t)));
    }
  };

  const deleteTodo = async (id: string) => {
    const prev = todos;
    setTodos((p) => p.filter((t) => t.id !== id));
    try {
      await plannerApi.todos.delete(id);
    } catch {
      setTodos(prev);
    }
  };

  // ── Derived groupings ───────────────────────────────────────────────────────

  const openTodos = useMemo(
    () =>
      todos
        .filter((t) => !t.done && (t.list === activeTab || (!t.list && activeTab === 'todo')))
        .sort((a, b) => {
          // Overdue → dated (soonest first) → undated, newest last within groups.
          const ad = a.dueDate ?? '9999-99-99';
          const bd = b.dueDate ?? '9999-99-99';
          return ad.localeCompare(bd);
        }),
    [todos, activeTab],
  );
  const doneTodos = useMemo(
    () => todos.filter((t) => t.done && (t.list === activeTab || (!t.list && activeTab === 'todo'))),
    [todos, activeTab],
  );

  const statusMeta = (item: PlannerWorkItem) => statusIndex.get(item.workflowId)?.get(item.status);

  const activeAssigned = useMemo(() => {
    return assigned.filter((i) => {
      const meta = statusMeta(i);
      return meta?.category !== 'done';
    });
  }, [assigned, statusIndex]);

  const overdueAssigned = useMemo(() => activeAssigned.filter((i) => isOverdue(i.dueDate)), [activeAssigned]);
  const dueSoonAssigned = useMemo(() => activeAssigned.filter((i) => isDueSoon(i.dueDate)), [activeAssigned]);
  const laterAssigned = useMemo(
    () => activeAssigned.filter((i) => !isOverdue(i.dueDate) && !isDueSoon(i.dueDate)),
    [activeAssigned],
  );

  // ── Renderers ───────────────────────────────────────────────────────────────

  const summaryChip = (Icon: typeof Inbox, label: string, count: number, accent?: string) => (
    <div
      className="section-card"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flex: '1 1 150px', minWidth: 150 }}
    >
      <Icon size={18} style={{ color: accent || 'var(--text-muted)' }} />
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: accent }}>{count}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );

  const todoRow = (todo: PersonalTodo) => (
    <div
      key={todo.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <button
        onClick={() => toggleTodo(todo)}
        aria-label={todo.done ? 'Mark as not done' : 'Mark as done'}
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          flexShrink: 0,
          border: todo.done ? 'none' : '2px solid var(--border)',
          background: todo.done ? 'var(--primary)' : 'transparent',
          color: '#fff',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        {todo.done && <Check size={13} strokeWidth={3} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {todo.taskId ? (
          <span
            onClick={() => navigate(`/planner/${todo.taskId}`)}
            style={{
              fontSize: 14,
              textDecoration: todo.done ? 'line-through' : 'underline',
              color: todo.done ? 'var(--text-muted)' : 'var(--primary)',
              overflowWrap: 'anywhere',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {todo.text}
          </span>
        ) : (
          <span
            style={{
              fontSize: 14,
              textDecoration: todo.done ? 'line-through' : 'none',
              color: todo.done ? 'var(--text-muted)' : 'var(--text)',
              overflowWrap: 'anywhere',
            }}
          >
            {todo.text}
          </span>
        )}
        {todo.dueDate && !todo.done && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: isOverdue(todo.dueDate) ? '#fef2f2' : 'var(--bg)',
              color: isOverdue(todo.dueDate) ? '#b91c1c' : 'var(--text-muted)',
              border: `1px solid ${isOverdue(todo.dueDate) ? '#fecaca' : 'var(--border)'}`,
              whiteSpace: 'nowrap',
            }}
          >
            {isOverdue(todo.dueDate) ? `Overdue · ${fmtDue(todo.dueDate)}` : fmtDue(todo.dueDate)}
          </span>
        )}
      </div>
      <button
        onClick={() => deleteTodo(todo.id)}
        aria-label="Delete to-do"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', opacity: 0.5, padding: 4 }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const itemCard = (item: PlannerWorkItem, overdue = false) => (
    <div
      key={item.id}
      className="section-card"
      onClick={() => navigate(`/planner/${item.id}`)}
      style={{
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        borderLeft: overdue ? '3px solid #dc2626' : undefined,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        <div style={{ fontSize: 12, color: overdue ? '#b91c1c' : 'var(--text-muted)', marginTop: 4 }}>
          {item.typeId}
          {item.dueDate ? ` · Due ${fmtDue(item.dueDate)}` : ''}
          {item.priority && item.priority !== 'normal' ? ` · ${item.priority}` : ''}
        </div>
      </div>
      <StatusBadge status={item.status} meta={statusMeta(item)} />
    </div>
  );

  const itemGroup = (title: string, Icon: typeof Inbox, list: PlannerWorkItem[], opts?: { overdue?: boolean; empty?: string }) => {
    if (list.length === 0 && !opts?.empty) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Icon size={15} style={{ color: opts?.overdue ? '#dc2626' : undefined }} />
          <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: opts?.overdue ? '#dc2626' : undefined }}>{title}</h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({list.length})</span>
        </div>
        {list.length === 0 ? (
          <div className="section-card" style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {opts?.empty}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{list.map((i) => itemCard(i, opts?.overdue))}</div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <PlannerViewTabs />
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 14 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {summaryChip(ListTodo, 'Open to-dos', todos.filter(t => !t.done).length)}
        {summaryChip(Inbox, 'Assigned to me', activeAssigned.length)}
        {summaryChip(AlertTriangle, 'Overdue', overdueAssigned.length + todos.filter((t) => !t.done && isOverdue(t.dueDate)).length, overdueAssigned.length ? '#dc2626' : undefined)}
        {summaryChip(ClipboardCheck, 'Awaiting my approval', awaiting.length, awaiting.length ? 'var(--primary)' : undefined)}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── My to-dos (private) ── */}
        <div style={{ flex: '1 1 340px', minWidth: 320, maxWidth: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ListTodo size={15} />
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0 }}>My to-dos</h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 8px' }}>
              Only visible to you
            </span>
          </div>

          <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Segmented Control / Tab Bar for Todo, Backlog, Draft */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', padding: 4 }}>
              {(['todo', 'backlog', 'draft'] as const).map((tab) => {
                const count = todos.filter((t) => !t.done && (t.list === tab || (!t.list && tab === 'todo'))).length;
                const label = tab === 'todo' ? 'To Do' : tab === 'backlog' ? 'Backlog' : 'Draft';
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: isActive ? 'var(--card)' : 'transparent',
                      color: isActive ? 'var(--text)' : 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                    }}
                  >
                    {label}
                    {count > 0 && (
                      <span
                        style={{
                          background: isActive ? 'var(--primary)' : 'var(--border)',
                          color: isActive ? '#fff' : 'var(--text-muted)',
                          padding: '1px 5px',
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Quick add */}
            <div style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
              <input
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTodo()}
                placeholder={`Add to ${activeTab === 'todo' ? 'To Do' : activeTab === 'backlog' ? 'Backlog' : 'Draft'}…`}
                style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 14, background: 'var(--card)', color: 'var(--text)' }}
              />
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                aria-label="Due date (optional)"
                style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 13, background: 'var(--card)', color: 'var(--text-muted)', width: 130 }}
              />
              <button
                onClick={addTodo}
                disabled={!newTodo.trim() || adding}
                aria-label="Add to-do"
                style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '0 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', opacity: !newTodo.trim() || adding ? 0.5 : 1 }}
              >
                <Plus size={16} />
              </button>
            </div>

            {todosLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading to-dos…</div>
            ) : openTodos.length === 0 && doneTodos.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Your list is empty. Add your first to-do above.
              </div>
            ) : (
              <>
                {openTodos.map(todoRow)}
                {doneTodos.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowCompleted((s) => !s)}
                      style={{ width: '100%', background: 'var(--bg)', border: 'none', borderTop: '1px solid var(--border)', padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Completed ({doneTodos.length})
                    </button>
                    {showCompleted && doneTodos.map(todoRow)}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Assigned work & approvals ── */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          {loading ? (
            <LoadingSpinner message="Loading your work…" />
          ) : (
            <>
              {awaiting.length > 0 && itemGroup('Awaiting my approval', ClipboardCheck, awaiting)}
              {itemGroup('Overdue', AlertTriangle, overdueAssigned, { overdue: true })}
              {itemGroup('Due in the next 7 days', CalendarClock, dueSoonAssigned)}
              {itemGroup(
                overdueAssigned.length || dueSoonAssigned.length ? 'Later / no due date' : 'Assigned to me',
                Inbox,
                laterAssigned,
                { empty: activeAssigned.length === 0 ? 'Nothing is assigned to you right now.' : undefined },
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
