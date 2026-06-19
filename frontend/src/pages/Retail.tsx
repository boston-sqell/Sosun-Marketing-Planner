import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc,
} from 'firebase/firestore';
import { Plus, X, Store, Trash2, ArrowRight, Pencil } from 'lucide-react';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { toDisplayDate } from '../utils/dateUtils';
import type {
  Distribution, DistributionStatus, DistributionType, Outlet, OutletTier,
} from '../types';

const DIST_FLOW: DistributionStatus[] = ['allocated', 'dispatched', 'installed', 'verified', 'removed'];
const DIST_TYPES: DistributionType[] = [
  'window-sticker', 'shelf-strip', 'wobbler', 'shelf', 'standee',
  'poster', 'fridge', 'display-stand', 'billboard', 'other',
];
const TIERS: OutletTier[] = ['A', 'B', 'C'];

const nextDistStatus = (s: DistributionStatus): DistributionStatus | null => {
  const i = DIST_FLOW.indexOf(s);
  return i >= 0 && i < DIST_FLOW.length - 1 ? DIST_FLOW[i + 1] : null;
};

const isoToday = () => new Date().toISOString().slice(0, 10);

interface ActivityForm {
  outletId: string;
  brand: string;
  assetName: string;
  type: DistributionType;
  qty: number;
  status: DistributionStatus;
  activityDate: string;
}

const emptyActivity = (): ActivityForm => ({
  outletId: '', brand: '', assetName: '', type: 'window-sticker',
  qty: 1, status: 'allocated', activityDate: isoToday(),
});

const emptyOutlet = () => ({
  name: '', code: '', region: '', address: '', tier: 'B' as OutletTier,
  brands: [] as string[], contactName: '', contactPhone: '',
});

/**
 * Merchandising — one merged view: every activity (what was done, where,
 * for which brand, on which date) in a single editable table. Outlets are
 * managed from the "Outlets" modal; new outlets can also be created inline
 * while recording an activity.
 */
export const Retail: React.FC = () => {
  const { role, profile } = useAuth();
  const { brands, isInScope, colorOf } = useBrandScope();
  const canEdit = role === 'admin' || role === 'internal';

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [dists, setDists] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Activity modal (create or edit)
  const [activityModal, setActivityModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ActivityForm>(emptyActivity());
  // Inline quick-add outlet inside the activity modal
  const [quickOutlet, setQuickOutlet] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickRegion, setQuickRegion] = useState('');

  // Outlets management modal
  const [outletsModal, setOutletsModal] = useState(false);
  const [outletForm, setOutletForm] = useState(emptyOutlet());

  useEffect(() => {
    let pending = 2;
    const done = () => { if (--pending <= 0) setLoading(false); };
    const u1 = onSnapshot(collection(db, 'outlets'), snap => {
      setOutlets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Outlet)));
      done();
    });
    const u2 = onSnapshot(collection(db, 'distributions'), snap => {
      setDists(snap.docs.map(d => ({ id: d.id, ...d.data() } as Distribution)));
      done();
    });
    return () => { u1(); u2(); };
  }, []);

  const visible = useMemo(
    () => dists.filter(d => isInScope(d.brand))
      .sort((a, b) =>
        (b.activityDate || b.updatedAt || '').localeCompare(a.activityDate || a.updatedAt || '')),
    [dists, isInScope],
  );

  const coverage = useMemo(() => {
    const covered = new Set(visible
      .filter(d => d.status === 'installed' || d.status === 'verified')
      .map(d => d.outletId));
    return {
      outlets: covered.size,
      installed: visible.filter(d => d.status === 'installed').length,
      verified: visible.filter(d => d.status === 'verified').length,
      inTransit: visible.filter(d => d.status === 'allocated' || d.status === 'dispatched').length,
    };
  }, [visible]);

  /* ------------------------------ Activity CRUD ------------------------------ */

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyActivity());
    setQuickOutlet(false);
    setError('');
    setActivityModal(true);
  };

  const openEdit = (d: Distribution) => {
    setEditingId(d.id);
    setForm({
      outletId: d.outletId,
      brand: d.brand,
      assetName: d.assetName,
      type: d.type,
      qty: d.qty,
      status: d.status,
      activityDate: d.activityDate || (d.updatedAt || '').slice(0, 10) || isoToday(),
    });
    setQuickOutlet(false);
    setError('');
    setActivityModal(true);
  };

  const saveActivity = async () => {
    let outletId = form.outletId;
    let outletName = outlets.find(o => o.id === outletId)?.name || '';

    // Inline outlet creation
    if (quickOutlet) {
      if (!quickName.trim()) { setError('New outlet needs a name.'); return; }
      const ref = await addDoc(collection(db, 'outlets'), {
        name: quickName.trim(),
        code: quickName.trim().slice(0, 4).toUpperCase(),
        region: quickRegion.trim(),
        address: '', tier: 'B', brands: form.brand ? [form.brand] : [],
        contactName: '', contactPhone: '', active: true,
      });
      outletId = ref.id;
      outletName = quickName.trim();
    }

    if (!outletId || !form.brand || !form.assetName.trim()) {
      setError('Outlet, brand and activity are required.');
      return;
    }

    const payload = {
      outletId,
      outletName,
      brand: form.brand,
      assetName: form.assetName.trim(),
      type: form.type,
      qty: Math.max(1, form.qty),
      status: form.status,
      activityDate: form.activityDate || isoToday(),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, 'distributions', editingId), payload);
      } else {
        await addDoc(collection(db, 'distributions'), {
          ...payload,
          installedAt: null, verifiedByUid: null, photoAssetId: null,
        });
      }
      setActivityModal(false);
      setQuickName(''); setQuickRegion('');
    } catch (e: any) {
      setError(e.message || 'Save failed.');
    }
  };

  const advance = (d: Distribution) => {
    const to = nextDistStatus(d.status);
    if (!to) return;
    const patch: Record<string, unknown> = { status: to, updatedAt: new Date().toISOString() };
    if (to === 'installed') patch.installedAt = new Date().toISOString();
    if (to === 'verified') patch.verifiedByUid = profile?.uid ?? null;
    updateDoc(doc(db, 'distributions', d.id), patch);
  };

  /* ------------------------------ Outlet CRUD ------------------------------ */

  const saveOutlet = async () => {
    if (!outletForm.name.trim()) { setError('Outlet name required.'); return; }
    await addDoc(collection(db, 'outlets'), {
      ...outletForm,
      name: outletForm.name.trim(),
      code: outletForm.code.trim().toUpperCase() || outletForm.name.slice(0, 4).toUpperCase(),
      active: true,
    });
    setOutletForm(emptyOutlet());
    setError('');
  };

  if (loading) return <LoadingSpinner message="Loading merchandising data..." />;

  const brandPill = (name: string) => (
    <span key={name} style={{
      fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 999,
      backgroundColor: `${colorOf(name)}1A`, color: colorOf(name), whiteSpace: 'nowrap',
    }}>{name}</span>
  );

  return (
    <div>
      {/* Coverage KPIs */}
      <div className="card-grid" style={{ marginBottom: 20 }}>
        {[
          { title: 'Outlets Covered', value: coverage.outlets, sub: `of ${outlets.length} outlets` },
          { title: 'Installed', value: coverage.installed, sub: 'merchandising live' },
          { title: 'Verified', value: coverage.verified, sub: 'with proof' },
          { title: 'In Transit', value: coverage.inTransit, sub: 'allocated / dispatched' },
        ].map(k => (
          <div key={k.title} className="stat-card">
            <div className="stat-header"><span className="stat-title">{k.title}</span></div>
            <div className="stat-value">{k.value}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Merged activity table */}
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Store size={18} /> Merchandising Activities ({visible.length})
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && (
              <>
                <button className="btn btn-secondary" onClick={() => { setError(''); setOutletsModal(true); }}>
                  <Store size={15} /> <span>Outlets ({outlets.length})</span>
                </button>
                <button className="btn btn-primary" onClick={openCreate}>
                  <Plus size={16} /> <span>Record Activity</span>
                </button>
              </>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            No merchandising activity in scope. {canEdit ? 'Record the first one.' : ''}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 10px' }}>Date</th>
                  <th style={{ padding: '8px 10px' }}>Activity</th>
                  <th style={{ padding: '8px 10px' }}>Type</th>
                  <th style={{ padding: '8px 10px' }}>Brand</th>
                  <th style={{ padding: '8px 10px' }}>Outlet</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                  {canEdit && <th style={{ padding: '8px 10px' }} />}
                </tr>
              </thead>
              <tbody>
                {visible.map(d => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                      {toDisplayDate(d.activityDate || (d.updatedAt || '').slice(0, 10))}
                    </td>
                    <td style={{ padding: '10px', fontWeight: 600 }}>{d.assetName}</td>
                    <td style={{ padding: '10px' }}>
                      <span className="badge low" style={{ fontSize: 10 }}>{d.type}</span>
                    </td>
                    <td style={{ padding: '10px' }}>{brandPill(d.brand)}</td>
                    <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{d.outletName}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{d.qty}</td>
                    <td style={{ padding: '10px' }}>
                      <span className={`badge ${d.status === 'verified' ? 'approved' : d.status === 'installed' ? 'medium' : ''}`}>
                        {d.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {nextDistStatus(d.status) && (
                            <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }}
                              title={`Advance to ${nextDistStatus(d.status)}`}
                              onClick={() => advance(d)}>
                              <ArrowRight size={10} /> <span>{nextDistStatus(d.status)}</span>
                            </button>
                          )}
                          <button className="btn-icon" title="Edit activity" onClick={() => openEdit(d)}>
                            <Pencil size={13} />
                          </button>
                          <button className="btn-icon" title="Delete"
                            onClick={() => window.confirm('Delete this activity record?') && deleteDoc(doc(db, 'distributions', d.id))}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity modal (create / edit) */}
      {activityModal && (
        <div className="modal-overlay" onClick={() => setActivityModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h4 className="modal-title">{editingId ? 'Edit Merchandising Activity' : 'Record Merchandising Activity'}</h4>
              <button className="modal-close-btn" onClick={() => setActivityModal(false)}><X size={18} /></button>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input className="form-input" type="date" value={form.activityDate}
                  onChange={e => setForm({ ...form, activityDate: e.target.value })} />
              </div>
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
            </div>

            <div className="form-group">
              <label className="form-label">Outlet *</label>
              {!quickOutlet ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="form-input" style={{ flex: 1 }} value={form.outletId}
                    onChange={e => setForm({ ...form, outletId: e.target.value })}>
                    <option value="">Select outlet…</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.name}{o.region ? ` (${o.region})` : ''}</option>)}
                  </select>
                  <button className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}
                    onClick={() => setQuickOutlet(true)}>
                    <Plus size={13} /> <span>New</span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" style={{ flex: 1 }} placeholder="New outlet name"
                    value={quickName} onChange={e => setQuickName(e.target.value)} />
                  <input className="form-input" style={{ width: 120 }} placeholder="Region"
                    value={quickRegion} onChange={e => setQuickRegion(e.target.value)} />
                  <button className="btn-icon" title="Pick existing instead" onClick={() => setQuickOutlet(false)}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Activity / Asset *</label>
                <input className="form-input" value={form.assetName}
                  onChange={e => setForm({ ...form, assetName: e.target.value })}
                  placeholder="Summer promo window sticker" />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input" value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value as DistributionType })}>
                  {DIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Qty</label>
                <input className="form-input" type="number" min={1} value={form.qty}
                  onChange={e => setForm({ ...form, qty: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-input" value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value as DistributionStatus })}>
                  {DIST_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setActivityModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveActivity}>
                {editingId ? 'Save Changes' : 'Record Activity'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outlets management modal */}
      {outletsModal && (
        <div className="modal-overlay" onClick={() => setOutletsModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h4 className="modal-title">Outlets ({outlets.length})</h4>
              <button className="modal-close-btn" onClick={() => setOutletsModal(false)}><X size={18} /></button>
            </div>

            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>
              {outlets.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No outlets yet.</div>
              ) : outlets.map(o => (
                <div key={o.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 8,
                }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{o.name}</strong>
                    <span className="badge low" style={{ fontSize: 9, marginLeft: 6 }}>Tier {o.tier}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{o.region}</span>
                    <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
                      {(o.brands || []).map(brandPill)}
                    </span>
                  </div>
                  <button className="btn-icon" title="Delete outlet"
                    onClick={() => window.confirm(`Delete outlet "${o.name}"?`) && deleteDoc(doc(db, 'outlets', o.id))}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <strong style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Add Outlet</strong>
            <div className="form-row" style={{ marginTop: 8 }}>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" value={outletForm.name}
                  onChange={e => setOutletForm({ ...outletForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Region</label>
                <input className="form-input" value={outletForm.region}
                  onChange={e => setOutletForm({ ...outletForm, region: e.target.value })} placeholder="Malé" />
              </div>
              <div className="form-group">
                <label className="form-label">Tier</label>
                <select className="form-input" value={outletForm.tier}
                  onChange={e => setOutletForm({ ...outletForm, tier: e.target.value as OutletTier })}>
                  {TIERS.map(t => <option key={t} value={t}>Tier {t}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Assigned Brands</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {brands.filter(b => b.active !== false).map(b => {
                  const active = outletForm.brands.includes(b.name);
                  return (
                    <button key={b.id}
                      onClick={() => setOutletForm(f => ({
                        ...f,
                        brands: active ? f.brands.filter(x => x !== b.name) : [...f.brands, b.name],
                      }))}
                      style={{
                        padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: `1.5px solid ${active ? b.color : 'var(--border)'}`,
                        backgroundColor: active ? `${b.color}22` : 'var(--card)',
                        color: active ? b.color : 'var(--text-muted)',
                      }}>
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setOutletsModal(false)}>Close</button>
              <button className="btn btn-primary" onClick={saveOutlet}>
                <Plus size={14} /> <span>Add Outlet</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
