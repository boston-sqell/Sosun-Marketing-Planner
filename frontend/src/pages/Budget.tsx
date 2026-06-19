import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, increment, onSnapshot, updateDoc,
} from 'firebase/firestore';
import { Plus, X, Trash2, Wallet, Pencil } from 'lucide-react';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { toDisplayDate } from '../utils/dateUtils';
import type { BudgetCategory, BudgetEntry, CampaignData, EventData } from '../types';

const CATEGORIES: BudgetCategory[] = [
  'media', 'production', 'sponsorship', 'logistics', 'print',
  'marketing-agency', 'billboards', 'tasting-events', 'other',
];

/**
 * Spend ledger. Every entry is one immutable row attributable to a brand and
 * optionally a campaign or event. campaigns.budgetSpent is a denormalized
 * rollup maintained with increment() on write/delete.
 */
export const Budget: React.FC = () => {
  const { role, profile } = useAuth();
  const { brands, isInScope, colorOf } = useBrandScope();
  const canEdit   = role === 'admin' || role === 'internal';
  const canDelete = role === 'admin';

  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<BudgetEntry | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    brand: '', campaignId: '', eventId: '', category: 'media' as BudgetCategory,
    description: '', notes: '', amount: 0, currency: 'MVR' as 'MVR' | 'USD',
    spentAt: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'budgetEntries'), snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as BudgetEntry)));
      setLoading(false);
    }, err => { console.warn('Ledger access denied:', err.message); setLoading(false); });
    const u2 = onSnapshot(collection(db, 'campaigns'), snap =>
      setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CampaignData))));
    const u3 = onSnapshot(collection(db, 'events'), snap =>
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventData))));
    return () => { u1(); u2(); u3(); };
  }, []);

  const visible = useMemo(
    () => entries.filter(e => isInScope(e.brand))
      .sort((a, b) => (b.spentAt || '').localeCompare(a.spentAt || '')),
    [entries, isInScope],
  );

  const totals = useMemo(() => {
    const byBrand = new Map<string, number>();
    const byCategory = new Map<string, number>();
    let total = 0;
    for (const e of visible) {
      total += e.amount || 0;
      byBrand.set(e.brand, (byBrand.get(e.brand) || 0) + (e.amount || 0));
      byCategory.set(e.category, (byCategory.get(e.category) || 0) + (e.amount || 0));
    }
    return { total, byBrand, byCategory };
  }, [visible]);

  const blankForm = () => ({
    brand: '', campaignId: '', eventId: '', category: 'media' as BudgetCategory,
    description: '', notes: '', amount: 0, currency: 'MVR' as 'MVR' | 'USD',
    spentAt: new Date().toISOString().slice(0, 10),
  });

  const openAdd = () => {
    setEditingEntry(null);
    setForm(blankForm());
    setError('');
    setModalOpen(true);
  };

  const openEdit = (entry: BudgetEntry) => {
    setEditingEntry(entry);
    setForm({
      brand: entry.brand,
      campaignId: entry.campaignId || '',
      eventId: entry.eventId || '',
      category: entry.category,
      description: entry.description,
      notes: entry.notes || '',
      amount: entry.amount || 0,
      currency: (entry.currency || 'MVR') as 'MVR' | 'USD',
      spentAt: entry.spentAt || new Date().toISOString().slice(0, 10),
    });
    setError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.brand) { setError('Brand is required.'); return; }
    if (!form.description.trim()) { setError('Description is required.'); return; }
    if (!form.amount || form.amount <= 0) { setError('Amount must be positive.'); return; }
    try {
      if (editingEntry) {
        // --- Update existing entry ---
        await updateDoc(doc(db, 'budgetEntries', editingEntry.id), {
          brand: form.brand,
          campaignId: form.campaignId || null,
          eventId: form.eventId || null,
          category: form.category,
          description: form.description.trim(),
          notes: form.notes.trim() || null,
          amount: form.amount,
          currency: form.currency,
          spentAt: form.spentAt,
        });
        // Reconcile denormalized budgetSpent on campaigns
        const oldCid = editingEntry.campaignId;
        const newCid = form.campaignId || null;
        const oldAmt = editingEntry.amount || 0;
        const newAmt = form.amount;
        if (oldCid === newCid) {
          // Same campaign – just apply the diff
          if (oldCid && oldAmt !== newAmt) {
            await updateDoc(doc(db, 'campaigns', oldCid), {
              budgetSpent: increment(newAmt - oldAmt),
            }).catch(() => {});
          }
        } else {
          // Campaign changed – roll back old, apply new
          if (oldCid) {
            await updateDoc(doc(db, 'campaigns', oldCid), {
              budgetSpent: increment(-oldAmt),
            }).catch(() => {});
          }
          if (newCid) {
            await updateDoc(doc(db, 'campaigns', newCid), {
              budgetSpent: increment(newAmt),
            }).catch(() => {});
          }
        }
      } else {
        // --- Add new entry ---
        await addDoc(collection(db, 'budgetEntries'), {
          brand: form.brand,
          campaignId: form.campaignId || null,
          eventId: form.eventId || null,
          category: form.category,
          description: form.description.trim(),
          notes: form.notes.trim() || null,
          amount: form.amount,
          currency: form.currency,
          spentAt: form.spentAt,
          enteredByUid: profile?.uid ?? null,
          enteredBy: profile?.displayName ?? '',
          createdAt: new Date().toISOString(),
        });
        // Denormalized rollup on the campaign
        if (form.campaignId) {
          await updateDoc(doc(db, 'campaigns', form.campaignId), {
            budgetSpent: increment(form.amount),
          });
        }
      }
      setModalOpen(false);
      setEditingEntry(null);
      setForm(blankForm());
      setError('');
    } catch (e: any) {
      setError(e.message || 'Save failed.');
    }
  };

  const remove = async (e: BudgetEntry) => {
    if (!window.confirm(`Delete entry "${e.description}" (${e.amount})?`)) return;
    await deleteDoc(doc(db, 'budgetEntries', e.id));
    if (e.campaignId) {
      await updateDoc(doc(db, 'campaigns', e.campaignId), {
        budgetSpent: increment(-(e.amount || 0)),
      }).catch(() => { /* campaign may have been deleted */ });
    }
  };

  if (loading) return <LoadingSpinner message="Loading ledger..." />;

  return (
    <div>
      {/* Totals */}
      <div className="card-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-header"><span className="stat-title">Total Spend (scope)</span></div>
          <div className="stat-value">{totals.total.toLocaleString()}</div>
          <div className="stat-sub">{visible.length} ledger entries</div>
        </div>
        {[...totals.byBrand.entries()].slice(0, 3).map(([brand, amt]) => (
          <div key={brand} className="stat-card" style={{ borderTop: `3px solid ${colorOf(brand)}` }}>
            <div className="stat-header"><span className="stat-title">{brand}</span></div>
            <div className="stat-value">{amt.toLocaleString()}</div>
            <div className="stat-sub">
              {((amt / (totals.total || 1)) * 100).toFixed(0)}% of scoped spend
            </div>
          </div>
        ))}
      </div>

      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={18} /> Budget Ledger
          </h3>
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={16} /> <span>Record Spend</span>
          </button>
        </div>

        {/* Category strip */}
        {totals.byCategory.size > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {[...totals.byCategory.entries()].map(([cat, amt]) => (
              <span key={cat} className="badge low" style={{ fontSize: 11 }}>
                {cat}: <strong>{amt.toLocaleString()}</strong>
              </span>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            No spend recorded in scope.
          </div>
        ) : visible.map(e => {
          const campaign = e.campaignId ? campaigns.find(c => c.id === e.campaignId) : null;
          const event = e.eventId ? events.find(ev => ev.id === e.eventId) : null;
          return (
            <div key={e.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 12,
            }}>
              <div>
                <strong style={{ fontSize: 13 }}>{e.description}</strong>
                <span className="badge low" style={{ fontSize: 10, marginLeft: 8 }}>{e.category}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 999, marginLeft: 6,
                  backgroundColor: `${colorOf(e.brand)}1A`, color: colorOf(e.brand),
                }}>{e.brand}</span>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {toDisplayDate(e.spentAt)}
                  {campaign && ` · campaign: ${campaign.name}`}
                  {event && ` · event: ${event.name}`}
                  {e.enteredBy && ` · by ${e.enteredBy}`}
                </div>
                {e.notes && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>
                    {e.notes}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
                  {(e.amount || 0).toLocaleString()} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.currency}</span>
                </strong>
                {canEdit && (
                  <button className="btn-icon" title="Edit entry" onClick={() => openEdit(e)}>
                    <Pencil size={13} />
                  </button>
                )}
                {canDelete && (
                  <button className="btn-icon" title="Delete entry" onClick={() => remove(e)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Entry modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => { setModalOpen(false); setEditingEntry(null); }}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h4 className="modal-title">{editingEntry ? 'Edit Entry' : 'Record Spend'}</h4>
              <button className="modal-close-btn" onClick={() => { setModalOpen(false); setEditingEntry(null); }}><X size={18} /></button>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Brand *</label>
                <select className="form-input" value={form.brand}
                  onChange={e => setForm({ ...form, brand: e.target.value })}>
                  <option value="">Select brand…</option>
                  {brands.filter(b => b.active !== false).map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-input" value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value as BudgetCategory })}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description *</label>
              <input className="form-input" value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Boosted IG campaign, June flight" />
            </div>
            <div className="form-group">
              <label className="form-label">Notes / Detail <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
              <textarea className="form-input" rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Invoice ref, vendor name, approval details…"
                style={{ resize: 'vertical', minHeight: 60 }} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Amount *</label>
                <input className="form-input" type="number" min={0} value={form.amount || ''}
                  onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-input" value={form.currency}
                  onChange={e => setForm({ ...form, currency: e.target.value as 'MVR' | 'USD' })}>
                  <option value="MVR">MVR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={form.spentAt}
                  onChange={e => setForm({ ...form, spentAt: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Campaign (optional)</label>
                <select className="form-input" value={form.campaignId}
                  onChange={e => setForm({ ...form, campaignId: e.target.value })}>
                  <option value="">—</option>
                  {campaigns
                    .filter(c => !form.brand || c.brand === form.brand)
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Event (optional)</label>
                <select className="form-input" value={form.eventId}
                  onChange={e => setForm({ ...form, eventId: e.target.value })}>
                  <option value="">—</option>
                  {events
                    .filter(ev => !form.brand || (ev.brands || []).includes(form.brand))
                    .map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => { setModalOpen(false); setEditingEntry(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editingEntry ? 'Save Changes' : 'Record Entry'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
