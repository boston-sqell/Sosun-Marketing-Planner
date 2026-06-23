import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { collection, doc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { TaskData, UserItem } from '../../types';

const STATUS_OPTIONS = [
  'Requested', 'Idea', 'Brief Needed', 'Brief Sent',
  'Draft Ready', 'In Review', 'Revision Needed',
  'Approved', 'Scheduled', 'Published', 'Completed',
];
const CONTENT_TYPES = ['Reel', 'Video', 'Image', 'Carousel', 'Story', 'Design', 'Other'];

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit: TaskData | null;
  onSave: (payload: Partial<TaskData>, id: string) => Promise<void>;
  brandCatalog: { name: string; active?: boolean }[];
  usersList: UserItem[];
  initialDate?: string;
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({ isOpen, onClose, taskToEdit, onSave, brandCatalog, usersList, initialDate }) => {
  const [formType, setFormType] = useState<'task' | 'meeting'>('task');
  const [meetingVisibility, setMeetingVisibility] = useState<'internal' | 'agency' | 'external'>('internal');
  const [meetingStartDate, setMeetingStartDate] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingAgenda, setMeetingAgenda] = useState('');
  const [invitedGuests, setInvitedGuests] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('Sosun Fihaara');
  const [platformsInput, setPlatformsInput] = useState('Instagram');
  const [contentType, setContentType] = useState('Reel');
  const [campaignId, setCampaignId] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('Idea');
  const [assignedTo, setAssignedTo] = useState('Internal');
  const [sharedDate, setSharedDate] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [caption, setCaption] = useState('');
  const [notes, setNotes] = useState('');
  const [assetLink, setAssetLink] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (taskToEdit) {
        setFormType(taskToEdit.type || 'task');
        setTitle(taskToEdit.title);
        setBrand(taskToEdit.brand);
        setPlatformsInput(taskToEdit.platforms ? taskToEdit.platforms.join(', ') : '');
        setContentType(taskToEdit.contentType);
        setCampaignId(taskToEdit.campaignId || '');
        setPriority(taskToEdit.priority);
        setStatus(taskToEdit.status);
        setAssignedTo(taskToEdit.assignedTo);
        setSharedDate(taskToEdit.sharedDate || taskToEdit.reviewDeadline || '');
        setScheduledDate(taskToEdit.scheduledDate || '');
        setCaption(taskToEdit.caption || '');
        setNotes(taskToEdit.notes || '');
        setAssetLink(taskToEdit.assetLink || '');
        
        setMeetingVisibility(taskToEdit.visibility || 'internal');
        setMeetingStartDate(taskToEdit.startDate || '');
        setMeetingLocation(taskToEdit.location || '');
        setMeetingAgenda(taskToEdit.agenda || '');
        setInvitedGuests(taskToEdit.invitedGuests || []);
      } else {
        setFormType('task');
        setTitle('');
        setBrand('Sosun Fihaara');
        setPlatformsInput('Instagram');
        setContentType('Reel');
        setCampaignId('');
        setPriority('Medium');
        setStatus('Idea');
        setAssignedTo('Internal');
        setSharedDate('');
        setScheduledDate(initialDate || '');
        setCaption('');
        setNotes('');
        setAssetLink('');
        
        setMeetingVisibility('internal');
        setMeetingStartDate('');
        setMeetingLocation('');
        setMeetingAgenda('');
        setInvitedGuests([]);
      }
    }
  }, [isOpen, taskToEdit, initialDate]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !brand) return;
    const id = taskToEdit ? taskToEdit.id : doc(collection(db, 'tasks')).id;

    let payload: Partial<TaskData>;
    if (formType === 'meeting') {
      let calculatedEndDate = '';
      if (meetingStartDate) {
        const startObj = new Date(meetingStartDate);
        if (!isNaN(startObj.getTime())) {
          const endObj = new Date(startObj.getTime() + 60 * 60 * 1000);
          const year = endObj.getFullYear();
          const month = String(endObj.getMonth() + 1).padStart(2, '0');
          const day = String(endObj.getDate()).padStart(2, '0');
          const hours = String(endObj.getHours()).padStart(2, '0');
          const minutes = String(endObj.getMinutes()).padStart(2, '0');
          calculatedEndDate = `${year}-${month}-${day}T${hours}:${minutes}`;
        }
      }
      payload = {
        type: 'meeting',
        title: title.trim(),
        brand,
        visibility: meetingVisibility,
        startDate: meetingStartDate,
        endDate: calculatedEndDate,
        status,
        location: meetingLocation.trim(),
        agenda: meetingAgenda.trim(),
        notes: notes.trim(),
        assetLink: assetLink.trim(),
        invitedGuests: meetingVisibility === 'external' ? invitedGuests : [],
      };
    } else {
      payload = {
        type: 'task',
        title: title.trim(),
        brand,
        campaignId: campaignId.trim() || undefined,
        platforms: platformsInput.split(',').map(s => s.trim()).filter(Boolean),
        contentType,
        priority,
        status,
        assignedTo,
        scheduledDate,
        sharedDate,
        caption: caption.trim(),
        notes: notes.trim(),
        assetLink: assetLink.trim(),
      };
    }
    
    await onSave(payload, id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h4 className="modal-title">{taskToEdit ? 'Edit Item' : 'New Item'}</h4>
          <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        
        {!taskToEdit && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '10px 20px', gap: '16px' }}>
            <button
              type="button"
              onClick={() => { setFormType('task'); setStatus('Idea'); }}
              style={{
                padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: formType === 'task' ? 'bold' : 'normal',
                backgroundColor: formType === 'task' ? 'var(--primary)' : 'transparent',
                color: formType === 'task' ? '#fff' : 'var(--text-muted)',
                border: '1px solid ' + (formType === 'task' ? 'var(--primary)' : 'var(--border)'),
                fontSize: '13px'
              }}
            >
              Create Task
            </button>
            <button
              type="button"
              onClick={() => { setFormType('meeting'); setStatus('Scheduled'); }}
              style={{
                padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: formType === 'meeting' ? 'bold' : 'normal',
                backgroundColor: formType === 'meeting' ? 'var(--primary)' : 'transparent',
                color: formType === 'meeting' ? '#fff' : 'var(--text-muted)',
                border: '1px solid ' + (formType === 'meeting' ? 'var(--primary)' : 'var(--border)'),
                fontSize: '13px'
              }}
            >
              Create Meeting
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ padding: '0 20px' }}>
          {formType === 'meeting' ? (
            <>
              <div className="form-group" style={{ marginTop: '12px' }}>
                <label className="form-label">Meeting Title</label>
                <input type="text" required placeholder="e.g. Media Partners Sync" value={title} onChange={e => setTitle(e.target.value)} className="form-input" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Brand</label>
                  <select value={brand} onChange={e => setBrand(e.target.value)} className="form-select">
                    {(brandCatalog.length ? brandCatalog.filter(b => b.active !== false).map(b => b.name) : ['Sosun Fihaara']).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Visibility / Meeting Type</label>
                  <select value={meetingVisibility} onChange={e => setMeetingVisibility(e.target.value as 'internal' | 'agency' | 'external')} className="form-select">
                    <option value="internal">Internal</option>
                    <option value="agency">Marketing Agency</option>
                    <option value="external">External</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Meeting Date & Time</label>
                  <input type="datetime-local" required value={meetingStartDate} onChange={e => setMeetingStartDate(e.target.value)} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="form-select">
                    {['Scheduled', 'Completed', 'Cancelled', 'Postponed'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Location / Meeting Link</label>
                <input type="text" placeholder="e.g. Zoom link or Meeting Room A" value={meetingLocation} onChange={e => setMeetingLocation(e.target.value)} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Agenda / Brief</label>
                <textarea rows={3} placeholder="Creative brief or meeting agenda..." value={meetingAgenda} onChange={e => setMeetingAgenda(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Internal Notes (Hidden from external guests)</label>
                <textarea rows={2} placeholder="Internal preparation notes..." value={notes} onChange={e => setNotes(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Relevant Links / Assets</label>
                <input type="url" placeholder="https://..." value={assetLink} onChange={e => setAssetLink(e.target.value)} className="form-input" />
              </div>
              
              {meetingVisibility === 'external' && (
                <div className="form-group">
                  <label className="form-label">Invite External Partners (Select multiple)</label>
                  <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {usersList
                      .filter(u => u.role === 'media' || u.role === 'sponsor' || u.role === 'supplier')
                      .map(u => {
                        const isChecked = invitedGuests.includes(u.uid);
                        return (
                          <label key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setInvitedGuests(prev => prev.filter(x => x !== u.uid));
                                } else {
                                  setInvitedGuests(prev => [...prev, u.uid]);
                                }
                              }}
                            />
                            <span>{u.displayName} ({u.role.toUpperCase()})</span>
                          </label>
                        );
                      })}
                    {usersList.filter(u => u.role === 'media' || u.role === 'sponsor' || u.role === 'supplier').length === 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>No external partner users found.</div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="form-group" style={{ marginTop: '12px' }}>
                <label className="form-label">Task Title</label>
                <input type="text" required placeholder="e.g. June Newsletter Campaign" value={title} onChange={e => setTitle(e.target.value)} className="form-input" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Brand</label>
                  <select value={brand} onChange={e => setBrand(e.target.value)} className="form-select">
                    {(brandCatalog.length ? brandCatalog.filter(b => b.active !== false).map(b => b.name) : ['Sosun Fihaara']).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Campaign ID</label>
                  <input type="text" placeholder="e.g. C-EID-2026" value={campaignId} onChange={e => setCampaignId(e.target.value)} className="form-input" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Platform(s)</label>
                  <input type="text" placeholder="Instagram, TikTok, ..." value={platformsInput} onChange={e => setPlatformsInput(e.target.value)} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Content Type</label>
                  <select value={contentType} onChange={e => setContentType(e.target.value)} className="form-select">
                    {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)} className="form-select">
                    {['Low','Medium','High','Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="form-select">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Assigned To</label>
                  <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="form-select">
                    {['Internal','Agency','Both'].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Scheduled Date</label>
                  <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="form-input" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Review / Share Date</label>
                <input type="date" value={sharedDate} onChange={e => setSharedDate(e.target.value)} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Caption / Brief</label>
                <textarea rows={3} placeholder="Caption or creative brief..." value={caption} onChange={e => setCaption(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea rows={2} placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)} className="form-input" style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Asset Link</label>
                <input type="url" placeholder="https://drive.google.com/..." value={assetLink} onChange={e => setAssetLink(e.target.value)} className="form-input" />
              </div>
            </>
          )}
          </div>
          <div className="modal-footer" style={{ padding: '20px', borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{taskToEdit ? 'Save Changes' : (formType === 'meeting' ? 'Create Meeting' : 'Create Task')}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
