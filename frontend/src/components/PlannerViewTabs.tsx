import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { plannerApi } from '../services/plannerApi';
import { Trash2 } from 'lucide-react';

export const PlannerViewTabs: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useAuth();
  const isStaff = role === 'admin' || role === 'internal';

  const [savedViews, setSavedViews] = useState<any[]>([]);

  const loadViews = async () => {
    try {
      const list = await plannerApi.views.list('marketing');
      setSavedViews(list);
    } catch (err) {
      console.error('Failed to load saved views:', err);
    }
  };

  useEffect(() => {
    loadViews();
  }, [location.search]);

  // Parse active viewId
  const searchParams = new URLSearchParams(location.search);
  const activeViewId = searchParams.get('viewId');
  const path = location.pathname;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this saved view?')) return;
    try {
      await plannerApi.views.delete(id);
      loadViews();
      // If we deleted the active view, navigate to the base list page
      if (activeViewId === id) {
        navigate('/planner/tasks');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete view');
    }
  };

  const renderTab = (label: string, targetPath: string, isActive: boolean) => (
    <button
      onClick={() => navigate(targetPath)}
      style={{
        border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        background: isActive ? 'var(--card)' : 'transparent',
        color: isActive ? 'var(--text)' : 'var(--text-muted)',
        boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
    </button>
  );

  const renderSavedTab = (view: any) => {
    const isActive = activeViewId === view.id;
    let targetPath = '/planner/tasks';
    if (view.kind === 'board') targetPath = '/planner/board';
    else if (view.kind === 'timeline') targetPath = '/planner/timeline';
    else if (view.kind === 'workload') targetPath = '/planner/workload';

    return (
      <div
        key={view.id}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: isActive ? 'var(--card)' : 'transparent',
          borderRadius: 8,
          boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
          paddingRight: isStaff ? 4 : 0,
        }}
      >
        <button
          onClick={() => navigate(`${targetPath}?viewId=${view.id}`)}
          style={{
            border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            background: 'transparent',
            color: isActive ? 'var(--text)' : 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {view.name}
        </button>
        {isStaff && (
          <button
            onClick={(e) => handleDelete(e, view.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', padding: '4px 6px', opacity: 0.6
            }}
            className="hover-red"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'inline-flex', gap: 6, background: 'var(--bg)', padding: 4, borderRadius: 10, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
      {/* Calendar & Dashboard tabs removed on purpose — the app-level Calendar
          and Dashboard already cover them. The planner is now person-first:
          My Workspace lands first, team-wide views follow. */}
      {renderTab('My Workspace', '/planner', path === '/planner')}
      {renderTab('Tasks', '/planner/tasks', (path === '/planner/tasks' || path === '/planner/board') && !activeViewId)}
      {renderTab('Timeline', '/planner/timeline', path === '/planner/timeline' && !activeViewId)}
      {isStaff && renderTab('Workload', '/planner/workload', path === '/planner/workload' && !activeViewId)}

      {savedViews.filter((v) => v.kind !== 'calendar').length > 0 && (
        <div style={{ width: 1, background: 'var(--border)', margin: '4px 2px' }} />
      )}

      {savedViews.filter((v) => v.kind !== 'calendar').map(renderSavedTab)}
    </div>
  );
};
