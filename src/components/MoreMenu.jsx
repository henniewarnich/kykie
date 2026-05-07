import { APP_VERSION } from '../utils/constants.js';
import Icon from './Icons.jsx';

function goAdmin(screen) {
  window.location.hash = screen ? `#/admin/${screen}` : '#/admin';
}

const MenuItem = ({ icon, iconColor, title, sub, onClick }) => (
  <div onClick={onClick} style={{
    background: '#1E293B', borderRadius: 10, padding: '10px 14px', marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
  }}>
    <Icon name={icon} size={18} color={iconColor || '#94A3B8'} />
    <div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748B' }}>{sub}</div>}
    </div>
  </div>
);

const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, marginTop: 10, marginBottom: 6 }}>{children}</div>
);

export default function MoreMenu({ currentUser, onLogout }) {
  const isComm = currentUser && ['admin', 'commentator'].includes(currentUser.role);
  const isAdmin = currentUser && ['admin'].includes(currentUser.role);
  const isCoach = currentUser?.role === 'coach';

  return (
    <div style={{ padding: '16px 16px 20px' }}>

      {/* ── ADMIN ── */}
      {isAdmin && (
        <>
          <SectionLabel>Manage</SectionLabel>
          <MenuItem icon="calendar" iconColor="#F59E0B" title="Match schedule" sub="Create, edit, start live" onClick={() => goAdmin('match_schedule')} />
          <MenuItem icon="bar_chart" iconColor="#8B5CF6" title="Game history" sub="Past matches and stats" onClick={() => goAdmin('history')} />
          <MenuItem icon="buildings" iconColor="#3B82F6" title="Institutions & Teams" sub="Schools and team setup" onClick={() => goAdmin('teams')} />
          <MenuItem icon="user_plus" iconColor="#EF4444" title="Users" sub="Roles and assignments" onClick={() => goAdmin('users')} />
          <MenuItem icon="pending" iconColor="#EC4899" title="Pending approvals" sub="Review submissions" onClick={() => goAdmin('pending')} />
          <MenuItem icon="heartbeat" iconColor="#06B6D4" title="System health" sub="Database and activity" onClick={() => goAdmin('health')} />
          <MenuItem icon="mic" iconColor="#F97316" title="Credits overview" sub="Commentator credits & vouchers" onClick={() => goAdmin('admin_credits')} />
        </>
      )}

      {/* ── COMMENTATOR (non-admin) ── */}
      {isComm && !isAdmin && (
        <>
          <div onClick={() => goAdmin('home')} style={{
            background: '#F59E0B11', border: '1px solid #F59E0B44', borderRadius: 10,
            padding: '12px 14px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
          }}>
            <Icon name="mic" size={20} color="#F59E0B" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>Commentator dashboard</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>Match schedule, recording, credits</div>
            </div>
          </div>

          <SectionLabel>Quick access</SectionLabel>
          <MenuItem icon="calendar" iconColor="#F59E0B" title="Match schedule" sub="Create, edit, start live" onClick={() => goAdmin('match_schedule')} />
          <MenuItem icon="bar_chart" iconColor="#8B5CF6" title="Game history" sub="Past matches and stats" onClick={() => goAdmin('history')} />
          <MenuItem icon="coins" iconColor="#F59E0B" title="My credits" sub="Credit statement and vouchers" onClick={() => goAdmin('credits')} />
        </>
      )}

      {/* ── COACH ── */}
      {isCoach && !isComm && (
        <>
          <MenuItem icon="coach" iconColor="#3B82F6" title="Coach dashboard" sub="Team analytics and trends"
            onClick={() => { window.location.hash = '#/coach'; }} />
        </>
      )}

      {/* ── CONTRIBUTE (non-admin) ── */}
      {!isAdmin && (
        <>
          <SectionLabel>Contribute</SectionLabel>
          <MenuItem icon="edit" iconColor="#10B981" title="Submit a result" sub="Know a score? Add it"
            onClick={() => { window.location.hash = '#/submit?mode=result'; }} />
          <MenuItem icon="calendar_plus" iconColor="#3B82F6" title="Add upcoming match" sub="Fixture not yet listed"
            onClick={() => { window.location.hash = '#/submit?mode=upcoming'; }} />
          <MenuItem icon="school" iconColor="#8B5CF6" title="Suggest a team" sub="Add a school not yet listed"
            onClick={() => { window.location.hash = '#/submit?mode=team'; }} />
          <MenuItem icon="alert_triangle" iconColor="#F59E0B" title="Report a mistake" sub="Flag incorrect data"
            onClick={() => { window.location.hash = '#/issues'; }} />
        </>
      )}

      {/* ── ACCOUNT ── */}
      {currentUser && (
        <>
          <SectionLabel>Account</SectionLabel>
          <MenuItem icon="lock" iconColor="#94A3B8" title="Security" sub="Password and devices"
            onClick={() => { window.location.hash = '#/security'; }} />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <span onClick={onLogout} style={{ fontSize: 12, color: '#EF4444', fontWeight: 600, cursor: 'pointer' }}>Sign out</span>
          </div>
        </>
      )}

      {!currentUser && (
        <div style={{ marginTop: 12 }}>
          <div onClick={() => { window.location.hash = '#/login'; }} style={{
            width: '100%', padding: 12, borderRadius: 10, border: 'none',
            background: '#F59E0B', color: '#0B0F1A', fontSize: 13, fontWeight: 700,
            textAlign: 'center', cursor: 'pointer', marginBottom: 8,
          }}>Sign in</div>
          <div onClick={() => { window.location.hash = '#/register'; }} style={{
            width: '100%', padding: 12, borderRadius: 10,
            border: '1px solid #334155', background: 'none', color: '#94A3B8',
            fontSize: 13, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
          }}>Create account</div>
        </div>
      )}

      <div style={{ fontSize: 9, color: '#334155', textAlign: 'center', marginTop: 16 }}>v{APP_VERSION}</div>
    </div>
  );
}
