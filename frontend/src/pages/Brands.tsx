import React, { useState } from 'react';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { triggerSheetsBackup } from '../services/syncApi';
import type { Brand } from '../types';

const PALETTE = ['#7C6FF0', '#E2574C', '#2E9E6B', '#D98E04', '#1A66C2', '#C53070', '#0E8C8C', '#6B4FA1'];

interface BrandForm {
  name: string; code: string; principal: string;
  countryOfOrigin: string; color: string; active: boolean;
}

const emptyForm = (color: string): BrandForm =>
  ({ name: '', code: '', principal: '', countryOfOrigin: '', color, active: true });

export const Brands: React.FC = () => {
  const { role } = useAuth();
  const { brands } = useBrandScope();
  const canEdit = role === 'admin';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [form, setForm] = useState<BrandForm>(emptyForm(PALETTE[0]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(PALETTE[brands.length % PALETTE.length]));
    setError('');
    setModalOpen(true);
  };

  const openEdit = (b: Brand) => {
    setEditing(b);
    setForm({
      name: b.name, code: b.code || '', principal: b.principal || '',
      countryOfOrigin: b.countryOfOrigin || '', color: b.color || PALETTE[0],
      active: b.active !== false,
    });
    setError('');
    setModalOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) { setError('Brand name is required.'); return; }
    const duplicate = brands.some(b => b.name === name && b.id !== editing?.id);
    if (duplicate) { setError('A brand with this name already exists.'); return; }

    setSaving(true);
    try {
      const payload = {
        name,
        code: form.code.trim().toUpperCase() || name.slice(0, 3).toUpperCase(),
        principal: form.principal.trim(),
        countryOfOrigin: form.countryOfOrigin.trim(),
        color: form.color,
        active: form.active,
      };
      if (editing) {
        await updateDoc(doc(db, 'brands', editing.id), payload);
      } else {
        await addDoc(collection(db, 'brands'), {
          ...payload, createdAt: new Date().toISOString(),
        });
      }
      triggerSheetsBackup();
      setModalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: Brand) => {
    if (!window.confirm(`Delete brand "${b.name}"? Existing campaigns/tasks keep their brand label.`)) return;
    await deleteDoc(doc(db, 'brands', b.id));
    triggerSheetsBackup();
  };

  return (
    <div>
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title">Brands ({brands.length})</h3>
          {canEdit && (
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> <span>Add Brand</span>
            </button>
          )}
        </div>

        {brands.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
            No brands yet. {canEdit ? 'Add your first brand, or run the seed script to import legacy brand names.' : ''}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
            {brands.map(b => (
              <div key={b.id} style={{
                border: '1px solid var(--border)', borderRadius: '10px', padding: '14px',
                backgroundColor: 'var(--bg)', borderTop: `3px solid ${b.color || 'var(--primary)'}`,
                opacity: b.active === false ? 0.55 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '15px' }}>{b.name}</strong>
                    <span className="badge low" style={{ marginLeft: 8, fontSize: '10px' }}>{b.code}</span>
                    {b.active === false && <span className="badge" style={{ marginLeft: 6, fontSize: '10px' }}>Inactive</span>}
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 4 }}>
                      {b.principal || '—'}{b.countryOfOrigin ? ` · ${b.countryOfOrigin}` : ''}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" title="Edit" onClick={() => openEdit(b)}><Pencil size={14} /></button>
                      <button className="btn-icon" title="Delete" onClick={() => remove(b)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h4 className="modal-title">{editing ? `Edit ${editing.name}` : 'Add Brand'}</h4>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>

            <div className="form-group">
              <label className="form-label">Brand Name *</label>
              <input className="form-input" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Sosun Cook" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Code</label>
                <input className="form-input" value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value })} placeholder="SCK" maxLength={5} />
              </div>
              <div className="form-group">
                <label className="form-label">Country of Origin</label>
                <input className="form-input" value={form.countryOfOrigin}
                  onChange={e => setForm({ ...form, countryOfOrigin: e.target.value })} placeholder="Thailand" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Principal / Supplier</label>
              <input className="form-input" value={form.principal}
                onChange={e => setForm({ ...form, principal: e.target.value })} placeholder="International principal" />
            </div>
            <div className="form-group">
              <label className="form-label">Accent Color</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setForm({ ...form, color: c })} style={{
                    width: 26, height: 26, borderRadius: '50%', backgroundColor: c, cursor: 'pointer',
                    border: form.color === c ? '3px solid var(--text)' : '2px solid transparent',
                  }} />
                ))}
              </div>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="brand-active" checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })} />
              <label htmlFor="brand-active" className="form-label" style={{ margin: 0 }}>Active</label>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: '13px', marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Brand'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
