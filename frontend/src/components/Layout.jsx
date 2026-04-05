import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    to: '/investments',
    label: 'Investments',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    ),
  },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    to: '/credit-cards',
    label: 'Credit Cards',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
        <line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    ),
  },
  {
    to: '/banks',
    label: 'Banks',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="22" x2="21" y2="22"/>
        <line x1="6" y1="18" x2="6" y2="11"/>
        <line x1="10" y1="18" x2="10" y2="11"/>
        <line x1="14" y1="18" x2="14" y2="11"/>
        <line x1="18" y1="18" x2="18" y2="11"/>
        <polygon points="12 2 20 7 4 7"/>
      </svg>
    ),
  },
  {
    to: '/upload',
    label: 'Log Expense',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
]

const PAGE_LABELS = {
  '/': 'Dashboard',
  '/investments': 'Investments',
  '/transactions': 'Transactions',
  '/banks': 'Banks',
  '/credit-cards': 'Credit Cards',
  '/settings': 'Settings',
  '/upload': 'Log Expense',
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const sidebarRef = useRef(null)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        sidebarOpen &&
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target) &&
        !e.target.closest('.hamburger-btn')
      ) {
        setSidebarOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [sidebarOpen])

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const currentPageLabel = PAGE_LABELS[location.pathname] || 'Finance'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>
      <style>{`
        @media (min-width: 769px) {
          .sidebar { transform: translateX(0) !important; box-shadow: none !important; }
          .main-with-sidebar { margin-left: var(--sidebar-width); }
        }
        .nav-link-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 8px;
          margin-bottom: 2px;
          font-size: 13.5px;
          font-weight: 500;
          text-decoration: none;
          color: var(--text-muted);
          background: transparent;
          transition: all 0.15s ease;
          position: relative;
        }
        .nav-link-item:hover {
          color: var(--text-primary);
          background: var(--bg-elevated);
        }
        .nav-link-item.active {
          color: var(--accent);
          background: var(--accent-dim);
        }
        .nav-link-item.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--gradient);
        }
        .hamburger-btn {
          background: none;
          border: none;
          padding: 6px;
          border-radius: 8px;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .hamburger-btn:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 9px 12px;
          border-radius: 8px;
          font-size: 13.5px;
          font-weight: 500;
          background: transparent;
          border: none;
          color: var(--danger);
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .logout-btn:hover {
          background: rgba(239,68,68,0.1);
        }
      `}</style>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 199,
            backdropFilter: 'blur(3px)',
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className="sidebar"
        style={{
          width: 'var(--sidebar-width)',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 200,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: sidebarOpen ? '0 0 40px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {/* Logo */}
        <div style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'var(--gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Finance</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Personal tracker</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link-item${isActive ? ' active' : ''}`}
            >
              {({ isActive }) => (
                <>
                  <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.65 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
          <button className="logout-btn" onClick={handleLogout}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div
        className="main-with-sidebar"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
      >
        {/* Header */}
        <header style={{
          height: 58,
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Toggle menu"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                {currentPageLabel}
              </span>
            </div>
          </div>

          {/* Header right: time indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              padding: '4px 10px',
              borderRadius: 20,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </header>

        {/* Page */}
        <main style={{ flex: 1, padding: '24px 20px', overflowX: 'hidden' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
