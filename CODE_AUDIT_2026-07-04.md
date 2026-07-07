# Code Audit: Load Time & Security Deep Dive
Date: July 4, 2026

This audit focuses on application load time optimizations and security vulnerabilities, specifically analyzing the React frontend, Firebase configuration, and Firestore rules.

## 🚀 Load Time Optimizations

### 1. Render-Blocking Firestore Query in `App.tsx`
**Issue:** 
In `frontend/src/App.tsx` (lines 50-71), the application initialization blocks the entire render tree while it checks for the existence of the `wf_task` workflow document in Firestore. If the session storage cache is empty (which happens on every new tab), it renders a full-page `<LoadingSpinner>` and waits for a network round trip before painting the UI.
**Impact:** 
Adds significant latency to the Time to Interactive (TTI) on fresh page loads.
**Recommendation:**
Since the task absorption migration is a one-time event, this dynamic check can be safely removed and hardcoded to `true`. Alternatively, if it must remain dynamic, inject the `tasksAbsorbed` flag into the user's custom claims or profile document so it arrives alongside the auth state, eliminating the extra network request.

### 2. Missing Caching Headers for Static Assets
**Issue:** 
Vite fingerprints all compiled JavaScript and CSS files in the `frontend/dist/assets/` directory (e.g., `index-[hash].js`), making them safe to cache indefinitely. However, `firebase.json` does not specify `Cache-Control` headers for these assets, falling back to Firebase's default short-lived cache.
**Impact:** 
Returning users must re-validate or re-download unchanged JavaScript and CSS files, slowing down repeat visits.
**Recommendation:**
Add the following block to the `hosting.headers` section in `firebase.json`:
```json
{
  "source": "/assets/**",
  "headers": [
    {
      "key": "Cache-Control",
      "value": "public, max-age=31536000, immutable"
    }
  ]
}
```

### 3. Client-Side Redirection Thrashing
**Issue:** 
In `frontend/index.html`, a `<script>` tag is used to redirect traffic from the legacy `.web.app` domain to the new custom domain (`sosunmarketingplanner.online`).
**Impact:** 
This causes the browser to download the HTML file, parse the head, execute the script, and then tear down the page to navigate to the new domain—resulting in a flash of unstyled content (FOUC) and poor SEO signaling.
**Recommendation:** 
Handle the 301 redirect at the infrastructure level. You can set up a dedicated site in Firebase Hosting for the legacy domain that only contains a `firebase.json` configured to immediately return a 301 server-side redirect to the new domain.

---

## 🔒 Security Vulnerabilities

### 1. Denial of Wallet via Global Activities Log
**Issue:** 
In `firestore.rules`, the `/activities/{activityId}` collection has the following rule:
`allow create: if isAuth();`
**Risk:** 
Any authenticated user can create an unlimited number of activity documents with arbitrary sizes. A malicious actor could exploit this to spam the database with gigabytes of fake data, resulting in a Denial of Wallet (DoW) attack through inflated Firestore write and storage costs, while also polluting the global UI feed.
**Recommendation:** 
Change `allow create: if false;` in Firestore rules. Move all activity creation to the backend API where `express-rate-limit` is enforced and payload sizes/contents can be validated.

### 2. Push Notification Hijacking
**Issue:** 
The update rule for `/pushSubscriptions/{subId}` in `firestore.rules` is incomplete:
`allow update: if isAuth() && resource.data.uid == request.auth.uid;`
**Risk:** 
While it verifies that the user currently owns the document (`resource.data.uid`), it does not validate the *incoming* data (`request.resource.data.uid`). A malicious user could update their own subscription document to change the `uid` field to an Admin's UID. This could intercept targeted push notifications or cause system-wide misdirection.
**Recommendation:** 
Strictly enforce that the incoming UID matches the authenticated user:
```javascript
allow update: if isAuth() && 
  resource.data.uid == request.auth.uid && 
  request.resource.data.uid == request.auth.uid;
```

### 3. UI Spoofing via User Profile Creation Flaw
**Issue:** 
In the `/users/{userId}` collection rules:
```javascript
allow write: if isAuth() && (
  getRole() == 'admin' ||
  (request.auth.uid == userId && (
    resource == null ||
    !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'plannerRole'])
  ))
);
```
**Risk:** 
If `resource == null` evaluates to true (i.e., the document is being created), the second half of the OR condition is completely bypassed. This means a user creating their own document can inject `role: 'admin'` into the payload. While the true backend permissions are secured by custom claims (`getRole()`), the frontend UI might read this spoofed `role` field directly from the Firestore document, potentially revealing admin-only UI elements or causing unpredictable client behavior.
**Recommendation:** 
Since users are now strictly provisioned via the backend (`POST /api/users/create`), the client should not be allowed to create user documents at all. 
Update the rule to `allow update:` instead of `allow write:`, preventing client-side creation.
