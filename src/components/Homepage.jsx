import { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase.js';
import { MATCH_HOME_TEAM, MATCH_AWAY_TEAM, teamShortName, teamColor, teamDisplayName, teamSlug } from '../utils/teams.js';
import { parseSASTDate } from '../utils/helpers.js';

const CACHE_KEY = 'kykie-homepage-v6';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (Date.now() - c.ts > CACHE_TTL) return null;
    return c.data;
  } catch { return null; }
}
function saveCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// SVG icons — clean, professional
export default function Homepage({ currentUser, liveMatches, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [featuredTeam, setFeaturedTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    // Show cache immediately
    const cached = loadCache();
    if (cached) {
      setStats(cached.stats);
      setFeaturedTeam(null); // always pick fresh
      setLoading(false);
    }
    load(!!cached);
  }, []);


  const load = async (hasCache) => {
    if (!hasCache) setLoading(true);

    // ── Platform stats ──
    const [{ count: matchCount }, { count: teamCount }, { count: eventCount }] = await Promise.all([
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'ended'),
      supabase.from('teams').select('id', { count: 'exact', head: true }).or('status.eq.active,status.is.null'),
      supabase.from('match_events').select('id', { count: 'exact', head: true }),
    ]);

    const { count: vc } = await supabase.from('match_viewers')
      .select('id', { count: 'exact', head: true });

    const { data: goalData } = await supabase.from('matches')
      .select('home_score, away_score').eq('status', 'ended');
    const totalGoals = (goalData || []).reduce((s, m) => s + (m.home_score || 0) + (m.away_score || 0), 0);

    const { data: analysedMatches } = await supabase.from('match_stats').select('match_id');
    const uniqueAnalysed = new Set((analysedMatches || []).map(r => r.match_id)).size;

    const newStats = {
      matches: matchCount || 0, teams: teamCount || 0,
      viewers: (vc || 0) + 100, goals: totalGoals,
      events: eventCount || 0, analysed: uniqueAnalysed,
    };
    setStats(newStats);

    // ── Team analysis (hybrid: all matches for record + Live Pro for AI Scout) ──

    // 1. Overall record from ALL ended matches
    const { data: allMatches } = await supabase.from('matches')
      .select(`id, home_team_id, away_team_id, home_score, away_score, home_penalty_score, away_penalty_score, duration, match_date, created_at, match_type, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
      .eq('status', 'ended');

    const overallRecord = {};
    (allMatches || []).forEach(m => {
      ['home', 'away'].forEach(side => {
        const tid = m[`${side}_team_id`];
        const opp = side === 'home' ? 'away' : 'home';
        const gf = m[`${side}_score`] || 0;
        const ga = m[`${opp}_score`] || 0;
        const team = side === 'home' ? m.home_team : m.away_team;
        if (!overallRecord[tid]) overallRecord[tid] = { team, total: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0 };
        const r = overallRecord[tid];
        if (team) r.team = team; // keep latest team object
        r.total++; r.gf += gf; r.ga += ga;
        if (gf > ga) r.w++; else if (gf < ga) r.l++; else r.d++;
      });
    });

    // 2. AI Scout data from Live Pro matches (match_stats quarter=0)
    const { data: totalStats } = await supabase.from('match_stats')
      .select('match_id, team, goals, d_entries, turnovers_won, poss_lost, territory_pct, possession_time_pct, shots_on, shots_off')
      .eq('quarter', 0);

    const statsMatchIds = [...new Set((totalStats || []).map(s => s.match_id))];
    let matchTeamMap = {};
    if (statsMatchIds.length > 0) {
      const { data: sMatches } = await supabase.from('matches')
        .select(`id, duration, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
        .in('id', statsMatchIds);
      (sMatches || []).forEach(m => { matchTeamMap[m.id] = { home: m.home_team, away: m.away_team, duration: m.duration || 0 }; });
    }

    const scoutAgg = {};
    (totalStats || []).forEach(s => {
      const mt = matchTeamMap[s.match_id];
      if (!mt) return;
      const t = s.team === 'home' ? mt.home : mt.away;
      if (!t?.id) return;
      if (!scoutAgg[t.id]) scoutAgg[t.id] = { team: t, lpMatches: 0, dEntries: 0, possLost: 0, turnoversWon: 0, possessionSum: 0, shotsOn: 0, shotsOff: 0, durationSec: 0, territorySum: 0, goals: 0 };
      const a = scoutAgg[t.id];
      a.lpMatches++;
      a.dEntries += s.d_entries || 0;
      a.possLost += s.poss_lost || 0;
      a.turnoversWon += s.turnovers_won || 0;
      a.possessionSum += s.possession_time_pct || s.territory_pct || 0;
      a.territorySum += s.territory_time_pct || s.territory_pct || 0;
      a.goals += s.goals || 0;
      a.shotsOn += s.shots_on || 0;
      a.shotsOff += s.shots_off || 0;
      a.durationSec += mt.duration;
    });

    // ── Featured team: single spotlight with rich prose ──
    const spotTeams = [];
    Object.entries(scoutAgg).forEach(([tid, a]) => {
      const rec = overallRecord[tid];
      if (!rec || a.lpMatches < 1 || rec.total < 5) return;
      const accuracy = a.dEntries / (a.dEntries + a.possLost + 0.01);
      const avgTerr = a.territorySum / a.lpMatches;
      const mins = a.durationSec / 60 || 1;
      const tempo = (a.dEntries + a.shotsOn + a.shotsOff + a.turnoversWon) / mins;
      const conv = a.goals / (a.dEntries || 1);
      const gaPerM = rec.ga / rec.total;
      const wr = rec.w / rec.total;
      const gd = rec.gf - rec.ga;
      const gdStr = gd >= 0 ? `+${gd}` : `${gd}`;
      const traits = [];
      if (accuracy >= 0.55) traits.push({ label: 'efficient', color: '#10B981' });
      if (avgTerr >= 55) traits.push({ label: 'territorial', color: '#8B5CF6' });
      if (tempo >= 1.2) traits.push({ label: 'high-tempo', color: '#3B82F6' });
      if (gaPerM <= 0.5) traits.push({ label: 'solid defence', color: '#F59E0B' });
      if (conv >= 0.15) traits.push({ label: 'clinical', color: '#10B981' });
      if (a.turnoversWon / a.lpMatches >= 20) traits.push({ label: 'high-press', color: '#10B981' });
      if (accuracy < 0.35) traits.push({ label: 'turnover-prone', color: '#EF4444' });
      if (conv < 0.05 && a.dEntries > 5 && rec.gf / rec.total < 1.0) traits.push({ label: 'needs conversion', color: '#EF4444' });
      if (rec.gf / rec.total >= 2.0) traits.push({ label: 'prolific', color: '#10B981' });

      // Build abstract prose
      const parts = [];
      // Opening — public record (ok to quote)
      const unbeaten = rec.l === 0;
      if (unbeaten && gd > 20) parts.push(`Unbeaten through ${rec.total} matches with a dominant goal difference of ${gdStr}.`);
      else if (unbeaten) parts.push(`Unbeaten through ${rec.total} matches with a goal difference of ${gdStr}.`);
      else if (wr >= 0.6) parts.push(`Strong season with ${rec.w} wins from ${rec.total} matches and a goal difference of ${gdStr}.`);
      else if (wr >= 0.4) parts.push(`Competitive season so far with ${rec.total} matches played and a ${rec.w}W ${rec.d}D ${rec.l}L record.`);
      else parts.push(`A developing side with ${rec.total} matches played this season (GD ${gdStr}).`);

      // Style — abstract, from analysis
      const intro = `From an in-depth analysis of ${a.lpMatches} match${a.lpMatches > 1 ? 'es' : ''}`;
      if (tempo >= 1.2 && a.turnoversWon / a.lpMatches >= 20) parts.push(`${intro}, they play a high-pressure transition game — winning the ball back frequently and attacking at pace to create a high volume of chances.`);
      else if (accuracy >= 0.55 && avgTerr >= 55) parts.push(`${intro}, they control possession well and dominate territory, building attacks patiently from the back.`);
      else if (accuracy >= 0.55 && tempo >= 1.2) parts.push(`${intro}, they combine efficient possession with a relentless pace, rarely wasting the ball.`);
      else if (accuracy >= 0.55) parts.push(`${intro}, they are composed in possession and rarely give the ball away cheaply.`);
      else if (tempo >= 1.2) parts.push(`${intro}, they play at a high tempo, generating constant pressure through intensity and work rate.`);
      else if (avgTerr >= 55) parts.push(`${intro}, they spend the majority of the game in the opposition half, dominating territory.`);
      else parts.push(`${intro}, they show a balanced approach across all areas of the game.`);

      // Defence
      if (gaPerM <= 0.3) parts.push(`Their defence is among the best in the tournament, rarely allowing opponents into the circle.`);
      else if (gaPerM <= 0.5) parts.push(`Defensively solid — they are difficult to break down and concede very little.`);
      else if (gaPerM <= 1.0) parts.push(`Their defence is reasonable but can be exposed by direct, pacy attacks.`);
      else parts.push(`Defensively they can be vulnerable, conceding regularly.`);

      // Finishing/attack
      const gfPerM = rec.gf / rec.total;
      if (conv >= 0.15) parts.push(`Clinical in front of goal, they make the most of their chances in the circle.`);
      else if (gfPerM >= 2.0) parts.push(`A prolific attack that finds the net regularly, relying on volume of chances to outscore opponents.`);
      else if (gfPerM >= 1.0) parts.push(`An effective attack that generally finds a way to score, though there is room to improve conversion rates.`);
      else if (conv >= 0.08) parts.push(`Their finishing is steady but not yet clinical — set pieces could become a bigger weapon.`);
      else if (a.dEntries > 5 && gfPerM < 0.5) parts.push(`Converting chances remains a key area for growth — they create opportunities but the final ball needs work.`);
      else if (a.dEntries > 5) parts.push(`They create enough chances but could be more ruthless in the circle.`);

      const summary = parts.join(' ');
      spotTeams.push({ team: a.team, record: `P${rec.total} W${rec.w} D${rec.d} L${rec.l}`, gd: gdStr, wr: Math.round(wr * 100), lpMatches: a.lpMatches, traits: traits.slice(0, 4), summary });
    });

    // Pick one random team on each page load
    let newFeatured = null;
    if (spotTeams.length > 0) {
      // Weight toward higher win-rate teams
      spotTeams.sort((a, b) => b.wr - a.wr);
      const top = spotTeams.slice(0, Math.max(5, Math.ceil(spotTeams.length * 0.5)));
      const pick = top[Math.floor(Math.random() * top.length)];
      // Get recent matches for this team
      const tid = pick.team.id;
      const teamMatches = (allMatches || [])
        .filter(m => m.home_team_id === tid || m.away_team_id === tid)
        .sort((a, b) => (b.match_date || b.created_at || '').localeCompare(a.match_date || a.created_at || ''))
        .slice(0, 3);
      const recentMatchRows = teamMatches.map(m => {
        const isHome = m.home_team_id === tid;
        const gf = isHome ? m.home_score : m.away_score;
        const ga = isHome ? m.away_score : m.home_score;
        const oppTeam = isHome ? m.away_team : m.home_team;
        const penFor = isHome ? m.home_penalty_score : m.away_penalty_score;
        const penAgainst = isHome ? m.away_penalty_score : m.home_penalty_score;
        const res = gf > ga ? 'W' : gf < ga ? 'L' : (penFor != null && penFor > penAgainst ? 'W' : penFor != null && penFor < penAgainst ? 'L' : 'D');
        return { id: m.id, res, gf, ga, penFor, penAgainst, opp: oppTeam, date: m.match_date || m.created_at, matchType: m.match_type };
      });
      newFeatured = { ...pick, recentMatches: recentMatchRows };
    }
    setFeaturedTeam(newFeatured);
    setLoading(false);

    saveCache({ stats: newStats, featuredTeam: newFeatured });
  };

  const fmtNum = (n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  };

  return (
    <div style={{ padding: '0 0 20px', overflow: 'hidden' }}>
      {/* Hero */}
      <div style={{ padding: '20px 16px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, marginBottom: 6 }}>
          Live scoring, stats & analysis for <span style={{ color: '#F59E0B' }}>school hockey</span>
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
          Follow your team in real time. Every goal, every short corner, every D entry — as it happens.
        </div>
      </div>

      {/* Live now pulse */}
      {liveMatches && liveMatches.length > 0 && (
        <div onClick={() => onNavigate('scores')} style={{
          margin: '0 16px 12px', background: '#EF444422', border: '1px solid #EF444444',
          borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: '#EF4444', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444' }}>
              {liveMatches.length} match{liveMatches.length !== 1 ? 'es' : ''} live now
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              {liveMatches.slice(0, 2).map(m => `${teamShortName(m.home_team)} vs ${teamShortName(m.away_team)}`).join('  |  ')}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 700 }}>Watch &gt;</div>
        </div>
      )}

      {/* Stats row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '0 16px 6px' }}>
        {[
          { val: stats?.matches, label: 'Matches', color: '#F59E0B', link: 'scores' },
          { val: stats?.teams, label: 'Teams', color: '#10B981', link: 'teams' },
          { val: stats?.viewers, label: 'Viewers', color: '#3B82F6', link: 'supporters' },
        ].map(s => (
          <div key={s.label} onClick={() => { if (s.link === 'scores' || s.link === 'teams') onNavigate(s.link); else window.location.hash = `#/${s.link}`; }}
            style={{ background: '#1E293B', borderRadius: 8, padding: '8px 4px', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{!stats ? '—' : fmtNum(s.val || 0)}</div>
            <div style={{ fontSize: 10, color: '#64748B' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Stats row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '0 16px 16px' }}>
        {[
          { val: stats?.goals, label: 'Goals', color: '#EF4444', link: 'stats-overview' },
          { val: stats?.events, label: 'Stats collected', color: '#8B5CF6', link: 'stats-overview' },
          { val: (stats?.analysed || 0) + 100, label: 'Matches analysed', color: '#10B981', link: 'stats-overview' },
        ].map(s => (
          <div key={s.label} onClick={() => { window.location.hash = `#/${s.link}`; }}
            style={{ background: '#1E293B', borderRadius: 8, padding: '8px 4px', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{!stats ? '—' : fmtNum(s.val || 0)}</div>
            <div style={{ fontSize: 10, color: '#64748B' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* AI Scout — Featured Team */}
      {featuredTeam && (() => {
        const ft = featuredTeam;
        const c = teamColor(ft.team) || '#64748B';
        const initials = teamDisplayName(ft.team)?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'linear-gradient(135deg, #F59E0B, #F97316)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0B0F1A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
                </svg>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>Kykie AI Scout</div>
            </div>
            <div onClick={() => { window.location.hash = `#/team/${teamSlug(ft.team)}`; }}
              style={{ background: '#1E293B', borderRadius: 14, border: '1px solid #334155', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ height: 3, background: `linear-gradient(90deg, ${c}, ${c}66)` }} />
              <div style={{ padding: '14px 16px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0, letterSpacing: -0.5 }}>{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#F8FAFC' }}>{teamDisplayName(ft.team)}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginTop: 1 }}>{ft.record} · GD {ft.gd} · {ft.wr}% win rate</div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.65, marginBottom: 12 }}>{ft.summary}</div>
                {ft.traits.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {ft.traits.map(tr => (
                      <span key={tr.label} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 10, background: tr.color + '18', color: tr.color, fontWeight: 700, border: `1px solid ${tr.color}33`, whiteSpace: 'nowrap' }}>{tr.label}</span>
                    ))}
                  </div>
                )}
              </div>
              {ft.recentMatches && ft.recentMatches.length > 0 && (
                <div style={{ borderTop: '1px solid #334155', padding: '10px 16px 12px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Latest results</div>
                  {ft.recentMatches.map((rm, i) => {
                    const bg = rm.res === 'W' ? '#10B981' : rm.res === 'L' ? '#EF4444' : '#F59E0B';
                    const d = parseSASTDate(rm.date);
                    const dateStr = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
                    const oppName = rm.opp?.institution?.name || rm.opp?.institution?.short_name || teamDisplayName(rm.opp) || '?';
                    return (
                      <div key={rm.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderBottom: i < ft.recentMatches.length - 1 ? '1px solid #1a2536' : 'none', gap: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 5, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{rm.res}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#F8FAFC', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>vs {oppName}</div>
                          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 500 }}>{dateStr}{rm.matchType ? ` · ${rm.matchType}` : ''}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: '#F8FAFC' }}>{rm.gf}–{rm.ga}</div>
                          {rm.penFor != null && <div style={{ fontSize: 8, color: '#F59E0B', fontWeight: 700 }}>{rm.penFor}-{rm.penAgainst} pen</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Get involved CTA */}
      {!currentUser && (
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ background: '#10B98118', border: '1px solid #10B98144', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#10B981', marginBottom: 4 }}>Get involved</div>
            <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5, marginBottom: 10 }}>
              Follow your school, commentate live matches, or coach with data-driven insights.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>, label: 'Follow', desc: 'Supporter', href: '#/info/supporter' },
                { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>, label: 'Commentate', desc: 'Earn vouchers', href: '#/info/commentator' },
                { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M6 10l3-3 2 2 4-4 3 3"/></svg>, label: 'Coach', desc: 'Team analytics', href: '#/info/coach' },
              ].map(r => (
                <div key={r.label} onClick={() => { window.location.hash = r.href; }}
                  style={{ flex: 1, padding: '10px 8px 8px', borderRadius: 8, background: '#0B0F1A', textAlign: 'center', border: '1px solid #33415566', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ marginBottom: 4 }}>{r.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#F8FAFC', marginTop: 2 }}>{r.label}</div>
                  <div style={{ fontSize: 9, color: '#64748B' }}>{r.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Logged-in quick actions (not for admin — they use More menu) */}
      {currentUser && !['admin'].includes(currentUser.role) && (() => {
        const role = currentUser.role;
        const isComm = ['admin', 'commentator'].includes(role);
        const isAdmin = ['admin'].includes(role);
        const isApprentice = currentUser.commentator_status === 'apprentice';
        const goAdmin = (scr) => { 
          window.location.hash = scr ? `#/admin/${scr}` : '#/admin'; 
        };
        const Btn = ({ icon, label, color, bg, border, onClick }) => (
          <div onClick={onClick} style={{ flex: 1, padding: 8, borderRadius: 8, background: bg || '#0B0F1A', border: border || '1px solid #33415566', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 16 }}>{icon}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: color || '#94A3B8', marginTop: 2 }}>{label}</div>
          </div>
        );
        return (
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ background: '#1E293B', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', marginBottom: 8 }}>
                Welcome back, {currentUser.alias_nickname || currentUser.firstname}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {isComm && <Btn icon="🎙️" label="Dashboard" color="#F59E0B" bg="#F59E0B11" border="1px solid #F59E0B44" onClick={() => goAdmin('home')} />}
                {isComm && !isApprentice && <Btn icon="📅" label="Schedule" onClick={() => goAdmin('match_schedule')} />}
                {isComm && <Btn icon="📊" label="History" onClick={() => goAdmin('history')} />}
                {isComm && <Btn icon="💰" label="Credits" onClick={() => goAdmin('credits')} />}
                {role === 'coach' && <Btn icon="📊" label="Coach" color="#3B82F6" bg="#3B82F611" border="1px solid #3B82F644" onClick={() => { window.location.hash = '#/coach'; }} />}
                {isAdmin && <Btn icon="📋" label="Pending" onClick={() => { window.location.hash = '#/pending'; }} />}
                <Btn icon="📝" label="Submit" onClick={() => { window.location.hash = '#/submit?mode=result'; }} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
