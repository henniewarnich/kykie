import RoleSwitcher from './RoleSwitcher.jsx';

export default function PageHeader({ currentUser, onLogout, onRoleSwitch, onBack }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 30, background: '#0B0F1A',
      borderBottom: '1px solid #1E293B',
    }}>
    <div style={{
      padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      {/* Left: back + logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 16, cursor: 'pointer', padding: '0 4px 0 0', lineHeight: 1 }}>←</button>
        )}
        <svg width="28" height="28" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="20" fill="none" stroke="#10B981" strokeWidth="2"/>
          <circle cx="28" cy="28" r="8" fill="none" stroke="#F59E0B" strokeWidth="2"/>
          <line x1="34" y1="22" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="40" y1="12" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="44" y1="12" x2="44" y2="16" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontSize: 20, fontWeight: 900, color: '#F59E0B' }}>kykie</span>
      </div>

      {/* Right: user + role + sign out */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {currentUser ? (
          <>
            <div onClick={() => { window.location.hash = '#/profile'; }}
              style={{ fontSize: 11, color: '#94A3B8', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#33415588', textUnderlineOffset: 2 }}
              title="Edit my profile">
              {currentUser.alias_nickname || currentUser.firstname}
            </div>
            {onRoleSwitch && <RoleSwitcher currentUser={currentUser} onSwitch={onRoleSwitch} />}
            <button onClick={onLogout} style={{ fontSize: 10, color: '#EF4444', background: '#EF444411', border: '1px solid #EF444444', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>Sign out</button>
          </>
        ) : (
          <button onClick={() => { window.location.hash = '#/login'; }} style={{ fontSize: 11, color: '#F59E0B', background: '#F59E0B11', border: '1px solid #F59E0B44', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontWeight: 700 }}>Sign in</button>
        )}
      </div>
    </div>
    </div>
  );
}
