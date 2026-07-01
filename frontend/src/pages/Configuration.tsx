import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, auth } from '../firebase/config';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { Settings, Shield, RefreshCw, UserCheck, Plus, X, Cloud, FolderTree, ExternalLink, Check, Trash2, CheckCircle2, AlertCircle, Pencil, Save, UserPlus, Eye, EyeOff, Bell, Send } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { driveApi } from '../services/driveApi';
import { configApi } from '../services/configApi';
import { pushApi } from '../services/pushApi';
import type { PushStats, BroadcastPayload } from '../services/pushApi';
import { bulkImportFromSheets } from '../services/syncApi';
import { appCheckHeader } from '../services/appCheckHeader';
import type { UserRole, UserItem, WorkspaceConfig } from '../types';

export const Configuration: React.FC = () => {
  const { profile, role } = useAuth();
  const isAdmin = role === 'admin';

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline editing state for agency user profiles
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAgency, setEditAgency] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Create user form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUser, setNewUser] = useState({ displayName: '', password: '', role: 'agency' as UserRole, agencyName: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  
  // Custom brands and platforms config lists
  const [brands, setBrands] = useState<string[]>(['Sosun Fihaara', 'Sosun Cook', 'Sosun Book']);
  const [newBrand, setNewBrand] = useState('');
  
  const [platforms, setPlatforms] = useState<string[]>(['Instagram', 'TikTok', 'Facebook', 'WhatsApp Status']);
  const [newPlatform, setNewPlatform] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  // Bulk import sheets state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Google Sheets sync states
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ success: boolean | null; message: string; time: string; }>({
    success: null, message: '', time: localStorage.getItem('last_sheets_sync_time') || 'Never'
  });

  // Media workspace (Google Drive) state
  const [workspace, setWorkspace] = useState<WorkspaceConfig | null>(null);
  const [savingWs, setSavingWs] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [wsMessage, setWsMessage] = useState<string | null>(null);

  // Push notifications admin state
  const [pushStats, setPushStats] = useState<PushStats | null>(null);
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [testingSend, setTestingSend] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSettingsData = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserItem));
      setUsers(list);
    } catch (err) {
      console.error('Error loading user directory:', err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspace = async () => {
    try {
      const ws = await driveApi.getWorkspace();
      setWorkspace(ws);
    } catch (err) {
      console.error('Could not load workspace settings:', err);
    }
  };

  const loadConfig = async () => {
    try {
      const c = await configApi.get();
      setBrands(c.brands);
      setPlatforms(c.platforms);
    } catch (err) {
      console.error('Could not load brand/platform config:', err);
    }
  };

  useEffect(() => {
    loadSettingsData();
    loadWorkspace();
    loadConfig();
    // Load push stats (admin-only endpoint, will 403 for non-admins — that's fine)
    pushApi.getStats().then(setPushStats).catch(() => {});
  }, []);

  const handleCreateWorkspace = async () => {
    setSavingWs(true);
    setWsMessage(null);
    try {
      const ws = await driveApi.createWorkspace('Marketing Assets');
      setWorkspace(ws);
      setWsMessage(`Created "${ws.rootFolderName}" in your Google Drive. Now create the folder structure.`);
    } catch (err) {
      setWsMessage((err as Error).message || 'Could not create workspace.');
    } finally {
      setSavingWs(false);
    }
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setWsMessage(null);
    try {
      const ws = await driveApi.provisionWorkspace();
      setWorkspace(ws);
      setWsMessage(`Folder structure ready: ${Object.keys(ws.topLevelFolderIds).join(', ')}.`);
    } catch (err) {
      setWsMessage((err as Error).message || 'Could not create folder structure.');
    } finally {
      setProvisioning(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    if (!isAdmin) {
      alert('Only Administrators can change user roles.');
      return;
    }
    
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      
      const response = await fetch(`${backendUrl}/api/users/set-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          ...(await appCheckHeader()),
        },
        body: JSON.stringify({ uid: userId, role: newRole })
      });

      if (!response.ok) {
        throw new Error('Server returned error setting custom claims');
      }

      setUsers(prev => prev.map(u => u.uid === userId ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error('Could not update user role:', err);
      alert('Could not update role: ' + (err as Error).message);
    }
  };

  const handleDeleteUser = async (u: UserItem) => {
    if (!isAdmin || u.uid === profile?.uid) return;
    if (!window.confirm(`Permanently delete ${u.displayName} (${u.email})? They will lose all access to the app.`)) return;
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const response = await fetch(`${backendUrl}/api/users/${u.uid}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}`, ...(await appCheckHeader()) }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Server error deleting user');
      }
      setUsers(prev => prev.filter(x => x.uid !== u.uid));
    } catch (err) {
      console.error('Could not delete user:', err);
      alert('Could not delete user: ' + (err as Error).message);
    }
  };

  const startEdit = (u: UserItem) => {
    setEditingUid(u.uid);
    setEditName(u.displayName);
    setEditAgency(u.agencyName || '');
  };

  const cancelEdit = () => {
    setEditingUid(null);
    setEditName('');
    setEditAgency('');
  };

  const handleSaveProfile = async (uid: string) => {
    if (!isAdmin) return;
    setSavingEdit(true);
    try {
      const patch: Record<string, string> = { displayName: editName.trim() };
      if (editAgency.trim()) patch.agencyName = editAgency.trim();

      await updateDoc(doc(db, 'users', uid), patch);

      setUsers(prev => prev.map(u =>
        u.uid === uid ? { ...u, displayName: patch.displayName, agencyName: patch.agencyName } : u
      ));
      cancelEdit();
    } catch (err) {
      console.error('Could not update user profile:', err);
      alert('Could not save changes: ' + (err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg(null);
    setCreatingUser(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const body: Record<string, string> = {
        password: newUser.password,
        displayName: newUser.displayName.trim(),
        role: newUser.role,
      };
      if (newUser.agencyName.trim()) body.agencyName = newUser.agencyName.trim();

      const res = await fetch(`${backendUrl}/api/users/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          ...(await appCheckHeader()),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Server error');

      setUsers(prev => [...prev, {
        uid: data.uid,
        displayName: newUser.displayName.trim(),
        role: newUser.role,
        ...(newUser.agencyName.trim() ? { agencyName: newUser.agencyName.trim() } : {}),
      }]);

      setCreateMsg({ ok: true, text: `Account created for ${newUser.displayName.trim()}. Share their password with them directly.` });
      setNewUser({ displayName: '', password: '', role: 'agency', agencyName: '' });
      setShowCreateForm(false);
    } catch (err) {
      setCreateMsg({ ok: false, text: (err as Error).message || 'Could not create user.' });
    } finally {
      setCreatingUser(false);
    }
  };

  // Persist brand/platform lists via the backend (Firestore + Google Sheet CONFIG tab).
  // Optimistic: the UI is updated by the caller; we reconcile with the server response
  // and revert on failure so a refresh never silently loses an unsaved change.
  const saveConfig = async (patch: { brands?: string[]; platforms?: string[] }, revert: () => void) => {
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const r = await configApi.save(patch);
      setBrands(r.config.brands);
      setPlatforms(r.config.platforms);
      if (r.sheetError) setConfigMsg(`Saved. (Google Sheet sync warning: ${r.sheetError})`);
    } catch (err) {
      revert();
      setConfigMsg((err as Error).message || 'Could not save changes.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAddBrand = () => {
    const b = newBrand.trim();
    if (!b || brands.includes(b)) return;
    const prev = brands;
    setBrands([...brands, b]);
    setNewBrand('');
    saveConfig({ brands: [...prev, b] }, () => setBrands(prev));
  };

  const handleRemoveBrand = (b: string) => {
    const prev = brands;
    const next = brands.filter(item => item !== b);
    setBrands(next);
    saveConfig({ brands: next }, () => setBrands(prev));
  };

  const handleAddPlatform = () => {
    const p = newPlatform.trim();
    if (!p || platforms.includes(p)) return;
    const prev = platforms;
    setPlatforms([...platforms, p]);
    setNewPlatform('');
    saveConfig({ platforms: [...prev, p] }, () => setPlatforms(prev));
  };

  const handleRemovePlatform = (p: string) => {
    const prev = platforms;
    const next = platforms.filter(item => item !== p);
    setPlatforms(next);
    saveConfig({ platforms: next }, () => setPlatforms(prev));
  };

  const handleSyncSheets = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncStatus(prev => ({ ...prev, success: null, message: 'Syncing...' }));

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated.');
      const response = await fetch(`${backendUrl}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });
      
      const data = await response.json();
      const nowStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      if (response.ok && data.success) {
        setSyncStatus({ success: true, message: 'Synced successfully', time: nowStr });
        localStorage.setItem('last_sheets_sync_time', nowStr);
      } else {
        throw new Error(data.error || 'Server returned an error');
      }
    } catch (err) {
      console.error('Sheets sync failed:', err);
      setSyncStatus({ success: false, message: (err as Error).message || 'Connection failed', time: syncStatus.time });
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportResult('Importing data from Google Sheets...');

    try {
      const data = await bulkImportFromSheets();
      setImportResult(`Successfully imported ${data.campaignsImported} campaigns and ${data.postsImported} tasks!`);
    } catch (err) {
      console.error('Import failed:', err);
      setImportResult(`Import failed: ${(err as Error).message || 'Could not connect to Cloud Run API'}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="config-view-wrap">
      <div className="section-card" style={{ marginBottom: '24px' }}>
        <div className="section-header">
          <h3 className="section-title">
            <Settings size={18} style={{ color: 'var(--primary)' }} />
            <span>App Settings & Bulk Import</span>
          </h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div>
              <strong>Google Sheets Sync</strong>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                Push the latest data to the Google Sheet.
              </p>
              <div style={{ fontSize: '11px', color: syncStatus.success === false ? 'var(--red)' : 'var(--text-light)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px' }}>
                {syncStatus.success === true && <CheckCircle2 size={12} style={{ color: 'var(--green)' }} />}
                {syncStatus.success === false && <AlertCircle size={12} />}
                <span>{syncStatus.success === true ? 'Success' : syncStatus.message || `Last Synced: ${syncStatus.time}`}</span>
              </div>
            </div>
            <button 
              className="btn btn-primary" 
              onClick={handleSyncSheets} 
              disabled={syncing}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <RefreshCw size={16} className={syncing ? 'spinning-anim' : ''} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          <div>
            <strong>Google Sheets Bulk Import</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', marginBottom: '12px' }}>
              Import historical content records, posts, and campaigns directly from your Google Sheet. Firestore remains the primary source of truth.
            </p>
            <button 
              className="btn btn-secondary" 
              onClick={handleBulkImport} 
              disabled={importing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <RefreshCw size={14} className={importing ? 'spinning-anim' : ''} />
              <span>{importing ? 'Importing...' : 'Bulk Import from Sheet'}</span>
            </button>
            {importResult && (
              <div style={{
                marginTop: '12px',
                padding: '10px 14px',
                backgroundColor: 'var(--primary-light)',
                color: 'var(--primary)',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600
              }}>
                {importResult}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Media Workspace (Google Drive) */}
      <div className="section-card" style={{ marginBottom: '24px' }}>
        <div className="section-header">
          <h3 className="section-title">
            <Cloud size={18} style={{ color: 'var(--primary)' }} />
            <span>Media Workspace (Google Drive)</span>
          </h3>
          {workspace?.configured && (
            <span className="badge active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Check size={12} /> Connected
            </span>
          )}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', marginBottom: '16px' }}>
          The Media Library stores all assets in a dedicated <strong>"Marketing Assets"</strong> folder that the app
          creates in your connected Google Drive. Click <strong>Create Drive workspace</strong> to set it up, then
          create the folder structure. Google Drive remains the source of truth — only metadata is indexed here.
        </p>

        {!isAdmin ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {workspace?.configured
              ? `Workspace: ${workspace.rootFolderName}`
              : 'Only administrators can configure the media workspace.'}
          </p>
        ) : (
          <>
            {!workspace?.configured && (
              <div style={{ marginBottom: '12px' }}>
                <button className="btn btn-primary" onClick={handleCreateWorkspace} disabled={savingWs} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Cloud size={15} /> {savingWs ? 'Creating…' : 'Create Drive workspace'}
                </button>
              </div>
            )}

            {workspace?.configured && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text)' }}>{workspace.rootFolderName}</strong>
                  <span style={{ fontFamily: 'monospace', marginLeft: '8px' }}>{workspace.rootFolderId}</span>
                </div>
                {workspace.rootFolderUrl && (
                  <a href={workspace.rootFolderUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <ExternalLink size={12} /> Open in Drive
                  </a>
                )}
                <button className="btn btn-secondary" onClick={handleProvision} disabled={provisioning} style={{ padding: '6px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <FolderTree size={14} className={provisioning ? 'spinning-anim' : ''} />
                  {provisioning ? 'Creating…' : 'Create folder structure'}
                </button>
              </div>
            )}

            {workspace?.configured && Object.keys(workspace.topLevelFolderIds).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {Object.keys(workspace.topLevelFolderIds).map((f) => (
                  <span key={f} className="badge low" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <FolderTree size={11} /> {f}
                  </span>
                ))}
              </div>
            )}

            {wsMessage && (
              <div style={{ marginTop: '8px', padding: '10px 14px', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>
                {wsMessage}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Brand Management */}
        <div className="section-card" style={{ marginBottom: '0' }}>
          <div className="section-header">
            <h3 className="section-title">Active Brands</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {brands.map(b => (
              <span key={b} className="badge low" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}>
                <span>{b}</span>
                {isAdmin && (
                  <button onClick={() => handleRemoveBrand(b)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" placeholder="Add new brand..." value={newBrand} onChange={e => setNewBrand(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddBrand(); } }} className="form-input" />
              <button className="btn btn-primary" onClick={handleAddBrand} disabled={savingConfig} style={{ padding: '8px 16px' }}><Plus size={16} /></button>
            </div>
          )}
        </div>

        {/* Platform Management */}
        <div className="section-card" style={{ marginBottom: '0' }}>
          <div className="section-header">
            <h3 className="section-title">Supported Social Platforms</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {platforms.map(p => (
              <span key={p} className="badge low" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}>
                <span>{p}</span>
                {isAdmin && (
                  <button onClick={() => handleRemovePlatform(p)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" placeholder="Add new platform..." value={newPlatform} onChange={e => setNewPlatform(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPlatform(); } }} className="form-input" />
              <button className="btn btn-primary" onClick={handleAddPlatform} disabled={savingConfig} style={{ padding: '8px 16px' }}><Plus size={16} /></button>
            </div>
          )}
        </div>
      </div>

      {(savingConfig || configMsg) && (
        <div style={{ marginBottom: '24px', fontSize: '13px', color: configMsg ? 'var(--red)' : 'var(--text-muted)' }}>
          {savingConfig ? 'Saving…' : configMsg}
        </div>
      )}

      {/* Push Notifications (admin only) */}
      {isAdmin && (
        <div className="section-card" style={{ marginBottom: '24px' }}>
          <div className="section-header">
            <h3 className="section-title">
              <Bell size={18} style={{ color: 'var(--primary)' }} />
              <span>Push Notifications</span>
            </h3>
            {pushStats && (
              <span className="badge active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {pushStats.pushReady ? <Check size={12} /> : <AlertCircle size={12} />}
                {pushStats.pushReady ? 'Active' : 'Not Configured'}
              </span>
            )}
          </div>

          {/* Subscriber stats */}
          <div className="push-admin-stats">
            <div className="push-admin-stat">
              <strong>{pushStats?.subscriberCount ?? '—'}</strong>
              <span>active subscribers</span>
            </div>
          </div>

          {/* Broadcast form */}
          <div className="push-broadcast-form">
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              Send a notification to all team members with push enabled.
            </p>
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Title *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 📢 Monthly Review Due"
                  value={pushTitle}
                  onChange={(e) => setPushTitle(e.target.value)}
                  maxLength={80}
                  id="push-broadcast-title"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Link URL (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. /campaigns"
                  value={pushUrl}
                  onChange={(e) => setPushUrl(e.target.value)}
                  id="push-broadcast-url"
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Message *</label>
              <textarea
                className="form-textarea"
                placeholder="Write the notification message…"
                value={pushBody}
                onChange={(e) => setPushBody(e.target.value)}
                maxLength={200}
                rows={2}
                id="push-broadcast-body"
              />
            </div>
            <div className="push-broadcast-actions">
              <button
                className="btn btn-primary"
                disabled={broadcasting || !pushTitle.trim() || !pushBody.trim()}
                onClick={async () => {
                  setBroadcasting(true);
                  setPushResult(null);
                  try {
                    const payload: BroadcastPayload = {
                      title: pushTitle.trim(),
                      body: pushBody.trim(),
                      url: pushUrl.trim() || '/',
                    };
                    const result = await pushApi.broadcast(payload);
                    setPushResult({ ok: true, text: `Sent to ${result.sent} subscriber${result.sent !== 1 ? 's' : ''}.${result.staleRemoved ? ` ${result.staleRemoved} stale removed.` : ''}` });
                    setPushTitle('');
                    setPushBody('');
                    setPushUrl('');
                    // Refresh stats
                    pushApi.getStats().then(setPushStats).catch(() => {});
                  } catch (err) {
                    setPushResult({ ok: false, text: (err as Error).message || 'Broadcast failed.' });
                  } finally {
                    setBroadcasting(false);
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                id="push-broadcast-send"
              >
                {broadcasting ? <RefreshCw size={14} className="spinning-anim" /> : <Send size={14} />}
                {broadcasting ? 'Sending…' : 'Broadcast to All'}
              </button>
              <button
                className="btn btn-secondary"
                disabled={testingSend}
                onClick={async () => {
                  setTestingSend(true);
                  setPushResult(null);
                  try {
                    await pushApi.testPush();
                    setPushResult({ ok: true, text: 'Test notification sent to your devices.' });
                  } catch (err) {
                    setPushResult({ ok: false, text: (err as Error).message || 'Test failed.' });
                  } finally {
                    setTestingSend(false);
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                id="push-test-btn"
              >
                {testingSend ? <RefreshCw size={14} className="spinning-anim" /> : <Bell size={14} />}
                {testingSend ? 'Sending…' : 'Send Test to Me'}
              </button>
              {pushResult && (
                <span className={`push-broadcast-result ${pushResult.ok ? '' : 'error'}`}>
                  {pushResult.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {pushResult.text}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Management System */}
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title">
            <Shield size={18} style={{ color: 'var(--primary)' }} />
            <span>User Directory & Permission Roles</span>
          </h3>
          {isAdmin && (
            <button
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '13px' }}
              onClick={() => { setShowCreateForm(v => !v); setCreateMsg(null); }}
            >
              <UserPlus size={15} />
              {showCreateForm ? 'Cancel' : 'Add User'}
            </button>
          )}
        </div>

        {/* Create User Form */}
        {isAdmin && showCreateForm && (
          <form onSubmit={handleCreateUser} style={{ marginBottom: '20px', padding: '16px', background: 'var(--bg-alt)', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '14px', color: 'var(--text)' }}>
              New user account — the password you set here should be shared directly with the person.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Full Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Ahmed Ali"
                  value={newUser.displayName}
                  onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Password * (min 8 chars)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Set a temporary password"
                    value={newUser.password}
                    onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                    required
                    minLength={8}
                    style={{ paddingRight: '36px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Role *</label>
                <select
                  className="form-select"
                  value={newUser.role}
                  onChange={e => setNewUser(p => ({ ...p, role: e.target.value as UserRole }))}
                  style={{ width: '100%' }}
                >
                  <option value="agency">External Agency</option>
                  <option value="internal">Internal Marketing</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              {newUser.role === 'agency' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Agency / Company Name (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Creative Studio Co."
                    value={newUser.agencyName}
                    onChange={e => setNewUser(p => ({ ...p, agencyName: e.target.value }))}
                  />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
              {createMsg && (
                <span style={{ fontSize: '12px', color: createMsg.ok ? 'var(--green, #16a34a)' : 'var(--red)', flex: 1 }}>
                  {createMsg.ok ? '✓ ' : '✗ '}{createMsg.text}
                </span>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creatingUser}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {creatingUser ? <RefreshCw size={14} className="spinning-anim" /> : <UserPlus size={14} />}
                {creatingUser ? 'Creating...' : 'Create Account'}
              </button>
            </div>
          </form>
        )}

        {createMsg && !showCreateForm && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, background: createMsg.ok ? 'var(--green-bg, #f0fdf4)' : 'var(--red-bg, #fef2f2)', color: createMsg.ok ? 'var(--green, #16a34a)' : 'var(--red)' }}>
            {createMsg.text}
          </div>
        )}

        {loading ? (
          <LoadingSpinner message="Loading users..." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {users.map(u => {
              const isEditing = editingUid === u.uid;
              const isSelf = u.uid === profile?.uid;

              return (
                <div key={u.uid} style={{ border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--card)', overflow: 'hidden' }}>
                  {/* ── Main row ─────────────────────────────────────────── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div>
                      <strong style={{ fontSize: '14px', display: 'block' }}>{u.displayName}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{u.email}</span>
                      {u.agencyName && (
                        <span style={{ fontSize: '11px', color: 'var(--text-light)', display: 'block', marginTop: '2px' }}>
                          {u.agencyName}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <UserCheck size={14} style={{ color: 'var(--text-light)' }} />
                      <select
                        value={u.role}
                        disabled={!isAdmin || isSelf}
                        onChange={e => handleRoleChange(u.uid, e.target.value as UserRole)}
                        className="form-select"
                        style={{ padding: '6px 12px', width: 'auto' }}
                      >
                        <option value="admin">Administrator</option>
                        <option value="internal">Internal Marketing</option>
                        <option value="agency">External Agency</option>
                      </select>

                      {/* Edit profile button — available for all users (admins editing agency accounts) */}
                      {isAdmin && !isSelf && !isEditing && (
                        <button
                          className="btn-icon"
                          title="Edit display name / agency"
                          onClick={() => startEdit(u)}
                        >
                          <Pencil size={14} style={{ color: 'var(--primary)' }} />
                        </button>
                      )}

                      {isAdmin && !isSelf && (
                        <button className="btn-icon" title="Delete user permanently" onClick={() => handleDeleteUser(u)}>
                          <Trash2 size={14} style={{ color: 'var(--red)' }} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Inline edit panel ────────────────────────────────── */}
                  {isEditing && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-alt)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>
                        Edit profile — {u.email}
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Display Name</label>
                          <input
                            type="text"
                            className="form-input"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            placeholder="Full Name"
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Agency / Company Name</label>
                          <input
                            type="text"
                            className="form-input"
                            value={editAgency}
                            onChange={e => setEditAgency(e.target.value)}
                            placeholder="e.g. Sosun Agency Partner"
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" onClick={cancelEdit} disabled={savingEdit}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          onClick={() => handleSaveProfile(u.uid)}
                          disabled={savingEdit || !editName.trim()}
                        >
                          {savingEdit ? <RefreshCw size={14} className="spinning-anim" /> : <Save size={14} />}
                          Save
                        </button>
                         </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
