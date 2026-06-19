import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ChevronLeft, ChevronRight, Calendar as CalIcon, List, X,
  Megaphone, CheckSquare, Tent,
} from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { toDisplayDate } from '../utils/dateUtils';
import { useBrandScope } from '../context/BrandScopeContext';
import { useCalendarItems, type CalendarItem } from '../hooks/useCalendarItems';
import type { TaskData } from '../types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_SHORT  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_NARROW = ['S',   'M',   'T',   'W',   'T',   'F',   'S'];

const KIND_ICON = { task: CheckSquare, campaign: Megaphone, event: Tent } as const;

export const CalendarView: React.FC = () => {
  const { profile } = useAuth();
  const role = profile?.role || 'internal';
  const isAgency = role === 'agency';
  const { colorOf } = useBrandScope();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'list'>('month');
  const [filterKind, setFilterKind] = useState<'All' | 'task' | 'campaign' | 'event'>('All');
  const [selectedCellDate, setSelectedCellDate] = useState<Date | null>(null);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const windowStart = useMemo(() => new Date(year, month, -7),     [year, month]);
  const windowEnd   = useMemo(() => new Date(year, month + 1, 7),  [year, month]);

  const { items, byDay, loading, dayKey } = useCalendarItems(windowStart, windowEnd);

  const visible = (i: CalendarItem) => {
    if (filterKind !== 'All' && i.kind !== filterKind) return false;
    if (isAgency && i.kind === 'task' && i.status === 'Idea') return false;
    return true;
  };

  const handleCellClick = (date: Date) => {
    setSelectedCellDate(date);
    setIsDateModalOpen(true);
  };

  const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  // Month grid cells
  const firstDayIndex       = new Date(year, month, 1).getDay();
  const totalDays           = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays  = new Date(year, month, 0).getDate();
  const calendarCells: { day: number; isCurrentMonth: boolean; date: Date }[] = [];

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    calendarCells.push({ day: prevMonthTotalDays - i, isCurrentMonth: false, date: new Date(year, month - 1, prevMonthTotalDays - i) });
  }
  for (let d = 1; d <= totalDays; d++) {
    calendarCells.push({ day: d, isCurrentMonth: true, date: new Date(year, month, d) });
  }
  const remainingCells = (7 - (calendarCells.length % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    calendarCells.push({ day: i, isCurrentMonth: false, date: new Date(year, month + 1, i) });
  }

  /** Desktop text chip */
  const chip = (item: CalendarItem) => {
    const color = colorOf(item.brands[0]);
    const Icon  = KIND_ICON[item.kind];
    return (
      <div
        key={`${item.kind}-${item.id}`}
        title={`${item.kind.toUpperCase()}: ${item.title} [${item.status}] — ${item.brands.join(', ')}`}
        style={{
          fontSize: '10px', padding: '3px 6px', borderRadius: '4px', fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
          backgroundColor: `${color}1A`, color, borderLeft: `2.5px solid ${color}`,
        }}
      >
        <Icon size={10} style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
      </div>
    );
  };

  const sortedListItems = useMemo(
    () => items.filter(visible).sort((a, b) => +a.start - +b.start),
    [items, filterKind, isAgency],
  );

  return (
    <div className="calendar-view-wrap">

      {/* ── Controls bar ─────────────────────────────────────────── */}
      <div className="cal-controls">
        {/* Month / List toggle */}
        <div className="cal-controls-views">
          <button
            className={`btn ${viewMode === 'month' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('month')}
            style={{ padding: '8px 14px' }}
          >
            <CalIcon size={16} />
            <span>Month</span>
          </button>
          <button
            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('list')}
            style={{ padding: '8px 14px' }}
          >
            <List size={16} />
            <span>List</span>
          </button>
        </div>

        {/* Month navigator */}
        <div className="cal-controls-nav">
          <button className="btn-icon" onClick={handlePrevMonth}><ChevronLeft size={16} /></button>
          <h3 className="cal-month-title">
            {MONTH_NAMES[month]} {year}
          </h3>
          <button className="btn-icon" onClick={handleNextMonth}><ChevronRight size={16} /></button>
        </div>

        {/* Kind filter */}
        <select
          value={filterKind}
          onChange={e => setFilterKind(e.target.value as typeof filterKind)}
          className="cal-filter-select"
        >
          <option value="All">All Entries</option>
          <option value="task">Content Tasks</option>
          <option value="campaign">Campaigns</option>
          <option value="event">Events</option>
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading calendar entries..." />

      ) : viewMode === 'month' ? (
        /* ── Month grid ──────────────────────────────────────────── */
        <div className="section-card" style={{ padding: '0', overflow: 'hidden' }}>
          <div className="cal-grid">
            {/* Day-of-week headers */}
            {DAYS_SHORT.map((day, idx) => (
              <div key={idx} className="cal-day-header">
                <span className="cal-day-label-long">{day}</span>
                <span className="cal-day-label-short">{DAYS_NARROW[idx]}</span>
              </div>
            ))}

            {/* Date cells */}
            {calendarCells.map((cell, idx) => {
              const isToday      = new Date().toDateString() === cell.date.toDateString();
              const cellItems    = (byDay.get(dayKey(cell.date)) || []).filter(visible);
              // Desktop: max 3 chips then "+N more"
              const MAX_CHIPS    = 3;
              const visibleChips = cellItems.slice(0, MAX_CHIPS);
              const hiddenCount  = cellItems.length - visibleChips.length;
              // Mobile dots
              const dotItems     = cellItems.slice(0, 5);
              const extraCount   = cellItems.length - dotItems.length;

              return (
                <div
                  key={idx}
                  className="cal-cell"
                  onClick={() => handleCellClick(cell.date)}
                  style={{ opacity: cell.isCurrentMonth ? 1 : 0.38 }}
                >
                  {/* Day number */}
                  <span className="cal-day-num" style={{
                    backgroundColor: isToday ? 'var(--primary)' : 'transparent',
                    color: isToday ? '#fff' : 'inherit',
                  }}>
                    {cell.day}
                  </span>

                  {/* Desktop: text chips (max 3) */}
                  <div className="cal-chips">
                    {visibleChips.map(chip)}
                    {hiddenCount > 0 && (
                      <span className="cal-chip-more">+{hiddenCount} more</span>
                    )}
                  </div>

                  {/* Mobile: colored dot indicators */}
                  <div className="cal-dots">
                    {dotItems.map(item => (
                      <span
                        key={`dot-${item.kind}-${item.id}`}
                        className="cal-dot"
                        style={{ backgroundColor: colorOf(item.brands[0]) }}
                        title={item.title}
                      />
                    ))}
                    {extraCount > 0 && (
                      <span className="cal-dot-more">+{extraCount}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      ) : (
        /* ── List view ───────────────────────────────────────────── */
        <div className="section-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sortedListItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Nothing scheduled in this window.
              </div>
            ) : (
              sortedListItems.map(item => {
                const Icon     = KIND_ICON[item.kind];
                const color    = colorOf(item.brands[0]);
                const spansDays = +item.start !== +item.end;
                return (
                  <div key={`${item.kind}-${item.id}`} className="cal-list-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <span style={{
                        width: 30, height: 30, borderRadius: '8px', flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: `${color}1A`, color,
                      }}>
                        <Icon size={15} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: '14px', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.title}
                        </strong>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {item.brands.join(', ')} · {item.kind}
                          {' · '}
                          <strong>
                            {item.start.toLocaleDateString('en-GB')}
                            {spansDays ? ` → ${item.end.toLocaleDateString('en-GB')}` : ''}
                          </strong>
                        </div>
                      </div>
                    </div>
                    <span className={`badge ${(item.status || '').toLowerCase().replace(/ /g, '-')}`} style={{ flexShrink: 0 }}>
                      {item.status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Day detail modal ─────────────────────────────────────── */}
      {isDateModalOpen && selectedCellDate && (
        <div className="modal-overlay" onClick={() => setIsDateModalOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h4 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CalIcon size={18} style={{ color: 'var(--primary)' }} />
                <span>{selectedCellDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </h4>
              <button className="modal-close-btn" onClick={() => setIsDateModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '4px 0' }}>
              {(() => {
                const dayItems = (byDay.get(dayKey(selectedCellDate)) || []).filter(visible);

                if (dayItems.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
                      <p style={{ fontSize: '14px', marginBottom: '16px' }}>Nothing scheduled for this day.</p>
                      {!isAgency && (
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            const y = selectedCellDate.getFullYear();
                            const m = String(selectedCellDate.getMonth() + 1).padStart(2, '0');
                            const d = String(selectedCellDate.getDate()).padStart(2, '0');
                            window.location.href = `/tasks?newDate=${y}-${m}-${d}`;
                          }}
                          style={{ fontSize: '13px', padding: '8px 16px' }}
                        >
                          Schedule New Post
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                    {dayItems.map(item => {
                      const color = colorOf(item.brands[0]);
                      const Icon  = KIND_ICON[item.kind];
                      const task  = item.kind === 'task' ? (item.raw as TaskData) : null;
                      return (
                        <div
                          key={`${item.kind}-${item.id}`}
                          style={{
                            border: '1px solid var(--border)', borderRadius: '8px', padding: '16px',
                            backgroundColor: 'var(--bg)', borderLeft: `3px solid ${color}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div style={{ minWidth: 0, flex: 1, marginRight: '8px' }}>
                              <span style={{ fontSize: '10px', color: 'var(--text-light)', fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Icon size={11} /> {item.kind.toUpperCase()}
                              </span>
                              <h5 style={{ fontSize: '14px', fontWeight: 700, margin: '2px 0' }}>{item.title}</h5>
                              <span className="badge low" style={{ fontSize: '10px', padding: '1px 6px', marginTop: '4px' }}>
                                {item.brands.join(', ')}{task ? ` · ${task.contentType}` : ''}
                              </span>
                            </div>
                            <span className={`badge ${(item.status || '').toLowerCase().replace(/ /g, '-')}`} style={{ flexShrink: 0 }}>{item.status}</span>
                          </div>

                          {task && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                              <strong>Platforms:</strong> {(task.platforms || []).join(', ') || '—'}
                              {task.scheduledTime && ` @ ${task.scheduledTime}`}
                              <br />
                              <strong>Assigned To:</strong> {task.assignedTo}
                            </div>
                          )}

                          {task?.caption && (
                            <div style={{ marginTop: '8px' }}>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>CAPTION / BRIEF</span>
                              <p style={{
                                fontSize: '12px', backgroundColor: 'var(--card)', padding: '8px 12px',
                                borderRadius: '6px', border: '1px solid var(--border)', marginTop: '2px',
                                whiteSpace: 'pre-wrap', maxHeight: '80px', overflowY: 'auto',
                              }}>
                                {task.caption}
                              </p>
                            </div>
                          )}

                          {item.kind !== 'task' && +item.start !== +item.end && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                              Runs {toDisplayDate(item.start.toISOString().slice(0, 10))} → {toDisplayDate(item.end.toISOString().slice(0, 10))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div style={{ padding: '12px 24px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setIsDateModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
