import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { triggerSheetsBackup } from '../services/syncApi';
import { db } from '../firebase/config';
import { collection, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { Plus, Trash2, Edit, X, Target } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { toDisplayDate } from '../utils/dateUtils';
import { driveApi } from '../services/driveApi';
import { mockCampaigns } from '../mockData';
import type { CampaignData, ChecklistItem } from '../types';
import { campaignsApi } from '../services/campaignsApi';
import { logActivity } from '../utils/activityLogger';

export const Campaigns: React.FC = () => {
  const { profile } = useAuth();
  const { brands: brandCatalog } = useBrandScope();
  const role = profile?.role || 'internal';
  const isAgency = role === 'agency';

  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Pagination states
  const [hasMore, setHasMore] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('Sosun Fihaara');
  const [type, setType] = useState('Seasonal');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('Draft');
  const [objective, setObjective] = useState('');
  const [platforms, setPlatforms] = useState('');
  const [postsPlanned, setPostsPlanned] = useState(0);
  const [budget, setBudget] = useState(0);
  const [notes, setNotes] = useState('');
  const [assetLinks, setAssetLinks] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');

  const loadCampaigns = async (isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const list = await campaignsApi.list();
      setCampaigns(list);
      setHasMore(false);
    } catch (err) {
      console.error('Error loading campaigns, using mock data:', err);
      if (!isLoadMore) {
        setCampaigns(mockCampaigns);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const handleOpenCreate = () => {
    setEditingId(null);
    setName('');
    setBrand('Sosun Fihaara');
    setType('Seasonal');
    setStartDate('');
    setEndDate('');
    setStatus('Draft');
    setObjective('');
    setPlatforms('');
    setPostsPlanned(0);
    setBudget(0);
    setNotes('');
    setAssetLinks([]);
    setChecklist([]);
    setNewCheckItem('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (campaign: CampaignData) => {
    setEditingId(campaign.id);
    setName(campaign.name);
    setBrand(campaign.brand);
    setType(campaign.type);
    setStartDate(campaign.startDate || '');
    setEndDate(campaign.endDate || '');
    setStatus(campaign.status);
    setObjective(campaign.objective);
    setPlatforms(campaign.platforms);
    setPostsPlanned(campaign.postsPlanned);
    setBudget(campaign.budget);
    setNotes(campaign.notes);
    setAssetLinks(campaign.assetLinks?.length
      ? campaign.assetLinks
      : (campaign.assetLink ? [campaign.assetLink] : []));
    setChecklist(campaign.checklist || []);
    setNewCheckItem('');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Secure Firestore-generated ID if creating new campaign
    const campaignId = editingId || doc(collection(db, 'campaigns')).id;
    
    const data: CampaignData = {
      id: campaignId,
      name,
      brand,
      type,
      startDate,
      endDate,
      status,
      objective,
      platforms,
      postsPlanned,
      budget,
      notes,
      assetLink: assetLinks.find(l => l.trim()) || '',
      assetLinks: assetLinks.map(l => l.trim()).filter(Boolean),
      checklist
    };

    try {
      await setDoc(doc(db, 'campaigns', campaignId), data);
      if (editingId) {
        setCampaigns(prev => prev.map(c => c.id === editingId ? data : c));
        await logActivity(profile?.displayName || 'User', role, 'campaign', 'updated campaign', name, campaignId);
      } else {
        setCampaigns(prev => [data, ...prev]);
        await logActivity(profile?.displayName || 'User', role, 'campaign', 'created campaign', name, campaignId);
      }
    } catch (err) {
      console.error('Could not save campaign to Firestore, using state-only fallback:', err);
      if (editingId) {
        setCampaigns(prev => prev.map(c => c.id === editingId ? data : c));
      } else {
        setCampaigns(prev => [data, ...prev]);
      }
    }

    // Auto-create the Google Drive folder structure for new campaigns.
    // Best-effort: never block campaign creation if Drive isn't configured.
    if (!editingId) {
      driveApi.provisionCampaign(campaignId).catch(err =>
        console.warn('Campaign Drive folder provisioning skipped:', err.message)
      );
    }

    triggerSheetsBackup();
    setIsModalOpen(false);
  };

  const toggleChecklistItem = async (campaign: CampaignData, itemId: string) => {
    if (isAgency) return;
    const updated = (campaign.checklist || []).map(i =>
      i.id === itemId ? { ...i, done: !i.done } : i);
    setCampaigns(prev => prev.map(c => c.id === campaign.id ? { ...c, checklist: updated } : c));
    try {
      await updateDoc(doc(db, 'campaigns', campaign.id), { checklist: updated });
    } catch (err) {
      console.error('Could not update checklist:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this campaign?')) return;
    
    const campToDelete = campaigns.find(c => c.id === id);
    try {
      await deleteDoc(doc(db, 'campaigns', id));
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (campToDelete) {
        await logActivity(profile?.displayName || 'User', role, 'campaign', 'deleted campaign', campToDelete.name, id);
      }
    } catch (err) {
      console.error('Could not delete campaign:', err);
      setCampaigns(prev => prev.filter(c => c.id !== id));
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active': return 'badge active';
      case 'planning': return 'badge medium';
      case 'draft': return 'badge low';
      default: return 'badge low';
    }
  };

  const getProgressPercent = (campaign: CampaignData) => {
    // Checklist completion drives progress when to-dos exist.
    if (campaign.checklist && campaign.checklist.length > 0) {
      return Math.round((campaign.checklist.filter(i => i.done).length / campaign.checklist.length) * 100);
    }
    if (!campaign.postsPlanned) return 0;
    return Math.min(100, Math.round((campaign.postsPlanned / 12) * 100));
  };

  return (
    <div className="campaigns-view-wrap">
      {/* Header + Create Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Campaigns & Promotions</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Plan, manage and track all marketing campaigns across brands.
          </p>
        </div>
        {!isAgency && (
          <button className="btn btn-primary" onClick={handleOpenCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px' }}>
            <Plus size={16} />
            <span>Create Campaign</span>
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner message="Loading campaigns..." />
      ) : (
        <div>
          <div className="grid-2col">
            {campaigns.map(campaign => (
              <div key={campaign.id} className="section-card" style={{ padding: '20px', marginBottom: '0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <Target size={16} style={{ color: 'var(--primary)' }} />
                      <h4 style={{ fontSize: '15px', fontWeight: 800 }}>{campaign.name}</h4>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-light)', fontFamily: 'monospace' }}>
                      {campaign.id} &middot; {campaign.brand}
                    </span>
                  </div>
                  <span className={getStatusBadgeClass(campaign.status)}>{campaign.status}</span>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
                  {campaign.objective}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px', marginBottom: '16px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Type: </span>
                    <strong>{campaign.type}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Platforms: </span>
                    <strong>{campaign.platforms}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Period: </span>
                    <strong>{toDisplayDate(campaign.startDate)} &ndash; {toDisplayDate(campaign.endDate)}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Budget: </span>
                    {isAgency ? (
                      <span className="restricted-badge" title="Contact your account manager for budget details" style={{ color: 'var(--warning)', cursor: 'help', textDecoration: 'underline dotted', fontWeight: 600 }}>[Restricted]</span>
                    ) : (
                      <strong>${campaign.budget?.toLocaleString()}</strong>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    <span>{(campaign.checklist || []).length > 0
                      ? `To-dos: ${(campaign.checklist || []).filter(i => i.done).length}/${(campaign.checklist || []).length} done`
                      : `Posts: ${campaign.postsPlanned || 0} planned`}</span>
                    <span>{getProgressPercent(campaign)}% progress</span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${getProgressPercent(campaign)}%`,
                      backgroundColor: campaign.status === 'Active' ? 'var(--green)' : 'var(--primary)',
                      borderRadius: '3px'
                    }}></div>
                  </div>
                </div>

                {(campaign.checklist || []).length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    {(campaign.checklist || []).map(item => (
                      <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0', cursor: isAgency ? 'default' : 'pointer' }}>
                        <input type="checkbox" checked={item.done} disabled={isAgency}
                          onChange={() => toggleChecklistItem(campaign, item.id)} />
                        <span style={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--text-muted)' : 'var(--text)' }}>
                          {item.text}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {(campaign.assetLinks || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '12px' }}>
                    {(campaign.assetLinks || []).map((l, i) => (
                      <a key={i} href={l} target="_blank" rel="noreferrer" className="badge low"
                        style={{ fontSize: 10, textDecoration: 'none' }} title={l}>
                        link {i + 1} ↗
                      </a>
                    ))}
                  </div>
                )}

                {campaign.notes && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: '12px', marginBottom: '12px' }}>
                    {campaign.notes}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  {!isAgency && (
                    <button className="btn btn-secondary" onClick={() => handleOpenEdit(campaign)} style={{ padding: '6px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Edit size={12} />
                      <span>Edit</span>
                    </button>
                  )}
                  {role === 'admin' && (
                    <button className="btn btn-secondary" onClick={() => handleDelete(campaign.id)} style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '24px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => loadCampaigns(true)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : 'Load More Campaigns'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Campaign Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h4 className="modal-title">{editingId ? 'Edit Campaign' : 'Create Campaign'}</h4>
              <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Campaign Name</label>
                <input type="text" required placeholder="e.g. Eid al-Adha Mega Sale" value={name} onChange={e => setName(e.target.value)} className="form-input" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Brand</label>
                  <select value={brand} onChange={e => setBrand(e.target.value)} className="form-select">
                    {(brandCatalog.length
                      ? brandCatalog.filter(b => b.active !== false).map(b => b.name)
                      : ['Sosun Fihaara', 'Sosun Cook', 'Sosun Book']
                    ).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Campaign Type</label>
                  <select value={type} onChange={e => setType(e.target.value)} className="form-select">
                    <option value="Seasonal">Seasonal</option>
                    <option value="Awareness">Awareness</option>
                    <option value="Product Launch">Product Launch</option>
                    <option value="Branding">Branding</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} className="form-input" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="form-select">
                    <option value="Draft">Draft</option>
                    <option value="Planning">Planning</option>
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Posts Planned</label>
                  <input type="number" min="0" value={postsPlanned} onChange={e => setPostsPlanned(Number(e.target.value))} className="form-input" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Platforms (comma-separated)</label>
                <input type="text" placeholder="e.g. Instagram, TikTok, Facebook" value={platforms} onChange={e => setPlatforms(e.target.value)} className="form-input" />
              </div>

              <div className="form-group">
                <label className="form-label">Objective</label>
                <textarea placeholder="Campaign objective and key messaging..." value={objective} onChange={e => setObjective(e.target.value)} className="form-textarea" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Budget ($)</label>
                  <input type="number" min="0" step="100" value={budget} onChange={e => setBudget(Number(e.target.value))} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes / Instructions</label>
                  <input type="text" placeholder="Additional notes..." value={notes} onChange={e => setNotes(e.target.value)} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Post / Asset Links</label>
                  {assetLinks.map((l, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input type="url" placeholder="https://instagram.com/p/..." value={l}
                        onChange={e => setAssetLinks(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                        className="form-input" style={{ flex: 1 }} />
                      <button type="button" className="btn-icon" title="Remove link"
                        onClick={() => setAssetLinks(prev => prev.filter((_, j) => j !== i))}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
                    onClick={() => setAssetLinks(prev => [...prev, ''])}>
                    <Plus size={12} /> <span>Add link</span>
                  </button>
                </div>
                <div className="form-group">
                  <label className="form-label">Checklist / To-dos</label>
                  {checklist.map(item => (
                    <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <input type="checkbox" checked={item.done}
                        onChange={() => setChecklist(prev => prev.map(x => x.id === item.id ? { ...x, done: !x.done } : x))} />
                      <span style={{ flex: 1, fontSize: 13, textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
                      <button type="button" className="btn-icon" title="Remove"
                        onClick={() => setChecklist(prev => prev.filter(x => x.id !== item.id))}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="text" placeholder="Add a to-do…" value={newCheckItem}
                      onChange={e => setNewCheckItem(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const t = newCheckItem.trim();
                          if (t) { setChecklist(prev => [...prev, { id: `cl-${Date.now()}`, text: t, done: false }]); setNewCheckItem(''); }
                        }
                      }}
                      className="form-input" style={{ flex: 1 }} />
                    <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px' }}
                      onClick={() => {
                        const t = newCheckItem.trim();
                        if (t) { setChecklist(prev => [...prev, { id: `cl-${Date.now()}`, text: t, done: false }]); setNewCheckItem(''); }
                      }}>
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Update Campaign' : 'Create Campaign'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
