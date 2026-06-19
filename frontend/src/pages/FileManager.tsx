import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, storage } from '../firebase/config';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { Upload, FileText, Image, Video, File, Trash2, Link, Check, ExternalLink } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { mockAssets } from '../mockData';
import type { FileAsset } from '../types';

export const FileManager: React.FC = () => {
  const { profile } = useAuth();
  const role = profile?.role || 'internal';
  const isAgency = role === 'agency';

  const [assets, setAssets] = useState<FileAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [filterType, setFilterType] = useState('All');
  
  // UI helper for copied links
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Ref to store the upload simulation interval to avoid memory leaks
  const uploadIntervalRef = useRef<any>(null);

  const loadAssets = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, 'assets'));
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileAsset));
      
      if (list.length === 0) {
        setAssets(mockAssets);
      } else {
        setAssets(list);
      }

      // Load campaigns for linking dropdown
      const campSnap = await getDocs(collection(db, 'campaigns'));
      setCampaigns(campSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    } catch (err) {
      console.error('Error loading assets, using mock data:', err);
      setAssets(mockAssets);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssets();
    
    // Cleanup interval on unmount
    return () => {
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
      }
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Detect file type
    let assetType = 'document';
    if (file.type.startsWith('image/')) assetType = 'image';
    else if (file.type.startsWith('video/')) assetType = 'video';

    const assetId = 'A-' + Math.floor(100 + Math.random() * 900);
    const sizeStr = file.size > 1024 * 1024 
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` 
      : `${(file.size / 1024).toFixed(0)} KB`;

    // Local sandbox simulation if Storage credentials aren't ready
    if (!storage || storage.app.options.apiKey === 'mock-api-key') {
      console.warn('Mock Storage detected, simulating upload progress...');
      setUploadProgress(10);
      
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
      }

      uploadIntervalRef.current = setInterval(() => {
        setUploadProgress(prev => {
          if (prev === null) return null;
          if (prev >= 100) {
            if (uploadIntervalRef.current) {
              clearInterval(uploadIntervalRef.current);
              uploadIntervalRef.current = null;
            }
            setTimeout(async () => {
              const newAsset: FileAsset = {
                id: assetId,
                name: file.name,
                type: assetType,
                url: assetType === 'image' 
                  ? 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=300' 
                  : 'https://pdfobject.com/pdf/sample.pdf',
                size: sizeStr,
                uploadedBy: profile?.displayName || 'User',
                uploadedAt: new Date().toISOString().split('T')[0],
                campaignId: selectedCampaign || undefined
              };

              try {
                await setDoc(doc(db, 'assets', assetId), newAsset);
                setAssets(prevAssets => [newAsset, ...prevAssets]);
              } catch (err) {
                console.error('Could not save to db:', err);
                setAssets(prevAssets => [newAsset, ...prevAssets]);
              }
              setUploadProgress(null);
            }, 500);
            return 100;
          }
          return prev + 30;
        });
      }, 200);
      return;
    }

    // Actual Firebase Storage upload
    const storageRef = ref(storage, `assets/${assetId}_${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(Math.round(progress));
      },
      (error) => {
        console.error('Upload failed:', error);
        alert('Upload failed: ' + error.message);
        setUploadProgress(null);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        const newAsset: FileAsset = {
          id: assetId,
          name: file.name,
          type: assetType,
          url: downloadUrl,
          size: sizeStr,
          uploadedBy: profile?.displayName || 'User',
          uploadedAt: new Date().toISOString().split('T')[0],
          campaignId: selectedCampaign || undefined
        };

        await setDoc(doc(db, 'assets', assetId), newAsset);
        setUploadProgress(null);
        loadAssets();
      }
    );
  };

  const handleDeleteAsset = async (asset: FileAsset) => {
    if (!window.confirm(`Are you sure you want to delete ${asset.name}?`)) return;

    try {
      // If it is a real storage object, delete it
      if (storage && storage.app.options.apiKey !== 'mock-api-key' && asset.url.includes('firebasestorage')) {
        const fileRef = ref(storage, asset.url);
        await deleteObject(fileRef);
      }
      await deleteDoc(doc(db, 'assets', asset.id));
      loadAssets();
    } catch (err) {
      console.error('Could not delete asset:', err);
      // Fallback: update list locally
      setAssets(prev => prev.filter(a => a.id !== asset.id));
    }
  };

  const handleCopyLink = (asset: FileAsset) => {
    navigator.clipboard.writeText(asset.url);
    setCopiedId(asset.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'image': return <Image size={24} style={{ color: 'var(--green)' }} />;
      case 'video': return <Video size={24} style={{ color: 'var(--purple)' }} />;
      case 'document': return <FileText size={24} style={{ color: 'var(--primary)' }} />;
      default: return <File size={24} style={{ color: 'var(--gray)' }} />;
    }
  };

  const filteredAssets = assets.filter(a => {
    if (filterType !== 'All' && a.type !== filterType.toLowerCase()) return false;
    return true;
  });

  return (
    <div className="file-manager-wrap">
      {/* File Upload panel */}
      <div className="section-card" style={{ marginBottom: '24px' }}>
        <div className="section-header" style={{ marginBottom: '16px' }}>
          <h3 className="section-title">
            <Upload size={18} style={{ color: 'var(--primary)' }} />
            <span>Upload Creative Assets</span>
          </h3>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label" style={{ marginBottom: '4px' }}>
              Link to Campaign (Optional)
            </label>
            <select 
              value={selectedCampaign} 
              onChange={e => setSelectedCampaign(e.target.value)}
              className="form-select"
            >
              <option value="">Do not link to a campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ flexShrink: 0 }}>
            <label 
              className="btn btn-primary"
              style={{ display: 'inline-flex', cursor: 'pointer', pointerEvents: uploadProgress !== null ? 'none' : 'auto', opacity: uploadProgress !== null ? 0.7 : 1 }}
            >
              <Upload size={16} />
              <span>{uploadProgress !== null ? `Uploading ${uploadProgress}%` : 'Select File to Upload'}</span>
              <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} disabled={uploadProgress !== null} />
            </label>
          </div>
        </div>

        {uploadProgress !== null && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              <span>Uploading asset file...</span>
              <strong>{uploadProgress}%</strong>
            </div>
            <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${uploadProgress}%`, backgroundColor: 'var(--primary)', borderRadius: '3px' }}></div>
            </div>
          </div>
        )}
      </div>

      {/* Asset Explorer header and filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h4 style={{ fontSize: '15px', fontWeight: 800 }}>Asset Explorer</h4>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['All', 'Image', 'Video', 'Document'].map(t => (
            <button 
              key={t}
              className={`btn ${filterType === t ? 'btn-primary' : 'btn-secondary'}`} 
              onClick={() => setFilterType(t)}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading assets..." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {filteredAssets.map(asset => (
            <div key={asset.id} className="stat-card" style={{ padding: '16px', position: 'relative' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ 
                  width: '48px', 
                  height: '48px', 
                  borderRadius: '8px', 
                  backgroundColor: 'var(--bg)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {getFileIcon(asset.type)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ 
                    fontSize: '13px', 
                    display: 'block', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    color: 'var(--text)'
                  }} title={asset.name}>
                    {asset.name}
                  </strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-light)', display: 'block' }}>
                    {asset.size} &middot; {asset.type.toUpperCase()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '10px', marginTop: '12px' }}>
                <span>By: {asset.uploadedBy}</span>
                <span>{asset.uploadedAt}</span>
              </div>

              {/* Action bar on cards */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                <button 
                  className="btn-icon" 
                  onClick={() => handleCopyLink(asset)} 
                  style={{ padding: '6px' }}
                  title="Copy Direct Link"
                >
                  {copiedId === asset.id ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Link size={14} />}
                </button>
                <a 
                  href={asset.url} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="btn-icon" 
                  style={{ padding: '6px' }}
                  title="Open in Browser"
                >
                  <ExternalLink size={14} />
                </a>
                {(!isAgency || asset.uploadedBy === profile?.displayName) && (
                  <button 
                    className="btn-icon" 
                    onClick={() => handleDeleteAsset(asset)} 
                    style={{ padding: '6px', color: 'var(--red)' }}
                    title="Delete Asset"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
