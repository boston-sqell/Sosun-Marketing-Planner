import { Router } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { db } from '../services/firestore';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../services/calendar';
import {
  isPushReady,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  countSubscriptions,
  sendPushToUser,
  sendPushToRoles,
  broadcastPush,
} from '../services/pushService';
import type { PushPayload } from '../services/pushService';

const router = Router();

// All push routes require authentication.
router.use(requireAuth);

// ── GET /api/push/vapid-public-key ──────────────────────────────────────────
// Returns the VAPID public key so the client doesn't need to hardcode it.
router.get('/vapid-public-key', (_req: AuthedRequest, res) => {
  if (!isPushReady()) {
    return res.status(503).json({
      success: false,
      error: 'Push notifications are not configured on this server.',
    });
  }
  res.json({ success: true, publicKey: getVapidPublicKey() });
});

// ── POST /api/push/subscribe ────────────────────────────────────────────────
// Stores a new PushSubscription for the authenticated user.
router.post('/subscribe', async (req: AuthedRequest, res, next) => {
  try {
    const { subscription, platform, userAgent, timezone } = req.body || {};

    if (
      !subscription ||
      !subscription.endpoint ||
      !subscription.keys?.p256dh ||
      !subscription.keys?.auth
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription object. Required: endpoint, keys.p256dh, keys.auth.',
      });
    }

    const docId = await saveSubscription(req.uid!, subscription, {
      role: req.role,
      platform,
      userAgent,
      timezone,
    });

    // Send a welcome notification
    if (isPushReady()) {
      await sendPushToUser(req.uid!, {
        title: '🔔 Notifications enabled!',
        body: 'You\'ll now receive alerts for tasks, campaigns, and important updates.',
        url: '/',
        tag: 'sosun-welcome',
      }).catch((err) => console.warn('Welcome push failed:', err.message));
    }

    res.json({ success: true, subscriptionId: docId });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/push/unsubscribe ──────────────────────────────────────────────
// Removes a subscription by endpoint for the authenticated user.
router.post('/unsubscribe', async (req: AuthedRequest, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'Missing endpoint.' });
    }

    const removed = await removeSubscription(req.uid!, endpoint);
    res.json({ success: true, removed });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/push/broadcast ────────────────────────────────────────────────
// Admin only: sends a notification to ALL active subscribers.
router.post('/broadcast', requireRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    if (!isPushReady()) {
      return res.status(503).json({
        success: false,
        error: 'Push notifications are not configured on this server.',
      });
    }

    const { title, body, url, tag } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, body.',
      });
    }

    const payload: PushPayload = {
      title,
      body,
      url: url || '/',
      tag: tag || 'sosun-broadcast',
    };

    const result = await broadcastPush(payload);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/push/test ─────────────────────────────────────────────────────
// Admin only: sends a test notification to the requesting user's devices only.
router.post('/test', requireRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    if (!isPushReady()) {
      return res.status(503).json({
        success: false,
        error: 'Push notifications are not configured on this server.',
      });
    }

    const result = await sendPushToUser(req.uid!, {
      title: '🧪 Test Notification',
      body: 'If you see this, push notifications are working!',
      url: '/config',
      tag: 'sosun-test',
    });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/push/notify-task ──────────────────────────────────────────────
// Triggers notifications when a task is assigned.
router.post('/notify-task', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const { taskId, action, title, assignedTo } = req.body || {};
    if (!taskId || !title || !assignedTo || !action) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    let rolesToNotify: ('admin' | 'internal' | 'agency')[] = [];
    if (assignedTo === 'Agency') {
      rolesToNotify = ['agency', 'admin'];
    } else if (assignedTo === 'Internal') {
      rolesToNotify = ['internal', 'admin'];
    } else if (assignedTo === 'Both') {
      rolesToNotify = ['agency', 'internal', 'admin'];
    }

    if (rolesToNotify.length > 0) {
      // Import sendPushToRoles directly inside the handler to avoid circular dependencies if any,
      // or just rely on the top-level import (I will add it to the top-level imports in a moment)
      await sendPushToRoles(rolesToNotify, {
        title: `Task ${action}: ${title}`,
        body: `A task has been ${action.toLowerCase()} to ${assignedTo}. Tap to view Tasks & Queue.`,
        url: '/tasks',
        tag: `task-${taskId}`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/push/notify-meeting ──────────────────────────────────────────
// Triggers notifications and syncs with Google Calendar when a meeting is created, updated, or deleted.
router.post('/notify-meeting', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const { meetingId, action, title, visibility, invitedGuests } = req.body || {};
    if (!meetingId || !title || !visibility) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    if (action === 'Deleted') {
      const meetingDoc = await db.collection('tasks').doc(meetingId).get();
      if (meetingDoc.exists) {
        const meeting = meetingDoc.data();
        if (meeting?.calendarEventId) {
          try {
            await deleteCalendarEvent(meeting.calendarEventId);
          } catch (calErr: any) {
            console.error('Google Calendar Deletion error:', calErr.message);
          }
        }
      }
      return res.json({ success: true });
    }

    // Fetch meeting document from Firestore to get full details
    const meetingDoc = await db.collection('tasks').doc(meetingId).get();
    if (!meetingDoc.exists) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }
    const meeting = meetingDoc.data();

    // Determine guest emails based on visibility and invited list
    const usersSnapshot = await db.collection('users').get();
    const allUsers = usersSnapshot.docs.map(doc => doc.data());

    const internalEmails = allUsers
      .filter((u: any) => u.role === 'admin' || u.role === 'internal')
      .map((u: any) => u.email);

    const agencyEmails = allUsers
      .filter((u: any) => u.role === 'agency')
      .map((u: any) => u.email);

    let guestEmails: string[] = [];

    if (visibility === 'agency') {
      // Invite all internal team and all agency partners
      guestEmails = [...internalEmails, ...agencyEmails];
    } else {
      // Internal or External: restrict to internal team members only (no external partner notifications/emails)
      guestEmails = [...internalEmails];
    }

    // Deduplicate emails
    guestEmails = Array.from(new Set(guestEmails.filter(Boolean)));

    // Sync to Google Calendar
    let calendarEventId = meeting?.calendarEventId || null;
    try {
      if (calendarEventId) {
        await updateCalendarEvent(calendarEventId, meeting, guestEmails);
      } else {
        calendarEventId = await createCalendarEvent(meeting, guestEmails);
        if (calendarEventId) {
          await db.collection('tasks').doc(meetingId).update({ calendarEventId });
        }
      }
    } catch (calErr: any) {
      console.error('Google Calendar Sync error:', calErr.message);
    }

    // Trigger Push Notifications
    const payload = {
      title: `Meeting ${action}: ${title}`,
      body: `A meeting has been scheduled: ${meeting?.agenda || 'No agenda'}. Location: ${meeting?.location || 'N/A'}.`,
      url: '/tasks',
      tag: `meeting-${meetingId}`,
    };

    if (visibility === 'agency') {
      // Notify internal + agency
      await sendPushToRoles(['admin', 'internal', 'agency'], payload);
    } else {
      // Internal or External: Notify internal team members only
      await sendPushToRoles(['admin', 'internal'], payload);
    }

    res.json({ success: true, calendarEventId });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/push/stats ─────────────────────────────────────────────────────
// Admin only: returns subscriber count.
router.get('/stats', requireRole('admin'), async (_req: AuthedRequest, res, next) => {
  try {
    const count = await countSubscriptions();
    res.json({ success: true, subscriberCount: count, pushReady: isPushReady() });
  } catch (err) {
    next(err);
  }
});

export default router;
