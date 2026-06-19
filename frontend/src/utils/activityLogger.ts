import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const logActivity = async (
  user: string,
  role: string,
  type: 'campaign' | 'task' | 'comment' | 'approval' | 'media',
  action: string,
  target: string,
  targetId: string,
  text?: string
) => {
  try {
    const activityId = doc(collection(db, 'activities')).id;
    await setDoc(doc(db, 'activities', activityId), {
      id: activityId,
      type,
      user,
      role,
      action,
      target,
      targetId,
      text: text || null,
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
};
