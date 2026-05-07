import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { getCoachTeams } from '../utils/auth.js';
import { APP_VERSION } from '../utils/constants.js';
import { S, theme } from '../utils/styles.js';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icons.jsx';
import KykieSpinner from '../components/KykieSpinner.jsx';
import { teamDisplayName, teamSlug } from '../utils/teams.js';

export default function CoachDashboard({ currentUser, onLogout, onRoleSwitch }) {
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [playedCount, setPlayedCount] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    getCoachTeams(currentUser.id).then(t => {
      setTeams(t || []);
      if (t && t.length > 0) {
        sessionStorage.setItem('kykie-coach-team-count', String(t.length));
        sessionStorage.setItem('kykie-coach-teams', JSON.stringify(t.map(team => ({
          id: team.id, slug: teamSlug(team), name: teamDisplayName(team),
          short_name: team.short_name, color: team.color,
        }))));
      }
      setLoading(false);
    });

    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'upcoming')
      .then(({ count }) => setScheduledCount(count || 0));
    supabase.from('matches').select('id', { count: 'exact', head: true }).in('status', ['ended', 'abandoned'])
      .then(({ count }) => setPlayedCount(count || 0));
  }, [currentUser]);

  const goToTeamStats = () => {
    if (teams.length === 0) return;
    window.location.hash = '#/team/' + teamSlug(teams[0]);
  };

  const tryDemo = () => {
    sessionStorage.setItem('kykie-start-demo', '1');
    window.location.hash = '#/admin/match_schedule';
  };

  const tiles = [
    ...(teams.length > 0 ? [
      { key: 'team_stats', icon: 'bar_chart', color: '#10B981', title: 'Team Stats',
        sub: teams.length === 1 ? teamDisplayName(teams[0]) : `${teams.length} teams · tap to view`,
        onClick: goToTeamStats },
    ] : []),
    { key: 'training', icon: 'school', color: '#06B6D4', title: 'Training',
      sub: 'Training materials & benchmark test',
      onClick: () => { window.location.hash = '#/training'; } },
    { key: 'start_demo', icon: 'bolt', color: '#8B5CF6', title: 'Try Demo Match',
      sub: 'Practice the recorder — data is discarded',
      onClick: tryDemo },
    { key: 'match_schedule', icon: 'calendar', color: '#F59E0B', title: 'Match Schedule',
      sub: `${scheduledCount} upcoming match${scheduledCount !== 1 ? 'es' : ''}`,
      onClick: () => { window.location.hash = '#/admin/match_schedule'; } },
    { key: 'match_setup', icon: 'bolt', color: '#10B981', title: 'New Match',
      sub: 'Live match, quick score or demo',
      onClick: () => { window.location.hash = '#/admin/match_setup'; } },
    { key: 'history', icon: 'bar_chart', color: '#8B5CF6', title: 'Game History',
      sub: `${playedCount} game${playedCount !== 1 ? 's' : ''}`,
      onClick: () => { window.location.hash = '#/admin/history'; } },
  ];

  if (loading) {
    return (
      <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <KykieSpinner size={40} />
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div style={S.app}>
        <PageHeader currentUser={currentUser} onLogout={onLogout} onRoleSwitch={onRoleSwitch}
          onBack={() => { window.location.hash = '#/browse'; }} />
        <div style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏑</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC', marginBottom: 4 }}>No teams assigned yet</div>
          <div style={{ fontSize: 11, marginBottom: 20 }}>Ask your admin to assign you to a team to unlock Team Stats.</div>
        </div>
        <div style={{ padding: '0 16px 20px' }}>
          {tiles.map(t => (
            <div key={t.key} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={t.onClick}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: t.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={t.icon} size={20} color={t.color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</div>
                <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>{t.sub}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 10, color: theme.textDimmer }}>v{APP_VERSION}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <PageHeader currentUser={currentUser} onLogout={onLogout} onRoleSwitch={onRoleSwitch}
        onBack={() => { window.location.hash = '#/browse'; }} />
      <div style={{ padding: '0 16px 20px' }}>
        {tiles.map(t => (
          <div key={t.key} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={t.onClick}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: t.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name={t.icon} size={20} color={t.color} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</div>
              <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>{t.sub}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 10, color: theme.textDimmer }}>v{APP_VERSION}</div>
      </div>
    </div>
  );
}
