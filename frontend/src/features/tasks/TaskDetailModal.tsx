import React, { useState } from 'react';
import { X, Edit, Trash2, Video } from 'lucide-react';
import { tasksApi } from '../../services/tasksApi';
import { toDisplayDate } from '../../utils/dateUtils';
import type { TaskData, UserItem, ChecklistItem, CommentItem } from '../../types';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskData;
  onEdit: (t: TaskData) => void;
  onDelete: (id: string) => void;
  role: string;
  usersList: UserItem[];
  profileName: string;
  onTaskUpdated: (updatedTask: TaskData) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  isOpen, onClose, task, onEdit, onDelete, role, usersList, profileName, onTaskUpdated
}) => {
  const [newCheckItem, setNewCheckItem] = useState('');
  const [newComment, setNewComment] = useState('');

  if (!isOpen || !task) return null;

  const handleToggleChecklist = async (itemId: string) => {
    const list = task.checklist || [];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx === -1) return;
    const newList = [...list];
    newList[idx] = { ...newList[idx], done: !newList[idx].done };
    const progress = Math.round((newList.filter((x) => x.done).length / newList.length) * 100) || 0;
    
    // Optimistic update
    const updated = { ...task, checklist: newList, progress };
    onTaskUpdated(updated);
    try {
      await tasksApi.update(task.id, { checklist: newList, progress });
    } catch (err) {
      console.error(err);
      onTaskUpdated(task); // revert
    }
  };

  const handleAddChecklist = async () => {
    if (!newCheckItem.trim()) return;
    const item: ChecklistItem = { id: Date.now().toString(), text: newCheckItem.trim(), done: false };
    const list = task.checklist || [];
    const newList = [...list, item];
    const progress = Math.round((newList.filter((x) => x.done).length / newList.length) * 100) || 0;
    
    setNewCheckItem('');
    const updated = { ...task, checklist: newList, progress };
    onTaskUpdated(updated);
    try {
      await tasksApi.update(task.id, { checklist: newList, progress });
    } catch (err) {
      console.error(err);
      onTaskUpdated(task); // revert
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    const comment: CommentItem = {
      id: Date.now().toString(),
      user: profileName,
      role,
      text: newComment.trim(),
      time: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
    };
    const list = task.comments || [];
    const newList = [...list, comment];
    
    setNewComment('');
    const updated = { ...task, comments: newList };
    onTaskUpdated(updated);
    try {
      await tasksApi.update(task.id, { comments: newList });
    } catch (err) {
      console.error(err);
      onTaskUpdated(task); // revert
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <h4 className="modal-title">{task.title}</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(role === 'admin' || role === 'internal') && (
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => { onClose(); onEdit(task); }}>
                <Edit size={13} /> Edit
              </button>
            )}
            <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div style={{ padding: '4px 0', maxHeight: '70vh', overflowY: 'auto' }}>
          {task.type === 'meeting' ? (
            <>
              {/* Meeting Meta */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                <span className="badge urgent" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Video size={13} /> Meeting
                </span>
                <span className={`badge ${(task.status || 'Scheduled').toLowerCase().replace(/ /g, '-')}`}>
                  {task.status || 'Scheduled'}
                </span>
                <span className="badge low">
                  {task.visibility === 'internal' ? 'Internal' : task.visibility === 'agency' ? 'Marketing Agency' : 'External'}
                </span>
                {task.brand && <span className="badge low">{task.brand}</span>}
              </div>

              {/* Date & Time */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {task.startDate && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Start</span>
                    <div style={{ fontSize: '13px' }}>
                      {new Date(task.startDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                )}
                {task.endDate && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>End</span>
                    <div style={{ fontSize: '13px' }}>
                      {new Date(task.endDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                )}
              </div>

              {/* Location / Meeting Link */}
              {task.location && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Location / Link</span>
                  {task.location.startsWith('http://') || task.location.startsWith('https://') ? (
                    <a href={task.location} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '13px', color: 'var(--primary)', marginTop: '4px', wordBreak: 'break-all' }}>
                      {task.location}
                    </a>
                  ) : (
                    <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', margin: 0 }}>
                      {task.location}
                    </p>
                  )}
                </div>
              )}

              {/* Agenda */}
              {task.agenda && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Agenda / Brief</span>
                  <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>
                    {task.agenda}
                  </p>
                </div>
              )}

              {/* Internal Notes - redacted for external users */}
              {(role === 'admin' || role === 'internal') && task.notes && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Internal Notes (Admin & Internal Only)</span>
                  <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>
                    {task.notes}
                  </p>
                </div>
              )}

              {/* Relevant Links / Assets */}
              {task.assetLink && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Relevant Links / Assets</span>
                  <a href={task.assetLink} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '13px', color: 'var(--primary)', marginTop: '4px', wordBreak: 'break-all' }}>
                    {task.assetLink}
                  </a>
                </div>
              )}

              {/* Invited Guests */}
              {task.visibility === 'external' && (task.invitedGuests || []).length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invited Guests</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {(task.invitedGuests || []).map((guestId: string) => {
                      const guestUser = usersList.find(u => u.uid === guestId);
                      return (
                        <span key={guestId} className="badge low" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}>
                          {guestUser ? `${guestUser.displayName} (${guestUser.role.toUpperCase()})` : `Guest (${guestId})`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Task Meta */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                <span className={`badge ${task.priority?.toLowerCase()}`}>{task.priority}</span>
                <span className={`badge ${task.status?.toLowerCase().replace(/ /g,'-')}`}>{task.status}</span>
                <span className="badge low">{task.brand}</span>
                <span className="badge low">{task.contentType}</span>
                {task.campaignId && <span className="badge low" style={{ fontFamily: 'monospace' }}>{task.campaignId}</span>}
              </div>

              {/* Platforms */}
              {(task.platforms || []).length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Platforms</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                    {(task.platforms || []).map((p: string) => <span key={p} className="badge low" style={{ fontSize: '11px' }}>{p}</span>)}
                  </div>
                </div>
              )}

              {/* Dates */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {task.scheduledDate && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Scheduled</span>
                    <div style={{ fontSize: '13px' }}>{toDisplayDate(task.scheduledDate)}</div>
                  </div>
                )}
                {task.sharedDate && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Review Date</span>
                    <div style={{ fontSize: '13px' }}>{toDisplayDate(task.sharedDate)}</div>
                  </div>
                )}
              </div>

              {/* Progress */}
              {(task.checklist || []).length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Progress</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{task.progress || 0}%</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${task.progress || 0}%`, background: (task.progress || 0) >= 100 ? '#22c55e' : 'var(--primary)', borderRadius: '3px', transition: 'width 0.3s' }} />
                  </div>
                </div>
              )}

              {/* Caption */}
              {task.caption && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Caption / Brief</span>
                  <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>{task.caption}</p>
                </div>
              )}

              {/* Notes - redacted for external users */}
              {(role === 'admin' || role === 'internal') && task.notes && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Notes (Admin & Internal Only)</span>
                  <p style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginTop: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>{task.notes}</p>
                </div>
              )}

              {/* Asset Link */}
              {task.assetLink && (
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Asset Link</span>
                  <a href={task.assetLink} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '13px', color: 'var(--primary)', marginTop: '4px', wordBreak: 'break-all' }}>{task.assetLink}</a>
                </div>
              )}

              {/* Checklist */}
              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Checklist</span>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(task.checklist || []).map((item) => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={item.done} onChange={() => handleToggleChecklist(item.id)} />
                      <span style={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--text-muted)' : 'inherit' }}>{item.text}</span>
                    </label>
                  ))}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    <input type="text" placeholder="Add checklist item..." value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddChecklist())} className="form-input" style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }} />
                    <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={handleAddChecklist}>Add</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Comments */}
          <div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Comments</span>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(task.comments || []).map((c) => (
                <div key={c.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700 }}>{c.user}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.time}</span>
                  </div>
                  <p style={{ fontSize: '13px', margin: 0 }}>{c.text}</p>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="text" placeholder="Add a comment..." value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddComment())} className="form-input" style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }} />
                <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={handleAddComment}>Send</button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          {(role === 'admin' || role === 'internal') && (
            <button type="button" className="btn btn-danger" style={{ fontSize: '12px' }} onClick={() => onDelete(task.id)}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
