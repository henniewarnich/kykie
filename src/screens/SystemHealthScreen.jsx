import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { archiveMatchStats, retrofitPredictions } from '../utils/sync.js';
import { exportAllData, exportTeamData } from '../utils/export.js';
import { APP_VERSION } from '../utils/constants.js';
import AdminBackBar from '../components/AdminBackBar.jsx';
import { TEAM_SELECT, teamDisplayName } from '../utils/teams.js';
import NavLogo from '../components/NavLogo.jsx';
import KykieSpinner from '../components/KykieSpinner.jsx';

const THRESHOLDS = {
  matches:        { green: 1000, amber: 5000 },
  match_events:   { green: 50000, amber: 200000 },
  match_stats:    { green: 10000, amber: 50000 },
  profiles:       { green: 500, amber: 2000 },
  teams:          { green: 500, amber: 2000 },
  event_reactions:{ green: 10000, amber: 50000 },
  audit_log:      { green: 10000, amber: 40000 },
  match_viewers:  { green: 10000, amber: 50000 },
  coach_teams:    { green: 500, amber: 2000 },
  match_commentators: { green: 500, amber: 2000 },
  ranking_sets:   { green: 500, amber: 2000 },
  rankings:       { green: 5000, amber: 20000 },
  sponsors:       { green: 100, amber: 500 },
  sponsor_impressions: { green: 50000, amber: 200000 },
  sponsor_clicks: { green: 10000, amber: 50000 },
};

const TABLES = ['matches','match_events','match_stats','profiles','teams','sponsors','sponsor_impressions','sponsor_clicks','event_reactions','audit_log','match_viewers','coach_teams','match_commentators','ranking_sets','rankings'];

function badge(count, table) {
  const t = THRESHOLDS[table] || { green: 10000, amber: 50000 };
  if (count >= t.amber) return { label: 'HIGH', bg: '#EF444422', color: '#EF4444' };
  if (count >= t.green) return { label: 'WARN', bg: '#F59E0B22', color: '#F59E0B' };
  return { label: 'OK', bg: '#10B98122', color: '#10B981' };
}

export default function SystemHealthScreen({ onBack }) {
  const [tableCounts, setTableCounts] = useState({});
  const [userStats, setUserStats] = useState({ total: 0, active24h: 0, active7d: 0, active30d: 0, byRole: {} });
  const [matchStats, setMatchStats] = useState({ live: 0, pending: 0, upcoming: 0 });
  const [dbSize, setDbSize] = useState(null);
  const [loading, setLoading] = useState(true);
  const [visitors, setVisitors] = useState(0);
  const [archiving, setArchiving] = useState(false);
  const [archiveResult, setArchiveResult] = useState(null);
  const [retrofitting, setRetrofitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [retrofitResult, setRetrofitResult] = useState(null);
  const [dailyActivity, setDailyActivity] = useState([]); // [{date, visitors, users}]
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [togglingMaintenance, setTogglingMaintenance] = useState(false);
  const [recordings, setRecordings] = useState({ live: 0, videoReview: 0 }); // active recording sessions
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [teamExportId, setTeamExportId] = useState('');
  const [teamExporting, setTeamExporting] = useState(false);
  const [teamExportProgress, setTeamExportProgress] = useState(null);

  useEffect(() => {
    const load = async () => {
      // Table row counts
      const counts = {};
      await Promise.all(TABLES.map(async (t) => {
        const { count } = await supabase.from(t).select('id', { count: 'exact', head: true });
        counts[t] = count || 0;
      }));
      setTableCounts(counts);

      // Match stats
      const [{ count: liveCount }, { count: pendingCount }, { count: upcomingCount }] = await Promise.all([
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'live'),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'upcoming'),
      ]);
      setMatchStats({ live: liveCount || 0, pending: pendingCount || 0, upcoming: upcomingCount || 0 });

      // User stats
      const { data: allProfiles } = await supabase.from('profiles').select('firstname, lastname, alias_nickname, role, last_seen_at, blocked');
      if (allProfiles) {
        const now = Date.now();
        const h24 = 24 * 60 * 60 * 1000;
        const m10 = 10 * 60 * 1000;
        const active = allProfiles.filter(p => !p.blocked);
        const byRole = {};
        active.forEach(p => { byRole[p.role] = (byRole[p.role] || 0) + 1; });
        setUserStats({
          total: active.length,
          active24h: active.filter(p => p.last_seen_at && (now - new Date(p.last_seen_at).getTime()) < h24).length,
          active7d: 0, active30d: 0, // populated below from real data
          byRole,
        });
        // Online now (last 10 minutes)
        setOnlineUsers(
          active.filter(p => p.last_seen_at && (now - new Date(p.last_seen_at).getTime()) < m10)
            .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at))
        );
      }

      // Daily activity trend (last 30 days) — from match_viewers + audit_log
      const now = Date.now();
      const h24 = 24 * 60 * 60 * 1000;
      const thirtyDaysAgo = new Date(now - 30 * h24).toISOString();
      const days = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * h24);
        days.push({ date: d.toISOString().slice(0, 10), visitors: 0, users: 0 });
      }

      // Fetch match_viewers for visitor counts (anonymous + registered)
      const { data: viewerRows } = await supabase
        .from('match_viewers')
        .select('viewer_id, created_at')
        .gte('created_at', thirtyDaysAgo);
      if (viewerRows) {
        // Group by day → distinct viewer_ids
        const dayVisitors = {};
        viewerRows.forEach(r => {
          const dayKey = new Date(r.created_at).toISOString().slice(0, 10);
          if (!dayVisitors[dayKey]) dayVisitors[dayKey] = new Set();
          dayVisitors[dayKey].add(r.viewer_id);
        });
        days.forEach(d => { d.visitors = dayVisitors[d.date]?.size || 0; });
        // Update 7d/30d visitor stats
        const uniqueVisitors7d = new Set();
        const uniqueVisitors30d = new Set();
        viewerRows.forEach(r => {
          const age = now - new Date(r.created_at).getTime();
          uniqueVisitors30d.add(r.viewer_id);
          if (age < 7 * h24) uniqueVisitors7d.add(r.viewer_id);
        });
        setUserStats(prev => ({ ...prev, active7d: uniqueVisitors7d.size, active30d: uniqueVisitors30d.size }));
      }

      // Fetch audit_log for registered user activity
      const { data: auditRows } = await supabase
        .from('audit_log')
        .select('user_id, created_at')
        .gte('created_at', thirtyDaysAgo);
      if (auditRows) {
        const dayUsers = {};
        auditRows.forEach(r => {
          if (!r.user_id) return;
          const dayKey = new Date(r.created_at).toISOString().slice(0, 10);
          if (!dayUsers[dayKey]) dayUsers[dayKey] = new Set();
          dayUsers[dayKey].add(r.user_id);
        });
        days.forEach(d => { d.users = dayUsers[d.date]?.size || 0; });
      }

      setDailyActivity(days);

      // DB size estimate (rough: sum of row counts * avg row size)
      const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
      // Rough estimate: match_events ~200 bytes/row, others ~500 bytes/row avg
      const estBytes = (counts.match_events || 0) * 200 + (totalRows - (counts.match_events || 0)) * 500;
      setDbSize({ totalRows, estMB: Math.round(estBytes / 1024 / 1024) });

      // Maintenance mode
      const { data: maint } = await supabase.from('site_settings').select('value').eq('key', 'maintenance_mode').single();
      if (maint) setMaintenanceMode(maint.value === 'true');

      // Active recordings (locked matches — only count recent locks, not stale ones)
      const { data: locked } = await supabase.from('matches').select('status, locked_by, updated_at').not('locked_by', 'is', null);
      if (locked) {
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        setRecordings({
          live: locked.filter(m => m.status === 'live').length,
          videoReview: locked.filter(m => m.status === 'ended' && m.updated_at > fourHoursAgo).length,
        });
      }

      // Load teams for export dropdown
      const { data: teamsData } = await supabase.from('teams').select(TEAM_SELECT).or('status.eq.active,status.is.null').order('name');
      if (teamsData) setAllTeams(teamsData);

      setLoading(false);
    };
    load();

    // Visitor presence
    const channel = supabase.channel('health-presence', { config: { presence: { key: Math.random().toString(36).slice(2) } } });
    channel.on('presence', { event: 'sync' }, () => {
      setVisitors(Object.keys(channel.presenceState()).length);
    });
    channel.subscribe(async (status) => { if (status === 'SUBSCRIBED') await channel.track({}); });
    return () => supabase.removeChannel(channel);
  }, []);

  const totalRows = dbSize?.totalRows || 0;
  const dbPct = dbSize ? Math.max(1, Math.round((dbSize.estMB / 500) * 100)) : 0;
  const dbColor = dbPct > 80 ? '#EF4444' : dbPct > 50 ? '#F59E0B' : '#10B981';

  const roleMeta = {
    admin: { color: '#EF4444' },
    commentator: { color: '#10B981' },
    coach: { color: '#8B5CF6' },
    supporter: { color: '#3B82F6' },
  };

  const cardStyle = { background: '#1E293B', borderRadius: 8, padding: '10px 12px' };

  return (
    <div style={{
      fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: '0 auto',
      background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', padding: 0,
    }}>
      <AdminBackBar title="System Health" onBack={onBack} />
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ padding: 16 }}>
      {loading ? (
        <div style={{ textAlign: 'center', marginTop: 40 }}><KykieSpinner /></div>
      ) : (
        <>
          {/* DB size + connections */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div style={{ ...cardStyle, borderLeft: `3px solid ${dbColor}`, borderRadius: 0 }}>
              <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4 }}>Est. database size</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>~{dbSize.estMB} <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>/ 500 MB</span></div>
              <div style={{ height: 4, background: '#334155', borderRadius: 2, marginTop: 6 }}>
                <div style={{ height: 4, background: dbColor, borderRadius: 2, width: `${Math.min(dbPct, 100)}%` }} />
              </div>
            </div>
            <div style={{ ...cardStyle, borderLeft: '3px solid #10B981', borderRadius: 0 }}>
              <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4 }}>Total rows</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{totalRows.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: '#64748B', marginTop: 6 }}>
                {totalRows < 100000 ? 'Healthy' : totalRows < 400000 ? 'Growing' : 'Consider pruning'}
              </div>
            </div>
          </div>

          {/* Table row counts */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Table row counts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {TABLES.map(t => {
              const count = tableCounts[t] || 0;
              const b = badge(count, t);
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', ...cardStyle }}>
                  <div style={{ flex: 1, fontSize: 12, color: '#94A3B8' }}>{t}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginRight: 8 }}>{count.toLocaleString()}</div>
                  <div style={{ padding: '2px 8px', borderRadius: 99, fontSize: 9, fontWeight: 700, background: b.bg, color: b.color }}>{b.label}</div>
                </div>
              );
            })}
          </div>

          {/* Activity */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: matchStats.live > 0 ? '#10B981' : '#F8FAFC' }}>{matchStats.live}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Live now</div>
            </div>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: matchStats.pending > 0 ? '#F59E0B' : '#F8FAFC' }}>{matchStats.pending}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Pending</div>
            </div>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{visitors}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Online now</div>
            </div>
          </div>

          {/* User activity */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#10B981' }}>{userStats.active24h}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Users 24h</div>
            </div>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#F59E0B' }}>{userStats.active7d}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Visitors 7d</div>
            </div>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#94A3B8' }}>{userStats.active30d}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Visitors 30d</div>
            </div>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#8B5CF6' }}>{userStats.total}</div>
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>Registered</div>
            </div>
          </div>

          {/* Who's online (last 10 minutes) */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>
            Who's online ({onlineUsers.length})
          </div>
          {onlineUsers.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', fontSize: 11, color: '#475569' }}>No users active in the last 10 minutes</div>
          ) : (
            <div style={cardStyle}>
              {onlineUsers.map((u, i) => {
                const meta = roleMeta[u.role] || { color: '#64748B' };
                const name = u.alias_nickname || `${u.firstname || ''} ${u.lastname || ''}`.trim() || 'Unknown';
                const ago = Math.floor((Date.now() - new Date(u.last_seen_at).getTime()) / 60000);
                const label = meta.label || (u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : '');
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < onlineUsers.length - 1 ? '1px solid #33415522' : 'none' }}>
                    <div style={{ width: 6, height: 6, borderRadius: 3, background: ago < 2 ? '#10B981' : '#F59E0B', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#F8FAFC' }}>{name}</div>
                    <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: meta.color + '22', color: meta.color }}>{label}</span>
                    <div style={{ fontSize: 9, color: '#475569', minWidth: 30, textAlign: 'right' }}>{ago < 1 ? 'now' : `${ago}m`}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Daily activity trend */}
          {dailyActivity.length > 0 && (() => {
            const maxV = Math.max(...dailyActivity.map(d => d.visitors), 1);
            const maxU = Math.max(...dailyActivity.map(d => d.users), 1);
            const max = Math.max(maxV, maxU);
            const totalV = dailyActivity.reduce((s, d) => s + d.visitors, 0);
            const totalU = dailyActivity.reduce((s, d) => s + d.users, 0);
            const chartW = 340;
            const chartH = 100;
            const step = chartW / (dailyActivity.length - 1 || 1);
            const toY = (val) => chartH - (val / max) * (chartH - 12);
            const makeLine = (key) => dailyActivity.map((d, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${toY(d[key]).toFixed(1)}`).join(' ');
            const makeArea = (key) => makeLine(key) + ` L${((dailyActivity.length - 1) * step).toFixed(1)},${chartH} L0,${chartH} Z`;
            const vLine = makeLine('visitors');
            const uLine = makeLine('users');
            return (
              <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>
                Daily activity (30d)
                <div style={{ display: 'flex', gap: 12, marginTop: 4, marginBottom: 4, fontWeight: 600, fontSize: 9, letterSpacing: 0, textTransform: 'none' }}>
                  <span style={{ color: '#10B981' }}>● Visitors: {totalV}</span>
                  <span style={{ color: '#8B5CF6' }}>● Registered: {totalU}</span>
                </div>
                <div style={{ background: '#1E293B', borderRadius: 10, padding: '12px 10px 6px', marginTop: 4, border: '1px solid #334155' }}>
                  <svg width={chartW} height={chartH + 20} style={{ display: 'block' }}>
                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75].map(frac => (
                      <line key={frac} x1={0} y1={chartH - frac * (chartH - 12)} x2={chartW} y2={chartH - frac * (chartH - 12)} stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                    ))}
                    {/* Visitor area + line */}
                    <path d={makeArea('visitors')} fill="#10B981" opacity="0.1" />
                    <path d={vLine} fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    {/* Registered area + line */}
                    <path d={makeArea('users')} fill="#8B5CF6" opacity="0.1" />
                    <path d={uLine} fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    {/* Visitor dots */}
                    {dailyActivity.map((d, i) => d.visitors > 0 && (
                      <g key={'v' + d.date}>
                        <circle cx={i * step} cy={toY(d.visitors)} r={i === dailyActivity.length - 1 ? 4 : 2.5} fill={i === dailyActivity.length - 1 ? '#F59E0B' : '#10B981'} />
                        <text x={i * step} y={toY(d.visitors) - 6} textAnchor="middle" fill="#10B981" fontSize="7" fontWeight="700">{d.visitors}</text>
                      </g>
                    ))}
                    {/* Registered user dots */}
                    {dailyActivity.map((d, i) => d.users > 0 && (
                      <g key={'u' + d.date}>
                        <circle cx={i * step} cy={toY(d.users)} r={2.5} fill="#8B5CF6" />
                      </g>
                    ))}
                    {/* Baseline */}
                    <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="#334155" strokeWidth="0.5" />
                    {/* Date labels */}
                    {dailyActivity.filter((_, i) => i === 0 || i === 14 || i === dailyActivity.length - 1).map((d, _, arr) => {
                      const i = dailyActivity.indexOf(d);
                      return (
                        <text key={d.date} x={i * step} y={chartH + 12} textAnchor="middle" fill="#475569" fontSize="7">
                          {new Date(d.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              </div>
            );
          })()}

          {/* Users by role */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Users by role</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {Object.entries(userStats.byRole).map(([role, count]) => {
              const meta = roleMeta[role] || { color: '#64748B' };
              const label = meta.label || role.charAt(0).toUpperCase() + role.slice(1);
              return (
                <div key={role} style={{ padding: '6px 12px', borderRadius: 8, background: meta.color + '22', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: meta.color }}>{count}</div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{label}</div>
                </div>
              );
            })}
          </div>

          {/* Thresholds legend */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Thresholds</div>
          <div style={{ ...cardStyle, fontSize: 11, color: '#64748B', lineHeight: 2 }}>
            <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#10B981', marginRight: 6 }} />Green: within safe limits</div>
            <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#F59E0B', marginRight: 6 }} />Amber: approaching limits — monitor</div>
            <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#EF4444', marginRight: 6 }} />Red: action needed (prune / upgrade)</div>
          </div>

          {/* Maintenance Mode */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Maintenance mode</div>
          <div style={cardStyle}>
            {/* Current activity */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#0B0F1A', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: visitors > 0 ? '#10B981' : '#64748B' }}>{visitors}</div>
                <div style={{ fontSize: 8, color: '#64748B' }}>Visitors online</div>
              </div>
              <div style={{ flex: 1, background: '#0B0F1A', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: recordings.live > 0 ? '#EF4444' : '#64748B' }}>{recordings.live}</div>
                <div style={{ fontSize: 8, color: '#64748B' }}>Live recordings</div>
              </div>
              <div style={{ flex: 1, background: '#0B0F1A', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: recordings.videoReview > 0 ? '#8B5CF6' : '#64748B' }}>{recordings.videoReview}</div>
                <div style={{ fontSize: 8, color: '#64748B' }}>Video reviews</div>
              </div>
            </div>
            {(recordings.live > 0 || recordings.videoReview > 0) && (
              <div style={{ fontSize: 10, color: '#F59E0B', marginBottom: 8, padding: '6px 8px', background: '#F59E0B11', borderRadius: 6 }}>
                ⚠️ Active recordings in progress — taking offline may interrupt {recordings.live + recordings.videoReview} session{recordings.live + recordings.videoReview !== 1 ? 's' : ''}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: maintenanceMode ? '#EF4444' : '#10B981' }}>
                  {maintenanceMode ? '🔴 Site is offline' : '🟢 Site is live'}
                </div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                  {maintenanceMode ? 'Public users see upgrade page. Admins can still access.' : 'All users can access the site normally.'}
                </div>
              </div>
              <button
                disabled={togglingMaintenance}
                onClick={async () => {
                  const next = !maintenanceMode;
                  if (next && !confirm(`Take site offline? ${visitors} visitor${visitors !== 1 ? 's' : ''} online, ${recordings.live + recordings.videoReview} active recording${recordings.live + recordings.videoReview !== 1 ? 's' : ''}.`)) return;
                  setTogglingMaintenance(true);
                  await supabase.from('site_settings').update({ value: String(next), updated_at: new Date().toISOString() }).eq('key', 'maintenance_mode');
                  setMaintenanceMode(next);
                  setTogglingMaintenance(false);
                }}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  background: maintenanceMode ? '#10B981' : '#EF444422',
                  color: maintenanceMode ? '#fff' : '#EF4444',
                  opacity: togglingMaintenance ? 0.5 : 1,
                }}
              >
                {togglingMaintenance ? '...' : maintenanceMode ? 'Take online' : 'Take offline'}
              </button>
            </div>
          </div>

          {/* Stats Recomputation */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, margin: '14px 0 8px', textTransform: 'uppercase' }}>Data Management</div>
          <div style={cardStyle}>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
              Pre-computes match stats from raw events. Safe to run any time — deletes old stats and rebuilds from scratch. Matches without events (quick scores) are skipped.
            </div>
            <button
              disabled={archiving}
              onClick={async () => {
                setArchiving(true);
                setArchiveResult(null);
                try {
                  // Find ALL ended matches with duration (have events)
                  const { data: allEnded } = await supabase
                    .from('matches')
                    .select('id')
                    .eq('status', 'ended')
                    .gt('duration', 0);
                  if (!allEnded || allEnded.length === 0) {
                    setArchiveResult('No matches with events found.');
                  } else {
                    let ok = 0, noEvents = 0, errors = [];
                    for (const m of allEnded) {
                      try {
                        const result = await archiveMatchStats(m.id);
                        if (result.ok) {
                          ok++;
                        } else if (result.reason === 'no events') {
                          noEvents++;
                        } else {
                          errors.push(m.id.slice(0,8) + ': ' + result.reason);
                          console.error('Recompute failed:', m.id, result.reason);
                        }
                      } catch (e) {
                        errors.push(m.id.slice(0,8) + ': ' + e.message);
                        console.error('Recompute threw:', m.id, e);
                      }
                    }
                    let msg = `✓ ${ok} match${ok !== 1 ? 'es' : ''} computed`;
                    if (noEvents > 0) msg += ` · ${noEvents} skipped (no events)`;
                    if (errors.length > 0) msg += ` · ${errors.length} failed`;
                    setArchiveResult(msg);
                    if (errors.length > 0) console.error('Failed matches:', errors);
                    // Refresh table counts
                    const { count } = await supabase.from('match_stats').select('id', { count: 'exact', head: true });
                    setTableCounts(prev => ({ ...prev, match_stats: count || 0 }));
                  }
                } catch (e) {
                  setArchiveResult('Error: ' + e.message);
                }
                setArchiving(false);
              }}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700,
                background: archiving ? '#334155' : '#3B82F622', color: archiving ? '#64748B' : '#3B82F6',
                cursor: archiving ? 'default' : 'pointer', marginBottom: 6,
              }}
            >
              {archiving ? '⏳ Recomputing...' : '🔄 Recompute All Stats'}
            </button>
            {archiveResult && (
              <div style={{ fontSize: 10, color: archiveResult.includes('failed') ? '#F59E0B' : archiveResult.startsWith('Error') ? '#EF4444' : '#10B981', marginTop: 4 }}>{archiveResult}</div>
            )}
          </div>

          {/* Prediction Retrofit */}
          <div style={cardStyle}>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
              Retrofit predictions for Kykie AI, Pistol Pete (GD-based), and Suzi Snow (rank-based) on all completed matches. Safe to re-run — clears and rebuilds.
            </div>
            <button
              disabled={retrofitting}
              onClick={async () => {
                setRetrofitting(true);
                setRetrofitResult(null);
                try {
                  const result = await retrofitPredictions((i, total) => {
                    setRetrofitResult(`Processing ${i}/${total}...`);
                  });
                  let msg = `✓ ${result.inserted} predictions from ${result.total} matches`;
                  if (result.skipped > 0) msg += ` · ${result.skipped} skipped`;
                  if (result.errors.length > 0) msg += ` · ${result.errors.length} errors`;
                  setRetrofitResult(msg);
                  if (result.errors.length > 0) console.error('Retrofit errors:', result.errors);
                  const { count } = await supabase.from('predictions').select('id', { count: 'exact', head: true });
                  setTableCounts(prev => ({ ...prev, predictions: count || 0 }));
                } catch (e) {
                  setRetrofitResult('Error: ' + e.message);
                }
                setRetrofitting(false);
              }}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700,
                background: retrofitting ? '#334155' : '#F59E0B22', color: retrofitting ? '#64748B' : '#F59E0B',
                cursor: retrofitting ? 'default' : 'pointer', marginBottom: 6,
              }}
            >
              {retrofitting ? '⏳ Retrofitting...' : '🔮 Retrofit Predictions'}
            </button>
            {retrofitResult && (
              <div style={{ fontSize: 10, color: retrofitResult.includes('Error') ? '#EF4444' : retrofitResult.includes('Processing') ? '#3B82F6' : '#10B981', marginTop: 4 }}>{retrofitResult}</div>
            )}
          </div>

          {/* Export All Data */}
          <div style={{ background: '#1E293B', borderRadius: 10, padding: '12px 14px', marginTop: 12, border: '1px solid #334155' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8B5CF6', marginBottom: 6 }}>📦 Data Export</div>
            <button
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                setExportProgress('Starting...');
                try {
                  const counts = await exportAllData(setExportProgress);
                  const total = Object.values(counts).reduce((a, b) => a + b, 0);
                  setExportProgress(`✓ Exported ${total.toLocaleString()} rows across ${Object.keys(counts).length} tables`);
                } catch (err) {
                  setExportProgress(`Error: ${err.message}`);
                }
                setExporting(false);
              }}
              style={{
                width: '100%', padding: '8px 14px', borderRadius: 8, border: '1px solid #8B5CF644',
                background: exporting ? '#334155' : '#8B5CF611', color: '#8B5CF6',
                fontSize: 11, fontWeight: 700, cursor: exporting ? 'default' : 'pointer',
              }}
            >
              {exporting ? '⏳ Exporting...' : '📦 Export All Data (JSON)'}
            </button>
            {exportProgress && (
              <div style={{ fontSize: 10, color: exportProgress.startsWith('Error') ? '#EF4444' : exportProgress.startsWith('✓') ? '#10B981' : '#64748B', marginTop: 4 }}>{exportProgress}</div>
            )}
            {/* Team Export */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #33415544' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>Export single team data</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={teamExportId} onChange={e => { setTeamExportId(e.target.value); setTeamExportProgress(null); }} style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #33415566',
                  background: '#0B0F1A', color: '#F8FAFC', fontSize: 11,
                }}>
                  <option value="">Select team...</option>
                  {allTeams.map(t => <option key={t.id} value={t.id}>{teamDisplayName(t)}</option>)}
                </select>
                <button
                  disabled={!teamExportId || teamExporting}
                  onClick={async () => {
                    const team = allTeams.find(t => t.id === teamExportId);
                    if (!team) return;
                    setTeamExporting(true);
                    setTeamExportProgress('Exporting...');
                    try {
                      await exportTeamData(team, () => {});
                      setTeamExportProgress('✓ Downloaded');
                    } catch (e) {
                      setTeamExportProgress(`Error: ${e.message}`);
                    }
                    setTeamExporting(false);
                  }}
                  style={{
                    padding: '6px 12px', borderRadius: 6, border: '1px solid #8B5CF644',
                    background: !teamExportId ? '#334155' : '#8B5CF611', color: '#8B5CF6',
                    fontSize: 11, fontWeight: 700, cursor: !teamExportId ? 'default' : 'pointer',
                    opacity: !teamExportId ? 0.4 : 1,
                  }}
                >📥</button>
              </div>
              {teamExportProgress && (
                <div style={{ fontSize: 10, color: teamExportProgress.startsWith('Error') ? '#EF4444' : teamExportProgress.startsWith('✓') ? '#10B981' : '#64748B', marginTop: 4 }}>{teamExportProgress}</div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 9, color: '#334155' }}>v{APP_VERSION}</div>
        </>
      )}
      </div>
    </div>
  );
}
