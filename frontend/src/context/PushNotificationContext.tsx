import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { pushApi } from '../services/pushApi';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'sosun_push_dismissed_at';
const BACKOFF_DAYS = 14;

/** Base64url → Uint8Array (required for applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Detect the rough platform for tagging. */
function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** iOS standalone detection (A2HS already done). */
function isIOSStandalone(): boolean {
  return (
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/** Is this iOS Safari (not standalone)? */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !isIOSStandalone();
}

/** True if the soft prompt was dismissed within the backoff window. */
function isDismissedRecently(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return false;
  const daysElapsed = (Date.now() - parseInt(dismissed, 10)) / (1000 * 60 * 60 * 24);
  return daysElapsed < BACKOFF_DAYS;
}

// ── Context ─────────────────────────────────────────────────────────────────

interface PushContextType {
  /** Browser supports push (SW + PushManager present). */
  isSupported: boolean;
  /** The user is currently subscribed. */
  isSubscribed: boolean;
  /** Current Notification permission state. */
  permission: NotificationPermission | 'unsupported';
  /** Whether the soft-prompt banner should be shown. */
  showPrompt: boolean;
  /** Whether iOS A2HS coaching should be shown instead of push prompt. */
  showIOSCoaching: boolean;
  /** Subscribe to push notifications. */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications. */
  unsubscribe: () => Promise<void>;
  /** Dismiss the soft prompt (backed off for 14 days). */
  dismissPrompt: () => void;
  /** Loading state (during subscribe/unsubscribe). */
  loading: boolean;
  /** Any error message from the last operation. */
  error: string | null;
}

const PushContext = createContext<PushContextType | undefined>(undefined);

// ── Provider ────────────────────────────────────────────────────────────────

export const PushNotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIOSCoaching, setShowIOSCoaching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Check support & current subscription state ──
  useEffect(() => {
    if (!user) {
      setShowPrompt(false);
      setShowIOSCoaching(false);
      return;
    }

    const check = async () => {
      // Feature detection
      const sw = 'serviceWorker' in navigator;
      const pm = 'PushManager' in window;
      const notif = 'Notification' in window;

      // iOS Safari without A2HS — can't do push, but can show coaching
      if (isIOSSafari()) {
        setIsSupported(false);
        setShowIOSCoaching(!isDismissedRecently());
        setShowPrompt(false);
        return;
      }

      const supported = sw && pm && notif;
      setIsSupported(supported);

      if (!supported) {
        setShowPrompt(false);
        return;
      }

      // Check current permission
      const perm = Notification.permission;
      setPermission(perm);

      if (perm === 'denied') {
        setShowPrompt(false);
        return;
      }

      // Check if already subscribed
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const subscribed = !!sub;
        setIsSubscribed(subscribed);

        // Show prompt if: supported, not subscribed, not denied, not recently dismissed
        if (!subscribed && (perm as string) !== 'denied' && !isDismissedRecently()) {
          setShowPrompt(true);
        } else {
          setShowPrompt(false);
        }
      } catch {
        setShowPrompt(false);
      }
    };

    check();
  }, [user]);

  // ── Subscribe ──
  const subscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Get VAPID public key from server
      const vapidPublicKey = await pushApi.getVapidPublicKey();

      // 2. Request permission (must be user-gesture initiated)
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        setShowPrompt(false);
        return;
      }

      // 3. Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // 4. Send subscription to server
      await pushApi.subscribe(sub.toJSON(), {
        platform: detectPlatform(),
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      setIsSubscribed(true);
      setShowPrompt(false);
      localStorage.removeItem(DISMISS_KEY);
    } catch (err) {
      console.error('Push subscribe failed:', err);
      setError((err as Error).message || 'Failed to enable notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Unsubscribe ──
  const unsubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        // Tell server first
        await pushApi.unsubscribe(sub.endpoint);
        // Then unsubscribe locally
        await sub.unsubscribe();
      }

      setIsSubscribed(false);
    } catch (err) {
      console.error('Push unsubscribe failed:', err);
      setError((err as Error).message || 'Failed to disable notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Dismiss prompt ──
  const dismissPrompt = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShowPrompt(false);
    setShowIOSCoaching(false);
  }, []);

  return (
    <PushContext.Provider
      value={{
        isSupported,
        isSubscribed,
        permission,
        showPrompt,
        showIOSCoaching,
        subscribe,
        unsubscribe,
        dismissPrompt,
        loading,
        error,
      }}
    >
      {children}
    </PushContext.Provider>
  );
};

export const usePush = () => {
  const context = useContext(PushContext);
  if (context === undefined) {
    throw new Error('usePush must be used within a PushNotificationProvider');
  }
  return context;
};
