import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { triggerSheetsBackup } from '../services/syncApi';
import { pushApi } from '../services/pushApi';
import { db } from '../firebase/config';
import { collection, doc, getDocs } from 'firebase/firestore';
import {
  Plus, Trash2, User, Edit, X, Filter, ChevronDown,
  RotateCcw, CheckCircle2, Clock, AlertCircle, Layers, Video,
} from 'lucide-react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { toDisplayDate } from '../utils/dateUtils';
import { mockTasks, mockUsers } from '../mockData';
import type { TaskData, ChecklistItem, UserItem } from '../types';
import { tasksApi } from '../services/tasksApi';
import { logActivity } from '../utils/activityLogger';

const STATUS_OPTIONS = [
  'Requested', 'Idea', 'Brief Needed', 'Brief Sent',
  'Draft Ready', 'In Review', 'Revision Needed',
  'Approved', 'Scheduled', 'Published', 'Completed',
];
const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'Facebook', 'WhatsApp Status', 'YouTube', 'Twitter', 'LinkedIn', 'Print Out', 'Other'];
const CONTENT_TYPES    = ['Reel', 'Video', 'Image', 'Carousel', 'Story', 'Design', 'Other'];

const DISPLAY_STEP = 10;

// ── Stat card ────────────────────────────────────────────────────────────────
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

export const Tasks: React.FC = () => {
  const { profile } = useAuth();
  const { brands: brandCatalog } = useBrandScope();
  const role     = profile?.role || 'internal';
  const isAgency = role === 'agency';
  const isMobile = useMediaQuery('(max-width: 768px)');

  // ── Data ──────────────────────────────────────────────────────────────────
  const [tasks, setTasks]     = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Modals ────────────────────────────────────────────────────────────────
  const [isModalOpen,   setIsModalOpen]   = useState(false);
  const [isDetailOpen,  setIsDetailOpen]  = useState(false);
  const [selectedTask,  setSelectedTask]  = useState<TaskData | null>(null);
  const [filtersOpen,   setFiltersOpen]   = useState(false);

  // ── Users list for guest invites ──────────────────────────────────────────
  const [usersList, setUsersList] = useState<UserItem[]>([]);

  // ── Form types & meeting specific fields ──────────────────────────────────
  const [formType, setFormType] = useState<'task' | 'meeting'>('task');
  const [meetingVisibility, setMeetingVisibility] = useState<'internal' | 'agency' | 'external'>('internal');
  const [meetingStartDate, setMeetingStartDate] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingAgenda, setMeetingAgenda] = useState('');
  const [invitedGuests, setInvitedGuests] = useState<string[]>([]);

  // ── Display pagination ────────────────────────────────────────────────────
  const [displayCount, setDisplayCount] = useState(DISPLAY_STEP);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [filterBrand,    setFilterBrand]    = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterProgress, setFilterProgress] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo,   setFilterDateTo]   = useState('');
  const [filterType,     setFilterType]     = useState<'All' | 'task' | 'meeting'>('All');

  const activeFilterCount = [filterBrand, filterStatus, filterAssigned, filterPlatform, filterProgress, filterDateFrom, filterDateTo, filterType !== 'All' ? 'type' : ''].filter(Boolean).length;

  const clearFilters = () => {
    setFilterBrand(''); setFilterStatus(''); setFilterAssigned('');
    setFilterPlatform(''); setFilterProgress('');
    setFilterDateFrom(''); setFilterDateTo('');
    setFilterType('All');
    setDisplayCount(DISPLAY_STEP);
  };

  // ── Form fields ───────────────────────────────────────────────────────────
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [title,           setTitle]           = useState('');
  const [brand,           setBrand]           = useState('Sosun Fihaara');
  const [platformsInput,  setPlatformsInput]  = useState('Instagram');
  const [contentType,     setContentType]     = useState('Reel');
  const [campaignId,      setCampaignId]      = useState('');
  const [priority,        setPriority]        = useState('Medium');
  const [status,          setStatus]          = useState('Idea');
  const [assignedTo,      setAssignedTo]      = useState('Internal');
  const [sharedDate,      setSharedDate]      = useState('');
  const [scheduledDate,   setScheduledDate]   = useState('');
  const [caption,         setCaption]         = useState('');
  const [notes,           setNotes]           = useState('');
  const [assetLink,       setAssetLink]       = useState('');
  const [newComment,      setNewComment]      = useState('');
  const [newCheckItem,    setNewCheckItem]    = useState('');

  // ── Load all tasks (client-side filtering) ────────────────────────────────
  const loadTasks = async () => {
    setLoading(true);
    try {
      const list = await tasksApi.list();
      setTasks(list.length ? list : mockTasks);
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

  useEffect(() => {
    loadTasks();
    loadUsers();
    const params  = new URLSearchParams(window.location.search);
    const datePrm = params.get('newDate');
    if (datePrm) {
      resetForm();
      setScheduledDate(datePrm);
      setIsModalOpen(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // ── Filtered + paginated list ─────────────────────────────────────────────
  const baseList = useMemo(() => {
    if (role === 'agency') {
      return tasks.filter(t => 
        t.type === 'meeting' 
          ? t.visibility === 'agency'
          : t.assignedTo === 'Agency' || t.assignedTo === 'Both'
      );
    } else if (role === 'media' || role === 'sponsor' || role === 'supplier') {
      return tasks.filter(t => 
        t.type === 'meeting' && t.visibility === 'external'
      );
    }
    return tasks;
  }, [tasks, role]);

  const filteredTasks = useMemo(() => {
    let r = baseList;
    if (filterType !== 'All') {
      r = r.filter(t => (t.type || 'task') === filterType);
    }
    if (filterBrand)    r = r.filter(t => t.brand === filterBrand);
    if (filterStatus)   r = r.filter(t => t.status === filterStatus);
    if (filterAssigned) r = r.filter(t => t.assignedTo === filterAssigned);
    if (filterPlatform) r = r.filter(t => (t.platforms || []).includes(filterPlatform));
    if (filterProgress === '0')       r = r.filter(t => (t.progress || 0) === 0);
    else if (filterProgress === 'partial') r = r.filter(t => (t.progress || 0) > 0 && (t.progress || 0) < 100);
    else if (filterProgress === '100') r = r.filter(t => (t.progress || 0) === 100);
    if (filterDateFrom) r = r.filter(t => t.createdAt && t.createdAt >= filterDateFrom);
    if (filterDateTo)   r = r.filter(t => t.createdAt && t.createdAt <= filterDateTo + 'T23:59:59');
    return r;
  }, [baseList, filterType, filterBrand, filterStatus, filterAssigned, filterPlatform, filterProgress, filterDateFrom, filterDateTo]);

  const displayedTasks  = filteredTasks.slice(0, displayCount);
  const hasMoreToShow   = displayCount < filteredTasks.length;

  // Stats
  const totalTasks     = baseList.length;
  const publishedCount = baseList.filter(t => t.status === 'Published' || t.status === 'Completed').length;
  const inReviewCount  = baseList.filter(t => ['In Review', 'Draft Ready', 'Revision Needed'].includes(t.status)).length;
  const overdueCount   = baseList.filter(t => t.overdue === true).length;

  // ── Form helpers ──────────────────────────────────────────────────────────
  const resetForm = () => {
    setEditingId(null);
    setFormType('task');
    setTitle(''); setBrand('Sosun Fihaara');
    setPlatformsInput('Instagram'); setContentType('Reel');
    setCampaignId(''); setPriority('Medium'); setStatus('Idea');
    setAssignedTo('Internal'); setSharedDate(''); setScheduledDate('');
    setCaption(''); setNotes(''); setAssetLink('');

    setMeetingVisibility('internal');
    setMeetingStartDate('');
    setMeetingLocation('');
    setMeetingAgenda('');
    setInvitedGuests([]);
  };

  const handleOpenAdd = () => { resetForm(); setIsModalOpen(true); };

  const handleOpenEdit = (t: TaskData) => {
    setEditingId(t.id);
    setFormType(t.type || 'task');
    setTitle(t.title); setBrand(t.brand);
    setPlatformsInput(t.platforms ? t.platforms.join(', ') : '');
    setContentType(t.contentType); setCampaignId(t.campaignId || '');
    setPriority(t.priority); setStatus(t.status); setAssignedTo(t.assignedTo);
    setSharedDate(t.sharedDate || t.reviewDeadline || '');
    setScheduledDate(t.scheduledDate || '');
    setCaption(t.caption || ''); setNotes(t.notes || ''); setAssetLink(t.assetLink || '');

    setMeetingVisibility(t.visibility || 'internal');
    setMeetingStartDate(t.startDate || '');
    setMeetingLocation(t.location || '');
    setMeetingAgenda(t.agenda || '');
    setInvitedGuests(t.invitedGuests || []);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !brand) return;
    const id = editingId || doc(collection(db, 'tasks')).id;

    let payload: Partial<TaskData> = {};
    if (formType === 'meeting') {
      let calculatedEndDate = '';
      if (meetingStartDate) {
        const startObj = new Date(meetingStartDate);
        if (!isNaN(startObj.getTime())) {
          const endObj = new Date(startObj.getTime() + 60 * 60 * 1000);
          const year = endObj.getFullYear();
          const month = String(endObj.getMonth() + 1).padStart(2, '0');
          const day = String(endObj.getDate()).padStart(2, '0');
          const hours = String(endObj.getHours()).padStart(2, '0');
          const minutes = String(endObj.getMinutes()).padStart(2, '0');
          calculatedEndDate = `${year}-${month}-${day}T${hours}:${minutes}`;
        }
      }
      payload = {
        type: 'meeting',
        title, brand,
        visibility: meetingVisibility,
        startDate: meetingStartDate,
        endDate: calculatedEndDate,
        location: meetingLocation,
        agenda: meetingAgenda,
        notes,
        assetLink,
        invitedGuests: meetingVisibility === 'external' ? invitedGuests : [],
        status: status || 'Scheduled',
        createdAt: editingId ? undefined : new Date().toISOString(),
      };
    } else {
      payload = {
        type: 'task',
        title, brand,
        platforms: platformsInput.split(',').map(p => p.trim()).filter(Boolean),
        contentType, campaignId, priority, status, assignedTo,
        sharedDate, scheduledDate, caption, notes, assetLink,
        createdAt: editingId ? undefined : new Date().toISOString(),
      };
    }

    try {
      if (editingId) {
        const prev = tasks.find(t => t.id === editingId);
        
        // Find matching status doc to pass correct status details to backend if status changed
        const newStatus = payload.status;
        const newStatusId = (newStatus && STATUS_OPTIONS.indexOf(newStatus) >= 0)
          ? newStatus.toLowerCase().replace(/[^a-z0-9]+/g, '-') 
          : 'to-do';
          
        const cleanPayload = Object.fromEntries(
          Object.entries({ ...payload, statusId: newStatusId }).filter(([_, v]) => v !== undefined)
        );
        await tasksApi.update(editingId, cleanPayload);

        if (formType === 'meeting') {
          await pushApi.notifyMeetingScheduled(id, title, meetingVisibility, 'Rescheduled', invitedGuests).catch(err => console.error('Push notify err:', err));
        } else {
          if (prev && prev.assignedTo !== assignedTo) {
            pushApi.notifyTaskAssignment(editingId, title, assignedTo, 'Reassigned').catch(err => console.error('Push notify err:', err));
          }
        }

        const changed = prev && prev.status !== status;
        await logActivity(
          profile?.displayName || 'User', role,
          formType === 'meeting' ? 'task' : (changed && status === 'Approved' ? 'approval' : 'task'),
          formType === 'meeting' ? 'updated meeting details of' : (changed ? (status === 'Approved' ? 'approved task' : `updated status to "${status}" for`) : 'updated task details of'),
          title, editingId
        );
      } else {
        const newStatusId = status 
          ? status.toLowerCase().replace(/[^a-z0-9]+/g, '-') 
          : 'to-do';
        const newTask: TaskData = {
          id,
          submittedBy: profile?.displayName || 'User',
          checklist: [], comments: [], progress: 0,
          createdAt: new Date().toISOString(),
          statusId: newStatusId,
          ...payload
        } as TaskData;
        await tasksApi.create(newTask);

        if (formType === 'meeting') {
          await pushApi.notifyMeetingScheduled(id, title, meetingVisibility, 'Scheduled', invitedGuests).catch(err => console.error('Push notify err:', err));
        } else {
          pushApi.notifyTaskAssignment(id, title, assignedTo, 'Assigned').catch(err => console.error('Push notify err:', err));
        }

        await logActivity(profile?.displayName || 'User', role, 'task', formType === 'meeting' ? 'scheduled meeting' : 'created task', title, id);
      }
      triggerSheetsBackup();
      setIsModalOpen(false);
      loadTasks();
    } catch (err) {
      alert('Could not save meeting/task: ' + (err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    const t = tasks.find(x => x.id === id);
    if (!window.confirm(`Delete "${t?.title || id}"?`)) return;
    try {
      if (t?.type === 'meeting') {
        await pushApi.notifyMeetingScheduled(id, t.title, t.visibility || 'internal', 'Deleted').catch(err => console.error('Delete calendar notify error:', err));
      }
      await tasksApi.delete(id);
      setIsDetailOpen(false);
      loadTasks();
      if (t) await logActivity(profile?.displayName || 'User', role, 'task', t.type === 'meeting' ? 'deleted meeting' : 'deleted task', t.title, id);
    } catch (err: any) {
      alert('Could not delete: ' + err.message);
    }
  };

  const handleAddComment = async () => {
    if (!selectedTask || !newComment.trim()) return;
    try {
      const commentObj = await tasksApi.addComment(selectedTask.id, newComment, false);
      const updated = [...(selectedTask.comments || []), commentObj];
      const upd = { ...selectedTask, comments: updated };
      setSelectedTask(upd); setNewComment('');
      setTasks(prev => prev.map(t => t.id === selectedTask.id ? upd : t));
      await logActivity(profile?.displayName || 'User', role, 'comment', 'commented on task', selectedTask.title, selectedTask.id, newComment);
    } catch (err: any) {
      alert('Could not add comment: ' + err.message);
    }
  };

  const handleToggleChecklist = async (itemId: string) => {
    if (!selectedTask) return;
    const checked = selectedTask.checklist?.find(i => i.id === itemId);
    const updated = (selectedTask.checklist || []).map(i => i.id === itemId ? { ...i, done: !i.done } : i);
    const progress = updated.length ? Math.round(updated.filter(i => i.done).length / updated.length * 100) : 0;
    try {
      await tasksApi.update(selectedTask.id, { checklist: updated, progress });
      const upd = { ...selectedTask, checklist: updated, progress };
      setSelectedTask(upd);
      setTasks(prev => prev.map(t => t.id === selectedTask.id ? upd : t));
      if (checked) await logActivity(profile?.displayName || 'User', role, 'task', !checked.done ? 'completed checklist item in' : 'uncompleted checklist item in', selectedTask.title, selectedTask.id, checked.text);
    } catch (err: any) {
      alert('Could not toggle checklist item: ' + err.message);
    }
  };

  const handleAddChecklist = async () => {
    if (!selectedTask || !newCheckItem.trim()) return;
    const newItem: ChecklistItem = { id: 'chk' + Date.now(), text: newCheckItem, done: false };
    const updated = [...(selectedTask.checklist || []), newItem];
    const progress = Math.round(updated.filter(i => i.done).length / updated.length * 100);
    try {
      await tasksApi.update(selectedTask.id, { checklist: updated, progress });
      const upd = { ...selectedTask, checklist: updated, progress };
      setSelectedTask(upd); setNewCheckItem('');
      setTasks(prev => prev.map(t => t.id === selectedTask.id ? upd : t));
      await logActivity(profile?.displayName || 'User', role, 'task', 'added checklist item to', selectedTask.title, selectedTask.id, newCheckItem);
    } catch (err: any) {
      alert('Could not add checklist item: ' + err.message);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="tasks-view-wrap">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Content Planner & Tasks</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            {isAgency ? 'Manage and update your assigned daily deliverables.' : 'Manage content schedules, priorities, and collaborations.'}
          </p>
        </div>
        {(role === 'admin' || role === 'internal') && !isMobile && (
          <button className="btn btn-primary" onClick={handleOpenAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={16} /><span>Create task or meeting</span>
          </button>
        )}
      </div>

      {loading ? <LoadingSpinner message="Loading tasks..." /> : (
        <>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <StatPill label="Total Tasks"    count={totalTasks}     color="var(--primary)"  icon={<Layers size={16} />} />
            <StatPill label="Live / Done"    count={publishedCount} color="#16a34a"          icon={<CheckCircle2 size={16} />} />
            <StatPill label="Awaiting Review" count={inReviewCount} color="#d97706"          icon={<Clock size={16} />} />
            <StatPill label="Overdue"        count={overdueCount}   color="var(--red)"       icon={<AlertCircle size={16} />} />
          </div>

          {/* Filter bar */}
          <div className="section-card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: filtersOpen ? '14px' : 0 }}>
              <button
                onClick={() => setFiltersOpen(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontWeight: 700, fontSize: '13px', padding: 0 }}
              >
                <Filter size={15} style={{ color: 'var(--primary)' }} />
                Filters
                {activeFilterCount > 0 && (
                  <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '20px', padding: '1px 7px', fontSize: '11px', fontWeight: 800 }}>
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown size={14} style={{ transform: filtersOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Showing <strong>{Math.min(displayCount, filteredTasks.length)}</strong> of <strong>{filteredTasks.length}</strong> tasks
                </span>
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '4px 8px' }}>
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
              </div>
            </div>

            {filtersOpen && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                {/* Type */}
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Type</label>
                  <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterType} onChange={e => { setFilterType(e.target.value as any); setDisplayCount(DISPLAY_STEP); }}>
                    <option value="All">All Types</option>
                    <option value="task">Tasks Only</option>
                    <option value="meeting">Meetings Only</option>
                  </select>
                </div>

                {/* Brand */}
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Brand</label>
                  <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setDisplayCount(DISPLAY_STEP); }}>
                    <option value="">All Brands</option>
                    {(brandCatalog.length ? brandCatalog.filter(b => b.active !== false).map(b => b.name) : []).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Status</label>
                  <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setDisplayCount(DISPLAY_STEP); }}>
                    <option value="">All Statuses</option>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Assigned */}
                {!isAgency && (role === 'admin' || role === 'internal') && (
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Assigned To</label>
                    <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterAssigned} onChange={e => { setFilterAssigned(e.target.value); setDisplayCount(DISPLAY_STEP); }}>
                      <option value="">All</option>
                      <option value="Internal">Internal</option>
                      <option value="Agency">Agency</option>
                    </select>
                  </div>
                )}

                {/* Platform */}
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Platform</label>
                  <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterPlatform} onChange={e => { setFilterPlatform(e.target.value); setDisplayCount(DISPLAY_STEP); }}>
                    <option value="">All Platforms</option>
                    {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                {/* Progress */}
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Progress</label>
                  <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterProgress} onChange={e => { setFilterProgress(e.target.value); setDisplayCount(DISPLAY_STEP); }}>
                    <option value="">All</option>
                    <option value="0">Not Started (0%)</option>
                    <option value="partial">In Progress (1–99%)</option>
                    <option value="100">Complete (100%)</option>
                  </select>
                </div>

                {/* Date From */}
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Created From</label>
                  <input type="date" className="form-input" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setDisplayCount(DISPLAY_STEP); }} />
                </div>
              </div>
            )}
          </div>

          {/* Content section */}
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
                          onClick={() => { setSelectedTask(t); setIsDetailOpen(true); }}
                          style={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '12px',
                            padding: '16px',
                            boxShadow: 'var(--shadow-sm)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            position: 'relative'
                          }}
                        >
                          {/* Task/Meeting Name & Actions */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h4 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text)', margin: 0, wordBreak: 'break-word' }}>
                                {isMeeting ? `📅 [Meeting] ${t.title}` : t.title}
                              </h4>
                              <span style={{ fontSize: '10px', color: 'var(--text-light)', fontFamily: 'monospace' }}>
                                {t.id.slice(0, 14)}…
                              </span>
                            </div>
                            <span className={`badge ${isMeeting ? 'scheduled' : (t.status || 'Idea').toLowerCase().replace(/ /g, '-')}`} style={{ marginLeft: '8px' }}>
                              {isMeeting ? (t.status || 'Scheduled') : (t.status || 'Idea')}
                            </span>
                          </div>

                          {/* Brand & Platform/Location Pills */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            <span className="badge low" style={{ fontSize: '10px', padding: '2px 8px' }}>
                              {t.brand}
                            </span>
                            {isMeeting ? (
                              <span className="badge low" style={{ fontSize: '10px', padding: '2px 8px', borderColor: 'var(--primary-light)', color: 'var(--primary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.location || 'No location'}
                              </span>
                            ) : (
                              (t.platforms || []).map((p, i) => (
                                <span key={i} className="badge low" style={{ fontSize: '10px', padding: '2px 8px', borderColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                                  {p}
                                </span>
                              ))
                            )}
                          </div>

                          {/* Progress/Guests and Date */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <User size={12} style={{ color: 'var(--text-muted)' }} />
                              <span style={{ color: 'var(--text-muted)' }}>
                                {isMeeting 
                                  ? (t.visibility === 'internal' ? 'Internal' : t.visibility === 'agency' ? 'Marketing Agency' : 'External') 
                                  : t.assignedTo}
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

                          {/* Date & Edit / Delete */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                            <span>
                              {isMeeting 
                                ? (t.startDate ? new Date(t.startDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'No date')
                                : (t.sharedDate || t.reviewDeadline ? `Review: ${toDisplayDate(t.sharedDate || t.reviewDeadline)}` : 'No review date')}
                            </span>
                            
                            <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                              {(role === 'admin' || role === 'internal') && (
                                <>
                                  <button onClick={() => handleOpenEdit(t)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '4px' }}>
                                    <Edit size={14} />
                                  </button>
                                  {role === 'admin' && (
                                    <button onClick={() => handleDelete(t.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '4px' }}>
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
                        <th style={{ width: '72px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedTasks.map(t => {
                        const isOD = t.overdue === true;
                        const isMeeting = t.type === 'meeting';
                        return (
                          <tr
                            key={t.id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => { setSelectedTask(t); setIsDetailOpen(true); }}
                          >
                            {/* Title + ID */}
                            <td style={{ maxWidth: '260px' }}>
                              <div style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>
                                {isMeeting ? `📅 [Meeting] ${t.title}` : t.title}
                              </div>
                              <span style={{ fontSize: '10px', color: 'var(--text-light)', fontFamily: 'monospace' }}>{t.id.slice(0, 14)}…</span>
                            </td>

                            {/* Brand */}
                            <td>
                              <span className="badge low" style={{ fontSize: '10px', padding: '2px 8px', whiteSpace: 'nowrap' }}>{t.brand}</span>
                            </td>

                            {/* Platforms / Location */}
                            <td>
                              {isMeeting ? (
                                <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }} title={t.location}>
                                  {t.location || '—'}
                                </div>
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

                            {/* Status */}
                            <td>
                              <span className={`badge ${(t.status || (isMeeting ? 'Scheduled' : 'Idea')).toLowerCase().replace(/ /g, '-')}`}>{t.status || (isMeeting ? 'Scheduled' : 'Idea')}</span>
                            </td>

                            {/* Assigned / Visibility */}
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', whiteSpace: 'nowrap' }}>
                                <User size={12} />
                                <span>
                                  {isMeeting 
                                    ? (t.visibility === 'internal' ? 'Internal' : t.visibility === 'agency' ? 'Marketing Agency' : `External (${(t.invitedGuests || []).length} guest(s))`) 
                                    : t.assignedTo}
                                </span>
                              </div>
                            </td>

                            {/* Progress */}
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

                            {/* Shared / Scheduled date */}
                            <td>
                              <span style={{ color: isOD ? 'var(--red)' : 'var(--text-muted)', fontSize: '12px', fontWeight: isOD ? 700 : 400, whiteSpace: 'nowrap' }}>
                                {isMeeting 
                                  ? (t.startDate ? new Date(t.startDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—')
                                  : (toDisplayDate(t.sharedDate || t.reviewDeadline) || '—')}
                              </span>
                            </td>

                            {/* Actions */}
                            <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                {(role === 'admin' || role === 'internal') && (
                                  <>
                                    <button className="btn-icon" onClick={() => handleOpenEdit(t)} style={{ padding: '6px' }} title="Edit">
                                      <Edit size={12} />
                                    </button>
                                    {role === 'admin' && (
                                      <button className="btn-icon" onClick={() => handleDelete(t.id)} style={{ padding: '6px', color: 'var(--red)' }} title="Delete">
                                        <Trash2 size={12} />
                                      </button>
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

                {/* Load more */}
                {hasMoreToShow && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px', textAlign: 'center' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setDisplayCount(c => c + DISPLAY_STEP)}
                      style={{ fontSize: '13px' }}
                    >
                      Load More ({filteredTasks.length - displayCount} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Mobile Floating Action Button */}
      {isMobile && (role === 'admin' || role === 'internal') && (
        <button 
          onClick={handleOpenAdd} 
          style={{ 
            position: 'fixed', bottom: '80px', right: '20px', zIndex: 850, 
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none', 
            borderRadius: '50%', width: '56px', height: '56px', display: 'flex', 
            alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-lg)',
            cursor: 'pointer'
          }}
          aria-label="Create task or meeting"
        >
          <Plus size={24} />
        </button>
      )}

      {/* ── Create / Edit Modal ─────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h4 className="modal-title">
                {editingId 
                  ? (formType === 'meeting' ? 'Edit Meeting' : 'Edit Task') 
                  : (formType === 'meeting' ? 'Create Meeting' : 'Create Task')}
              </h4>
              <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            
            {!editingId && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '10px 20px', gap: '16px' }}>
                <button
                  type="button"
                  onClick={() => { setFormType('task'); setStatus('Idea'); }}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: formType === 'task' ? 'bold' : 'normal',
                    backgroundColor: formType === 'task' ? 'var(--primary)' : 'transparent',
                    color: formType === 'task' ? '#fff' : 'var(--text-muted)',
                    border: '1px solid ' + (formType === 'task' ? 'var(--primary)' : 'var(--border)'),
                    fontSize: '13px'
                  }}
                >
                  Create Task
                </button>
                <button
                  type="button"
                  onClick={() => { setFormType('meeting'); setStatus('Scheduled'); }}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: formType === 'meeting' ? 'bold' : 'normal',
                    backgroundColor: formType === 'meeting' ? 'var(--primary)' : 'transparent',
                    color: formType === 'meeting' ? '#fff' : 'var(--text-muted)',
                    border: '1px solid ' + (formType === 'meeting' ? 'var(--primary)' : 'var(--border)'),
                    fontSize: '13px'
                  }}
                >
                  Create Meeting
                </button>
              </div>
            )}

            <form onSubmit={handleSave}>
              {formType === 'meeting' ? (
                <>
                  <div className="form-group" style={{ marginTop: '12px' }}>
                    <label className="form-label">Meeting Title</label>
                    <input type="text" required placeholder="e.g. Media Partners Sync" value={title} onChange={e => setTitle(e.target.value)} className="form-input" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Brand</label>
                      <select value={brand} onChange={e => setBrand(e.target.value)} className="form-select">
                        {(brandCatalog.length ? brandCatalog.filter(b => b.active !== false).map(b => b.name) : ['Sosun Fihaara']).map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Visibility / Meeting Type</label>
                      <select value={meetingVisibility} onChange={e => setMeetingVisibility(e.target.value as any)} className="form-select">
                        <option value="internal">Internal</option>
                        <option value="agency">Marketing Agency</option>
                        <option value="external">External</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Meeting Date & Time</label>
                      <input type="datetime-local" required value={meetingStartDate} onChange={e => setMeetingStartDate(e.target.value)} className="form-input" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Status</label>
                      <select value={status} onChange={e => setStatus(e.target.value)} className="form-select">
                        {['Scheduled', 'Completed', 'Cancelled', 'Postponed'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location / Meeting Link</label>
                    <input type="text" placeholder="e.g. Zoom link or Meeting Room A" value={meetingLocation} onChange={e => setMeetingLocation(e.target.value)} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Agenda / Brief</label>
                    <textarea rows={3} placeholder="Creative brief or meeting agenda..." value={meetingAgenda} onChange={e => setMeetingAgenda(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Internal Notes (Hidden from external guests)</label>
                    <textarea rows={2} placeholder="Internal preparation notes..." value={notes} onChange={e => setNotes(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Relevant Links / Assets</label>
                    <input type="url" placeholder="https://..." value={assetLink} onChange={e => setAssetLink(e.target.value)} className="form-input" />
                  </div>
                  
                  {meetingVisibility === 'external' && (
                    <div className="form-group">
                      <label className="form-label">Invite External Partners (Select multiple)</label>
                      <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {usersList
                          .filter(u => u.role === 'media' || u.role === 'sponsor' || u.role === 'supplier')
                          .map(u => {
                            const isChecked = invitedGuests.includes(u.uid);
                            return (
                              <label key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setInvitedGuests(prev => prev.filter(x => x !== u.uid));
                                    } else {
                                      setInvitedGuests(prev => [...prev, u.uid]);
                                    }
                                  }}
                                />
                                <span>{u.displayName} ({u.role.toUpperCase()})</span>
                              </label>
                            );
                          })}
                        {usersList.filter(u => u.role === 'media' || u.role === 'sponsor' || u.role === 'supplier').length === 0 && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>No external partner users found.</div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="form-group" style={{ marginTop: '12px' }}>
                    <label className="form-label">Task Title</label>
                    <input type="text" required placeholder="e.g. June Newsletter Campaign" value={title} onChange={e => setTitle(e.target.value)} className="form-input" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Brand</label>
                      <select value={brand} onChange={e => setBrand(e.target.value)} className="form-select">
                        {(brandCatalog.length ? brandCatalog.filter(b => b.active !== false).map(b => b.name) : ['Sosun Fihaara']).map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Campaign ID</label>
                      <input type="text" placeholder="e.g. C-EID-2026" value={campaignId} onChange={e => setCampaignId(e.target.value)} className="form-input" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Platform(s)</label>
                      <input type="text" placeholder="Instagram, TikTok, ..." value={platformsInput} onChange={e => setPlatformsInput(e.target.value)} className="form-input" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Content Type</label>
                      <select value={contentType} onChange={e => setContentType(e.target.value)} className="form-select">
                        {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Priority</label>
                      <select value={priority} onChange={e => setPriority(e.target.value)} className="form-select">
                        {['Low','Medium','High','Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Status</label>
                      <select value={status} onChange={e => setStatus(e.target.value)} className="form-select">
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Assigned To</label>
                      <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="form-select">
                        {['Internal','Agency','Both'].map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Scheduled Date</label>
                      <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="form-input" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Review / Share Date</label>
                    <input type="date" value={sharedDate} onChange={e => setSharedDate(e.target.value)} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Caption / Brief</label>
                    <textarea rows={3} placeholder="Caption or creative brief..." value={caption} onChange={e => setCaption(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <textarea rows={2} placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Asset Link</label>
                    <input type="url" placeholder="https://drive.google.com/..." value={assetLink} onChange={e => setAssetLink(e.target.value)} className="form-input" />
                  </div>
                </>
              )}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Save Changes' : (formType === 'meeting' ? 'Create Meeting' : 'Create Task')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Detail Modal ────────────────────────────────────────────────────── */}
      {isDetailOpen && selectedTask && (
        <div className="modal-overlay" onClick={() => setIsDetailOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px' }}>
            <div className="modal-header">
              <h4 className="modal-title">{selectedTask.title}</h4>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(role === 'admin' || role === 'internal') && (
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => { setIsDetailOpen(false); handleOpenEdit(selectedTask); }}>
                    <Edit size={13} /> Edit
                  </button>
                )}
                <button className="modal-close-btn" onClick={() => setIsDetailOpen(false)}><X size={18} /></button>
              </div>
            </div>

            <div style={{ padding: '4px 0', maxHeight: '70vh', overflowY: 'auto' }}>
              {selectedTask.type === 'meeting' ? (
                <>
                  {/* Meeting Meta */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                    <span className="badge urgent" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Video size={13} /> Meeting
                    </span>
                    <span className={`badge ${(selectedTask.status || 'Scheduled').toLowerCase().replace(/ /g, '-')}`}>
                      {selectedTask.status || 'Scheduled'}
                    </span>
                    <span className="badge low">
                      {selectedTask.visibility === 'internal' ? 'Internal' : selectedTask.visibility === 'agency' ? 'Marketing Agency' : 'External'}
                    </span>
                    {selectedTask.brand && <span className="badge low">{selectedTask.brand}</span>}
                  </div>

                  {/* Date & Time */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    {selectedTask.startDate && (
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Start</span>
                        <div style={{ fontSize: '13px' }}>
                          {new Date(selectedTask.startDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                    )}
                    {selectedTask.endDate && (
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>End</span>
                        <div style={{ fontSize: '13px' }}>
                          {new Date(selectedTask.endDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Location / Meeting Link */}
                  {selectedTask.location && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Location / Link</span>
                      {selectedTask.location.startsWith('http://') || selectedTask.location.startsWith('https://') ? (
                        <a href={selectedTask.location} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '13px', color: 'var(--primary)', marginTop: '4px', wordBreak: 'break-all' }}>
                          {selectedTask.location}
                        </a>
                      ) : (
                        <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', margin: 0 }}>
                          {selectedTask.location}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Agenda */}
                  {selectedTask.agenda && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Agenda / Brief</span>
                      <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>
                        {selectedTask.agenda}
                      </p>
                    </div>
                  )}

                  {/* Internal Notes - redacted for external users */}
                  {(role === 'admin' || role === 'internal') && selectedTask.notes && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Internal Notes (Admin & Internal Only)</span>
                      <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>
                        {selectedTask.notes}
                      </p>
                    </div>
                  )}

                  {/* Relevant Links / Assets */}
                  {selectedTask.assetLink && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Relevant Links / Assets</span>
                      <a href={selectedTask.assetLink} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '13px', color: 'var(--primary)', marginTop: '4px', wordBreak: 'break-all' }}>
                        {selectedTask.assetLink}
                      </a>
                    </div>
                  )}

                  {/* Invited Guests */}
                  {selectedTask.visibility === 'external' && (selectedTask.invitedGuests || []).length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invited Guests</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                        {(selectedTask.invitedGuests || []).map(guestId => {
                          const guestUser = usersList.find(u => u.uid === guestId);
                          return (
                            <span key={guestId} className="badge low" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}>
                              {guestUser ? `${guestUser.displayName} (${guestUser.role.toUpperCase()})` : `Guest (${guestId})`}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Task Meta */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                    <span className={`badge ${selectedTask.priority?.toLowerCase()}`}>{selectedTask.priority}</span>
                    <span className={`badge ${selectedTask.status?.toLowerCase().replace(/ /g,'-')}`}>{selectedTask.status}</span>
                    <span className="badge low">{selectedTask.brand}</span>
                    <span className="badge low">{selectedTask.contentType}</span>
                    {selectedTask.campaignId && <span className="badge low" style={{ fontFamily: 'monospace' }}>{selectedTask.campaignId}</span>}
                  </div>

                  {/* Platforms */}
                  {(selectedTask.platforms || []).length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Platforms</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        {(selectedTask.platforms || []).map(p => <span key={p} className="badge low" style={{ fontSize: '11px' }}>{p}</span>)}
                      </div>
                    </div>
                  )}

                  {/* Dates */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    {selectedTask.scheduledDate && (
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Scheduled</span>
                        <div style={{ fontSize: '13px' }}>{toDisplayDate(selectedTask.scheduledDate)}</div>
                      </div>
                    )}
                    {selectedTask.sharedDate && (
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Review Date</span>
                        <div style={{ fontSize: '13px' }}>{toDisplayDate(selectedTask.sharedDate)}</div>
                      </div>
                    )}
                  </div>

                  {/* Progress */}
                  {(selectedTask.checklist || []).length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Progress</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selectedTask.progress || 0}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${selectedTask.progress || 0}%`, background: (selectedTask.progress || 0) >= 100 ? '#22c55e' : 'var(--primary)', borderRadius: '3px', transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  )}

                  {/* Caption */}
                  {selectedTask.caption && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Caption / Brief</span>
                      <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>{selectedTask.caption}</p>
                    </div>
                  )}

                  {/* Notes - redacted for external users */}
                  {(role === 'admin' || role === 'internal') && selectedTask.notes && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Notes (Admin & Internal Only)</span>
                      <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>{selectedTask.notes}</p>
                    </div>
                  )}

                  {/* Asset Link */}
                  {selectedTask.assetLink && (
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Asset Link</span>
                      <a href={selectedTask.assetLink} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '13px', color: 'var(--primary)', marginTop: '4px', wordBreak: 'break-all' }}>{selectedTask.assetLink}</a>
                    </div>
                  )}

                  {/* Checklist */}
                  <div style={{ marginBottom: '16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Checklist</span>
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {(selectedTask.checklist || []).map(item => (
                        <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                          <input type="checkbox" checked={item.done} onChange={() => handleToggleChecklist(item.id)} />
                          <span style={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--text-muted)' : 'inherit' }}>{item.text}</span>
                        </label>
                      ))}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <input type="text" placeholder="Add checklist item..." value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddChecklist())} className="form-input" style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }} />
                        <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={handleAddChecklist}>Add</button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Comments */}
              <div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Comments</span>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(selectedTask.comments || []).map(c => (
                    <div key={c.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700 }}>{c.user}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.time}</span>
                      </div>
                      <p style={{ fontSize: '13px', margin: 0 }}>{c.text}</p>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input type="text" placeholder="Add a comment..." value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddComment())} className="form-input" style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }} />
                    <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={handleAddComment}>Send</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              {(role === 'admin' || role === 'internal') && (
                <button type="button" className="btn btn-danger" style={{ fontSize: '12px' }} onClick={() => handleDelete(selectedTask.id)}>
                  <Trash2 size={13} /> Delete
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setIsDetailOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
