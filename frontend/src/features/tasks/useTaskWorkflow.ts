import { useState, useCallback } from 'react';
import type { TaskData, UserItem } from '../../types';
import { tasksApi } from '../../services/tasksApi';
import { pushApi } from '../../services/pushApi';
import { triggerSheetsBackup } from '../../services/syncApi';
import { logActivity } from '../../utils/activityLogger';

interface UseTaskWorkflowOptions {
  role: string;
  profileName: string;
  usersList: UserItem[];
  /** Called after a successful create/update/delete so the caller can reload. */
  onRefresh: () => void;
}

/**
 * Shared task/meeting CRUD + modal orchestration, extracted from the legacy
 * Tasks page so both the planner Tasks tab (list) and the planner Board can
 * open the same create/edit/detail modals and run the same save/delete logic
 * (Firestore write → push notification → activity log → Sheets backup).
 */
export function useTaskWorkflow({ role, profileName, usersList, onRefresh }: UseTaskWorkflowOptions) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [editingTask, setEditingTask] = useState<TaskData | null>(null);

  const handleOpenAdd = useCallback(() => {
    setEditingTask(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((t: TaskData) => {
    setEditingTask(t);
    setIsModalOpen(true);
  }, []);

  const openDetail = useCallback((t: TaskData) => {
    setSelectedTask(t);
    setIsDetailOpen(true);
  }, []);

  /** Open the detail modal for an item we only have by id (e.g. a board card,
   *  whose object is a planner work-item rather than a full TaskData). */
  const openDetailById = useCallback(async (id: string) => {
    try {
      const task = await tasksApi.get(id);
      setSelectedTask(task);
      setIsDetailOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to open task');
    }
  }, []);

  const closeForm = useCallback(() => setIsModalOpen(false), []);
  const closeDetail = useCallback(() => setIsDetailOpen(false), []);

  const handleSave = useCallback(async (payload: Partial<TaskData>, id: string) => {
    const prev = editingTask;
    const editingId = prev ? prev.id : null;
    const formType = payload.type || 'task';
    const title = payload.title || 'Task';
    const status = payload.status || 'Idea';
    const assignedTo = payload.assignedTo || 'Internal';
    const meetingVisibility = payload.visibility || 'internal';
    const invitedGuests = payload.invitedGuests || [];

    try {
      if (editingId) {
        const newStatusId = status ? status.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'to-do';
        const cleanPayload = Object.fromEntries(
          Object.entries({ ...payload, statusId: newStatusId }).filter(([, v]) => v !== undefined)
        );
        await tasksApi.update(editingId, cleanPayload);

        if (formType === 'meeting') {
          await pushApi.notifyMeetingScheduled(id, title, meetingVisibility, 'Rescheduled', invitedGuests).catch(err => console.error(err));
        } else if (prev && prev.assignedTo !== assignedTo) {
          pushApi.notifyTaskAssignment(editingId, title, assignedTo, 'Reassigned').catch(err => console.error(err));
        }

        const changed = prev && prev.status !== status;
        await logActivity(
          profileName, role,
          formType === 'meeting' ? 'task' : (changed && status === 'Approved' ? 'approval' : 'task'),
          formType === 'meeting' ? 'updated meeting details of' : (changed ? (status === 'Approved' ? 'approved task' : `updated status to "${status}" for`) : 'updated task details of'),
          title, editingId
        );
      } else {
        const newStatusId = status ? status.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'to-do';
        const newTask: TaskData = {
          id,
          submittedBy: profileName,
          checklist: [], comments: [], progress: 0,
          createdAt: new Date().toISOString(),
          statusId: newStatusId,
          ...payload,
        } as TaskData;
        await tasksApi.create(newTask);

        if (formType === 'meeting') {
          await pushApi.notifyMeetingScheduled(id, title, meetingVisibility, 'Scheduled', invitedGuests).catch(err => console.error(err));
        } else {
          pushApi.notifyTaskAssignment(id, title, assignedTo, 'Assigned').catch(err => console.error(err));
        }

        await logActivity(profileName, role, 'task', formType === 'meeting' ? 'scheduled meeting' : 'created task', title, id);
      }
      triggerSheetsBackup();
      setIsModalOpen(false);
      onRefresh();
    } catch (err) {
      alert('Could not save meeting/task: ' + (err as Error).message);
    }
  }, [editingTask, profileName, role, onRefresh]);

  const handleDelete = useCallback(async (id: string, taskHint?: TaskData) => {
    const t = taskHint || selectedTask;
    if (!window.confirm(`Delete "${t?.title || id}"?`)) return;
    try {
      if (t?.type === 'meeting') {
        await pushApi.notifyMeetingScheduled(id, t.title, t.visibility || 'internal', 'Deleted').catch(err => console.error('Delete calendar notify error:', err));
      }
      await tasksApi.delete(id);
      setIsDetailOpen(false);
      if (t) await logActivity(profileName, role, 'task', t.type === 'meeting' ? 'deleted meeting' : 'deleted task', t.title, id);
      onRefresh();
    } catch (err) {
      alert('Could not delete: ' + (err as Error).message);
    }
  }, [selectedTask, profileName, role, onRefresh]);

  return {
    // state
    isModalOpen, isDetailOpen, selectedTask, editingTask, usersList,
    // setters
    setSelectedTask, setIsModalOpen, setIsDetailOpen,
    // handlers
    handleOpenAdd, handleOpenEdit, openDetail, openDetailById,
    closeForm, closeDetail, handleSave, handleDelete,
  };
}

export type TaskWorkflow = ReturnType<typeof useTaskWorkflow>;
