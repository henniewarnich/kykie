import { useState, useEffect } from 'react';
import { useMatchStore } from './hooks/useMatchStore.js';
import { S, theme } from './utils/styles.js';
import { saveData, loadData } from './utils/helpers.js';
import { saveMatchToSupabase, startVideoReview, clearMatchEvents } from './utils/sync.js';
import { supabase } from './utils/supabase.js';
import { APP_VERSION } from './utils/constants.js';
import { teamSlug, teamShortName, teamColor, MATCH_HOME_TEAM, MATCH_AWAY_TEAM } from './utils/teams.js';
import { getSession, getProfile, signOut, highestRole } from './utils/auth.js';
import HomeScreen from './screens/HomeScreen.jsx';
import TeamsScreen from './screens/TeamsScreen.jsx';
import MatchSetupScreen from './screens/MatchSetupScreen.jsx';
import LiveMatchScreen from './screens/LiveMatchScreen.jsx';
import HistoryScreen from './screens/HistoryScreen.jsx';
import GameReviewScreen from './screens/GameReviewScreen.jsx';
import PublicLiveScreen from './screens/PublicLiveScreen.jsx';
import CoachLiveScreen from './screens/CoachLiveScreen.jsx';
import TeamPage from './screens/TeamPage.jsx';
import CommentatorPage from './screens/CommentatorPage.jsx';
import LandingPage from './screens/LandingPage.jsx';
import MatchEditScreen from './screens/MatchEditScreen.jsx';
import LoginPage from './screens/LoginPage.jsx';
import UserManagementScreen from './screens/UserManagementScreen.jsx';
import MatchScheduleScreen from './screens/MatchScheduleScreen.jsx';
import CommentatorDashboard from './screens/CommentatorDashboard.jsx';
import CoachDashboard from './screens/CoachDashboard.jsx';
import ResetPasswordScreen from './screens/ResetPasswordScreen.jsx';
import ProfileEditScreen from './screens/ProfileEditScreen.jsx';
import RegisterPage from './screens/RegisterPage.jsx';
import CrowdSubmitScreen from './screens/CrowdSubmitScreen.jsx';
import PendingApprovalsScreen from './screens/PendingApprovalsScreen.jsx';
import IssuesScreen from './screens/IssuesScreen.jsx';
import SystemHealthScreen from './screens/SystemHealthScreen.jsx';
import PredictionLeaderboard from './screens/PredictionLeaderboard.jsx';
import LiveLiteScreen from './screens/LiveLiteScreen.jsx';
import LiveModeChooser from './components/LiveModeChooser.jsx';
import RankingsScreen from './screens/RankingsScreen.jsx';
import SponsorManagementScreen from './screens/SponsorManagementScreen.jsx';
import VoucherManagementScreen from './screens/VoucherManagementScreen.jsx';
import WhatIfScreen from './components/WhatIfScreen.jsx';
import TrainingScreen from './screens/TrainingScreen.jsx';
import CreditsScreen from './screens/CreditsScreen.jsx';
import AdminCreditsScreen from './screens/AdminCreditsScreen.jsx';
import SecurityScreen from './screens/SecurityScreen.jsx';
import ReportScreen from './screens/ReportScreen.jsx';
import NotifyCoachesScreen from './screens/NotifyCoachesScreen.jsx';
import VisitorsScreen from './screens/VisitorsScreen.jsx';
import DeviceVerification from './components/DeviceVerification.jsx';
import PageHeader from './components/PageHeader.jsx';
import { KykieLoadingScreen } from './components/KykieSpinner.jsx';
import { checkDevice, getDeviceId } from './utils/devices.js';
import { logVisit } from './utils/visitLog.js';
import CoachInfoScreen from './screens/CoachInfoScreen.jsx';
import CommentatorInfoScreen from './screens/CommentatorInfoScreen.jsx';
import SupporterInfoScreen from './screens/SupporterInfoScreen.jsx';
import SupporterDashboard from './screens/SupporterDashboard.jsx';

function getHashRoute() {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  if (hash.startsWith('team/')) {
    const rest = hash.replace('team/', '');
    const [slug, query] = rest.split('?');
    const matchId = query?.match(/match=([^&]+)/)?.[1] || null;
    return { type: 'team', slug, matchId };
  }
  if (hash.startsWith('record/')) return { type: 'record', slug: hash.replace('record/', '') };
  if (hash === 'record') return { type: 'record', slug: '' };
  if (hash === 'login') return { type: 'login' };
  if (hash === 'register') return { type: 'register' };
  if (hash.startsWith('register?')) return { type: 'register' };
  if (hash === 'submit') return { type: 'submit' };
  if (hash.startsWith('submit?')) {
    const params = new URLSearchParams(hash.split('?')[1]);
    return { type: 'submit', mode: params.get('mode') };
  }
  if (hash === 'pending') return { type: 'pending' };
  if (hash === 'issues') return { type: 'issues' };
  if (hash === 'health') return { type: 'health' };
  if (hash === 'training') return { type: 'training' };
  if (hash === 'security') return { type: 'security' };
  if (hash === 'profile') return { type: 'profile' };
  if (hash === 'coach') return { type: 'coach' };
  if (hash === 'info/coach') return { type: 'info_coach' };
  if (hash === 'info/commentator') return { type: 'info_commentator' };
  if (hash === 'info/supporter') return { type: 'info_supporter' };
  if (hash === 'home') return { type: 'home' };
  if (hash === 'browse') return { type: 'browse' };
  if (hash.startsWith('report/')) {
    const id = hash.replace('report/', '');
    return { type: 'report', id };
  }
  if (hash.startsWith('match/')) {
    const id = hash.replace('match/', '').split('?')[0];
    return { type: 'match', matchId: id };
  }
  if (hash.startsWith('review/')) {
    const id = hash.replace('review/', '').split('?')[0];
    return { type: 'review', matchId: id };
  }
  if (hash === 'admin' || hash.startsWith('admin/') || hash.startsWith('admin?')) {
    const sub = hash.includes('/') ? hash.split('/')[1] : null;
    return { type: 'admin', screen: sub || null };
  }
  return { type: 'landing' };
}

// Resolves #/review/{id} → fetches match, renders GameReviewScreen.
// Used for sharing a completed match with a commentator so they can
// kick off a video-stats recording from the same link.
function ReviewWrapper({ matchId, currentUser, onLogout, onRoleSwitch }) {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [matchConfig, setMatchConfig] = useState(null);

  useEffect(() => {
    if (!matchId) { setError('No match ID'); setLoading(false); return; }
    (async () => {
      try {
        const { data: m, error: mErr } = await supabase
          .from('matches')
          .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
          .eq('id', matchId)
          .single();
        if (mErr || !m) { setError('Match not found'); setLoading(false); return; }
        const { data: events } = await supabase
          .from('match_events')
          .select('*')
          .eq('match_id', matchId)
          .order('seq', { ascending: false });
        const built = {
          id: m.id,
          supabase_id: m.id,
          homeScore: m.home_score || 0,
          awayScore: m.away_score || 0,
          duration: m.duration || 0,
          date: m.match_date,
          venue: m.venue,
          matchType: m.match_type,
          matchLength: m.match_length || 60,
          breakFormat: m.break_format || 'quarters',
          status: m.status,
          teams: {
            home: { name: teamShortName(m.home_team), color: teamColor(m.home_team), id: m.home_team?.id, institution: m.home_team?.institution },
            away: { name: teamShortName(m.away_team), color: teamColor(m.away_team), id: m.away_team?.id, institution: m.away_team?.institution },
          },
          events: (events || []).map(e => ({
            id: e.id, team: e.team, event: e.event,
            zone: e.zone || '', detail: e.detail || '',
            time: e.match_time || 0, seq: e.seq,
          })),
        };
        setGame(built);
      } catch (e) {
        setError(e?.message || 'Could not load match');
      }
      setLoading(false);
    })();
  }, [matchId]);

  const handleStartVideoReview = async (g) => {
    const mid = g.supabase_id || g.id;
    const result = await startVideoReview(mid, currentUser?.id);
    if (result.error) { alert(result.error); return; }
    if (result.existingEvents > 0) {
      const confirmed = window.confirm(
        `This match has ${result.existingEvents} existing events from a previous recording. Starting video review will replace them. Continue?`
      );
      if (!confirmed) return;
      await clearMatchEvents(mid);
    }
    setMatchConfig({
      home: g.teams?.home || {},
      away: g.teams?.away || {},
      matchLength: g.matchLength || 60,
      breakFormat: g.breakFormat || 'quarters',
      matchType: g.matchType || 'league',
      venue: g.venue || '',
      date: g.date,
      isDemo: false,
      isVideoReview: true,
      videoReviewMatchId: mid,
      savedScore: { home: g.homeScore, away: g.awayScore },
    });
    setRecording(true);
  };

  if (loading) {
    return (
      <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <KykieLoadingScreen />
      </div>
    );
  }
  if (error || !game) {
    return (
      <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: '0 auto', background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <div style={{ fontSize: 24 }}>🏑</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{error || 'Match not found'}</div>
        <button onClick={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; }}
          style={{ marginTop: 8, padding: '8px 16px', borderRadius: 8, border: '1px solid #F59E0B44', background: '#F59E0B11', color: '#F59E0B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Go home
        </button>
      </div>
    );
  }
  if (recording && matchConfig) {
    return (
      <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh" }}>
        <LiveMatchScreen matchConfig={matchConfig} existingMatchId={matchConfig.videoReviewMatchId}
          currentUser={currentUser}
          onSaveGame={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; }}
          onNavigate={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; }} />
      </div>
    );
  }
  return (
    <GameReviewScreen
      game={game}
      currentUser={currentUser}
      onBack={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; }}
      onStartVideoReview={handleStartVideoReview}
    />
  );
}

// Resolves #/match/{id} → fetches home team, forwards to canonical #/team/{slug}?match={id}
function MatchRedirect({ matchId, currentUser }) {
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!matchId) { setError('No match ID'); return; }
    supabase.from('matches')
      .select('id, home_team:teams!home_team_id(*, institution:institutions(*))')
      .eq('id', matchId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data?.home_team) { setError('Match not found'); return; }
        const slug = teamSlug(data.home_team);
        if (!slug) { setError('Could not resolve match'); return; }
        window.location.hash = `#/team/${slug}?match=${matchId}`;
      });
  }, [matchId]);

  if (error) {
    return (
      <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: '0 auto', background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <div style={{ fontSize: 24 }}>🏑</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{error}</div>
        <button onClick={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; }}
          style={{ marginTop: 8, padding: '8px 16px', borderRadius: 8, border: '1px solid #F59E0B44', background: '#F59E0B11', color: '#F59E0B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Go home
        </button>
      </div>
    );
  }
  return (
    <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <KykieLoadingScreen />
    </div>
  );
}

function getHomeHash(user) {
  if (!user) return '#/';
  if (user.role === 'coach') return '#/coach';
  if (['admin'].includes(user.role)) return '#/admin';
  if (user.role === 'commentator') {
    return user.commentator_status === 'trainee' ? '#/training' : '#/admin';
  }
  // supporter, crowd, or any other role
  return '#/home';
}

export default function App() {
  const [route, setRoute] = useState(getHashRoute);
  const [subScreen, setSubScreen] = useState(null);
  const [screen, setScreen] = useState("home");
  const [matchConfig, setMatchConfig] = useState(null);
  const [reviewGame, setReviewGame] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintDoor, setMaintDoor] = useState({ taps: 0, show: false, email: '', password: '', error: '', loading: false });
  const [deviceBlock, setDeviceBlock] = useState(null); // { user, deviceInfo } when 3rd device detected
  const store = useMatchStore();

  // Check maintenance mode on load
  useEffect(() => {
    supabase.from('site_settings').select('value').eq('key', 'maintenance_mode').single()
      .then(({ data }) => { if (data?.value === 'true') setMaintenanceMode(true); })
      .catch(() => {});
  }, []);

  // Listen for hash changes
  useEffect(() => {
    const handler = () => setRoute(getHashRoute());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // First-party visit log — one row per pageload / hash change. logVisit
  // dedupes same-path bounces internally so this is safe to fire on every
  // route or user change. user_id is null for anonymous visitors.
  useEffect(() => {
    logVisit(window.location.hash, currentUser?.id || null);
  }, [route, currentUser?.id]);

  // Redirect logged-in users away from public landing page
  useEffect(() => {
    if (route.type === 'landing' && currentUser && !authLoading) {
      window.location.hash = getHomeHash(currentUser);
    }
  }, [route.type, currentUser, authLoading]);

  // Deep-link to admin screens via hash (e.g. #/admin/match_schedule)
  useEffect(() => {
    if (route.type === 'admin' && route.screen) {
      setScreen(route.screen);
    }
  }, [route.type, route.screen]);

  // Device heartbeat — check if this device is still registered, sign out if removed
  useEffect(() => {
    if (!currentUser) return;
    const deviceId = getDeviceId();
    const checkDevice = async () => {
      try {
        const { data, error } = await supabase.from('user_devices')
          .select('id')
          .eq('user_id', currentUser.id)
          .eq('device_id', deviceId);
        if (error) { console.warn('Device heartbeat error:', error.message); return; }
        if (!data || data.length === 0) {
          // Device was removed — sign out
          console.log('Device removed, signing out');
          await signOut();
          setCurrentUser(null);
          sessionStorage.removeItem('kykie-active-role');
          sessionStorage.removeItem('kykie-user-id');
          window.location.hash = '#/login';
          alert('You have been logged out because another device was registered.');
          return true; // signal to stop
        }
      } catch (e) { console.warn('Device heartbeat exception:', e); }
      return false;
    };
    // Check immediately, then every 15 seconds
    checkDevice();
    const interval = setInterval(async () => {
      const stopped = await checkDevice();
      if (stopped) clearInterval(interval);
    }, 15000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  // Check for existing session on mount
  useEffect(() => {
    // Detect email confirmation redirect (Supabase puts tokens in hash)
    const hashParams = window.location.hash;
    const isEmailConfirmation = hashParams.includes('type=signup') || hashParams.includes('type=email');

    const checkSession = async () => {
      const session = await getSession();
      if (session) {
        const profile = await getProfile();
        if (profile && !profile.blocked) {
          // Only admins can switch roles. For everyone else, the active role
          // is forced to the highest role they hold (coach > commentator > supporter).
          const hasAdmin = profile.roles?.includes('admin');
          if (hasAdmin) {
            const savedRole = sessionStorage.getItem('kykie-active-role');
            if (savedRole && profile.roles?.includes(savedRole)) {
              profile.role = savedRole;
            }
          } else {
            sessionStorage.removeItem('kykie-active-role');
            profile.role = highestRole(profile.roles) || profile.role;
          }
          setCurrentUser(profile);
          sessionStorage.setItem('kykie-user-id', profile.id);

          // Check device registration
          const devResult = await checkDevice(profile.id);
          if (devResult.status === 'blocked') {
            setDeviceBlock({ user: profile, deviceInfo: devResult });
          }

          if (isEmailConfirmation) {
            setEmailConfirmed(true);
            // Clean the hash to remove tokens — redirect to role home
            window.location.hash = getHomeHash(profile);
            setTimeout(() => setEmailConfirmed(false), 5000);
          }
        }
      }
      setAuthLoading(false);
    };
    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (profile) => {
    // Non-admins: pin to highest role; clear any stale switched-role.
    if (!profile.roles?.includes('admin')) {
      sessionStorage.removeItem('kykie-active-role');
      profile.role = highestRole(profile.roles) || profile.role;
    }
    setCurrentUser(profile);
    sessionStorage.setItem('kykie-user-id', profile.id);

    // Check device registration
    const devResult = await checkDevice(profile.id);
    if (devResult.status === 'blocked') {
      setDeviceBlock({ user: profile, deviceInfo: devResult });
      return; // Don't navigate — show device verification
    }

    if (['admin', 'commentator'].includes(profile.role)) {
      if (profile.role === 'commentator' && profile.commentator_status === 'trainee') {
        window.location.hash = '#/training';
      } else {
        window.location.hash = '#/admin';
      }
    } else {
      window.location.hash = getHomeHash(profile);
    }
  };

  const handleLogout = async () => {
    await signOut();
    setCurrentUser(null);
    setScreen("home");
    sessionStorage.removeItem('kykie-active-role');
    sessionStorage.removeItem('kykie-user-id');
    window.location.hash = '';
  };

  const handleRoleSwitch = (newRole) => {
    if (!currentUser) return;
    // Only admins are allowed to switch roles.
    if (!currentUser.roles?.includes('admin')) return;
    sessionStorage.setItem('kykie-active-role', newRole);
    // Trainee commentators go to training
    if (newRole === 'commentator' && currentUser.commentator_status === 'trainee') {
      window.location.hash = '#/training';
    } else {
      window.location.hash = getHomeHash({ ...currentUser, role: newRole });
    }
    window.location.reload();
  };

  // ── PASSWORD RECOVERY ──
  if (passwordRecovery) {
    return <ResetPasswordScreen onDone={() => {
      setPasswordRecovery(false);
      setCurrentUser(null);
      window.location.hash = '#/login';
    }} />;
  }

  // ── DEVICE VERIFICATION ──
  if (deviceBlock) {
    return (
      <DeviceVerification
        currentUser={deviceBlock.user}
        deviceInfo={deviceBlock.deviceInfo}
        onVerified={() => {
          setDeviceBlock(null);
          // Continue to normal destination
          const profile = deviceBlock.user;
          window.location.hash = getHomeHash(profile);
        }}
        onCancel={async () => {
          setDeviceBlock(null);
          await signOut();
          setCurrentUser(null);
          window.location.hash = '#/login';
        }}
      />
    );
  }

  // ── MAINTENANCE MODE ──
  // Admin/CommAdmin bypass maintenance to toggle it off
  if (maintenanceMode && !['admin'].includes(currentUser?.role)) {
    const handleMaintTap = () => {
      const next = maintDoor.taps + 1;
      if (next >= 5) setMaintDoor(d => ({ ...d, taps: next, show: true }));
      else setMaintDoor(d => ({ ...d, taps: next }));
    };
    const handleMaintLogin = async () => {
      setMaintDoor(d => ({ ...d, error: '', loading: true }));
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: maintDoor.email, password: maintDoor.password });
        if (error) { setMaintDoor(d => ({ ...d, error: error.message, loading: false })); return; }
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
        if (!profile || !['admin'].includes(profile.role)) {
          setMaintDoor(d => ({ ...d, error: 'Admin access required', loading: false }));
          await supabase.auth.signOut();
          return;
        }
        // Success — reload to bypass maintenance with active session
        window.location.reload();
      } catch (e) {
        setMaintDoor(d => ({ ...d, error: 'Login failed', loading: false }));
      }
    };
    return (
      <div style={{
        fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: "0 auto",
        background: "#0B0F1A", minHeight: "100vh", color: "#F8FAFC",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "0 20px",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <svg width="56" height="56" viewBox="0 0 56 56" style={{ marginBottom: 16 }}>
          <circle cx="28" cy="28" r="20" fill="none" stroke="#10B981" strokeWidth="2"/>
          <circle cx="28" cy="28" r="8" fill="none" stroke="#F59E0B" strokeWidth="2"/>
          <line x1="34" y1="22" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="40" y1="12" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="44" y1="12" x2="44" y2="16" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#F59E0B", marginBottom: 8 }}>kykie</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>We're upgrading!</div>
        <div style={{ fontSize: 13, color: "#94A3B8", marginBottom: 24, lineHeight: 1.6 }}>
          kykie is being upgraded with new features.<br />
          We'll be back in a couple of minutes.
        </div>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#334155", overflow: "hidden" }}>
          <div style={{ width: "60%", height: "100%", background: "#F59E0B", borderRadius: 2, animation: "loading 1.5s ease-in-out infinite alternate" }} />
        </div>
        <div onClick={handleMaintTap} style={{ fontSize: 10, color: "#475569", marginTop: 16, cursor: "default", userSelect: "none" }}>v{APP_VERSION}</div>

        {/* Secret admin login — appears after 5 taps on version */}
        {maintDoor.show && (
          <div style={{ marginTop: 20, width: "100%", maxWidth: 260 }}>
            <input type="email" placeholder="Email" value={maintDoor.email}
              onChange={e => setMaintDoor(d => ({ ...d, email: e.target.value }))}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #334155", background: "#1E293B", color: "#F8FAFC", fontSize: 12, marginBottom: 6, outline: "none" }}
            />
            <input type="password" placeholder="Password" value={maintDoor.password}
              onChange={e => setMaintDoor(d => ({ ...d, password: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleMaintLogin()}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #334155", background: "#1E293B", color: "#F8FAFC", fontSize: 12, marginBottom: 8, outline: "none" }}
            />
            {maintDoor.error && <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 6 }}>{maintDoor.error}</div>}
            <button onClick={handleMaintLogin} disabled={maintDoor.loading}
              style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", background: "#F59E0B", color: "#0B0F1A", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: maintDoor.loading ? 0.5 : 1 }}>
              {maintDoor.loading ? 'Signing in...' : 'Admin Sign In'}
            </button>
          </div>
        )}

        <style>{`@keyframes loading { from { width: 20%; margin-left: 0; } to { width: 60%; margin-left: 40%; } }`}</style>
      </div>
    );
  }

  // ── PUBLIC ROUTES (no auth needed) ──

  if (route.type === 'team') {
    return <TeamPage teamSlug={route.slug} initialMatchId={route.matchId} currentUser={currentUser} onBack={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; setRoute(getHashRoute()); }} />;
  }

  if (route.type === 'match') {
    return <MatchRedirect matchId={route.matchId} currentUser={currentUser} />;
  }

  if (route.type === 'review') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <ReviewWrapper matchId={route.matchId} currentUser={currentUser} onLogout={handleLogout} onRoleSwitch={handleRoleSwitch} />;
  }

  if (route.type === 'report') {
    return <ReportScreen reportId={route.id} currentUser={currentUser} onBack={() => {
      const ret = sessionStorage.getItem('kykie-report-return');
      sessionStorage.removeItem('kykie-report-return');
      if (ret) {
        window.location.hash = ret;
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.hash = currentUser ? getHomeHash(currentUser) : '';
      }
    }} />;
  }

  if (route.type === 'login') {
    if (currentUser) {
      // Already logged in — redirect to role dashboard
      const target = getHomeHash(currentUser);
      if (window.location.hash !== target) {
        window.location.hash = target;
        return <LoginPage onLogin={handleLogin} />;
      }
    }
    return <LoginPage onLogin={handleLogin} />;
  }

  if (route.type === 'register') {
    return <RegisterPage />;
  }

  // ── AUTH-REQUIRED ROUTES ──

  if (authLoading) {
    return <KykieLoadingScreen />;
  }

  // Crowd submit area
  if (route.type === 'submit') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <CrowdSubmitScreen currentUser={currentUser} onBack={() => { window.location.hash = getHomeHash(currentUser); }} initialMode={route.mode || null} />;
  }

  // Pending approvals (admin only)
  if (route.type === 'pending') {
    if (!currentUser || !['admin'].includes(currentUser.role)) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <PendingApprovalsScreen currentUser={currentUser} onBack={() => { window.location.hash = '#/admin'; }} />;
  }

  // Issues (any authenticated user)
  if (route.type === 'issues') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <IssuesScreen currentUser={currentUser} onBack={() => { window.location.hash = getHomeHash(currentUser); }} />;
  }

  // Security (any authenticated user)
  if (route.type === 'security') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <SecurityScreen currentUser={currentUser} onBack={() => { window.history.back(); }} />;
  }

  // Profile self-edit (any authenticated user)
  if (route.type === 'profile') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <ProfileEditScreen currentUser={currentUser} onLogout={handleLogout} onRoleSwitch={handleRoleSwitch}
      onBack={() => {
        if (window.history.length > 1) window.history.back();
        else window.location.hash = getHomeHash(currentUser);
      }} />;
  }

  if (route.type === 'info_coach') return <CoachInfoScreen />;
  if (route.type === 'info_commentator') return <CommentatorInfoScreen />;
  if (route.type === 'info_supporter') return <SupporterInfoScreen />;

  // Supporter dashboard
  if (route.type === 'home') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return <SupporterDashboard currentUser={currentUser} onLogout={handleLogout} onRoleSwitch={handleRoleSwitch} />;
  }

  // Browse mode — LandingPage with back to role dashboard. Default to the
  // Scores tab so "Browse Matches" actually shows matches, not the marketing home.
  if (route.type === 'browse') {
    return <LandingPage currentUser={currentUser} onLogout={handleLogout} emailConfirmed={emailConfirmed}
      initialTab="scores" initialScoresSub="results"
      onNavigate={currentUser ? (target) => setSubScreen(target) : null}
      onRoleSwitch={handleRoleSwitch}
      onBack={() => { window.location.hash = currentUser ? getHomeHash(currentUser) : ''; }} />;
  }

  // Commentator training (trainee commentators)
  if (route.type === 'training') {
    if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
    }
    return (
      <TrainingScreen
        currentUser={currentUser}
        onLogout={handleLogout}
        onRoleSwitch={handleRoleSwitch}
        onQualified={() => {
          // Reload profile to pick up qualified status
          window.location.hash = '#/admin';
          window.location.reload();
        }}
      />
    );
  }

  // Commentator recorder
  if (route.type === 'record') {
    if (!currentUser || !['admin', 'commentator', 'supporter'].includes(currentUser.role)) {
      return <LoginPage onLogin={handleLogin} />;
    }
    // Trainee commentators can't record real matches
    if (currentUser.role === 'commentator' && currentUser.commentator_status === 'trainee') {
      window.location.hash = '#/training';
      return null;
    }
    // Team-specific — old commentator page (kept for backward compat)
    if (route.slug) {
      return <CommentatorPage teamSlug={route.slug} currentUser={currentUser} onBack={() => { window.location.hash = '#/record'; }} onLogout={handleLogout} />;
    }
    // Match Schedule — same view as admin, with role-gated actions
    return <MatchScheduleScreen currentUser={currentUser} onBack={() => { window.location.hash = getHomeHash(currentUser); }} />;
  }

  // Coach area — standalone coach dashboard for team detail views
  if (route.type === 'coach') {
    if (!currentUser || !['admin', 'coach'].includes(currentUser.role)) {
      return <LoginPage onLogin={handleLogin} />;
    }
    // Pending coach — awaiting admin approval
    if (currentUser.role === 'coach' && currentUser.coach_status === 'pending') {
      return (
        <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: '0 auto', background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#F59E0B22', border: '1px solid #F59E0B44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Registration received</div>
          <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
            Hi {currentUser.firstname}, your coach registration is being reviewed.<br/>
            You'll receive an email once an admin has approved your access.
          </div>
          <div style={{ background: '#1E293B', borderRadius: 10, padding: 14, width: '100%', marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: '#64748B', marginBottom: 6 }}>While you wait, you can:</div>
            <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.6 }}>
              • Browse team pages and match results<br/>
              • Follow live matches as a supporter<br/>
              • React to match events
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button onClick={() => { window.location.hash = '#/browse'; }} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Browse kykie</button>
            <button onClick={handleLogout} style={{ padding: '12px 20px', borderRadius: 10, border: '1px solid #EF444444', background: 'transparent', color: '#EF4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Sign out</button>
          </div>
        </div>
      );
    }
    return <CoachDashboard currentUser={currentUser} onLogout={handleLogout} onRoleSwitch={handleRoleSwitch} />;
  }

  // Admin area
  if (route.type === 'admin') {
    if (!currentUser || !['admin', 'commentator', 'coach'].includes(currentUser.role)) {
      return <LoginPage onLogin={handleLogin} />;
    }
    // Trainee commentators go to training instead
    if (currentUser.role === 'commentator' && currentUser.commentator_status === 'trainee') {
      window.location.hash = '#/training';
      return null;
    }
    return (
      <AppContent
        store={store} screen={screen} setScreen={setScreen}
        matchConfig={matchConfig} setMatchConfig={setMatchConfig}
        reviewGame={reviewGame} setReviewGame={setReviewGame}
        currentUser={currentUser} onLogout={handleLogout} onRoleSwitch={handleRoleSwitch}
      />
    );
  }

  // Trainee commentators go to training
  const activeRole = sessionStorage.getItem('kykie-active-role') || currentUser?.role;
  if (currentUser && activeRole === 'commentator' && currentUser.commentator_status === 'trainee') {
    window.location.hash = '#/training';
    return null;
  }

  // Non-admin sub-screens
  if (subScreen === 'predictions') {
    return <PredictionLeaderboard currentUser={currentUser} onBack={() => setSubScreen(null)} />;
  }
  if (subScreen === 'history') {
    return <HistoryScreen games={store.games} currentUser={currentUser} onSelect={() => {}} onBack={() => setSubScreen(null)} onSyncAll={store.syncAllGames} syncing={store.syncing} />;
  }

  const defaultNavigate = (target) => {
    setSubScreen(target);
  };

  // Logged-in users should never see the public landing page — redirect effect handles it
  if (currentUser) {
    return <KykieLoadingScreen />;
  }

  return <LandingPage currentUser={currentUser} onLogout={handleLogout} emailConfirmed={emailConfirmed}
    onNavigate={null}
    onRoleSwitch={handleRoleSwitch} />;
}

function AppContent({ store, screen, setScreen, matchConfig, setMatchConfig, reviewGame, setReviewGame, currentUser, onLogout, onRoleSwitch }) {
  const navigate = (target, data) => {
    if (target === "home" && currentUser && !['admin', 'commentator'].includes(currentUser.role)) {
      window.location.hash = getHomeHash(currentUser);
      return;
    }
    if (target === "training") {
      window.location.hash = '#/training';
      return;
    }
    if (target === "start_demo") {
      setMatchConfig({ home: { id: "demo-home", color: "#1D4ED8", short_name: "Demo Lions", sport: "Hockey", age_group: "1st" }, away: { id: "demo-away", color: "#DC2626", short_name: "Demo Eagles", sport: "Hockey", age_group: "1st" }, matchLength: 10, breakFormat: "none", venue: "Demo Pitch", date: new Date().toISOString().slice(0, 10), isDemo: true, liveMode: 'pro' });
      setScreen("live");
      return;
    }
    // Clear hash sub-path so deep-link useEffect doesn't override
    if (window.location.hash.startsWith('#/admin/')) {
      window.history.replaceState(null, '', '#/admin');
    }
    if (["game_review", "public_view", "coach_view", "match_edit"].includes(target) && data) {
      setReviewGame(data);
    }
    setScreen(target);
  };

  const handleStartMatch = (config) => {
    setMatchConfig(config);
    if (config.liveMode) {
      setScreen(config.liveMode === 'lite' ? 'live_lite' : 'live');
    } else {
      setScreen("choose_live_mode");
    }
  };
  const handleLiveModeChosen = (mode) => {
    if (mode === 'lite') setScreen("live_lite");
    else setScreen("live");
  };
  const handleSaveGame = (game) => { store.saveGame(game); return game; };
  const handleImportGame = (game) => { const saved = store.saveGame(game); setReviewGame(saved || game); setScreen("game_review"); };
  const handleDeleteGame = async (id) => {
    // 1. Clean up credit entries (before FK blocks delete)
    try {
      await supabase.from('credit_ledger').delete().eq('match_id', id);
      await supabase.from('team_credits').delete().eq('match_id', id);
    } catch {}
    // 2. Delete from Supabase via audited RPC (MUST run before local delete)
    try {
      await supabase.rpc('delete_match', { p_match_id: id, p_user_id: currentUser?.id });
    } catch {}
    // 3. Remove from local storage only (Supabase already handled above)
    store.deleteGameLocal(id);
    setScreen("history");
  };

  const handleUpdateGame = async (updatedGame) => {
    const GAMES_KEY = 'kykie-games';
    const games = loadData(GAMES_KEY, []);
    const updated = games.map(g => g.id === updatedGame.id ? updatedGame : g);
    // Only persist unsynced games — synced ones live in the cloud
    saveData(GAMES_KEY, updated.filter(g => !g.supabase_id));
    try { await saveMatchToSupabase(updatedGame); } catch {}
    window.location.reload();
  };

  const handleSelectGame = async (game) => {
    // Cloud-only match — fetch events from Supabase
    if (game.cloudOnly && !game.events) {
      try {
        const { data: events } = await supabase
          .from('match_events')
          .select('*')
          .eq('match_id', game.id)
          .order('seq', { ascending: false });
        game = {
          ...game,
          events: (events || []).map(e => ({
            id: e.id,
            team: e.team,
            event: e.event,
            zone: e.zone || "",
            detail: e.detail || "",
            time: e.match_time || 0,
            seq: e.seq,
          })),
        };
      } catch {
        game = { ...game, events: [] };
      }
    }
    setReviewGame(game);
    setScreen("game_review");
  };

  const handleVideoReview = async (game) => {
    const matchId = game.supabase_id || game.id;
    // Lock check
    const result = await startVideoReview(matchId, currentUser?.id);
    if (result.error) {
      alert(result.error);
      return;
    }
    // If existing events, confirm replacement
    if (result.existingEvents > 0) {
      const confirmed = window.confirm(
        `This match has ${result.existingEvents} existing events from a previous recording. Starting video review will replace them. Continue?`
      );
      if (!confirmed) return;
      await clearMatchEvents(matchId);
    }
    // Build config from game data
    const config = {
      home: game.teams?.home || {},
      away: game.teams?.away || {},
      matchLength: game.matchLength || 60,
      breakFormat: game.breakFormat || 'quarters',
      matchType: game.matchType || 'league',
      venue: game.venue || '',
      date: game.date,
      isDemo: false,
      isVideoReview: true,
      videoReviewMatchId: matchId,
      savedScore: { home: game.homeScore, away: game.awayScore },
    };
    setMatchConfig(config);
    setScreen("live");
  };

  const getTeamShareLink = (team) => {
    const slug = teamSlug(team);
    return `${window.location.origin}${window.location.pathname}#/team/${slug}`;
  };

  // Screens that have their own full-screen UI (no standard header)
  const fullScreenModes = ['home', 'choose_live_mode', 'live', 'live_lite', 'game_review', 'public_view', 'coach_view'];
  const needsHeader = !fullScreenModes.includes(screen);

  const renderContent = () => {
  switch (screen) {
    case "home":
      return <HomeScreen teamCount={store.teams?.length || 0} gameCount={store.games?.length || 0}
        onNavigate={navigate} syncing={store.syncing} lastSyncError={store.lastSyncError}
        currentUser={currentUser} onLogout={onLogout} onRoleSwitch={onRoleSwitch} />;

    case "users":
      return <UserManagementScreen currentUser={currentUser} onBack={() => navigate("home")} />;

    case "rankings":
      return <RankingsScreen currentUser={currentUser} onBack={() => navigate("home")} />;

    case "pending":
      return <PendingApprovalsScreen currentUser={currentUser} onBack={() => navigate("home")} />;

    case "health":
      return <SystemHealthScreen onBack={() => navigate("home")} />;

    case "notify_coaches":
      return <NotifyCoachesScreen currentUser={currentUser} onBack={() => navigate("home")} />;

    case "visitors":
      return <VisitorsScreen onBack={() => navigate("home")} />;

    case "sponsors":
      return <SponsorManagementScreen onBack={() => navigate("home")} />;

    case "vouchers":
      return <VoucherManagementScreen onBack={() => navigate("home")} />;

    case "credits":
      return <CreditsScreen currentUser={currentUser} onBack={() => navigate("home")} />;
    case "admin_credits":
      return <AdminCreditsScreen currentUser={currentUser} onBack={() => navigate("home")} />;

    case "match_schedule":
      return <MatchScheduleScreen currentUser={currentUser} onBack={() => navigate("home")} />;

    case "teams":
      return <TeamsScreen currentUser={currentUser} onSave={store.saveTeam} onBack={() => navigate("home")} getShareLink={getTeamShareLink} />;

    case "match_setup":
      return <MatchSetupScreen teams={store.teams} games={store.games} onStart={handleStartMatch} onImportGame={handleImportGame} onBack={() => navigate("home")} onManageTeams={() => navigate("teams")} currentUser={currentUser} />;

    case "what_if":
      return <WhatIfScreen onBack={() => navigate("home")} />;

    case "choose_live_mode":
      if (!matchConfig) { navigate("home"); return null; }
      return (
        <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LiveModeChooser show={true} onSelect={handleLiveModeChosen} onClose={() => navigate("match_setup")} />
        </div>
      );

    case "live":
      if (!matchConfig) { navigate("home"); return null; }
      return (
        <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh" }}>
          <div style={{ padding: "4px 10px", background: "#1E293B", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <button onClick={() => {
              if (matchConfig.supabaseId) {
                if (!window.confirm("Please note that you will lose all statistics and commentary that you have recorded so far.\n\nAre you sure you want to continue?")) return;
              }
              setScreen("live_lite");
            }} style={{ background: "none", border: "1px solid #10B98144", borderRadius: 6, color: "#10B981", fontSize: 9, cursor: "pointer", fontWeight: 700, padding: "3px 8px" }}>
              ↓ Switch to Score only
            </button>
          </div>
          <LiveMatchScreen matchConfig={matchConfig} existingMatchId={matchConfig.supabaseId || null}
            onSaveGame={handleSaveGame} onNavigate={navigate}
            onBack={() => navigate("home")}
            currentUser={currentUser}
            onMatchCreated={(id) => setMatchConfig(prev => ({ ...prev, supabaseId: id }))} />
        </div>
      );

    case "live_lite":
      if (!matchConfig) { navigate("home"); return null; }
      return <LiveLiteScreen
        match={{ ...matchConfig, supabaseId: matchConfig.supabaseId || null }}
        currentUser={currentUser}
        onEnd={() => { setMatchConfig(null); navigate("home"); }}
        onPromote={() => setScreen("live")}
      />;

    case "history":
      return <HistoryScreen games={store.games} currentUser={currentUser} onSelect={handleSelectGame} onBack={() => navigate("home")} onSyncAll={store.syncAllGames} syncing={store.syncing} onVideoReview={handleVideoReview} />;

    case "predictions":
      return <PredictionLeaderboard currentUser={currentUser} onBack={() => navigate("home")} />;

    case "game_review":
      if (!reviewGame) { navigate("history"); return null; }
      return <GameReviewScreen game={reviewGame} onDelete={handleDeleteGame} onBack={() => navigate("history")} onNavigate={navigate} currentUser={currentUser} onStartVideoReview={handleVideoReview} />;

    case "public_view":
      if (!reviewGame) { navigate("history"); return null; }
      return <PublicLiveScreen match={{ ...reviewGame, status: "ended" }} events={reviewGame.events || []} matchTime={reviewGame.duration || 0} running={false} onBack={() => navigate("game_review", reviewGame)} />;

    case "coach_view":
      if (!reviewGame) { navigate("history"); return null; }
      return <CoachLiveScreen match={{ ...reviewGame, status: "ended" }} events={reviewGame.events || []} matchTime={reviewGame.duration || 0} running={false} onBack={() => navigate("game_review", reviewGame)} teamTier={currentUser?.role === 'admin' ? 'free_plus' : 'free'} />;

    case "match_edit":
      if (!reviewGame) { navigate("history"); return null; }
      return <MatchEditScreen game={reviewGame} teams={store.teams} onSave={handleUpdateGame} onBack={() => navigate("game_review", reviewGame)} />;

    default:
      return <div style={S.app}><div style={S.empty}>Something went wrong. <button onClick={() => navigate("home")} style={S.btnSm("#F59E0B", "#0F172A")}>Go Home</button></div></div>;
  }
  }; // end renderContent

  return (
    <>
      {needsHeader && <PageHeader currentUser={currentUser} onLogout={onLogout} onRoleSwitch={onRoleSwitch} onBack={() => navigate("home")} />}
      {renderContent()}
    </>
  );
}
