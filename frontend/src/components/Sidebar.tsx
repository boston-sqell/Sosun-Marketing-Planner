import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  LayoutDashboard,
  Calendar,
  Megaphone,
  CheckSquare,
  Images,
  Settings,
  LogOut,
  Tent,
  Store,
  Wallet,
  FileBarChart2,
  Tags,
  Radar,
  MoreHorizontal,
  X,
} from 'lucide-react';

const PRIMARY_PATHS = ['/', '/campaigns', '/tasks', '/calendar'];
const MQ = '(max-width: 768px)';

export const Sidebar: React.FC = () => {
  const { profile, logout } = useAuth();
  const role = profile?.role || 'internal';
  const [moreOpen, setMoreOpen] = useState(false);

  // Only render mobile nav when viewport is actually mobile — no CSS dependency
  const isMobile = useMediaQuery(MQ);
  useEffect(() => {
    if (!isMobile) setMoreOpen(false);
  }, [isMobile]);

  const menuItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'internal', 'agency'] },
    { path: '/campaigns', label: 'Campaigns', icon: Megaphone, roles: ['admin', 'internal', 'agency'] },
    { path: '/tasks', label: 'Tasks & Queue', icon: CheckSquare, roles: ['admin', 'internal', 'agency'] },
    { path: '/calendar', label: 'Calendar', icon: Calendar, roles: ['admin', 'internal', 'agency'] },
    { path: '/events', label: 'Events', icon: Tent, roles: ['admin', 'internal', 'agency'] },
    { path: '/retail', label: 'Merchandising', icon: Store, roles: ['admin', 'internal', 'agency'] },
    { path: '/budget', label: 'Budget', icon: Wallet, roles: ['admin', 'internal'] },
    { path: '/reports', label: 'Reports', icon: FileBarChart2, roles: ['admin', 'internal'] },
    { path: '/news', label: 'News Sentinel', icon: Radar, roles: ['admin', 'internal'] },
    { path: '/media', label: 'Media Library', icon: Images, roles: ['admin', 'internal', 'agency'] },
    { path: '/brands', label: 'Brands', icon: Tags, roles: ['admin', 'internal', 'agency'] },
    { path: '/config', label: 'Configuration', icon: Settings, roles: ['admin'] },
  ];

  const filteredItems  = menuItems.filter(item => item.roles.includes(role));
  const primaryItems   = filteredItems.filter(item => PRIMARY_PATHS.includes(item.path));
  const secondaryItems = filteredItems.filter(item => !PRIMARY_PATHS.includes(item.path));

  const roleLabel =
    role === 'admin'    ? 'Administrator' :
    role === 'internal' ? 'Internal Marketing' :
    role === 'external_agency' ? 'Agency Partner' :
    'Agency Partner';

  return (
    <>
      {/* Desktop sidebar — only mounted when viewport is desktop (> 768px) */}
      {!isMobile && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo">SF</div>
            <div>
              <h1 className="sidebar-title">Sosun Fihaara</h1>
              <span className="sidebar-subtitle">Marketing Planner</span>
            </div>
          </div>

          <ul className="sidebar-menu">
            {filteredItems.map(item => {
              const Icon = item.icon;
              return (
                <li key={item.path} className="sidebar-item">
                  <NavLink
                    to={item.path}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px' }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>

          <div className="sidebar-user">
            <div className="user-info">
              <div className="user-name" title={profile?.displayName} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.displayName || 'User'}</span>
                {(role === 'agency' || role === 'external_agency') && (
                  <span className="badge agency-badge" style={{ fontSize: '10px', padding: '1px 6px', backgroundColor: 'var(--color-warning-light, #fef9c3)', color: '#a16207', borderRadius: '10px', fontWeight: 700, border: '1px solid #fef08a' }}>Agency</span>
                )}
              </div>
              <div className="user-role">{roleLabel}</div>
            </div>
            <button className="logout-btn" onClick={logout} title="Sign Out">
              <LogOut size={18} />
            </button>
          </div>
        </aside>
      )}

      {/* Mobile nav — only mounted when viewport ≤ 768px */}
      {isMobile && (
        <>
          <nav className="mobile-nav">
            {primaryItems.map(item => {
              const Icon = item.icon;
              const shortLabel =
                item.label === 'Tasks & Queue' ? 'Tasks' :
                item.label === 'Dashboard'     ? 'Home'  :
                item.label;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon size={22} />
                  <span>{shortLabel}</span>
                </NavLink>
              );
            })}

            {secondaryItems.length > 0 && (
              <button
                className={`mobile-nav-item${moreOpen ? ' active' : ''}`}
                onClick={() => setMoreOpen(v => !v)}
                aria-label="More navigation"
              >
                <MoreHorizontal size={22} />
                <span>More</span>
              </button>
            )}
          </nav>

          {moreOpen && (
            <div
              className="mobile-more-overlay"
              onClick={() => setMoreOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label="More navigation options"
            >
              <div className="mobile-more-sheet" onClick={e => e.stopPropagation()}>
                <div className="mobile-more-handle" />
                <div className="mobile-more-header">
                  <span className="mobile-more-title">Menu</span>
                  <button
                    className="mobile-more-close"
                    onClick={() => setMoreOpen(false)}
                    aria-label="Close menu"
                  >
                    <X size={18} />
                  </button>
                </div>

                <ul className="mobile-more-list">
                  {secondaryItems.map(item => {
                    const Icon = item.icon;
                    return (
                      <li key={item.path}>
                        <NavLink
                          to={item.path}
                          className={({ isActive }) => `mobile-more-link${isActive ? ' active' : ''}`}
                          onClick={() => setMoreOpen(false)}
                        >
                          <Icon size={20} />
                          <span>{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>

                <div className="mobile-more-user">
                  <div className="user-info">
                    <div className="user-name">{profile?.displayName || 'User'}</div>
                    <div className="user-role" style={{ color: '#94a3b8', fontSize: '12px' }}>
                      {roleLabel}
                    </div>
                  </div>
                  <button className="logout-btn" onClick={logout} title="Sign Out">
                    <LogOut size={18} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};
