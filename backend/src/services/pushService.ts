import webpush from 'web-push';
import * as admin from 'firebase-admin';
import { db } from './firestore';

// ── VAPID Configuration ─────────────────────────────────────────────────────

let vapidReady = false;
let vapidInitialized = false;

function initVapid() {
  if (vapidInitialized) return;
  vapidInitialized = true;
  
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:push@sosunmarketingplanner.online';

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      vapidReady = true;
      console.log('Web Push: VAPID keys configured successfully.');
    } catch (err: any) {
      console.error('Web Push: Failed to set VAPID details:', err.message);
    }
  } else {
    console.warn('Web Push: VAPID keys not set — push notifications are disabled.');
  }
}

/** Check whether push is available (keys configured). */
export function isPushReady(): boolean {
  initVapid();
  return vapidReady;
}

/** Return the public VAPID key for the client. */
export function getVapidPublicKey(): string {
  initVapid();
  return process.env.VAPID_PUBLIC_KEY || '';
}

// ── Subscription Helpers ────────────────────────────────────────────────────
const SUBSCRIPTIONS = db.collection('pushSubscriptions');

export interface PushSubscriptionDoc {
  uid: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform: 'desktop' | 'android' | 'ios';
  userAgent: string;
  timezone: string;
  createdAt: admin.firestore.Timestamp;
  lastEngagedAt: admin.firestore.Timestamp;
}

/**
 * Save a new push subscription to Firestore.
 * Uses the endpoint as a natural dedup key (upsert by endpoint).
 */
export async function saveSubscription(
  uid: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  meta: { role?: string; platform?: string; userAgent?: string; timezone?: string } = {}
): Promise<string> {
  // Check if this endpoint already exists for this user
  const existing = await SUBSCRIPTIONS
    .where('uid', '==', uid)
    .where('endpoint', '==', subscription.endpoint)
    .limit(1)
    .get();

  const now = admin.firestore.Timestamp.now();

  if (!existing.empty) {
    // Update existing subscription (keys may have rotated)
    const docRef = existing.docs[0].ref;
    await docRef.update({
      keys: subscription.keys,
      lastEngagedAt: now,
    });
    return docRef.id;
  }

  // Create new subscription
  const docRef = await SUBSCRIPTIONS.add({
    uid,
    role: meta.role || 'agency', // Default least-privilege
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    platform: meta.platform || 'desktop',
    userAgent: (meta.userAgent || '').slice(0, 300),
    timezone: meta.timezone || 'UTC',
    createdAt: now,
    lastEngagedAt: now,
  });

  return docRef.id;
}



/**
 * Remove a subscription by endpoint for a given user.
 */
export async function removeSubscription(uid: string, endpoint: string): Promise<boolean> {
  const snap = await SUBSCRIPTIONS
    .where('uid', '==', uid)
    .where('endpoint', '==', endpoint)
    .limit(1)
    .get();

  if (snap.empty) return false;

  await snap.docs[0].ref.delete();
  return true;
}

/**
 * Remove a subscription by endpoint (any user) — used when push service
 * returns 404/410 indicating the subscription is dead.
 */
async function removeStaleEndpoint(endpoint: string): Promise<void> {
  const snap = await SUBSCRIPTIONS
    .where('endpoint', '==', endpoint)
    .get();

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  if (!snap.empty) await batch.commit();
}

/** Count active subscriptions. */
export async function countSubscriptions(): Promise<number> {
  const snap = await SUBSCRIPTIONS.count().get();
  return snap.data().count;
}

// ── Push Delivery ───────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  image?: string;
}

function buildPayload(payload: PushPayload): string {
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icon.svg',
    badge: payload.badge || '/favicon.svg',
    url: payload.url || '/',
    tag: payload.tag || 'sosun-general',
    image: payload.image,
  });
}

interface SendResult {
  sent: number;
  failed: number;
  staleRemoved: number;
}

/**
 * Send a push notification to a specific user's subscriptions.
 */
export async function sendPushToUser(uid: string, payload: PushPayload): Promise<SendResult> {
  if (!isPushReady()) throw new Error('VAPID keys not configured.');

  const snap = await SUBSCRIPTIONS.where('uid', '==', uid).get();
  const message = buildPayload(payload);
  const result: SendResult = { sent: 0, failed: 0, staleRemoved: 0 };

  const promises = snap.docs.map(async (doc) => {
    const sub = doc.data() as PushSubscriptionDoc;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        message,
        { TTL: 86400, urgency: 'normal' }
      );
      result.sent++;
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await removeStaleEndpoint(sub.endpoint);
        result.staleRemoved++;
      } else {
        console.error(`Push failed for ${sub.endpoint.slice(0, 60)}…:`, err.message);
        result.failed++;
      }
    }
  });

  await Promise.allSettled(promises);
  return result;
}

/**
 * Dispatch a push notification to all users matching any of the specified roles.
 * @param roles Array of AppRole strings (e.g. ['admin', 'agency'])
 * @param payload The notification payload
 */
export async function sendPushToRoles(roles: string[], payload: PushPayload): Promise<SendResult> {
  if (!isPushReady()) {
    return { sent: 0, failed: 0, staleRemoved: 0 };
  }
  if (!roles || roles.length === 0) return { sent: 0, failed: 0, staleRemoved: 0 };

  const snap = await SUBSCRIPTIONS.where('role', 'in', roles).get();
  if (snap.empty) return { sent: 0, failed: 0, staleRemoved: 0 };

  const strPayload = buildPayload(payload);
  let sent = 0;
  let failed = 0;
  let staleRemoved = 0;

  const pushPromises = snap.docs.map(async (doc) => {
    const sub = doc.data();
    try {
      const pSub = { endpoint: sub.endpoint, keys: sub.keys };
      await webpush.sendNotification(pSub, strPayload, { VAPID_PUBLIC_KEY: getVapidPublicKey() } as any);
      sent++;
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await doc.ref.delete();
        staleRemoved++;
      } else {
        console.error(`Push failed for ${sub.endpoint.slice(0, 50)}?:`, err.message);
        failed++;
      }
    }
  });

  await Promise.allSettled(pushPromises);
  return { sent, failed, staleRemoved };
}

/**
 * Admin broadcast: send a push to ALL active subscriptions.
 */
export async function broadcastPush(payload: PushPayload): Promise<SendResult> {
  if (!isPushReady()) throw new Error('VAPID keys not configured.');

  const message = buildPayload(payload);
  const result: SendResult = { sent: 0, failed: 0, staleRemoved: 0 };

  // Stream through subscriptions in batches of 100
  let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;
  const BATCH_SIZE = 100;

  while (true) {
    let query = SUBSCRIPTIONS.orderBy('createdAt').limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    const promises = snap.docs.map(async (doc) => {
      const sub = doc.data() as PushSubscriptionDoc;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          message,
          { TTL: 86400, urgency: 'normal' }
        );
        result.sent++;
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removeStaleEndpoint(sub.endpoint);
          result.staleRemoved++;
        } else {
          console.error(`Broadcast push failed for ${sub.endpoint.slice(0, 60)}…:`, err.message);
          result.failed++;
        }
      }
    });

    await Promise.allSettled(promises);
    lastDoc = snap.docs[snap.docs.length - 1];

    if (snap.docs.length < BATCH_SIZE) break;
  }

  return result;
}
