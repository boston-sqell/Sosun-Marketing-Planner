import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandScopeProvider } from './context/BrandScopeContext';
import { PushNotificationProvider } from './context/PushNotificationContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { BrandScopeBar } from './components/BrandScopeBar';
import { PushOptInBanner } from './components/PushOptInBanner';
import { LoadingSpinner } from './components/LoadingSpinner';
import { SafeRouteBoundary } from './components/SafeRouteBoundary';
import { Login } from './pages/Login'; // Keep Login synchronous for instant load
import './styles/index.css';

// Lazy load views
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Campaigns = lazy(() => import('./pages/Campaigns').then(m => ({ default: m.Campaigns })));
const Tasks = lazy(() => import('./pages/Tasks').then(m => ({ default: m.Tasks })));
const CalendarView = lazy(() => import('./pages/CalendarView').then(m => ({ default: m.CalendarView })));
const FileManager = lazy(() => import('./pages/FileManager').then(m => ({ default: m.FileManager })));
const MediaLibrary = lazy(() => import('./pages/MediaLibrary').then(m => ({ default: m.MediaLibrary })));
const Configuration = lazy(() => import('./pages/Configuration').then(m => ({ default: m.Configuration })));
const Brands = lazy(() => import('./pages/Brands').then(m => ({ default: m.Brands })));
const Events = lazy(() => import('./pages/Events').then(m => ({ default: m.Events })));
const Retail = lazy(() => import('./pages/Retail').then(m => ({ default: m.Retail })));
const Budget = lazy(() => import('./pages/Budget').then(m => ({ default: m.Budget })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const NewsSentinel = lazy(() => import('./pages/NewsSentinel').then(m => ({ default: m.NewsSentinel })));

// ─────────────────────────────────────────────────────────────────────────────

const AppContent: React.FC = () => {
  const { user, profile, loading, unprovisioned, logout } = useAuth();
  const location = useLocation();
  // Agency partners must never reach financial views (rules also deny the data server-side)
  const isAgency = profile?.role === 'agency';

  if (loading) {
    return <LoadingSpinner message="Verifying credentials..." fullPage />;
  }

  // Render auth screen if user is not logged in
  if (!user) {
    return <Login />;
  }

  // Email verification gate removed — access is controlled entirely by role.
  // All account creation goes through the admin panel (Configuration page),
  // so there is no open public registration to exploit.

  // This account authenticated successfully but has no Firestore profile/role.
  // That should never happen for an admin-created account — surface it clearly
  // instead of silently proceeding with a null role (which would previously
  // have auto-provisioned this account as 'agency').
  if (unprovisioned) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }}>
        <div style={{ maxWidth: 440, textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '2.5rem 2rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>Account not set up</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: '1.5rem' }}>
            Your login succeeded, but no role has been provisioned for this account yet.
            Contact your administrator to have your access set up.
          </p>
          <button
            onClick={() => logout()}
            style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const getPageInfo = () => {
    const path = location.pathname;
    switch (path) {
      case '/':
      case '/dashboard':
        return { title: 'Marketing Dashboard', subtitle: 'Overview of active campaigns, daily schedule and overdue items.' };
      case '/campaigns':
        return { title: 'Campaigns Planning', subtitle: 'Design and review marketing targets, channels and budgets.' };
      case '/tasks':
        return { title: 'Content Tasks & Queue', subtitle: 'Manage individual posts, checklist items and comments.' };
      case '/calendar':
        return { title: 'Marketing Calendar', subtitle: 'Visual content scheduling calendar (Month & List views).' };
      case '/media':
        return { title: 'Post Link Library', subtitle: 'Preview cards for published posts and creatives — click to open the original.' };
      case '/files':
        return { title: 'File Storage Hub', subtitle: 'Legacy file manager (Firebase Storage).' };
      case '/config':
        return { title: 'App Configuration', subtitle: 'Add active brands, supported platforms and manage permissions.' };
      case '/brands':
        return { title: 'Brands', subtitle: 'Manage international consumer brands, principals and accent colors.' };
      case '/events':
        return { title: 'Events & Sponsorships', subtitle: 'Trade shows, exhibitions, packing logistics and sponsorship ROI.' };
      case '/retail':
        return { title: 'Merchandising', subtitle: 'Outlets, window stickers, shelf strips, wobblers, billboards and other merchandising activities.' };
      case '/budget':
        return { title: 'Budget Ledger', subtitle: 'Every spend, attributable to a brand, campaign or event.' };
      case '/reports':
        return { title: 'Brand Reports', subtitle: 'Automated monthly performance summaries per brand.' };
      case '/news':
        return { title: 'News Sentinel', subtitle: 'Brand mention monitoring across configured news sources.' };
      default:
        return { title: 'Marketing Planner', subtitle: 'Sosun Fihaara Operations Platform' };
    }
  };

  const pageInfo = getPageInfo();

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Container */}
      <main className="main-content">
        {/* Header Action Bar */}
        <Header title={pageInfo.title} subtitle={pageInfo.subtitle} />

        {/* Global brand portfolio scope */}
        {(location.pathname === '/budget' || location.pathname === '/reports') && <BrandScopeBar />}

        {/* Dynamic Router-based Inner View */}
        <div className="view-content">
          {/* Push Notification Opt-in Banner */}
          <PushOptInBanner />

          <SafeRouteBoundary>
            <Suspense fallback={<LoadingSpinner message="Loading view..." />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/dashboard" element={<Navigate to="/" replace />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/calendar" element={<CalendarView />} />
                <Route path="/events" element={<Events />} />
                <Route path="/retail" element={<Retail />} />
                <Route path="/budget" element={isAgency ? <Navigate to="/" replace /> : <Budget />} />
                <Route path="/reports" element={isAgency ? <Navigate to="/" replace /> : <Reports />} />
                <Route path="/news" element={isAgency ? <Navigate to="/" replace /> : <NewsSentinel />} />
                <Route path="/brands" element={<Brands />} />
                <Route path="/media" element={<MediaLibrary />} />
                <Route path="/files" element={<FileManager />} />
                <Route path="/config" element={profile?.role === 'admin' ? <Configuration /> : <Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </SafeRouteBoundary>
        </div>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <PushNotificationProvider>
        <BrowserRouter>
          <BrandScopeProvider>
            <AppContent />
          </BrandScopeProvider>
        </BrowserRouter>
      </PushNotificationProvider>
    </AuthProvider>
  );
};

export default App;
