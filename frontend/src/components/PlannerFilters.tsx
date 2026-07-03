import React, { useState } from 'react';
import { Filter, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { UserItem } from '../types';
import type { PlannerWorkflowStatus } from '../services/plannerApi';
import { useAuth } from '../context/AuthContext';

interface PlannerFiltersProps {
  filtersOpen: boolean;
  setFiltersOpen: (v: boolean) => void;
  brandOptions: string[];
  statusOptions: PlannerWorkflowStatus[];
  userOptions: UserItem[];
  labelOptions: string[];
  
  // Current filters
  filterBrand: string;
  setFilterBrand: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  filterAssignee: string;
  setFilterAssignee: (v: string) => void;
  filterLabel: string;
  setFilterLabel: (v: string) => void;
  
  clearFilters: () => void;
  activeFilterCount: number;
  
  // Saved views action
  onSaveView: (name: string, shared: boolean) => void;
  activeSavedViewName?: string;
  onDeleteActiveView?: () => void;
}

export const PlannerFilters: React.FC<PlannerFiltersProps> = ({
  filtersOpen, setFiltersOpen, brandOptions, statusOptions, userOptions, labelOptions,
  filterBrand, setFilterBrand, filterStatus, setFilterStatus, filterAssignee, setFilterAssignee, filterLabel, setFilterLabel,
  clearFilters, activeFilterCount, onSaveView, activeSavedViewName, onDeleteActiveView
}) => {
  const { role } = useAuth();
  const isStaff = role === 'admin' || role === 'internal';

  // Save view modal
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [sharedView, setSharedView] = useState(false);

  const handleSave = () => {
    if (!viewName.trim()) return;
    onSaveView(viewName.trim(), sharedView);
    setViewName('');
    setSharedView(false);
    setSaveOpen(false);
  };

  return (
    <div className="section-card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--text)', fontWeight: 700, fontSize: '13px', padding: 0
          }}
        >
          <Filter size={15} style={{ color: 'var(--primary)' }} />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '20px', padding: '1px 7px', fontSize: '11px', fontWeight: 800 }}>
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeSavedViewName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(var(--primary-rgb), 0.08)', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
            <span>Active View: {activeSavedViewName}</span>
            {isStaff && onDeleteActiveView && (
              <button
                onClick={onDeleteActiveView}
                title="Delete this saved view"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', display: 'flex', padding: 0 }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '4px 8px' }}>
              <RotateCcw size={11} /> Clear
            </button>
          )}

          {isStaff && activeFilterCount > 0 && !activeSavedViewName && (
            <button
              onClick={() => setSaveOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--primary)', color: '#fff',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', padding: '5px 10px', fontWeight: 700
              }}
            >
              <Save size={11} /> Save as view
            </button>
          )}
        </div>
      </div>

      {/* Save View Modal Form */}
      {saveOpen && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>Save Current Filters as View</div>
          <input
            value={viewName}
            onChange={e => setViewName(e.target.value)}
            placeholder="View Name (e.g. Eid Campaigns)..."
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={sharedView} onChange={e => setSharedView(e.target.checked)} />
            <span>Share with agency partners</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={handleSave} disabled={!viewName.trim()}>
              Save
            </button>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Collapsible filters fields */}
      {filtersOpen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          {/* Brand */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Brand</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--card)', color: 'var(--text)' }} value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
              <option value="">All Brands</option>
              {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Status */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Status</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--card)', color: 'var(--text)' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {statusOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Assignee */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Assignee</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--card)', color: 'var(--text)' }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
              <option value="">All Assignees</option>
              {userOptions.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
            </select>
          </div>

          {/* Label */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Label</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--card)', color: 'var(--text)' }} value={filterLabel} onChange={e => setFilterLabel(e.target.value)}>
              <option value="">All Labels</option>
              {labelOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
