import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase/config';
import { collection, query, limit, orderBy, onSnapshot } from 'firebase/firestore';
import {
  Megaphone,
  CheckSquare,
  Clock,
  CalendarDays,
  AlertTriangle,
  Images,
  HardDrive,
  CheckCircle2,
  MessageSquare,
  Tent,
  Store,
  Wallet,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { parseDate, formatTimeAgo, toDisplayDate } from '../utils/dateUtils';
import { driveApi } from '../services/driveApi';
import { tasksApi } from '../services/tasksApi';
import { campaignsApi } from '../services/campaignsApi';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { useCalendarItems } from '../hooks/useCalendarItems';
import type {
  TaskData, CampaignData, MediaMetrics, EventData, Distribution,
  BudgetEntry, PackingItem, ChecklistItem,
} from '../types';

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type ActivityRow = { id: string; type: string; user: string; action: string; target: string; time: string; text?: string };

// Static demo data shown when no real activity exists. Computed once at module
// load so the relative timestamps aren't recomputed (impurely) during render.
const FALLBACK_ACTIVITY: ActivityRow[] = [
  { id: 'f1', type: 'campaign', user: 'Aminath Ali', action: 'created campaign', target: 'Eid Festive Sale 2026', time: new Date(Date.now() - 10 * 60000).toISOString() },
  { id: 'f2', type: 'task', user: 'Agency Partner', action: 'submitted draft for review', target: 'Summer Collection Showcase Video', time: new Date(Date.now() - 60 * 60000).toISOString() },
  { id: 'f3', type: 'comment', user: 'Ahmed Nazeer', action: 'commented on task', target: 'Eid Promo Reels Creative Assets', time: new Date(Date.now() - 180 * 60000).toISOString(), text: '"Please adjust the background gradient to match the new HSL variables."' },
  { id: 'f4', type: 'approval', user: 'Aminath Ali', action: 'approved creative asset for', target: 'Back to School Campaign Graphics', time: new Date(Date.now() - 24 * 3600000).toISOString() },
];

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { isInScope, anyInScope, colorOf } = useBrandScope();
  const canSeeBudget = role === 'admin' || role === 'internal';

  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [events, setEvents] = useState<EventData[]>([]);
  const [dists, setDists] = useState<Distribution[]>([]);
  const [ledger, setLedger] = useState<BudgetEntry[]>([]);
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [packingByEvent, setPackingByEvent] = useState<Record<string, PackingItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState<MediaMetrics | null>(null);
  const [campaignsEventsTab, setCampaignsEventsTab] = useState<'campaigns' | 'events'>('campaigns');

  // Band 2 week strip window: today → +6 days
  const weekStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 0); return d; }, [weekStart]);
  const { byDay, dayKey } = useCalendarItems(weekStart, weekEnd);

  // Load data from Firestore in real-time
  useEffect(() => {
    setLoading(true);

    const unsubs: Array<() => void> = [];

    if (role === 'agency' || role === 'external_agency') {
      campaignsApi.listAll().then(res => {
        setCampaigns(res.campaigns);
      }).catch(err => console.error('Error fetching campaigns:', err));

      tasksApi.listAll().then(res => {
        setTasks(res.tasks);
        setLoading(false);
      }).catch(err => {
        console.error('Error fetching tasks:', err);
        setLoading(false);
      });
    } else {
      unsubs.push(onSnapshot(query(collection(db, 'campaigns'), limit(30)), snap => {
        setCampaigns(snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as CampaignData)));
      }, err => console.error('Error listening to campaigns:', err)));

      unsubs.push(onSnapshot(query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(50)), snap => {
        setTasks(snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as TaskData)));
        setLoading(false);
      }, err => { console.error('Error listening to tasks:', err); setLoading(false); }));
    }

    unsubs.push(onSnapshot(query(collection(db, 'activities'), orderBy('time', 'desc'), limit(30)), snap => {
      setActivities(snap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as ActivityRow));
    }, err => console.error('Error listening to activities:', err)));

    unsubs.push(onSnapshot(collection(db, 'events'), snap => {
      setEvents(snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as EventData)));
    }, err => console.warn('events listener:', (err as Error).message)));

    unsubs.push(onSnapshot(collection(db, 'distributions'), snap => {
      setDists(snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as Distribution)));
    }, err => console.warn('distributions listener:', (err as Error).message)));

    if (canSeeBudget) {
      unsubs.push(onSnapshot(collection(db, 'budgetEntries'), snap => {
        setLedger(snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as BudgetEntry)));
      }, err => console.warn('ledger listener:', (err as Error).message)));
    }

    // Media metrics are best-effort: never block the dashboard if Drive isn't set up.
    driveApi.getMetrics().then(setMedia).catch(() => setMedia(null));

    return () => unsubs.forEach(u => u());
  }, [role, canSeeBudget]);

  /* ----------------------------- Scoped derivations ----------------------------- */

  const scopedCampaigns = useMemo(
    () => campaigns.filter(c => isInScope(c.brand)), [campaigns, isInScope]);
  const scopedTasks = useMemo(
    () => tasks.filter(t => isInScope(t.brand)), [tasks, isInScope]);
  const scopedEvents = useMemo(
    () => events.filter(e => anyInScope(e.brands)), [events, anyInScope]);
  const scopedDists = useMemo(
    () => dists.filter(d => isInScope(d.brand)), [dists, isInScope]);

  const activeCampaigns = scopedCampaigns.filter(c =>
    c.status && c.status.toLowerCase() !== 'completed' && c.status.toLowerCase() !== 'cancelled').length;

  // Overdue = explicit manual flag only.
  // sharedDate is factual (when draft was sent for review) — a past date is
  // normal and must NOT auto-flag a task as overdue.
  const overdueTasks = useMemo(
    () => scopedTasks.filter(t => t.overdue === true).slice(0, 5),
    [scopedTasks],
  );

  const upcomingPosts = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
    return scopedTasks.filter(t => {
      const d = parseDate(t.scheduledDate);
      return d && d >= today && d <= nextWeek;
    }).length;
  }, [scopedTasks]);

  // Spend this month (ledger dates are YYYY-MM-DD strings)
  const spendMTD = useMemo(() => {
    const monthStart = isoToday().slice(0, 7) + '-01';
    return ledger
      .filter(e => isInScope(e.brand) && (e.spentAt || '') >= monthStart)
      .reduce((s, e) => s + (e.amount || 0), 0);
  }, [ledger, isInScope]);

  // Next event in scope (running or upcoming)
  const nextEvent = useMemo(() => {
    const today = isoToday();
    return scopedEvents
      .filter(e => (e.endDate || e.startDate || '') >= today && e.status !== 'Reported')
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))[0] || null;
  }, [scopedEvents]);

  // Events in active preparation (Band 2 board)
  const prepEvents = useMemo(() =>
    scopedEvents
      .filter(e => e.status === 'Preparing' || e.status === 'Live' || e.status === 'Confirmed')
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
      .slice(0, 4),
    [scopedEvents]);

  // Live packing progress for the prep board
  useEffect(() => {
    const unsubs = prepEvents.map(ev =>
      onSnapshot(collection(db, 'events', ev.id, 'packingItems'), snap => {
        setPackingByEvent(prev => ({
          ...prev,
          [ev.id]: snap.docs.map(d => ({ id: d.id, ...d.data() } as PackingItem)),
        }));
      }, err => console.warn('packing listener:', (err as Error).message)));
    return () => unsubs.forEach(u => u());
  }, [prepEvents.map(e => e.id).join(',')]);

  const packingProgress = (eventId: string): { done: number; total: number; pct: number } => {
    const items = packingByEvent[eventId] || [];
    const total = items.length;
    const done = items.filter(i => i.status !== 'requested' && i.status !== 'damaged').length;
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  };

  const daysToEvent = (ev: EventData): string => {
    const today = isoToday();
    if ((ev.startDate || '') <= today && (ev.endDate || '') >= today) return 'LIVE';
    const start = parseDate(ev.startDate);
    if (!start) return '—';
    const days = Math.ceil((+start - +new Date()) / 86400000);
    return days <= 0 ? 'LIVE' : `${days}d`;
  };

  const retailCoverage = useMemo(() => ({
    installed: scopedDists.filter(d => d.status === 'installed').length,
    verified: scopedDists.filter(d => d.status === 'verified').length,
    outlets: new Set(scopedDists
      .filter(d => d.status === 'installed' || d.status === 'verified')
      .map(d => d.outletId)).size,
  }), [scopedDists]);

  /* ----------------------------- Existing helpers ----------------------------- */

  const getCampaignProgress = (campaign: CampaignData): number => {
    const cl = campaign.checklist as ChecklistItem[] | undefined;
    if (cl && cl.length > 0) {
      return Math.round((cl.filter(i => i.done).length / cl.length) * 100);
    }
    const campaignTasks = tasks.filter(t => t.campaignId === campaign.id);
    if (campaignTasks.length === 0) return 0;
    const completedStatuses = ['published', 'completed', 'approved', 'scheduled'];
    const completedCount = campaignTasks.filter(t =>
      t.status && completedStatuses.includes(t.status.toLowerCase())).length;
    return Math.min(100, Math.round((completedCount / campaignTasks.length) * 100));
  };

  const todaysTasks = useMemo(() => {
    const sorted = [...scopedTasks].sort((a, b) => {
      const termA = (a.isTerminal || a.statusPhase === 'terminal') ? 1 : 0;
      const termB = (b.isTerminal || b.statusPhase === 'terminal') ? 1 : 0;
      if (termA !== termB) return termA - termB;
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    return sorted.slice(0, 8);
  }, [scopedTasks]);

  const displayActivities = activities.length > 0 ? activities : FALLBACK_ACTIVITY;

  const getActivityStyles = (type: string) => {
    switch (type) {
      case 'campaign':
        return { icon: <Megaphone size={14} />, color: 'var(--primary)', bgColor: 'var(--primary-light)' };
      case 'task':
        return { icon: <CheckSquare size={14} />, color: 'var(--purple)', bgColor: 'var(--purple-bg)' };
      case 'comment':
        return { icon: <MessageSquare size={14} />, color: 'var(--orange)', bgColor: 'var(--orange-bg)' };
      case 'approval':
        return { icon: <CheckCircle2 size={14} />, color: 'var(--green)', bgColor: 'var(--green-bg)' };
      case 'media':
        return { icon: <Images size={14} />, color: 'var(--teal)', bgColor: 'var(--teal-bg)' };
      default:
        return { icon: <Clock size={14} />, color: 'var(--text-muted)', bgColor: 'var(--gray-bg)' };
    }
  };

  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekDays = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekStart]);

  /* ----------------------------------- Render ----------------------------------- */

  return (
    <div className="main-content-wrap">
      {/* ============ BAND 1: KPI cards (answers "are we on track?") ============ */}
      <div className="card-grid">
        {canSeeBudget ? (
          <div className="stat-card" onClick={() => navigate('/budget')} style={{ cursor: 'pointer' }}>
            <div className="stat-header">
              <span className="stat-title">Spend This Month</span>
              <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'var(--green-bg)', color: 'var(--green)' }}>
                <Wallet size={18} />
              </div>
            </div>
            <div className="stat-value">{spendMTD.toLocaleString()}</div>
            <div className="stat-sub">Ledger entries in scope</div>
          </div>
        ) : (
          <div className="stat-card" onClick={() => navigate('/calendar')} style={{ cursor: 'pointer' }}>
            <div className="stat-header">
              <span className="stat-title">Upcoming Posts</span>
              <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'var(--purple-bg)', color: 'var(--purple)' }}>
                <CalendarDays size={18} />
              </div>
            </div>
            <div className="stat-value">{upcomingPosts}</div>
            <div className="stat-sub">Scheduled next 7 days</div>
          </div>
        )}

        <div className="stat-card" onClick={() => navigate('/campaigns')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <span className="stat-title">Active Campaigns</span>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
              <Megaphone size={18} />
            </div>
          </div>
          <div className="stat-value">{activeCampaigns}</div>
          <div className="stat-sub">
            {overdueTasks.length > 0
              ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>⚠ {overdueTasks.length} overdue task(s)</span>
              : 'No overdue tasks in scope'}
          </div>
        </div>

        <div className="stat-card" onClick={() => navigate('/events')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <span className="stat-title">Next Event</span>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'var(--yellow-bg)', color: 'var(--yellow)' }}>
              <Tent size={18} />
            </div>
          </div>
          <div className="stat-value">{nextEvent ? daysToEvent(nextEvent) : '—'}</div>
          <div className="stat-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {nextEvent
              ? `${nextEvent.name} · packing ${packingProgress(nextEvent.id).pct}%`
              : 'Nothing scheduled'}
          </div>
        </div>

        <div className="stat-card" onClick={() => navigate('/retail')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <span className="stat-title">Merchandising</span>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'var(--purple-bg)', color: 'var(--purple)' }}>
              <Store size={18} />
            </div>
          </div>
          <div className="stat-value">{retailCoverage.outlets}</div>
          <div className="stat-sub">{retailCoverage.installed} installed · {retailCoverage.verified} verified</div>
        </div>
      </div>

      {/* ============ BAND 2: This Week (Full-Width) ============ */}
      <div className="section-card" style={{ marginBottom: '20px' }}>
        <div className="section-header">
          <h3 className="section-title">
            <CalendarDays size={18} style={{ color: 'var(--primary)' }} />
            <span>This Week</span>
          </h3>
          <button className="btn btn-secondary" onClick={() => navigate('/calendar')} style={{ padding: '4px 12px', fontSize: '12px' }}>Open Calendar</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', overflowX: 'auto', paddingBottom: '8px' }}>
          {weekDays.map(d => {
            const items = byDay.get(dayKey(d)) || [];
            const isToday = d.toDateString() === new Date().toDateString();
            return (
              <div key={dayKey(d)} style={{
                border: '1px solid var(--border)', borderRadius: '8px', padding: '6px',
                minHeight: '92px', minWidth: '100px', backgroundColor: isToday ? 'var(--primary-light)' : 'var(--bg)',
              }}>
                <div style={{ fontSize: '10px', fontWeight: 800, color: isToday ? 'var(--primary)' : 'var(--text-muted)', marginBottom: '4px' }}>
                  {DAYS_SHORT[d.getDay()]} {d.getDate()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {items.slice(0, 3).map(it => (
                    <div key={`${it.kind}-${it.id}`} title={`${it.kind}: ${it.title}`} style={{
                      fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '3px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      backgroundColor: `${colorOf(it.brands[0])}1A`,
                      color: colorOf(it.brands[0]),
                      borderLeft: `2px solid ${colorOf(it.brands[0])}`,
                    }}>
                      {it.title}
                    </div>
                  ))}
                  {items.length > 3 && (
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>+{items.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============ BAND 3: Campaigns & Events Tabbed Card (Full-Width) ============ */}
      <div className="section-card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          {/* Segmented Controller Tab Selector */}
          <div style={{ display: 'flex', background: 'var(--bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setCampaignsEventsTab('campaigns')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: campaignsEventsTab === 'campaigns' ? 'var(--card)' : 'transparent',
                color: campaignsEventsTab === 'campaigns' ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: campaignsEventsTab === 'campaigns' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: campaignsEventsTab === 'campaigns' ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              Active Campaigns ({scopedCampaigns.length})
            </button>
            <button
              onClick={() => setCampaignsEventsTab('events')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: campaignsEventsTab === 'events' ? 'var(--card)' : 'transparent',
                color: campaignsEventsTab === 'events' ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: campaignsEventsTab === 'events' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: campaignsEventsTab === 'events' ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              Event Prep ({prepEvents.length})
            </button>
          </div>
          
          <button
            className="btn btn-secondary"
            onClick={() => navigate(campaignsEventsTab === 'campaigns' ? '/campaigns' : '/events')}
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            {campaignsEventsTab === 'campaigns' ? 'All Campaigns' : 'All Events'}
          </button>
        </div>

        {campaignsEventsTab === 'campaigns' ? (
          /* Campaigns View */
          !loading && scopedCampaigns.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {scopedCampaigns.slice(0, 4).map((c) => (
                <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', borderTop: `3px solid ${colorOf(c.brand)}`, backgroundColor: 'var(--bg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <strong style={{ fontSize: '14px', display: 'block' }}>{c.name}</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.brand} · {c.type}</span>
                    </div>
                    <span className={`badge ${c.status && c.status.toLowerCase().replace(' ', '-')}`}>{c.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 4px' }}>
                    <span>Progress</span>
                    <strong>{getCampaignProgress(c)}%</strong>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${getCampaignProgress(c)}%`, backgroundColor: 'var(--primary)', borderRadius: '3px' }}></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No campaigns in scope yet.
            </div>
          )
        ) : (
          /* Events View */
          prepEvents.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 0', textAlign: 'center' }}>
              No events in preparation.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {prepEvents.map(ev => {
                const prog = packingProgress(ev.id);
                return (
                  <div key={ev.id} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', backgroundColor: 'var(--bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '13px' }}>{ev.name}</strong>
                      <span className={`badge ${ev.status === 'Live' ? 'approved' : 'medium'}`} style={{ fontSize: '10px' }}>
                        {ev.status === 'Live' ? 'LIVE' : `${ev.status} · ${daysToEvent(ev)}`}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      {ev.venue} · {toDisplayDate(ev.startDate)} · {(ev.brands || []).join(', ')}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>
                      <span>Packing</span>
                      <strong>{prog.done}/{prog.total} ({prog.pct}%)</strong>
                    </div>
                    <div style={{ height: '5px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${prog.pct}%`, backgroundColor: prog.pct === 100 ? 'var(--green)' : 'var(--primary)', borderRadius: '3px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Media & Asset Library metrics */}
      {media && media.totalFiles > 0 && (
        <div className="section-card" style={{ marginBottom: '20px' }}>
          <div className="section-header">
            <h3 className="section-title">
              <Images size={18} style={{ color: 'var(--primary)' }} />
              <span>Media &amp; Asset Library</span>
            </h3>
            <button className="btn btn-secondary" onClick={() => navigate('/media')} style={{ padding: '4px 12px', fontSize: '12px' }}>Open Library</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <MediaStat icon={<Images size={16} />} label="Total Assets" value={media.totalAssets} color="var(--primary)" />
            <MediaStat icon={<Clock size={16} />} label="Pending Approvals" value={media.pendingApprovals} color="var(--yellow)" />
            <MediaStat icon={<CheckCircle2 size={16} />} label="Approved" value={media.approved} color="var(--green)" />
            <MediaStat icon={<CalendarDays size={16} />} label="New (7 days)" value={media.recentUploads7d} color="var(--purple)" />
            <MediaStat icon={<HardDrive size={16} />} label="Storage Used" value={formatBytes(media.storageBytes)} color="var(--text-muted)" />
          </div>

          <div className="grid-2col">
            <div>
              <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>Assets by Type</h4>
              {Object.entries(media.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                const max = Math.max(...Object.values(media.byType), 1);
                return (
                  <div key={type} style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
                      <span style={{ textTransform: 'capitalize' }}>{type}</span><strong>{count}</strong>
                    </div>
                    <div style={{ height: '5px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(count / max) * 100}%`, backgroundColor: 'var(--primary)', borderRadius: '3px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>Recent Uploads</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {media.recentUploads.map((u) => (
                  <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }} title={u.name}>{u.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{u.uploadedBy} · {(u.uploadedAt || '').split('T')[0]}</span>
                  </div>
                ))}
                {media.recentUploads.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No uploads yet.</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ BAND 4: split columns ============ */}
      <div className="dashboard-layout">
        {/* Left Side: Overdue alert + Today's queue */}
        <div>
          {overdueTasks.length > 0 && (
            <div className="section-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'var(--red-bg)', marginBottom: '20px' }}>
              <div className="section-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '12px' }}>
                <h3 className="section-title" style={{ color: 'var(--red)' }}>
                  <AlertTriangle size={18} />
                  <span>Critical: Overdue Tasks Awaiting Action</span>
                </h3>
                <span className="badge critical">{overdueTasks.length} Overdue</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {overdueTasks.map((t) => {
                  const sharedStr = (t.sharedDate || t.reviewDeadline || '').split('-').reverse().join('/');
                  return (
                    <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--card)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'block' }}>{t.id}</span>
                        <strong style={{ fontSize: '13px' }}>{t.title}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Brand: {t.brand}{sharedStr ? ' · Shared: ' + sharedStr : ''}
                        </div>
                      </div>
                      <span className="badge revision">{t.status || 'Revision Needed'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="section-card">
            <div className="section-header">
              <h3 className="section-title">
                <CheckSquare size={18} style={{ color: 'var(--primary)' }} />
                <span>Today's Task Queue</span>
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {todaysTasks.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Queue is clear.</div>
              ) : todaysTasks.map((t) => (
                <div key={t.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: (t.isTerminal || t.statusPhase === 'terminal') ? 'line-through' : 'none',
                      color: (t.isTerminal || t.statusPhase === 'terminal') ? '#767676' : 'inherit'
                    }}>{t.title}</span>
                    <span className={`badge ${t.priority ? t.priority.toLowerCase() : 'medium'}`}>{t.priority}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>Brand: {t.brand} · Owner: {t.assignedTo}</span>
                    <span style={{ color: 'var(--primary)' }}>{t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Live Activity Feed */}
        <div>
          <div className="section-card">
            <div className="section-header">
              <h3 className="section-title">
                <Clock size={18} style={{ color: 'var(--text-muted)' }} />
                <span>Live Activity Feed</span>
              </h3>
            </div>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '16px',
              maxHeight: feedExpanded ? '420px' : 'none',
              overflowY: feedExpanded ? 'auto' : 'visible',
              paddingRight: feedExpanded ? '4px' : 0,
            }}>
              {(feedExpanded ? displayActivities : displayActivities.slice(0, 5)).map(act => {
                const styles = getActivityStyles(act.type);
                return (
                  <div key={act.id} style={{ display: 'flex', gap: '10px', fontSize: '13px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: styles.bgColor,
                      color: styles.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {styles.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ lineHeight: '1.4' }}>
                        <strong style={{ color: 'var(--text)' }}>{act.user}</strong>{' '}
                        <span style={{ color: 'var(--text-muted)' }}>{act.action}</span>{' '}
                        <strong style={{ color: 'var(--text)' }}>{act.target}</strong>
                      </p>
                      {act.text && (
                        <blockquote style={{ fontSize: '11px', color: 'var(--text-muted)', backgroundColor: 'var(--bg)', padding: '6px 10px', borderRadius: '4px', borderLeft: '2px solid var(--border)', marginTop: '4px', fontStyle: 'italic' }}>
                          {act.text}
                        </blockquote>
                      )}
                      <span style={{ fontSize: '10px', color: 'var(--text-light)', marginTop: '2px', display: 'block' }}>{formatTimeAgo(act.time)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {displayActivities.length > 5 && (
              <button className="btn btn-secondary"
                style={{ width: '100%', marginTop: 12, fontSize: 12, justifyContent: 'center' }}
                onClick={() => setFeedExpanded(x => !x)}>
                {feedExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                <span>{feedExpanded ? 'Show less' : `View all ${displayActivities.length} activities`}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const MediaStat: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; color: string }> = ({ icon, label, value, color }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color, marginBottom: '6px' }}>
      {icon}<span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{label}</span>
    </div>
    <div style={{ fontSize: '20px', fontWeight: 800 }}>{value}</div>
  </div>
);
