import React from 'react';
import { Filter, ChevronDown, RotateCcw } from 'lucide-react';

interface TaskFiltersProps {
  filtersOpen: boolean;
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeFilterCount: number;
  clearFilters: () => void;
  displayCount: number;
  filteredTasksLength: number;
  filterType: string;
  setFilterType: (v: string) => void;
  filterBrand: string;
  setFilterBrand: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  filterAssigned: string;
  setFilterAssigned: (v: string) => void;
  filterPlatform: string;
  setFilterPlatform: (v: string) => void;
  filterProgress: string;
  setFilterProgress: (v: string) => void;
  filterDateFrom: string;
  setFilterDateFrom: (v: string) => void;
  setDisplayCount: (v: number) => void;
  displayStep: number;
  brandCatalog: { name: string; active?: boolean }[];
  statusOptions: string[];
  platformOptions: string[];
  isAgency: boolean;
  role: string;
}

export const TaskFilters: React.FC<TaskFiltersProps> = ({
  filtersOpen, setFiltersOpen, activeFilterCount, clearFilters, displayCount, filteredTasksLength,
  filterType, setFilterType, filterBrand, setFilterBrand, filterStatus, setFilterStatus,
  filterAssigned, setFilterAssigned, filterPlatform, setFilterPlatform, filterProgress, setFilterProgress,
  filterDateFrom, setFilterDateFrom, setDisplayCount, displayStep, brandCatalog, statusOptions, platformOptions,
  isAgency, role
}) => {
  return (
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
            Showing <strong>{Math.min(displayCount, filteredTasksLength)}</strong> of <strong>{filteredTasksLength}</strong> tasks
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
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterType} onChange={e => { setFilterType(e.target.value); setDisplayCount(displayStep); }}>
              <option value="All">All Types</option>
              <option value="task">Tasks Only</option>
              <option value="meeting">Meetings Only</option>
            </select>
          </div>

          {/* Brand */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Brand</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setDisplayCount(displayStep); }}>
              <option value="">All Brands</option>
              {(brandCatalog.length ? brandCatalog.filter(b => b.active !== false).map(b => b.name) : []).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Status */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Status</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setDisplayCount(displayStep); }}>
              <option value="">All Statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Assigned */}
          {!isAgency && (role === 'admin' || role === 'internal') && (
            <div>
              <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Assigned To</label>
              <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterAssigned} onChange={e => { setFilterAssigned(e.target.value); setDisplayCount(displayStep); }}>
                <option value="">All</option>
                <option value="Internal">Internal</option>
                <option value="Agency">Agency</option>
              </select>
            </div>
          )}

          {/* Platform */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Platform</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterPlatform} onChange={e => { setFilterPlatform(e.target.value); setDisplayCount(displayStep); }}>
              <option value="">All Platforms</option>
              {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Progress */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Progress</label>
            <select className="form-select" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterProgress} onChange={e => { setFilterProgress(e.target.value); setDisplayCount(displayStep); }}>
              <option value="">All</option>
              <option value="0">Not Started (0%)</option>
              <option value="partial">In Progress (1–99%)</option>
              <option value="100">Complete (100%)</option>
            </select>
          </div>

          {/* Date From */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Created From</label>
            <input type="date" className="form-input" style={{ fontSize: '12px', padding: '6px 8px' }} value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setDisplayCount(displayStep); }} />
          </div>
        </div>
      )}
    </div>
  );
};
