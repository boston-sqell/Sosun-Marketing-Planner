import React, { useEffect, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc,
} from 'firebase/firestore';
import { ArrowRight, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { PACKING_LANES, nextStatus } from './packing';
import type { PackingItem, PackingStatus } from '../../types';

const LANE_LABEL: Record<PackingStatus, string> = {
  requested: 'Requested', packed: 'Packed', shipped: 'Shipped',
  'on-site': 'On-Site', returned: 'Returned', damaged: 'Damaged',
};

/**
 * Real-time packing board for one event. Every status click is a direct
 * Firestore write; all open devices converge via onSnapshot.
 */
export const PackingBoard: React.FC<{ eventId: string; readOnly?: boolean }> = ({ eventId, readOnly }) => {
  const { profile } = useAuth();
  const [items, setItems] = useState<PackingItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState(1);

  useEffect(() =>
    onSnapshot(collection(db, 'events', eventId, 'packingItems'), snap =>
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as PackingItem)))),
    [eventId]);

  const stamp = () => ({
    updatedByUid: profile?.uid ?? null,
    updatedAt: new Date().toISOString(),
  });

  const advance = (item: PackingItem) => {
    const to = nextStatus(item.status);
    if (!to) return;
    updateDoc(doc(db, 'events', eventId, 'packingItems', item.id), { status: to, ...stamp() });
  };

  const markDamaged = (item: PackingItem) =>
    updateDoc(doc(db, 'events', eventId, 'packingItems', item.id), { status: 'damaged', ...stamp() });

  const remove = (item: PackingItem) =>
    deleteDoc(doc(db, 'events', eventId, 'packingItems', item.id));

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    await addDoc(collection(db, 'events', eventId, 'packingItems'), {
      assetName: name, qty: Math.max(1, newQty), status: 'requested',
      mediaAssetId: null, ...stamp(),
    });
    setNewName('');
    setNewQty(1);
  };

  return (
    <div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            className="form-input" placeholder="Display asset (e.g. Brand standee 2m)"
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            style={{ flex: 1 }}
          />
          <input
            className="form-input" type="number" min={1} value={newQty}
            onChange={e => setNewQty(parseInt(e.target.value) || 1)}
            style={{ width: 70 }}
          />
          <button className="btn btn-primary" onClick={add}><Plus size={15} /> <span>Add</span></button>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${PACKING_LANES.length}, minmax(140px, 1fr))`,
        gap: 10, overflowX: 'auto',
      }}>
        {PACKING_LANES.map(lane => {
          const laneItems = items.filter(i => i.status === lane);
          return (
            <section key={lane} style={{
              backgroundColor: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 8, minHeight: 120,
              borderTop: lane === 'damaged' ? '3px solid var(--red)' : '3px solid var(--primary)',
            }}>
              <h5 style={{
                fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
                color: 'var(--text-muted)', margin: '2px 0 8px', letterSpacing: '0.4px',
              }}>
                {LANE_LABEL[lane]} ({laneItems.length})
              </h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {laneItems.map(item => (
                  <article key={item.id} style={{
                    backgroundColor: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '8px 10px', fontSize: 12,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {item.assetName} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>×{item.qty}</span>
                    </div>
                    {!readOnly && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {nextStatus(item.status) && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }}
                            onClick={() => advance(item)}>
                            <ArrowRight size={10} /> <span>{LANE_LABEL[nextStatus(item.status)!]}</span>
                          </button>
                        )}
                        {item.status !== 'damaged' && item.status !== 'returned' && (
                          <button className="btn-icon" title="Mark damaged" onClick={() => markDamaged(item)}>
                            <TriangleAlert size={12} style={{ color: 'var(--red)' }} />
                          </button>
                        )}
                        <button className="btn-icon" title="Remove" onClick={() => remove(item)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
