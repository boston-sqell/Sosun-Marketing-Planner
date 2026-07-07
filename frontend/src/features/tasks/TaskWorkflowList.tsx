import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, User, Edit, CheckCircle2, Clock, AlertCircle, Layers } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBrandScope } from '../../context/BrandScopeContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { toDisplayDate } from '../../utils/dateUtils';
import { mockTasks, mockUsers } from '../../mockData';
import type { TaskData, UserItem } from '../../types';
import { tasksApi } from '../../services/tasksApi';
import { plannerApi } from '../../services/plannerApi';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { TaskFilters } from './TaskFilters';
import { TaskFormModal } from './TaskFormModal';
import { TaskDetailModal } from './TaskDetailModal';
import { useTaskWorkflow } from './useTaskWorkflow';

const STATUS_OPTIONS = [
  'Requested', 'Idea', 'Brief Needed', 'Brief Sent',
  'Draft Ready', 'In Review', 'Revision Needed',
  'Approved', 'Scheduled', 'Published', 'Completed',
];
const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'Facebook', 'WhatsApp Status', 'YouTube', 'Twitter', 'LinkedIn', 'Print Out', 'Other'];

const DISPLAY_STEP = 10;

const StatPill: React.FC<{ label: string; count: number; color: string; icon: React.ReactNode }> = ({ label, count, color, icon }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '10px',
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: '10px', padding: '12px 16px', flex: '1 1 140px',
  }}>
    <span style={{ color, background: `${color}18`, borderRadius: '8px', padding: '6px', display: 'flex' }}>{icon}</span>
    <div>
      <div style={{ fontSize: '20px', fontWeight: 800, lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
    </div>
  </div>
);

/** Adds a task/meeting to the current user's personal workspace as a to-do. */
const WorkspaceSelect: React.FC<{ task: TaskData; compact?: boolean }> = ({ task, compact }) => (
  <select
    value=""
    onClick={(e) => e.stopPropagation()}
    onChange={async (e) => {
      const list = e.target.value as 'todo' | 'backlog' | 'draft';
      if (!list) return;
      try {
        await plannerApi.todos.create(task.title, task.scheduledDate || task.sharedDate || null, list, task.id);
        alert(`Task added to your workspace as ${list === 'todo' ? 'To Do' : list === 'backlog' ? 'Backlog' : 'Draft'}!`);
      } catch {
        alert('Failed to add task to workspace');
      }
      e.target.value = '';
    }}
    style={{
      padding: compact ? '4px 6px' : '4px 8px',
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
);

interface TaskWorkflowListProps {
  /** newDate deep-link (?newDate=YYYY-MM-DD) → auto-open the create modal. */
  newDate?: string | null;
}

export const TaskWorkflowList: React.FC<TaskWorkflowListProps> = ({ newDate }) => {
  const { profile } = useAuth();
  const { brands: brandCatalog } = useBrandScope();
  const role = profile?.role || 'internal';
  const isAgency = role === 'agency';
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [displayCount, setDisplayCount] = useState(DISPLAY_STEP);

  // Filters
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterProgress, setFilterProgress] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterType, setFilterType] = useState<'All' | 'task' | 'meeting'>('All');

  const loadTasks = async () => {
    setLoading(true);
    try {
      const res = await tasksApi.listAll();
      setTasks(res.tasks && res.tasks.length ? res.tasks : mockTasks);
    } catch (err) {
      console.error('Error loading tasks, using mock:', err);
      setTasks(mockTasks);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserItem));
      setUsersList(list.length ? list : mockUsers);
    } catch {
      setUsersList(mockUsers);
    }
  };

  const wf = useTaskWorkflow({
    role,
    profileName: profile?.displayName || 'User',
    usersList,
    onRefresh: loadTasks,
  });

  useEffect(() => {
    loadTasks();
    loadUsers();
  }, []);

  // Deep link: ?newDate=... opens the create modal once.
  useEffect(() => {
    if (newDate) {
      wf.handleOpenAdd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDate]);

  const activeFilterCount = [filterBrand, filterStatus, filterAssigned, filterPlatform, filterProgress, filterDateFrom, filterDateTo, filterType !== 'All' ? 'type' : ''].filter(Boolean).length;

  const clearFilters = () => {
    setFilterBrand(''); setFilterStatus(''); setFilterAssigned('');
    setFilterPlatform(''); setFilterProgress('');
    setFilterDateFrom(''); setFilterDateTo('');
    setFilterType('All');
    setDisplayCount(DISPLAY_STEP);
  };

  const baseList = useMemo(() => {
    if (role === 'agency') {
      return tasks.filter(t =>
        t.type === 'meeting'
          ? t.visibility === 'agency'
          : t.assignedTo === 'Agency' || t.assignedTo === 'Both'
      );
    } else if (role === 'media' || role === 'sponsor' || role === 'supplier') {
      return tasks.filter(t => t.type === 'meeting' && t.visibility === 'external');
    }
    return tasks;
  }, [tasks, role]);

  const filteredTasks = useMemo(() => {
    let r = baseList;
    if (filterType !== 'All') r = r.filter(t => (t.type || 'task') === filterType);
    if (filterBrand) r = r.filter(t => t.brand === filterBrand);
    if (filterStatus) r = r.filter(t => t.status === filterStatus);
    if (filterAssigned) r = r.filter(t => t.assignedTo === filterAssigned);
    if (filterPlatform) r = r.filter(t => (t.platforms || []).includes(filterPlatform));
    if (filterProgress === '0') r = r.filter(t => (t.progress || 0) === 0);
    else if (filterProgress === 'partial') r = r.filter(t => (t.progress || 0) > 0 && (t.progress || 0) < 100);
    else if (filterProgress === '100') r = r.filter(t => (t.progress || 0) === 100);
    if (filterDateFrom) r = r.filter(t => t.createdAt && t.createdAt >= filterDateFrom);
    if (filterDateTo) r = r.filter(t => t.createdAt && t.createdAt <= filterDateTo + 'T23:59:59');
    return r;
  }, [baseList, filterType, filterBrand, filterStatus, filterAssigned, filterPlatform, filterProgress, filterDateFrom, filterDateTo]);

  const displayedTasks = filteredTasks.slice(0, displayCount);
  const hasMoreToShow = displayCount < filteredTasks.length;

  const totalTasks = baseList.length;
  const publishedCount = baseList.filter(t => t.status === 'Published' || t.status === 'Completed').length;
  const inReviewCount = baseList.filter(t => ['In Review', 'Draft Ready', 'Revision Needed'].includes(t.status)).length;
  const overdueCount = baseList.filter(t => t.overdue === true).length;

  const canManage = role === 'admin' || role === 'internal';

  return (
    <div className="tasks-view-wrap">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        {canManage && !isMobile && (
          <button className="btn btn-primary" onClick={wf.handleOpenAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={16} /><span>Create task or meeting</span>
          </button>
        )}
      </div>

      {loading ? <LoadingSpinner message="Loading tasks..." /> : (
        <>
          {/* Stats row — staff only, desktop only */}
          {canManage && !isMobile && (
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <StatPill label="Total Tasks" count={totalTasks} color="var(--primary)" icon={<Layers size={16} />} />
              <StatPill label="Live / Done" count={publishedCount} color="#16a34a" icon={<CheckCircle2 size={16} />} />
              <StatPill label="Awaiting Review" count={inReviewCount} color="#d97706" icon={<Clock size={16} />} />
              <StatPill label="Overdue" count={overdueCount} color="var(--red)" icon={<AlertCircle size={16} />} />
            </div>
          )}

          <TaskFilters
            filtersOpen={filtersOpen}
            setFiltersOpen={setFiltersOpen}
            activeFilterCount={activeFilterCount}
            clearFilters={clearFilters}
            displayCount={displayCount}
            filteredTasksLength={filteredTasks.length}
            filterType={filterType}
            setFilterType={(v) => setFilterType(v as 'All' | 'task' | 'meeting')}
            filterBrand={filterBrand}
            setFilterBrand={setFilterBrand}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterAssigned={filterAssigned}
            setFilterAssigned={setFilterAssigned}
            filterPlatform={filterPlatform}
            setFilterPlatform={setFilterPlatform}
            filterProgress={filterProgress}
            setFilterProgress={setFilterProgress}
            filterDateFrom={filterDateFrom}
            setFilterDateFrom={setFilterDateFrom}
            setDisplayCount={setDisplayCount}
            displayStep={DISPLAY_STEP}
            brandCatalog={brandCatalog}
            statusOptions={STATUS_OPTIONS}
            platformOptions={PLATFORM_OPTIONS}
            isAgency={isAgency}
            role={role}
          />

          <div className="section-card" style={{ padding: 0, overflowX: 'auto' }}>
            {filteredTasks.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No tasks match your filters.
              </div>
            ) : (
              <>
                {isMobile ? (
                  <div className="tasks-mobile-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', width: '100%', boxSizing: 'border-box' }}>
                    {displayedTasks.map(t => {
                      const isMeeting = t.type === 'meeting';
                      return (
                        <div
                          key={t.id}
                          className="task-mobile-card"
                          onClick={() => wf.openDetail(t)}
                          style={{
                            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px',
                            padding: '16px', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
                            display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h4 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text)', margin: 0, wordBreak: 'break-word' }}>
                                {isMeeting ? `📅 [Meeting] ${t.title}` : t.title}
                              </h4>
                              <span style={{ fontSize: '10px', color: 'var(--text-light)', fontFamily: 'monospace' }}>{t.id.slice(0, 14)}…</span>
                            </div>
                            <span className={`badge ${isMeeting ? 'scheduled' : (t.status || 'Idea').toLowerCase().replace(/ /g, '-')}`} style={{ marginLeft: '8px' }}>
                              {isMeeting ? (t.status || 'Scheduled') : (t.status || 'Idea')}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            <span className="badge low" style={{ fontSize: '10px', padding: '2px 8px' }}>{t.brand}</span>
                            {isMeeting ? (
                              <span className="badge low" style={{ fontSize: '10px', padding: '2px 8px', borderColor: 'var(--primary-light)', color: 'var(--primary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.location || 'No location'}
                              </span>
                            ) : (
                              (t.platforms || []).map((p, i) => (
                                <span key={i} className="badge low" style={{ fontSize: '10px', padding: '2px 8px', borderColor: 'var(--primary-light)', color: 'var(--primary)' }}>{p}</span>
                              ))
                            )}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <User size={12} style={{ color: 'var(--text-muted)' }} />
                              <span style={{ color: 'var(--text-muted)' }}>
                                {isMeeting ? (t.visibility === 'internal' ? 'Internal' : t.visibility === 'agency' ? 'Marketing Agency' : 'External') : t.assignedTo}
                              </span>
                            </div>
                            {isMeeting ? (
                              <span style={{ fontSize: '11px', fontWeight: 700 }}>Meeting</span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700 }}>{t.progress || 0}%</span>
                                <div style={{ width: '40px', height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${t.progress || 0}%`, backgroundColor: t.progress === 100 ? '#16a34a' : 'var(--primary)' }} />
                                </div>
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }} onClick={e => e.stopPropagation()}>
                            <WorkspaceSelect task={t} compact />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {canManage && (
                                <>
                                  <button onClick={() => wf.handleOpenEdit(t)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '4px' }}>
                                    <Edit size={14} />
                                  </button>
                                  {role === 'admin' && (
                                    <button onClick={() => wf.handleDelete(t.id, t)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '4px' }}>
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Task / Meeting</th>
                        <th>Brand</th>
                        <th>Platforms / Location</th>
                        <th>Status</th>
                        <th>Assigned / Visibility</th>
                        <th>Progress</th>
                        <th>Review / Scheduled Date</th>
                        <th>Workspace</th>
                        <th style={{ width: '72px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedTasks.map(t => {
                        const isOD = t.overdue === true;
                        const isMeeting = t.type === 'meeting';
                        return (
                          <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => wf.openDetail(t)}>
                            <td style={{ maxWidth: '260px' }}>
                              <div style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>
                                {isMeeting ? `📅 [Meeting] ${t.title}` : t.title}
                              </div>
                              <span style={{ fontSize: '10px', color: 'var(--text-light)', fontFamily: 'monospace' }}>{t.id.slice(0, 14)}…</span>
                            </td>
                            <td>
                              <span className="badge low" style={{ fontSize: '10px', padding: '2px 8px', whiteSpace: 'nowrap' }}>{t.brand}</span>
                            </td>
                            <td>
                              {isMeeting ? (
                                <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }} title={t.location}>{t.location || '—'}</div>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                  {(t.platforms || []).slice(0, 2).map((p, i) => (
                                    <span key={i} className="badge low" style={{ fontSize: '10px', padding: '1px 6px' }}>{p}</span>
                                  ))}
                                  {(t.platforms || []).length > 2 && (
                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', alignSelf: 'center' }}>+{t.platforms!.length - 2}</span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${(t.status || (isMeeting ? 'Scheduled' : 'Idea')).toLowerCase().replace(/ /g, '-')}`}>{t.status || (isMeeting ? 'Scheduled' : 'Idea')}</span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', whiteSpace: 'nowrap' }}>
                                <User size={12} />
                                <span>
                                  {isMeeting ? (t.visibility === 'internal' ? 'Internal' : t.visibility === 'agency' ? 'Marketing Agency' : `External (${(t.invitedGuests || []).length} guest(s))`) : t.assignedTo}
                                </span>
                              </div>
                            </td>
                            <td style={{ minWidth: '90px' }}>
                              {isMeeting ? '—' : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <div style={{ flex: 1, height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden', minWidth: '44px' }}>
                                    <div style={{ height: '100%', width: `${t.progress || 0}%`, backgroundColor: t.progress === 100 ? '#16a34a' : 'var(--primary)', transition: 'width 0.3s' }} />
                                  </div>
                                  <span style={{ fontSize: '11px', fontWeight: 600, minWidth: '30px' }}>{t.progress || 0}%</span>
                                </div>
                              )}
                            </td>
                            <td>
                              <span style={{ color: isOD ? 'var(--red)' : 'var(--text-muted)', fontSize: '12px', fontWeight: isOD ? 700 : 400, whiteSpace: 'nowrap' }}>
                                {isMeeting ? (t.startDate ? new Date(t.startDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—') : (toDisplayDate(t.sharedDate || t.reviewDeadline) || '—')}
                              </span>
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              <WorkspaceSelect task={t} />
                            </td>
                            <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                {canManage && (
                                  <>
                                    <button className="btn-icon" onClick={() => wf.handleOpenEdit(t)} style={{ padding: '6px' }} title="Edit"><Edit size={12} /></button>
                                    {role === 'admin' && (
                                      <button className="btn-icon" onClick={() => wf.handleDelete(t.id, t)} style={{ padding: '6px', color: 'var(--red)' }} title="Delete"><Trash2 size={12} /></button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {hasMoreToShow && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px', textAlign: 'center' }}>
                    <button className="btn btn-secondary" onClick={() => setDisplayCount(c => c + DISPLAY_STEP)} style={{ fontSize: '13px' }}>
                      Load More ({filteredTasks.length - displayCount} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Mobile FAB */}
      {isMobile && canManage && (
        <button
          onClick={wf.handleOpenAdd}
          style={{
            position: 'fixed', bottom: '80px', right: '20px', zIndex: 850,
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none',
            borderRadius: '50%', width: '56px', height: '56px', display: 'flex',
            alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-lg)', cursor: 'pointer',
          }}
          aria-label="Create task or meeting"
        >
          <Plus size={24} />
        </button>
      )}

      <TaskFormModal
        isOpen={wf.isModalOpen}
        onClose={wf.closeForm}
        taskToEdit={wf.editingTask}
        onSave={wf.handleSave}
        brandCatalog={brandCatalog}
        usersList={usersList}
        initialDate={newDate || undefined}
      />

      {wf.selectedTask && (
        <TaskDetailModal
          isOpen={wf.isDetailOpen}
          onClose={wf.closeDetail}
          task={wf.selectedTask}
          onEdit={wf.handleOpenEdit}
          onDelete={(id) => wf.handleDelete(id)}
          role={role}
          usersList={usersList}
          profileName={profile?.displayName || 'Unknown'}
          onTaskUpdated={(updatedTask) => {
            wf.setSelectedTask(updatedTask);
            setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
          }}
        />
      )}
    </div>
  );
};
