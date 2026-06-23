import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, doc, onSnapshot, query, updateDoc, where,
} from 'firebase/firestore';
import {
  Plus, X, Tent, Trash2, ChevronDown, ChevronUp, CircleDollarSign,
} from 'lucide-react';
import { db } from '../firebase/config';
import { eventsApi } from '../services/eventsApi';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { PackingBoard } from '../features/events/PackingBoard';
import { EVENT_STATUS_FLOW, eventROI } from '../features/events/packing';
import { toDisplayDate } from '../utils/dateUtils';
import type {
  BudgetEntry, EventData, EventStatus, EventType, LogisticsKind, LogisticsLeg,
} from '../types';

const EVENT_TYPES: EventType[] = ['tradeshow', 'exhibition', 'sponsorship', 'activation'];
const LOGISTICS_KINDS: LogisticsKind[] = ['shipment', 'booth', 'staffing', 'permit'];

const emptyForm = () => ({
  name: '', type: 'tradeshow' as EventType, venue: '', city: '',
  brands: [] as string[], startDate: '', endDate: '',
  sponsorshipCost: 0, expectedFootfall: 0, notes: '',
});

/* ------------------------------ Logistics list ------------------------------ */

const LogisticsList: React.FC<{ eventId: string; canEdit: boolean; onCost: (c: LogisticsLeg[]) => void }> =
  ({ eventId, canEdit, onCost }) => {
    const [legs, setLegs] = useState<LogisticsLeg[]>([]);
    const [form, setForm] = useState({ kind: 'shipment' as LogisticsKind, description: '', dueDate: '', cost: 0 });

    useEffect(() =>
      onSnapshot(collection(db, 'events', eventId, 'logistics'), snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as LogisticsLeg));
        setLegs(list);
        onCost(list);
      }), [eventId]);

    const add = async () => {
      if (!form.description.trim()) return;
      await addDoc(collection(db, 'events', eventId, 'logistics'), {
        ...form, description: form.description.trim(), status: 'pending',
      });
      setForm({ kind: 'shipment', description: '', dueDate: '', cost: 0 });
    };

    const cycle = (leg: LogisticsLeg) => {
      const order = ['pending', 'in-progress', 'done'] as const;
      const next = order[(order.indexOf(leg.status) + 1) % order.length];
      updateDoc(doc(db, 'events', eventId, 'logistics', leg.id), { status: next });
    };

    return (
      <div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <select className="form-input" style={{ width: 110 }} value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value as LogisticsKind })}>
              {LOGISTICS_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input className="form-input" style={{ flex: 1, minWidth: 160 }} placeholder="Description"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <input className="form-input" type="date" style={{ width: 150 }} value={form.dueDate}
              onChange={e => setForm({ ...form, dueDate: e.target.value })} />
            <input className="form-input" type="number" style={{ width: 110 }} placeholder="Cost" value={form.cost || ''}
              onChange={e => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} />
            <button className="btn btn-primary" onClick={add}><Plus size={14} /></button>
          </div>
        )}
        {legs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No logistics legs yet.</div>
        ) : legs.map(leg => (
          <div key={leg.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)',
          }}>
            <div>
              <span className="badge low" style={{ fontSize: 10, marginRight: 8 }}>{leg.kind}</span>
              <strong>{leg.description}</strong>
              {leg.dueDate && <span style={{ color: 'var(--text-muted)' }}> · due {toDisplayDate(leg.dueDate)}</span>}
              {leg.cost > 0 && <span style={{ color: 'var(--text-muted)' }}> · {leg.cost.toLocaleString()}</span>}
            </div>
            <button
              className={`badge ${leg.status === 'done' ? 'approved' : leg.status === 'in-progress' ? 'medium' : ''}`}
              style={{ cursor: canEdit ? 'pointer' : 'default', border: 'none' }}
              onClick={() => canEdit && cycle(leg)}
              title={canEdit ? 'Click to advance' : ''}
            >
              {leg.status}
            </button>
          </div>
        ))}
      </div>
    );
  };

/* ------------------------------ Event detail ------------------------------ */

const EventDetail: React.FC<{ event: EventData; canEdit: boolean; showBudget: boolean }> =
  ({ event, canEdit, showBudget }) => {
    const [legs, setLegs] = useState<LogisticsLeg[]>([]);
    const [ledgerCost, setLedgerCost] = useState(0);
    const [metrics, setMetrics] = useState({
      leadsCaptured: event.leadsCaptured || 0,
      salesAttributed: event.salesAttributed || 0,
    });

    // Ledger entries tagged to this event (admin/internal only — rules enforce)
    useEffect(() => {
      if (!showBudget) return;
      return onSnapshot(
        query(collection(db, 'budgetEntries'), where('eventId', '==', event.id)),
        snap => setLedgerCost(snap.docs.reduce((s, d) => s + ((d.data() as BudgetEntry).amount || 0), 0)),
        err => console.warn('Ledger listener denied:', (err as Error).message),
      );
    }, [event.id, showBudget]);

    const { totalCost, roi } = eventROI(
      { ...event, ...metrics }, legs, ledgerCost,
    );

    const saveMetrics = () =>
      eventsApi.update(event.id, { ...metrics });

    const setStatus = (status: EventStatus) =>
      eventsApi.update(event.id, { status });

    return (
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 14 }}>
        {/* Status pipeline */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {EVENT_STATUS_FLOW.map(s => (
            <button key={s}
              className={`btn ${event.status === s ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '4px 10px' }}
              disabled={!canEdit}
              onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: showBudget ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
          {/* Logistics */}
          <div className="section-card" style={{ margin: 0 }}>
            <h4 style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Logistics</h4>
            <LogisticsList eventId={event.id} canEdit={canEdit} onCost={setLegs} />
          </div>

          {/* ROI */}
          {showBudget && (
            <div className="section-card" style={{ margin: 0 }}>
              <h4 style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CircleDollarSign size={14} /> Budget & ROI
              </h4>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>Sponsorship fee: <strong>{(event.sponsorshipCost || 0).toLocaleString()}</strong></div>
                <div>Logistics: <strong>{legs.reduce((s, l) => s + (l.cost || 0), 0).toLocaleString()}</strong></div>
                <div>Ledger entries: <strong>{ledgerCost.toLocaleString()}</strong></div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  Total cost: <strong>{totalCost.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Leads</label>
                  <input className="form-input" type="number" style={{ width: 90 }} disabled={!canEdit}
                    value={metrics.leadsCaptured}
                    onChange={e => setMetrics({ ...metrics, leadsCaptured: parseInt(e.target.value) || 0 })} />
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sales attrib.</label>
                  <input className="form-input" type="number" style={{ width: 110 }} disabled={!canEdit}
                    value={metrics.salesAttributed}
                    onChange={e => setMetrics({ ...metrics, salesAttributed: parseFloat(e.target.value) || 0 })} />
                  {canEdit && <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={saveMetrics}>Save</button>}
                </div>
                <div style={{
                  marginTop: 6, fontSize: 15, fontWeight: 800,
                  color: roi === null ? 'var(--text-muted)' : roi >= 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  ROI: {roi === null ? '—' : `${(roi * 100).toFixed(1)}%`}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Packing board */}
        <div className="section-card" style={{ margin: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Display Asset Packing</h4>
          <PackingBoard eventId={event.id} readOnly={!canEdit} />
        </div>
      </div>
    );
  };

/* -------------------------------- Page -------------------------------- */

export const Events: React.FC = () => {
  const { role } = useAuth();
  const { brands, anyInScope, colorOf } = useBrandScope();
  const canEdit = role === 'admin' || role === 'internal';
  const showBudget = canEdit; // agency partners never see spend

  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  useEffect(() =>
    onSnapshot(collection(db, 'events'), snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventData)));
      setLoading(false);
    }), []);

  const visibleEvents = useMemo(
    () => events
      .filter(e => anyInScope(e.brands))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [events, anyInScope],
  );

  const toggleBrand = (name: string) =>
    setForm(f => ({
      ...f,
      brands: f.brands.includes(name) ? f.brands.filter(b => b !== name) : [...f.brands, name],
    }));

  const save = async () => {
    if (!form.name.trim()) { setError('Event name is required.'); return; }
    if (!form.startDate || !form.endDate) { setError('Start and end dates are required.'); return; }
    if (form.brands.length === 0) { setError('Select at least one sponsoring brand.'); return; }
    try {
      await eventsApi.create({
        ...form,
        name: form.name.trim(),
        status: 'Scoping',
      });
      setModalOpen(false);
      setForm(emptyForm());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  };

  const remove = async (e: EventData) => {
    if (!window.confirm(`Delete event "${e.name}" and its packing/logistics data?`)) return;
    try {
      await eventsApi.delete(e.id);
    } catch (err) {
      setError((err as Error).message || 'Delete failed.');
    }
  };

  if (loading) return <LoadingSpinner message="Loading events..." />;

  return (
    <div>
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tent size={18} /> Events & Sponsorships ({visibleEvents.length})
          </h3>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => { setForm(emptyForm()); setError(''); setModalOpen(true); }}>
              <Plus size={16} /> <span>New Event</span>
            </button>
          )}
        </div>

        {visibleEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
            No events in scope. {canEdit ? 'Create the first one.' : ''}
          </div>
        ) : visibleEvents.map(ev => {
          const isOpen = expanded === ev.id;
          return (
            <div key={ev.id} style={{
              border: '1px solid var(--border)', borderRadius: 10, padding: 14,
              marginBottom: 12, backgroundColor: 'var(--bg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : ev.id)}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{ev.name}</strong>
                    <span className="badge low" style={{ fontSize: 10 }}>{ev.type}</span>
                    <span className={`badge ${ev.status === 'Live' ? 'approved' : ''}`} style={{ fontSize: 10 }}>{ev.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{ev.venue}{ev.city ? `, ${ev.city}` : ''}</span>
                    <span>· {toDisplayDate(ev.startDate)} → {toDisplayDate(ev.endDate)}</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      {(ev.brands || []).map(b => (
                        <span key={b} style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 999,
                          backgroundColor: `${colorOf(b)}1A`, color: colorOf(b),
                        }}>{b}</span>
                      ))}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {canEdit && (
                    <button className="btn-icon" title="Delete event"
                      onClick={e => { e.stopPropagation(); remove(ev); }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {isOpen && <EventDetail event={ev} canEdit={canEdit} showBudget={showBudget} />}
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h4 className="modal-title">New Event / Sponsorship</h4>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>

            <div className="form-group">
              <label className="form-label">Event Name *</label>
              <input className="form-input" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Maldives Trade Expo 2026" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input" value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value as EventType })}>
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Sponsorship Cost</label>
                <input className="form-input" type="number" value={form.sponsorshipCost || ''}
                  onChange={e => setForm({ ...form, sponsorshipCost: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Venue</label>
                <input className="form-input" value={form.venue}
                  onChange={e => setForm({ ...form, venue: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">City</label>
                <input className="form-input" value={form.city}
                  onChange={e => setForm({ ...form, city: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Date *</label>
                <input className="form-input" type="date" value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">End Date *</label>
                <input className="form-input" type="date" value={form.endDate}
                  onChange={e => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Sponsoring Brands *</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {brands.filter(b => b.active !== false).map(b => {
                  const active = form.brands.includes(b.name);
                  return (
                    <button key={b.id} onClick={() => toggleBrand(b.name)} style={{
                      padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: `1.5px solid ${active ? b.color : 'var(--border)'}`,
                      backgroundColor: active ? `${b.color}22` : 'var(--card)',
                      color: active ? b.color : 'var(--text-muted)',
                    }}>{b.name}</button>
                  );
                })}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Create Event</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
