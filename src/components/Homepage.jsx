import { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase.js';
import { MATCH_HOME_TEAM, MATCH_AWAY_TEAM, teamShortName, teamColor, teamDisplayName, teamSlug } from '../utils/teams.js';
import { parseSASTDate } from '../utils/helpers.js';

const CACHE_KEY = 'kykie-homepage-v7';
const CACHE_TTL = 5 * 60 * 1000;

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

export default function Homepage({ currentUser, liveMatches, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [featuredTeam, setFeaturedTeam] = useState(null);
  const loaded = useRef(false);

  useEffect(() => {
    const cached = loadCache();
    if (cached) setStats(cached.stats);
    load(!!cached);
  }, []);

  const load = async (hasCache) => {
    const [{ count: matchCount }, { count: teamCount }, { count: eventCount }] = await Promise.all([
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'ended'),
      supabase.from('teams').select('id', { count: 'exact', head: true }).or('status.eq.active,status.is.null'),
      supabase.from('match_events').select('id', { count: 'exact', head: true }),
    ]);
    const { count: vc } = await supabase.from('match_viewers').select('id', { count: 'exact', head: true });
    const { data: goalData } = await supabase.from('matches').select('home_score, away_score').eq('status', 'ended');
    const totalGoals = (goalData || []).reduce((s, m) => s + (m.home_score || 0) + (m.away_score || 0), 0);
    const { data: analysedMatches } = await supabase.from('match_stats').select('match_id');
    const uniqueAnalysed = new Set((analysedMatches || []).map(r => r.match_id)).size;

    const newStats = {
      matches: matchCount || 0,
      teams: teamCount || 0,
      viewers: (vc || 0) + 100,
      goals: totalGoals,
      events: eventCount || 0,
      analysed: uniqueAnalysed,
    };
    setStats(newStats);

    // AI Scout featured team (kept from previous version, abridged data load)
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
        if (team) r.team = team;
        r.total++; r.gf += gf; r.ga += ga;
        if (gf > ga) r.w++; else if (gf < ga) r.l++; else r.d++;
      });
    });
    const { data: totalStats } = await supabase.from('match_stats')
      .select('match_id, team, goals, d_entries, turnovers_won, poss_lost, territory_pct, possession_time_pct, shots_on, shots_off')
      .eq('quarter', 0);
    const statsMatchIds = [...new Set((totalStats || []).map(s => s.match_id))];
    let matchTeamMap = {};
    if (statsMatchIds.length > 0) {
      const { data: sMatches } = await supabase.from('matches')
        .select(`id, duration, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`).in('id', statsMatchIds);
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
      if (rec.gf / rec.total >= 2.0) traits.push({ label: 'prolific', color: '#10B981' });
      const parts = [];
      const unbeaten = rec.l === 0;
      if (unbeaten && gd > 20) parts.push(`Unbeaten through ${rec.total} matches with a dominant goal difference of ${gdStr}.`);
      else if (unbeaten) parts.push(`Unbeaten through ${rec.total} matches with a goal difference of ${gdStr}.`);
      else if (wr >= 0.6) parts.push(`Strong season with ${rec.w} wins from ${rec.total} matches and a goal difference of ${gdStr}.`);
      else if (wr >= 0.4) parts.push(`Competitive season so far with ${rec.total} matches played and a ${rec.w}W ${rec.d}D ${rec.l}L record.`);
      else parts.push(`A developing side with ${rec.total} matches played this season (GD ${gdStr}).`);
      const intro = `From an in-depth analysis of ${a.lpMatches} match${a.lpMatches > 1 ? 'es' : ''}`;
      if (tempo >= 1.2 && a.turnoversWon / a.lpMatches >= 20) parts.push(`${intro}, they play a high-pressure transition game.`);
      else if (accuracy >= 0.55 && avgTerr >= 55) parts.push(`${intro}, they control possession and dominate territory.`);
      else if (accuracy >= 0.55) parts.push(`${intro}, they are composed in possession.`);
      else if (tempo >= 1.2) parts.push(`${intro}, they play at high tempo.`);
      else parts.push(`${intro}, they show a balanced approach.`);
      spotTeams.push({ team: a.team, record: `P${rec.total} W${rec.w} D${rec.d} L${rec.l}`, gd: gdStr, wr: Math.round(wr * 100), lpMatches: a.lpMatches, traits: traits.slice(0, 4), summary: parts.join(' ') });
    });
    let newFeatured = null;
    if (spotTeams.length > 0) {
      spotTeams.sort((a, b) => b.wr - a.wr);
      const top = spotTeams.slice(0, Math.max(5, Math.ceil(spotTeams.length * 0.5)));
      const pick = top[Math.floor(Math.random() * top.length)];
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
    saveCache({ stats: newStats });
  };

  const fmtNum = (n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  };

  const goRoleInfo = (role) => () => { window.location.hash = `#/info/${role}`; };
  const isAdmin = currentUser && currentUser.role === 'admin';

  return (
    <div className="kykie-lp">
      <style>{`
        .kykie-lp { padding: 0 0 20px; }
        .kykie-lp .sec { padding: 28px 16px; border-top: 1px solid #1E293B; }
        .kykie-lp .sec.split { display: grid; grid-template-columns: 1fr; gap: 24px; align-items: center; }
        @media (min-width: 720px) { .kykie-lp .sec.split { grid-template-columns: 1fr 1fr; gap: 32px; padding: 36px 24px; } .kykie-lp .sec.split.flip .tc { order: 2; } }
        .kykie-lp .eyebrow { font-size: 11px; color: #F59E0B; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
        .kykie-lp .eyebrow.g { color: #10B981; }
        .kykie-lp h1 { font-size: 26px; font-weight: 900; line-height: 1.15; color: #F8FAFC; margin-bottom: 12px; }
        .kykie-lp h1 .a { color: #F59E0B; }
        .kykie-lp h3 { font-size: 20px; font-weight: 900; color: #F8FAFC; margin-bottom: 8px; }
        .kykie-lp .lede { font-size: 13px; color: #94A3B8; line-height: 1.6; max-width: 380px; }
        .kykie-lp .btn-am { background: #F59E0B; color: #0B0F1A; padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 800; display: inline-block; text-decoration: none; border: none; cursor: pointer; font-family: inherit; margin-top: 14px; }
        .kykie-lp .quote { margin: 22px 0 0; padding: 14px 16px; background: rgba(245,158,11,0.06); border-left: 3px solid #F59E0B; border-radius: 0 8px 8px 0; max-width: 380px; }
        .kykie-lp .quote .qtext { font-size: 13px; font-style: italic; color: #CBD5E1; line-height: 1.5; }
        .kykie-lp .quote .qattr { font-size: 11px; font-weight: 700; color: #94A3B8; margin-top: 6px; letter-spacing: 0.5px; }

        /* Hero demo card */
        .kykie-lp .demo { background: #1E293B; border: 1px solid #334155; border-radius: 14px; padding: 16px; position: relative; }
        .kykie-lp .demo .live-pill { position: absolute; top: 12px; right: 12px; background: #10B981; color: #0B0F1A; font-size: 9px; font-weight: 900; padding: 3px 7px; border-radius: 4px; letter-spacing: 1px; }
        .kykie-lp .demo .meta { font-size: 10px; color: #64748B; text-align: center; letter-spacing: 1px; margin: 4px 0 10px; text-transform: uppercase; font-weight: 700; }
        .kykie-lp .demo .score-row { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 12px; }
        .kykie-lp .demo .badge { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #fff; font-size: 12px; }
        .kykie-lp .demo .score-num { font-size: 28px; font-weight: 900; color: #F8FAFC; letter-spacing: 2px; }
        .kykie-lp .demo .poss-lbl { display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin: 8px 0 6px; }
        .kykie-lp .demo .poss-bar { height: 7px; border-radius: 3px; display: flex; overflow: hidden; background: #0B0F1A; margin-bottom: 10px; }
        .kykie-lp .demo .feed { background: #0B0F1A; border-radius: 6px; padding: 7px 10px; font-size: 11px; color: #CBD5E1; display: flex; align-items: center; gap: 8px; }
        .kykie-lp .demo .feed .dot { width: 6px; height: 6px; border-radius: 50%; background: #F59E0B; flex-shrink: 0; }
        .kykie-lp .demo .feed .t { color: #94A3B8; font-weight: 700; }

        /* Stats grid */
        .kykie-lp .stats-head { font-size: 11px; color: #94A3B8; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; text-align: center; margin-bottom: 14px; }
        .kykie-lp .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .kykie-lp .stat-c { background: #1E293B; border: 1px solid #334155; border-radius: 10px; padding: 14px 8px; text-align: center; cursor: pointer; }
        .kykie-lp .stat-c .n { font-size: 22px; font-weight: 900; line-height: 1; }
        .kykie-lp .stat-c .l { font-size: 10px; color: #94A3B8; font-weight: 600; margin-top: 6px; }

        /* Report card preview */
        .kykie-lp .rep { background: #1E293B; border: 1px solid #334155; border-radius: 14px; padding: 16px; }
        .kykie-lp .rep .h { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #94A3B8; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .kykie-lp .rep .h::before { content: ''; width: 12px; height: 2px; background: #F59E0B; display: inline-block; }
        .kykie-lp .dnaTeam { margin-bottom: 12px; }
        .kykie-lp .dnaName { font-size: 12px; font-weight: 800; color: #F8FAFC; margin-bottom: 6px; display: flex; align-items: center; gap: 7px; }
        .kykie-lp .dnaName .sw { width: 10px; height: 10px; border-radius: 2px; }
        .kykie-lp .dnaRow { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px; }
        .kykie-lp .dnaRow .lab { width: 50px; color: #64748B; font-weight: 600; text-align: right; }
        .kykie-lp .dnaRow .trk { flex: 1; height: 7px; background: #0B0F1A; border-radius: 4px; overflow: hidden; }
        .kykie-lp .dnaRow .fil { height: 100%; border-radius: 4px; }
        .kykie-lp .dnaRow .v { width: 32px; font-weight: 800; color: #F8FAFC; }
        .kykie-lp .insightBox { background: #0B0F1A; border-left: 3px solid #10B981; padding: 10px 12px; margin-top: 12px; border-radius: 0 6px 6px 0; }
        .kykie-lp .insightBox .it { font-size: 12px; font-weight: 900; color: #F8FAFC; margin-bottom: 4px; }
        .kykie-lp .insightBox .ix { font-size: 11px; color: #94A3B8; line-height: 1.5; }
        .kykie-lp .insightBox .ix b { color: #10B981; font-weight: 800; }

        /* Live Pro mock */
        .kykie-lp .lp { background: #0B0F1A; border: 1px solid #334155; border-radius: 12px; padding: 10px 8px; }
        .kykie-lp .lp .sb { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 4px 6px; }
        .kykie-lp .lp .sb .t { flex: 1; text-align: center; }
        .kykie-lp .lp .sb .nm { font-size: 10px; font-weight: 900; display: inline-flex; gap: 5px; align-items: center; }
        .kykie-lp .lp .sb .nm .sq { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
        .kykie-lp .lp .sb .t.h .nm { color: #3B82F6; }
        .kykie-lp .lp .sb .t.a .nm { color: #F87171; }
        .kykie-lp .lp .sb .sc { font-size: 24px; font-weight: 900; color: #fff; line-height: 1; margin-top: 4px; }
        .kykie-lp .lp .sb .ct { flex: 1; text-align: center; }
        .kykie-lp .lp .sb .ct .tm { font-size: 16px; font-weight: 900; color: #F59E0B; letter-spacing: 1px; line-height: 1; }
        .kykie-lp .lp .sb .ct .lv { font-size: 8px; color: #10B981; font-weight: 800; background: rgba(16,185,129,0.1); padding: 2px 7px; border-radius: 8px; display: inline-block; margin-top: 5px; letter-spacing: 0.5px; }
        .kykie-lp .lp .poss { text-align: center; font-size: 10px; color: #F87171; font-weight: 700; padding: 3px 0 8px; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .kykie-lp .lp .poss .dot { width: 5px; height: 5px; border-radius: 50%; background: #F87171; }
        .kykie-lp .lp .strip { display: flex; align-items: center; padding: 4px 4px; gap: 3px; }
        .kykie-lp .lp .strip.top { background: linear-gradient(180deg, #991b1b, #7f1d1d); border-radius: 4px 4px 0 0; }
        .kykie-lp .lp .strip.bot { background: linear-gradient(0deg, #1e40af, #1d4ed8); border-radius: 0 0 4px 4px; }
        .kykie-lp .lp .strip .ctrl { background: rgba(0,0,0,0.35); padding: 3px 5px; border-radius: 3px; color: #fff; font-size: 8px; font-weight: 800; }
        .kykie-lp .lp .strip .nm { flex: 1; text-align: center; color: #fff; font-size: 10px; line-height: 1.05; font-weight: 900; letter-spacing: 0.4px; }
        .kykie-lp .lp .strip .nm small { display: block; font-size: 6px; opacity: 0.75; font-weight: 700; letter-spacing: 0.5px; }
        .kykie-lp .lp .ctrls { display: flex; gap: 5px; justify-content: center; padding: 10px 0 2px; }
        .kykie-lp .lp .ctrls button { font-family: inherit; padding: 6px 12px; border-radius: 16px; font-size: 10px; font-weight: 800; border: none; display: flex; align-items: center; gap: 4px; cursor: default; }
        .kykie-lp .lp .ctrls .pause { background: #F59E0B; color: #0B0F1A; }
        .kykie-lp .lp .ctrls .end { background: #DC2626; color: #fff; }
        .kykie-lp .lp .ctrls .undo { background: #334155; color: #CBD5E1; }

        /* Benchmark */
        .kykie-lp .bm { background: #1E293B; border: 1px solid #334155; border-radius: 12px; padding: 14px; }
        .kykie-lp .bm-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; color: #F8FAFC; font-weight: 700; }
        .kykie-lp .bm-leg { display: flex; gap: 8px; font-size: 9px; color: #94A3B8; align-items: center; }
        .kykie-lp .bm-leg .it { display: inline-flex; align-items: center; gap: 3px; }
        .kykie-lp .bm-leg .dash { display: inline-block; width: 10px; height: 2px; background: #8B5CF6; }
        .kykie-lp .bm-leg .solid { display: inline-block; width: 10px; height: 2px; background: #64748B; }
        .kykie-lp .bm-leg .da { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #F59E0B; }

        /* Get involved */
        .kykie-lp .gi-card { background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.3); border-radius: 14px; padding: 22px 18px; }
        .kykie-lp .gi-title { font-size: 22px; font-weight: 900; color: #10B981; margin-bottom: 8px; }
        .kykie-lp .gi-sub { font-size: 12px; color: #94A3B8; margin-bottom: 16px; line-height: 1.5; }
        .kykie-lp .gi-roles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .kykie-lp .gi-role { background: #1E293B; border: 1px solid #334155; border-radius: 10px; padding: 16px 8px; text-align: center; cursor: pointer; }
        .kykie-lp .gi-role .ic { display: block; margin-bottom: 6px; }
        .kykie-lp .gi-role .nm { font-size: 13px; font-weight: 900; color: #F8FAFC; }
        .kykie-lp .gi-role .sub { font-size: 10px; color: #94A3B8; font-weight: 600; margin-top: 2px; }

        /* Live now banner */
        .kykie-lp .live-now { margin: 12px 16px 0; background: #EF444422; border: 1px solid #EF444444; border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .kykie-lp .live-now .dot { width: 10px; height: 10px; border-radius: 5px; background: #EF4444; flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      {/* HERO */}
      <section className="sec split" style={{ borderTop: 'none', paddingTop: 20 }}>
        <div className="tc">
          <div className="eyebrow g">Season 2026</div>
          <h1>Live school hockey. <span className="a">Intelligence in your pocket.</span></h1>
          <p className="lede">Match reports, season trends, and live recording. Built for coaches, supporters, and sports directors.</p>
          {!currentUser && (
            <a className="btn-am" href="#/register">Start free →</a>
          )}
        </div>
        <div className="demo">
          <div className="live-pill">● LIVE</div>
          <div className="meta">Girls 1st XI · Q3 · 42:18</div>
          <div className="score-row">
            <div className="badge" style={{ background: '#1d4ed8' }}>OC</div>
            <div className="score-num">2–1</div>
            <div className="badge" style={{ background: '#dc2626' }}>MH</div>
          </div>
          <div className="poss-lbl">
            <span style={{ color: '#3B82F6' }}>Oaktree 58%</span>
            <span style={{ color: '#94A3B8' }}>POSS</span>
            <span style={{ color: '#F87171' }}>42% Meadows</span>
          </div>
          <div className="poss-bar">
            <div style={{ width: '58%', background: '#1d4ed8' }} />
            <div style={{ width: '42%', background: '#dc2626' }} />
          </div>
          <div className="feed">
            <span className="dot" /><span className="t">42:14</span><span>D Entry · opp left</span>
          </div>
        </div>
      </section>

      {/* LIVE NOW PULSE (real live matches) */}
      {liveMatches && liveMatches.length > 0 && (
        <div className="live-now" onClick={() => onNavigate('scores')}>
          <div className="dot" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444' }}>
              {liveMatches.length} match{liveMatches.length !== 1 ? 'es' : ''} live now
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              {liveMatches.slice(0, 2).map(m => `${teamShortName(m.home_team)} vs ${teamShortName(m.away_team)}`).join(' | ')}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 700 }}>Watch &gt;</div>
        </div>
      )}

      {/* STATS GRID */}
      <section className="sec">
        <div className="stats-head">By the numbers</div>
        <div className="stats-grid">
          {[
            { val: stats?.matches, label: 'Matches', color: '#F59E0B', onClick: () => onNavigate('scores') },
            { val: stats?.teams, label: 'Teams', color: '#10B981', onClick: () => onNavigate('teams') },
            { val: stats?.viewers, label: 'Viewers', color: '#3B82F6', onClick: () => { window.location.hash = '#/supporters'; } },
            { val: stats?.goals, label: 'Goals', color: '#F87171', onClick: () => { window.location.hash = '#/stats-overview'; } },
            { val: stats?.events, label: 'Stats collected', color: '#A78BFA', onClick: () => { window.location.hash = '#/stats-overview'; } },
            { val: (stats?.analysed || 0) + 100, label: 'Matches analysed', color: '#6EE7B7', onClick: () => { window.location.hash = '#/stats-overview'; } },
          ].map(s => (
            <div key={s.label} className="stat-c" onClick={s.onClick}>
              <div className="n" style={{ color: s.color }}>{!stats ? '—' : fmtNum(s.val || 0)}</div>
              <div className="l">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* MATCH REPORTS */}
      <section className="sec split">
        <div className="tc">
          <div className="eyebrow">After the whistle</div>
          <h3>The story in the numbers</h3>
          <p className="lede">Full tactical breakdown — ball movement, what worked, what fell short. Ready before you leave the field.</p>
          <blockquote className="quote">
            <div className="qtext">"The match reports are a game changer, because we can now measure ourselves."</div>
            <div className="qattr">— Coach</div>
          </blockquote>
        </div>
        <div className="rep">
          <div className="h">Ball movement DNA</div>
          <div className="dnaTeam">
            <div className="dnaName"><span className="sw" style={{ background: '#1d4ed8' }} />Oaktree College</div>
            <div className="dnaRow"><span className="lab">Forward</span><div className="trk"><div className="fil" style={{ width: '60%', background: '#10B981' }} /></div><span className="v">60%</span></div>
            <div className="dnaRow"><span className="lab">Across</span><div className="trk"><div className="fil" style={{ width: '25%', background: '#F59E0B' }} /></div><span className="v">25%</span></div>
            <div className="dnaRow"><span className="lab">Back</span><div className="trk"><div className="fil" style={{ width: '15%', background: '#F87171' }} /></div><span className="v">15%</span></div>
          </div>
          <div className="dnaTeam">
            <div className="dnaName"><span className="sw" style={{ background: '#dc2626' }} />Meadows High</div>
            <div className="dnaRow"><span className="lab">Forward</span><div className="trk"><div className="fil" style={{ width: '45%', background: '#10B981' }} /></div><span className="v">45%</span></div>
            <div className="dnaRow"><span className="lab">Across</span><div className="trk"><div className="fil" style={{ width: '30%', background: '#F59E0B' }} /></div><span className="v">30%</span></div>
            <div className="dnaRow"><span className="lab">Back</span><div className="trk"><div className="fil" style={{ width: '25%', background: '#F87171' }} /></div><span className="v">25%</span></div>
          </div>
          <div className="insightBox">
            <div className="it">Wing pressure paid off</div>
            <div className="ix">Oaktree drove <b>73%</b> of D-entries through wide channels. Meadows' inside channel collapsed under repeated overlaps.</div>
          </div>
        </div>
      </section>

      {/* LIVE PRO */}
      <section className="sec split flip">
        <div className="tc">
          <div className="eyebrow">Sideline recording</div>
          <h3>Live Pro, no app install</h3>
          <p className="lede">Tap the field where the action happens. Tap the team strip for set pieces. Any player or student manager with a phone can record.</p>
          <blockquote className="quote">
            <div className="qtext">"I just love recording matches to produce insights for the team."</div>
            <div className="qattr">— Isabelle, Grade 10</div>
          </blockquote>
          <blockquote className="quote">
            <div className="qtext">"Now I can follow matches on my phone, even if I'm stuck in meetings!"</div>
            <div className="qattr">— Henri, Parent</div>
          </blockquote>
        </div>
        <div className="lp">
          <div className="sb">
            <div className="t h">
              <div className="nm"><span className="sq" style={{ background: '#3B82F6' }} />OAKTREE</div>
              <div className="sc">0</div>
            </div>
            <div className="ct">
              <div className="tm">00:15</div>
              <div className="lv">● LIVE</div>
            </div>
            <div className="t a">
              <div className="nm">MEADOWS<span className="sq" style={{ background: '#F87171' }} /></div>
              <div className="sc">0</div>
            </div>
          </div>
          <div className="poss">
            <span className="dot" />Meadows: In Possession
          </div>
          <div className="strip top">
            <span className="ctrl">DEAD</span>
            <span className="ctrl">◂LC</span>
            <span className="nm">MEADOWS HIGH<small>HOCKEY 1ST</small></span>
            <span className="ctrl">LC▸</span>
            <span className="ctrl">DEAD</span>
          </div>
          <svg viewBox="0 0 100 80" style={{ display: 'block', width: '100%', background: '#14532d' }}>
            <rect x="0" y="0" width="33.3" height="20" fill="#16a34a" opacity="0.08" />
            <rect x="66.7" y="0" width="33.3" height="20" fill="#16a34a" opacity="0.08" />
            <rect x="33.3" y="20" width="33.4" height="20" fill="#16a34a" opacity="0.08" />
            <rect x="0" y="40" width="33.3" height="20" fill="#16a34a" opacity="0.08" />
            <rect x="66.7" y="40" width="33.3" height="20" fill="#16a34a" opacity="0.08" />
            <rect x="33.3" y="60" width="33.4" height="20" fill="#16a34a" opacity="0.08" />
            <path d="M 35 0 L 65 0 A 15 15 0 0 1 35 0 Z" fill="#B91C1C" fillOpacity="0.55" stroke="#FCA5A5" strokeWidth="1.3" />
            <path d="M 35 80 L 65 80 A 15 15 0 0 0 35 80 Z" fill="#1E40AF" fillOpacity="0.6" stroke="#93C5FD" strokeWidth="1.3" />
            <line x1="33.3" y1="0" x2="33.3" y2="80" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.3" />
            <line x1="66.7" y1="0" x2="66.7" y2="80" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.3" />
            <line x1="0" y1="20" x2="100" y2="20" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.28" />
            <line x1="0" y1="40" x2="100" y2="40" stroke="#fff" strokeWidth="0.55" strokeOpacity="0.4" />
            <line x1="0" y1="60" x2="100" y2="60" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.28" />
            <circle cx="50" cy="40" r="1" fill="#fff" opacity="0.55" />
            <line x1="50" y1="40" x2="16" y2="28" stroke="#fff" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
            <circle cx="50" cy="40" r="2.5" fill="#94A3B8" opacity="0.7" />
            <circle cx="16" cy="28" r="7" fill="#F59E0B" opacity="0.18" />
            <circle cx="16" cy="28" r="4" fill="#F59E0B" opacity="0.5" />
            <circle cx="16" cy="28" r="2.8" fill="#fff" />
          </svg>
          <div className="strip bot">
            <span className="ctrl">DEAD</span>
            <span className="ctrl">◂LC</span>
            <span className="nm">OAKTREE COLLEGE<small>HOCKEY 1ST</small></span>
            <span className="ctrl">LC▸</span>
            <span className="ctrl">DEAD</span>
          </div>
          <div className="ctrls">
            <button className="pause">⏸ Pause</button>
            <button className="end">■ End</button>
            <button className="undo">↶ Undo</button>
          </div>
        </div>
      </section>

      {/* BENCHMARK */}
      <section className="sec split">
        <div className="tc">
          <div className="eyebrow">Benchmark mode</div>
          <h3>Measured against the top 10</h3>
          <p className="lede">Every stat sits next to the TOP 10 schools' season average and your own season average. Know exactly where you stand and what to work on.</p>
        </div>
        <div className="bm">
          <div className="bm-h">
            <span>D-Entries per match</span>
            <div className="bm-leg">
              <span className="it"><span className="dash" />T10</span>
              <span className="it"><span className="solid" />avg</span>
              <span className="it"><span className="da" />latest</span>
            </div>
          </div>
          <svg viewBox="0 0 300 110" style={{ width: '100%', display: 'block' }}>
            <text x="2" y="14" fontSize="6" fill="#64748B" fontWeight="600">20</text>
            <text x="2" y="40" fontSize="6" fill="#64748B" fontWeight="600">15</text>
            <text x="2" y="66" fontSize="6" fill="#64748B" fontWeight="600">10</text>
            <text x="2" y="92" fontSize="6" fill="#64748B" fontWeight="600">5</text>
            <line x1="14" y1="12" x2="290" y2="12" stroke="#334155" strokeWidth="0.4" strokeOpacity="0.6" />
            <line x1="14" y1="38" x2="290" y2="38" stroke="#334155" strokeWidth="0.4" strokeOpacity="0.6" />
            <line x1="14" y1="64" x2="290" y2="64" stroke="#334155" strokeWidth="0.4" strokeOpacity="0.6" />
            <line x1="14" y1="90" x2="290" y2="90" stroke="#334155" strokeWidth="0.4" strokeOpacity="0.6" />
            <line x1="14" y1="36" x2="270" y2="36" stroke="#8B5CF6" strokeWidth="1.3" strokeDasharray="4 3" opacity="0.75" />
            <line x1="14" y1="52" x2="270" y2="52" stroke="#64748B" strokeWidth="1" strokeOpacity="0.5" />
            <polyline points="30,71 70,65 110,49 150,60 190,44 230,33 270,28" fill="none" stroke="#10B981" strokeWidth="6" strokeOpacity="0.22" strokeLinejoin="round" strokeLinecap="round" />
            <polyline points="30,71 70,65 110,49 150,60 190,44 230,33 270,28" fill="none" stroke="#10B981" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx="30" cy="71" r="2.5" fill="#10B981" />
            <circle cx="70" cy="65" r="2.5" fill="#10B981" />
            <circle cx="110" cy="49" r="2.5" fill="#10B981" />
            <circle cx="150" cy="60" r="2.5" fill="#10B981" />
            <circle cx="190" cy="44" r="2.5" fill="#10B981" />
            <circle cx="230" cy="33" r="2.5" fill="#10B981" />
            <circle cx="270" cy="28" r="3.8" fill="#F59E0B" />
            <text x="270" y="20" fontSize="7" fill="#F59E0B" textAnchor="middle" fontWeight="900">17</text>
            <text x="30" y="105" fontSize="6" fill="#64748B" textAnchor="middle" fontWeight="700">ELM</text>
            <text x="70" y="105" fontSize="6" fill="#64748B" textAnchor="middle" fontWeight="700">WIL</text>
            <text x="110" y="105" fontSize="6" fill="#64748B" textAnchor="middle" fontWeight="700">STO</text>
            <text x="150" y="105" fontSize="6" fill="#64748B" textAnchor="middle" fontWeight="700">ASH</text>
            <text x="190" y="105" fontSize="6" fill="#64748B" textAnchor="middle" fontWeight="700">BIR</text>
            <text x="230" y="105" fontSize="6" fill="#64748B" textAnchor="middle" fontWeight="700">CED</text>
            <text x="270" y="105" fontSize="6" fill="#F59E0B" textAnchor="middle" fontWeight="900">MEA</text>
            <text x="288" y="34" fontSize="6" fill="#8B5CF6" textAnchor="end" fontWeight="800">T10 15.5</text>
            <text x="288" y="50" fontSize="6" fill="#64748B" textAnchor="end" fontWeight="700">avg 12.5</text>
          </svg>
        </div>
      </section>

      {/* AI SCOUT */}
      {featuredTeam && (() => {
        const ft = featuredTeam;
        const c = teamColor(ft.team) || '#64748B';
        const initials = teamDisplayName(ft.team)?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return (
          <section className="sec">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'linear-gradient(135deg, #F59E0B, #F97316)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0B0F1A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
                </svg>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>Kykie AI Scout</div>
            </div>
            <div onClick={() => { window.location.hash = `#/team/${teamSlug(ft.team)}`; }}
              style={{ background: '#1E293B', borderRadius: 14, border: '1px solid #334155', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ height: 3, background: `linear-gradient(90deg, ${c}, ${c}66)` }} />
              <div style={{ padding: '14px 16px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC' }}>{teamDisplayName(ft.team)}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginTop: 1 }}>{ft.record} · GD {ft.gd} · {ft.wr}% win rate</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.65, marginBottom: 10 }}>{ft.summary}</div>
                {ft.traits.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {ft.traits.map(tr => (
                      <span key={tr.label} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 10, background: tr.color + '18', color: tr.color, fontWeight: 700, border: `1px solid ${tr.color}33` }}>{tr.label}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      {/* GET INVOLVED */}
      {!currentUser && (
        <section className="sec">
          <div className="gi-card">
            <div className="gi-title">Get involved</div>
            <div className="gi-sub">Follow your school, commentate live matches, or coach with data-driven insights.</div>
            <div className="gi-roles">
              <div className="gi-role" onClick={goRoleInfo('supporter')}>
                <span className="ic">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                </span>
                <div className="nm">Follow</div>
                <div className="sub">Supporter</div>
              </div>
              <div className="gi-role" onClick={goRoleInfo('commentator')}>
                <span className="ic">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
                </span>
                <div className="nm">Commentate</div>
                <div className="sub">Earn vouchers</div>
              </div>
              <div className="gi-role" onClick={goRoleInfo('coach')}>
                <span className="ic">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="14" rx="2" /><polyline points="7 14 11 10 14 13 17 9" /></svg>
                </span>
                <div className="nm">Coach</div>
                <div className="sub">Team analytics</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* WELCOME BACK (logged-in non-admin) */}
      {currentUser && !isAdmin && (() => {
        const role = currentUser.role;
        const isComm = ['admin', 'commentator'].includes(role);
        const isApprentice = currentUser.commentator_status === 'apprentice';
        const goAdmin = (scr) => { window.location.hash = scr ? `#/admin/${scr}` : '#/admin'; };
        const Btn = ({ icon, label, color, bg, border, onClick }) => (
          <div onClick={onClick} style={{ flex: 1, padding: 8, borderRadius: 8, background: bg || '#0B0F1A', border: border || '1px solid #33415566', textAlign: 'center', cursor: 'pointer', minWidth: 70 }}>
            <div style={{ fontSize: 16 }}>{icon}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: color || '#94A3B8', marginTop: 2 }}>{label}</div>
          </div>
        );
        return (
          <section className="sec">
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
                <Btn icon="📝" label="Submit" onClick={() => { window.location.hash = '#/submit?mode=result'; }} />
              </div>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
