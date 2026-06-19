import React from 'react';
import { Bell, X, Share, PlusSquare } from 'lucide-react';
import { usePush } from '../context/PushNotificationContext';

/**
 * Two-step opt-in soft prompt for Web Push Notifications.
 *
 * - Desktop / Android: shows a slide-in banner with "Enable Notifications" CTA.
 * - iOS (Safari, not standalone): shows an "Add to Home Screen" coaching overlay.
 * - Hidden if: already subscribed, permission denied, or user dismissed recently.
 */
export const PushOptInBanner: React.FC = () => {
  const {
    showPrompt,
    showIOSCoaching,
    subscribe,
    dismissPrompt,
    loading,
    isSubscribed,
    permission,
  } = usePush();

  // ── iOS A2HS Coaching Overlay ──
  if (showIOSCoaching) {
    return (
      <div className="push-banner push-banner-ios" role="alert" id="push-ios-coaching">
        <div className="push-banner-icon push-banner-icon--ios">
          <Bell size={22} />
        </div>
        <div className="push-banner-content">
          <strong className="push-banner-title">Get Instant Updates</strong>
          <p className="push-banner-body">
            Install this app to receive task alerts and campaign updates:
          </p>
          <ol className="push-ios-steps">
            <li>
              <Share size={14} className="push-ios-step-icon" />
              Tap the <strong>Share</strong> button in Safari
            </li>
            <li>
              <PlusSquare size={14} className="push-ios-step-icon" />
              Tap <strong>"Add to Home Screen"</strong>
            </li>
            <li>Open the app from your Home Screen</li>
          </ol>
        </div>
        <button
          className="push-banner-dismiss"
          onClick={dismissPrompt}
          aria-label="Dismiss notification coaching"
          id="push-ios-dismiss"
        >
          <X size={18} />
        </button>
      </div>
    );
  }

  // ── Standard Push Opt-In Banner ──
  if (!showPrompt || isSubscribed || permission === 'denied') {
    return null;
  }

  return (
    <div className="push-banner" role="alert" id="push-optin-banner">
      <div className="push-banner-icon">
        <Bell size={22} />
      </div>
      <div className="push-banner-content">
        <strong className="push-banner-title">Stay in the loop</strong>
        <p className="push-banner-body">
          Get instant alerts for overdue tasks, campaign deadlines, and important updates.
        </p>
      </div>
      <div className="push-banner-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={subscribe}
          disabled={loading}
          id="push-enable-btn"
        >
          {loading ? 'Enabling…' : 'Enable Notifications'}
        </button>
        <button
          className="push-banner-dismiss"
          onClick={dismissPrompt}
          aria-label="Dismiss notification prompt"
          id="push-dismiss-btn"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};
