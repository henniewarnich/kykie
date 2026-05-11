import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../utils/supabase.js';
import { APP_VERSION } from '../utils/constants.js';
import { ensureContrastingColors, parseSAST, parseSASTDate, matchOutcome, matchWinner } from '../utils/helpers.js';
import { computeMatchStats, statsFromArchive, aggregateStats } from '../utils/stats.js';
import { getSession, getProfile, isCoachForTeam, signOut } from '../utils/auth.js';
import { fetchLatestRankings } from '../utils/sync.js';
import { useReactions } from '../hooks/useReactions.js';
import ReactionBar from '../components/ReactionBar.jsx';
import MatchCardTeams from '../components/MatchCardTeams.jsx';
import RankBadge from '../components/RankBadge.jsx';
import CoachLiveScreen from './CoachLiveScreen.jsx';
import CoachOverall from '../components/CoachOverall.jsx';
import CoachTrends from '../components/CoachTrends.jsx';
import PlayPatternField from '../components/PlayPatternField.jsx';
import { analysePlayPatterns, getProminentZones, getBallLossZones } from '../utils/playPattern.js';
import SponsorBanner from '../components/SponsorBanner.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { predictMatch } from '../utils/predict.js';
import { MATCH_AWAY_TEAM, MATCH_HOME_TEAM, TEAM_SELECT, teamColor, teamDerivedName, teamDisplayName, teamInitial, teamShortName, teamSlug as makeTeamSlug } from '../utils/teams.js';
import KykieSpinner from '../components/KykieSpinner.jsx';
import { shareMatchLink } from '../utils/share.js';
import Icon from '../components/Icons.jsx';

const fmtClock = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
const fmtMin = (s) => `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}`;

// Compute per-match GF/GA/GD averages for a team from a list of matches
const seasonAvgForTeam = (teamId, matchList) => {
  const ended = (matchList || []).filter(m => m.status === 'ended');
  if (ended.length === 0) return null;
  let gf = 0, ga = 0, n = 0;
  ended.forEach(m => {
    const isHome = m.home_team_id === teamId || m.home_team?.id === teamId;
    const isAway = m.away_team_id === teamId || m.away_team?.id === teamId;
    if (!isHome && !isAway) return; // skip matches this team didn't play in
    gf += isHome ? (m.home_score || 0) : (m.away_score || 0);
    ga += isHome ? (m.away_score || 0) : (m.home_score || 0);
    n++;
  });
  if (n === 0) return null;
  return { gf: gf / n, ga: ga / n, gd: (gf - ga) / n, n };
};

// Public-visible event types
const PUBLIC_EVENTS = [
  "Start", "Goal!", "Goal! (SC)", "Short Corner", "Penalty",
  "Green Card", "Yellow Card", "Penalty Stroke",
  "D Entry", "Shot on Goal", "Shot Off Target", "Dead Ball", "Long Corner", "Lost Possession",
];
const COMMENTARY_TYPES = ["commentary", "meta"];

function classifyEvent(e) {
  if (e.event === "Penalty Kick") return e.detail === "Goal" ? "pen_goal" : "pen_miss";
  if (e.event === "Shootout Start" || e.event === "Shootout End") return "shootout_marker";
  if (e.event?.startsWith("Goal")) return "goal";
  if (["Short Corner", "Long Corner", "Penalty"].includes(e.event)) return "set_piece";
  if (e.event?.includes("Card")) return "card";
  if (e.team === "meta" && e.event?.includes("Pause")) return "pause";
  if (e.team === "meta" && e.event === "Resume") return "resume";
  if (e.team === "meta") return "info";
  if (e.team === "commentary") return "narrative";
  if (e.event === "Start") return "start";
  return "other";
}

function eventIcon(type) {
  switch (type) {
    case "goal": return "⚽";
    case "pen_goal": return "⚽";
    case "pen_miss": return "✗";
    case "shootout_marker": return "🥅";
    case "set_piece": return "🏑";
    case "card": return "🟨";
    case "pause": return "⏸";
    case "resume": return "▶";
    case "start": return "▶";
    case "info": return "ℹ";
    case "narrative": return "💬";
    default: return "·";
  }
}

function eventColor(type) {
  switch (type) {
    case "goal": return "#F59E0B";
    case "pen_goal": return "#10B981";
    case "pen_miss": return "#EF4444";
    case "shootout_marker": return "#8B5CF6";
    case "set_piece": return "#8B5CF6";
    case "card": return "#EF4444";
    case "pause": return "#F59E0B";
    case "start": return "#10B981";
    case "info": return "#F59E0B";
    case "narrative": return "#94A3B8";
    default: return "#64748B";
  }
}

// Compute stats from events — with zone breakdowns
function computeStats(events, team) {
  const real = events.filter(e => e.team === team);
  const all = events.filter(e => !COMMENTARY_TYPES.includes(e.team));
  const cnt = (ev) => real.filter(e => e.event === ev).length;
  const cntS = (ev) => real.filter(e => e.event?.startsWith(ev)).length;
  const total = all.length || 1;

  // Zone helpers — zones contain "Own Quarter", "Opp Quarter", "Midfield", etc.
  const zoneOf = (e) => {
    const z = (e.zone || "").toLowerCase();
    if (z.includes("opp") || z.includes("d") && !z.includes("mid")) return "attack";
    if (z.includes("own")) return "defence";
    return "midfield";
  };
  const cntZone = (ev, zone) => real.filter(e => e.event === ev && zoneOf(e) === zone).length;

  const terrReal = real.filter(e => !COMMENTARY_TYPES.includes(e.team)).length;
  const terrAll = all.length || 1;

  // Zone-based territory — count events per zone
  const atkEvents = real.filter(e => zoneOf(e) === "attack").length;
  const midEvents = real.filter(e => zoneOf(e) === "midfield").length;
  const defEvents = real.filter(e => zoneOf(e) === "defence").length;
  const zoneTotal = atkEvents + midEvents + defEvents || 1;

  return {
    goals: cntS("Goal!"), dEntries: cnt("D Entry"), shotsOn: cnt("Shot on Goal"),
    shotsOff: cnt("Shot Off Target"), shortCorners: cnt("Short Corner"),
    longCorners: cnt("Long Corner"),
    turnoversWon: cnt("Turnover Won"),
    turnoversWonAtk: cntZone("Turnover Won", "attack"),
    turnoversWonMid: cntZone("Turnover Won", "midfield"),
    turnoversWonDef: cntZone("Turnover Won", "defence"),
    possLost: cnt("Poss Conceded") + real.filter(e => e.event?.startsWith("Sideline Out")).length,
    possLostAtk: cntZone("Poss Conceded", "attack") + real.filter(e => e.event?.startsWith("Sideline Out") && zoneOf(e) === "attack").length,
    possLostMid: cntZone("Poss Conceded", "midfield") + real.filter(e => e.event?.startsWith("Sideline Out") && zoneOf(e) === "midfield").length,
    possLostDef: cntZone("Poss Conceded", "defence") + real.filter(e => e.event?.startsWith("Sideline Out") && zoneOf(e) === "defence").length,
    territory: Math.round(terrReal / terrAll * 100),
    terrAtk: Math.round(atkEvents / zoneTotal * 100),
    terrMid: Math.round(midEvents / zoneTotal * 100),
    terrDef: Math.round(defEvents / zoneTotal * 100),
  };
}

const STATS_DEF = [
  { key: "dEntries", label: "D Entries" }, { key: "shotsOn", label: "Shots On" },
  { key: "shotsOff", label: "Shots Off" }, { key: "shortCorners", label: "Short Corners" },
];
const INVERTED = ["possLost", "shotsOff"];

// Zone breakdown row
const ZoneRow = ({ hAtk, hMid, hDef, hTotal, label, aAtk, aMid, aDef, aTotal, hColor, aColor, inverted }) => {
  const hWins = inverted ? hTotal < aTotal : hTotal > aTotal;
  const aWins = inverted ? aTotal < hTotal : aTotal > hTotal;
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid #0F172A" }}>
      {/* Total row */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 40, textAlign: "right", fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: hWins ? hColor : hTotal === aTotal ? "#94A3B8" : "#64748B" }}>{hTotal}</div>
        <div style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: 600, color: "#94A3B8", padding: "0 6px" }}>{label}</div>
        <div style={{ width: 40, textAlign: "left", fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: aWins ? aColor : aTotal === hTotal ? "#94A3B8" : "#64748B" }}>{aTotal}</div>
      </div>
      {/* Zone breakdown row */}
      <div style={{ display: "flex", alignItems: "center", marginTop: 4, padding: "4px 0", background: "#0F172A", borderRadius: 4 }}>
        <div style={{ width: 40, textAlign: "right", fontSize: 11, fontFamily: "monospace", color: "#CBD5E1", fontWeight: 600, paddingRight: 4 }}>{hAtk}</div>
        <div style={{ width: 40, textAlign: "right", fontSize: 11, fontFamily: "monospace", color: "#94A3B8", fontWeight: 600, paddingRight: 4 }}>{hMid}</div>
        <div style={{ width: 40, textAlign: "right", fontSize: 11, fontFamily: "monospace", color: "#64748B", fontWeight: 600 }}>{hDef}</div>
        <div style={{ flex: 1, textAlign: "center", fontSize: 9, color: "#64748B", fontWeight: 600 }}>atk · mid · def</div>
        <div style={{ width: 40, textAlign: "left", fontSize: 11, fontFamily: "monospace", color: "#CBD5E1", fontWeight: 600, paddingLeft: 4 }}>{aAtk}</div>
        <div style={{ width: 40, textAlign: "left", fontSize: 11, fontFamily: "monospace", color: "#94A3B8", fontWeight: 600, paddingLeft: 4 }}>{aMid}</div>
        <div style={{ width: 40, textAlign: "left", fontSize: 11, fontFamily: "monospace", color: "#64748B", fontWeight: 600 }}>{aDef}</div>
      </div>
    </div>
  );
};

const StatRow = ({ hVal, label, aVal, hColor, aColor, inverted }) => {
  const hWins = inverted ? hVal < aVal : hVal > aVal;
  const aWins = inverted ? aVal < hVal : aVal > hVal;
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #0F172A" }}>
      <div style={{ width: 40, textAlign: "right", fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: hWins ? hColor : hVal === aVal ? "#94A3B8" : "#64748B" }}>{hVal}</div>
      <div style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: 600, color: "#94A3B8", padding: "0 6px" }}>{label}</div>
      <div style={{ width: 40, textAlign: "left", fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: aWins ? aColor : aVal === hVal ? "#94A3B8" : "#64748B" }}>{aVal}</div>
    </div>
  );
};

export default function TeamPage({ teamSlug, initialMatchId, onBack, currentUser: appUser }) {
  const [team, setTeam] = useState(null);
  const [matches, setMatches] = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [liveMatch, setLiveMatch] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCoach, setIsCoach] = useState(false);
  const [coachProfile, setCoachProfile] = useState(null);
  const [tab, setTab] = useState("results");
  const [liveView, setLiveView] = useState("totals");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [shareToast, setShareToast] = useState(null);

  const handleShareMatch = async (m) => {
    if (!m?.id) return;
    const home = teamShortName(m.home_team) || 'Home';
    const away = teamShortName(m.away_team) || 'Away';
    const res = await shareMatchLink(m.id, { title: `${home} vs ${away}`, text: `${home} vs ${away} on Kykie` });
    if (res.ok && res.method === 'clipboard') { setShareToast('Link copied'); setTimeout(() => setShareToast(null), 2500); }
    else if (!res.ok && res.error && res.error !== 'cancelled') { setShareToast(`Share failed: ${res.error}`); setTimeout(() => setShareToast(null), 3000); }
  };
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [oppSeasonAvg, setOppSeasonAvg] = useState(null);
  const [matchReportIds, setMatchReportIds] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [matchViewers, setMatchViewers] = useState(0);
  const [totalViewers, setTotalViewers] = useState(null); // for historical match detail
  const [matchStatsMap, setMatchStatsMap] = useState({}); // matchId -> {team, opp}
  const [top10Agg, setTop10Agg] = useState(null); // aggregated stats for top 10 ranked teams
  const [top10PM, setTop10PM] = useState(null); // top 10 per-match averages from ALL matches
  const [teamTier, setTeamTier] = useState('free');
  const [loadingStats, setLoadingStats] = useState(false);
  const [playPatterns, setPlayPatterns] = useState(null);
  const [prominentZones, setProminentZones] = useState(null);
  const [ballLossZones, setBallLossZones] = useState(null);
  const [rawEvents, setRawEvents] = useState({}); // matchId -> [events]
  const [latestRankings, setLatestRankings] = useState({});
  const [oppRecords, setOppRecords] = useState({}); // teamId -> {p,w,d,l,gf,ga}
  const [matchPredictions, setMatchPredictions] = useState(null);
  const [matchDetailRecords, setMatchDetailRecords] = useState({}); // teamId -> {p,w,d,l,gf,ga} for selected match detail

  // Fetch opposition records for upcoming matches + own team
  useEffect(() => {
    if (!team) return;
    const oppIds = [...new Set(upcomingMatches.map(m =>
      m.home_team_id === team.id ? m.away_team_id : m.home_team_id
    ).filter(Boolean))];
    // Always include own team
    const allIds = [...new Set([team.id, ...oppIds])];
    if (allIds.length === 0) return;
    supabase.from('matches')
      .select('home_team_id, away_team_id, home_score, away_score, match_type, home_penalty_score, away_penalty_score')
      .eq('status', 'ended')
      .or(allIds.map(id => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(','))
      .then(({ data }) => {
        const recs = {};
        (data || []).forEach(m => {
          allIds.forEach(id => {
            if (m.home_team_id !== id && m.away_team_id !== id) return;
            if (!recs[id]) recs[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
            const isHome = m.home_team_id === id;
            const my = isHome ? m.home_score : m.away_score;
            const their = isHome ? m.away_score : m.home_score;
            recs[id].p++;
            recs[id].gf += my;
            recs[id].ga += their;
            const o = matchOutcome(m, id);
            if (o === 'W') recs[id].w++;
            else if (o === 'D') recs[id].d++;
            else recs[id].l++;
          });
        });
        setOppRecords(recs);
      });
  }, [team, upcomingMatches]);
  const { counts, myReactions, toggleReaction, loadReactions } = useReactions(liveMatch?.id || selectedMatch?.id);

  // Ensure contrasting team colors for live and selected matches
  const liveColors = useMemo(() => {
    if (!liveMatch) return { homeColor: null, awayColor: null };
    return ensureContrastingColors(teamColor(liveMatch.home_team), teamColor(liveMatch.away_team));
  }, [liveMatch?.home_team?.color, liveMatch?.away_team?.color]);

  const selectedColors = useMemo(() => {
    if (!selectedMatch) return { homeColor: null, awayColor: null };
    return ensureContrastingColors(teamColor(selectedMatch.home_team), teamColor(selectedMatch.away_team));
  }, [selectedMatch?.home_team?.color, selectedMatch?.away_team?.color]);

  // Per-match play pattern (for coach overlay on selected match)
  const selectedMatchVisuals = useMemo(() => {
    if (!selectedMatch || !isCoach || selectedEvents.length === 0) return null;
    if (!selectedEvents.some(e => e.zone)) return null; // not a Live Pro match
    try {
      const evtMap = { [selectedMatch.id]: selectedEvents };
      return {
        patterns: analysePlayPatterns([selectedMatch], evtMap, team?.id),
        zones: getProminentZones([selectedMatch], evtMap, team?.id),
        lossZones: getBallLossZones([selectedMatch], evtMap, team?.id),
      };
    } catch { return null; }
  }, [selectedMatch?.id, selectedEvents.length, isCoach, team?.id]);

  // Get or create anonymous viewer ID
  const getViewerId = () => {
    let id = sessionStorage.getItem('kykie-viewer-id');
    if (!id) {
      id = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('kykie-viewer-id', id);
    }
    return id;
  };

  // Track presence on live match
  useEffect(() => {
    if (!liveMatch) { setMatchViewers(0); return; }
    // Persist this viewer
    supabase.from('match_viewers')
      .upsert({ match_id: liveMatch.id, viewer_id: getViewerId() }, { onConflict: 'match_id,viewer_id' })
      .then(() => {});
    const channel = supabase.channel(`match-viewers-${liveMatch.id}`, { config: { presence: { key: Math.random().toString(36).slice(2) } } });
    channel.on('presence', { event: 'sync' }, () => {
      setMatchViewers(Object.keys(channel.presenceState()).length);
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ page: 'team', ts: Date.now() });
    });
    return () => { supabase.removeChannel(channel); };
  }, [liveMatch?.id]);

  // Load reactions when events change
  useEffect(() => {
    const ids = liveEvents.filter(e => e.id).map(e => e.id);
    if (ids.length > 0) loadReactions(ids);
  }, [liveEvents.length]);

  useEffect(() => {
    const ids = selectedEvents.filter(e => e.id).map(e => e.id);
    if (ids.length > 0) loadReactions(ids);
  }, [selectedEvents.length]);

  const refreshMatches = useCallback(async () => {
    if (!team) return;
    setRefreshing(true);
    try {
      const { data } = await supabase
        .from('matches')
        .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
        .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
        .order('match_date', { ascending: false });
      if (data) {
        const live = data.find(m => m.status === 'live');
        const ended = data.filter(m => m.status === 'ended');
        const upcoming = data.filter(m => m.status === 'upcoming').sort((a, b) => {
          const da = parseSAST(a.match_date, a.scheduled_time || '00:00');
          const db = parseSAST(b.match_date, b.scheduled_time || '00:00');
          return da - db;
        });
        setMatches(ended);
        setUpcomingMatches(upcoming);
        if (live) { setLiveMatch(live); setTab("live"); }
        else { setLiveMatch(null); }
      }
    } catch {}
    setRefreshing(false);
  }, [team]);

  const handleMatchTap = async (m) => {
    setSelectedMatch(m);
    setLoadingEvents(true);
    setTotalViewers(null);
    setMatchPredictions(null);
    try {
      const [{ data: events }, { count }, { data: preds }, { data: archived }] = await Promise.all([
        supabase.from('match_events').select('*').eq('match_id', m.id).order('seq', { ascending: false }),
        supabase.from('match_viewers').select('*', { count: 'exact', head: true }).eq('match_id', m.id),
        supabase.from('predictions').select('user_id, prediction, correct, home_win_pct, draw_pct, away_win_pct').eq('match_id', m.id),
        supabase.from('match_stats').select('*').eq('match_id', m.id),
      ]);
      setSelectedEvents(events || []);
      setTotalViewers(count || 0);
      // Compute stats for this match if not already in map (public users)
      if (!matchStatsMap[m.id] && team) {
        const evts = (events || []).filter(e => e.zone); // only zone events = Live Pro
        if (evts.length > 0) {
          const mapped = events.map(e => ({ team: e.team, event: e.event, time: e.match_time, zone: e.zone }));
          setMatchStatsMap(prev => ({ ...prev, [m.id]: computeMatchStats(mapped, team.id, m.home_team_id) }));
        } else if (archived && archived.length > 0) {
          setMatchStatsMap(prev => ({ ...prev, [m.id]: statsFromArchive(archived, team.id, m.home_team_id) }));
        }
      }
      // Parse predictions
      const kykie = (preds || []).find(p => !p.user_id);
      const userPreds = (preds || []).filter(p => p.user_id);
      const publicVotes = { home: 0, away: 0, draw: 0 };
      userPreds.forEach(p => { if (publicVotes[p.prediction] != null) publicVotes[p.prediction]++; });
      const totalVotes = userPreds.length;
      const topVote = totalVotes > 0 ? Object.entries(publicVotes).sort((a, b) => b[1] - a[1])[0] : null;
      setMatchPredictions({ kykie, publicVotes, totalVotes, topVote });
    } catch { setSelectedEvents([]); setTotalViewers(0); }
    // Fetch season records for both teams — separate try so it always runs
    try {
      const bothIds = [m.home_team?.id || m.home_team_id, m.away_team?.id || m.away_team_id].filter(Boolean);
      if (bothIds.length > 0) {
        const { data: recData } = await supabase.from('matches')
          .select('home_team_id, away_team_id, home_score, away_score, home_penalty_score, away_penalty_score')
          .eq('status', 'ended')
          .or(bothIds.map(id => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(','));
        const detailRecs = {};
        (recData || []).forEach(rm => {
          bothIds.forEach(id => {
            if (rm.home_team_id !== id && rm.away_team_id !== id) return;
            if (!detailRecs[id]) detailRecs[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
            const ih = rm.home_team_id === id;
            detailRecs[id].p++;
            detailRecs[id].gf += ih ? rm.home_score : rm.away_score;
            detailRecs[id].ga += ih ? rm.away_score : rm.home_score;
            const o = matchOutcome(rm, id);
            if (o === 'W') detailRecs[id].w++; else if (o === 'D') detailRecs[id].d++; else detailRecs[id].l++;
          });
        });
        setMatchDetailRecords(detailRecs);
        // Compute opponent's full season averages for per-match display
        const oppId = (m.home_team?.id || m.home_team_id) === team?.id
          ? (m.away_team?.id || m.away_team_id)
          : (m.home_team?.id || m.home_team_id);
        if (oppId && detailRecs[oppId]) {
          const r = detailRecs[oppId];
          setOppSeasonAvg({ gf: r.gf / r.p, ga: r.ga / r.p, gd: (r.gf - r.ga) / r.p, n: r.p });
        } else {
          setOppSeasonAvg(null);
        }
      }
    } catch (err) { console.error('matchDetailRecords fetch error:', err); }
    setLoadingEvents(false);
  };

  // Load team data
  useEffect(() => {
    let channel = null;
    const load = async () => {
      setLoading(true);
      try {
        // Find team by institution slug — load teams + auth in parallel
        const [{ data: teams }, session] = await Promise.all([
          supabase.from('teams').select(TEAM_SELECT),
          getSession(),
        ]);
        const found = teams?.find(t => makeTeamSlug(t) === teamSlug);
        if (!found) { setLoading(false); return; }
        setTeam(found);

        // Fetch team tier — use total ended matches for correct avg
        supabase.from('team_tiers').select('*').eq('team_id', found.id).single().then(async ({ data: tt }) => {
          const isOvr = tt?.tier_override && (!tt.override_expires || new Date(tt.override_expires) > new Date());
          if (isOvr) { setTeamTier(tt.tier_override); return; }
          // Count all ended matches for this team
          const { count } = await supabase.from('matches')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'ended')
            .or(`home_team_id.eq.${found.id},away_team_id.eq.${found.id}`);
          const credits = tt?.credits_total || 0;
          const avg = count > 0 ? credits / count : 0;
          setTeamTier(avg >= 20 ? 'free_plus' : 'free');
        }).catch(() => {});
        // Load matches + rankings + coach check in parallel
        const matchPromise = supabase
          .from('matches')
          .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
          .or(`home_team_id.eq.${found.id},away_team_id.eq.${found.id}`)
          .order('match_date', { ascending: false });
        const rankPromise = fetchLatestRankings();
        
        let coachPromise = Promise.resolve(false);
        if (session) {
          coachPromise = getProfile().then(async (profile) => {
            if (!profile || profile.blocked) return false;
            const activeRole = sessionStorage.getItem('kykie-active-role') || profile.role;
            // Apply switched role to profile (mirrors App.jsx logic)
            if (activeRole && profile.roles?.includes(activeRole)) {
              profile.role = activeRole;
            }
            const hasCoachRole = activeRole === 'coach' || profile.roles?.includes('coach');
            if (!hasCoachRole) return false;
            const assigned = await isCoachForTeam(profile.id, teamSlug);
            if (assigned) { setCoachProfile(profile); return true; }
            return false;
          }).catch(() => false);
        }

        const [{ data: allMatches }, rankings, isAssignedCoach] = await Promise.all([matchPromise, rankPromise, coachPromise]);
        setLatestRankings(rankings);
        if (isAssignedCoach) { setIsCoach(true); setTab("overall"); }

        if (allMatches) {
          const live = allMatches.find(m => m.status === 'live');
          const ended = allMatches.filter(m => m.status === 'ended' || m.status === 'abandoned');
          const upcoming = allMatches.filter(m => m.status === 'upcoming').sort((a, b) => {
            const da = parseSAST(a.match_date, a.scheduled_time || '00:00');
            const db = parseSAST(b.match_date, b.scheduled_time || '00:00');
            return da - db;
          });
          setMatches(ended);
          setUpcomingMatches(upcoming);

          // Fetch available reports for these matches (RLS-gated)
          if (ended.length > 0) {
            supabase.from('match_reports').select('id, match_id, report_type, title')
              .in('match_id', ended.map(m => m.id))
              .then(({ data: reps }) => {
                if (reps) {
                  const map = {};
                  reps.forEach(r => { map[r.match_id] = r.id; });
                  setMatchReportIds(map);
                }
              }).catch(() => {});
          }

          // Auto-open a specific match if navigated from a share link or landing page
          if (initialMatchId) {
            const target = ended.find(m => m.id === initialMatchId);
            if (target) {
              handleMatchTap(target);
            } else if (upcoming.some(m => m.id === initialMatchId)) {
              setTab("upcoming");
            } else if (live?.id === initialMatchId) {
              setTab("live");
            }
          }

          if (live) {
            setLiveMatch(live);
            setTab("live");
            const { data: events } = await supabase.from('match_events').select('*').eq('match_id', live.id).order('seq', { ascending: false });
            if (events) setLiveEvents(events);

            // Real-time subscription (no column filters)
            const liveId = live.id;
            channel = supabase.channel(`team-live-${liveId}`);
            channel
              .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
                if (payload.new?.id === liveId) {
                  setLiveMatch(prev => ({ ...prev, ...payload.new }));
                  if (payload.new.status === 'ended') { setTab("results"); setLiveMatch(null); load(); }
                }
              })
              .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events' }, (payload) => {
                if (payload.new?.match_id === liveId) setLiveEvents(prev => [payload.new, ...prev]);
              })
              .subscribe();
          }
        }
      } catch (err) { console.error('Load error:', err); }
      setLoading(false);
    };
    load();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [teamSlug]);

  // Poll every 5s for live data + refresh results
  useEffect(() => {
    if (!team) return;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from('matches')
          .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
          .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
          .order('match_date', { ascending: false });

        if (!data) return;
        const live = data.find(m => m.status === 'live');
        const ended = data.filter(m => m.status === 'ended' || m.status === 'abandoned');
        setMatches(ended);

        if (live) {
          setLiveMatch(live);
          if (tab !== "live" && tab !== "results") setTab("live");
          const { data: events } = await supabase.from('match_events').select('*').eq('match_id', live.id).order('seq', { ascending: false });
          if (events) setLiveEvents(events);
        } else if (liveMatch) {
          setLiveMatch(null);
          setTab("results");
        }
      } catch {}
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [team, liveMatch, tab]);

  // Load all match events for coach stats (Overall + Trends)
  useEffect(() => {
    if (!isCoach || !team || matches.length === 0) return;
    const endedWithDuration = matches.filter(m => m.status === 'ended' && m.duration > 0);
    if (endedWithDuration.length === 0) return;
    
    setLoadingStats(true);
    const matchIds = endedWithDuration.map(m => m.id);
    
    (async () => {
      // Fetch events per match (Supabase default limit is 1000 — batching risks truncation)
      const allEvents = {};
      for (const id of matchIds) {
        const { data } = await supabase
          .from('match_events')
          .select('match_id, team, event, match_time, zone, seq')
          .eq('match_id', id)
          .limit(5000);
        if (data && data.length > 0) {
          allEvents[id] = data;
        }
      }
      
      // Find matches missing events (pruned) — try archived stats
      const missingIds = matchIds.filter(id => !allEvents[id] || allEvents[id].length === 0);
      const archivedStats = {};
      if (missingIds.length > 0) {
        for (let i = 0; i < missingIds.length; i += 20) {
          const batch = missingIds.slice(i, i + 20);
          const { data } = await supabase
            .from('match_stats')
            .select('*')
            .in('match_id', batch);
          if (data) {
            data.forEach(r => {
              if (!archivedStats[r.match_id]) archivedStats[r.match_id] = [];
              archivedStats[r.match_id].push(r);
            });
          }
        }
      }

      // Compute stats per match — events first, fallback to archive
      const statsMap = {};
      endedWithDuration.forEach(m => {
        const raw = allEvents[m.id] || [];
        const events = raw.map(e => ({ team: e.team, event: e.event, time: e.match_time, zone: e.zone }));
        if (events.length > 0) {
          statsMap[m.id] = computeMatchStats(events, team.id, m.home_team_id);
        } else if (archivedStats[m.id]) {
          statsMap[m.id] = statsFromArchive(archivedStats[m.id], team.id, m.home_team_id);
        }
      });
      setMatchStatsMap(statsMap);

      // Play pattern analysis using raw events
      setRawEvents(allEvents);
      try {
        const liveProMatches = endedWithDuration.filter(m => (allEvents[m.id] || []).length > 0);
        if (liveProMatches.length > 0) {
          const patterns = analysePlayPatterns(liveProMatches, allEvents, team.id);
          setPlayPatterns(patterns);
          setProminentZones(getProminentZones(liveProMatches, allEvents, team.id));
          setBallLossZones(getBallLossZones(liveProMatches, allEvents, team.id));
        }
      } catch (e) { console.error('Play pattern error:', e); }

      setLoadingStats(false);
    })();
  }, [isCoach, team, matches.length]);

  // Load top 10 team aggregate stats for coach benchmark
  useEffect(() => {
    if (!isCoach || !team || Object.keys(latestRankings).length === 0) return;
    (async () => {
      try {
        // Get top 10 team IDs (excluding current team)
        const ranked = Object.entries(latestRankings)
          .filter(([id, r]) => r.rank && r.rank <= 10)
          .map(([id]) => id);
        if (ranked.length === 0) return;

        // Fetch ended matches for top 10 teams (with scores for per-match averages)
        const { data: t10Matches } = await supabase
          .from('matches')
          .select('id, home_team_id, away_team_id, home_score, away_score')
          .eq('status', 'ended')
          .or(ranked.map(id => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(','));
        if (!t10Matches || t10Matches.length === 0) return;

        // Compute TOP10 per-match averages from ALL ended matches
        let t10GF = 0, t10GA = 0, t10Count = 0;
        t10Matches.forEach(m => {
          const t10Id = ranked.find(id => id === m.home_team_id || id === m.away_team_id);
          if (!t10Id) return;
          const isHome = t10Id === m.home_team_id;
          t10GF += isHome ? (m.home_score || 0) : (m.away_score || 0);
          t10GA += isHome ? (m.away_score || 0) : (m.home_score || 0);
          t10Count++;
        });
        const top10PerMatch = t10Count > 0 ? {
          gf: +(t10GF / t10Count).toFixed(2),
          ga: +(t10GA / t10Count).toFixed(2),
          gd: +((t10GF - t10GA) / t10Count).toFixed(2),
          n: t10Count,
        } : null;

        // Fetch match_stats totals for those matches
        const t10MatchIds = t10Matches.map(m => m.id);
        const allRows = [];
        for (let i = 0; i < t10MatchIds.length; i += 50) {
          const batch = t10MatchIds.slice(i, i + 50);
          const { data } = await supabase
            .from('match_stats')
            .select('*')
            .in('match_id', batch)
            .or('quarter.eq.0,quarter.is.null');
          if (data) allRows.push(...data);
        }

        // Build matchStatsList from top10 perspective
        const statsList = [];
        t10Matches.forEach(m => {
          const rows = allRows.filter(r => r.match_id === m.id);
          if (rows.length < 2) return;
          // Determine which top10 team played this match
          const t10Id = ranked.find(id => id === m.home_team_id || id === m.away_team_id);
          if (!t10Id) return;
          const entry = statsFromArchive(rows, t10Id, m.home_team_id);
          statsList.push(entry);
        });

        if (statsList.length > 0) {
          setTop10Agg(aggregateStats(statsList));
        }
        if (top10PerMatch) {
          setTop10PM(top10PerMatch);
        }
      } catch (e) {
        console.error('Top10 stats error:', e);
      }
    })();
  }, [isCoach, team, latestRankings]);

  const handleCoachLogout = async () => {
    await signOut();
    setIsCoach(false);
    setCoachProfile(null);
  };

  const handleRoleSwitch = (role) => {
    sessionStorage.setItem('kykie-active-role', role);
    if (role === 'coach') window.location.hash = '#/coach';
    else if (role === 'commentator') window.location.hash = '#/admin';
    else if (role === 'admin') window.location.hash = '#/admin';
    else window.location.hash = '#/home';
    window.location.reload();
  };

  if (loading) return (
    <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", color: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <KykieSpinner />
    </div>
  );

  if (!team) return (
    <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", color: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🏑</div>
        <div style={{ fontSize: 16, color: "#94A3B8" }}>Team not found</div>
      </div>
    </div>
  );

  // Season stats (ended matches only — exclude abandoned)
  const seasonStats = matches.filter(m => m.status !== 'abandoned').reduce((s, m) => {
    const isHome = m.home_team?.id === team.id;
    const my = isHome ? m.home_score : m.away_score;
    const their = isHome ? m.away_score : m.home_score;
    const o = matchOutcome(m, team.id);
    return { played: s.played + 1, won: s.won + (o === 'W' ? 1 : 0), drawn: s.drawn + (o === 'D' ? 1 : 0), lost: s.lost + (o === 'L' ? 1 : 0), gf: s.gf + my, ga: s.ga + their };
  }, { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 });
  const gd = seasonStats.gf - seasonStats.ga;
  const winRate = seasonStats.played > 0 ? Math.round(seasonStats.won / seasonStats.played * 100) : 0;

  const resultColor = (m) => {
    if (m.status === 'abandoned') return "#64748B";
    const o = matchOutcome(m, team.id);
    return o === 'W' ? "#10B981" : o === 'L' ? "#EF4444" : "#F59E0B";
  };
  const resultLabel = (m) => {
    if (m.status === 'abandoned') return "ABN";
    return matchOutcome(m, team.id);
  };
  const opponent = (m) => m.home_team?.id === team.id ? m.away_team : m.home_team;

  // Live match clock — derive from latest event's match_time
  const liveTime = liveEvents.length > 0 ? Math.max(...liveEvents.map(e => e.match_time || 0)) : 0;

  // Filter events for public view
  const publicEvents = liveEvents.filter(e => {
    if (e.team === "meta") return true;
    if (e.team === "commentary") return true;
    return PUBLIC_EVENTS.some(k => e.event?.startsWith(k));
  });

  // Coach stats computed by CoachLiveScreen directly

  return (
    <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", color: "#E2E8F0", userSelect: "none", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#0B0F1A" }}>
      {isCoach && coachProfile ? (
        <PageHeader currentUser={coachProfile} onLogout={handleCoachLogout} onRoleSwitch={handleRoleSwitch}
          onBack={() => { window.location.hash = '#/coach'; }} />
      ) : appUser ? (
        <PageHeader currentUser={appUser} onLogout={handleCoachLogout} onRoleSwitch={handleRoleSwitch}
          onBack={onBack} />
      ) : (
      <div style={{ padding: "10px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => { window.history.back(); }} style={{
          background: "none", border: "none", color: "#F59E0B", fontSize: 13, cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", gap: 5, fontWeight: 700,
        }}>
          <svg width="16" height="16" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="20" fill="none" stroke="#10B981" strokeWidth="3"/>
            <circle cx="28" cy="28" r="8" fill="none" stroke="#F59E0B" strokeWidth="3"/>
            <line x1="34" y1="22" x2="44" y2="12" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round"/>
            <line x1="40" y1="12" x2="44" y2="12" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round"/>
            <line x1="44" y1="12" x2="44" y2="16" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          ← kykie
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={refreshMatches} disabled={refreshing} style={{
            background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center",
            animation: refreshing ? "spin 1s linear infinite" : "none",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={refreshing ? "#475569" : "#94A3B8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </button>
          <button onClick={() => { window.location.hash = '#/login'; }} style={{ fontSize: 10, color: "#F59E0B", background: "#F59E0B11", border: "1px solid #F59E0B44", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700 }}>Login</button>
        </div>
      </div>
      )}
      </div>

      {/* Coach team switcher (multi-team only) */}
      {isCoach && (() => {
        const count = parseInt(sessionStorage.getItem('kykie-coach-team-count') || '1');
        let coachTeams = [];
        try { coachTeams = JSON.parse(sessionStorage.getItem('kykie-coach-teams') || '[]'); } catch {}
        const isMulti = count > 1 && coachTeams.length > 1;
        const currentSlug = window.location.hash.replace('#/team/', '');
        return (
          <div style={{ padding: "10px 14px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: teamColor(team), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#fff", flexShrink: 0 }}>{teamInitial(team)}</div>
              {isMulti ? (
                <select
                  value={currentSlug}
                  onChange={(e) => { window.location.hash = '#/team/' + e.target.value; window.location.reload(); }}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #334155", background: "#1E293B", color: "#F8FAFC", fontSize: 14, fontWeight: 700 }}
                >
                  {coachTeams.map(t => (
                    <option key={t.slug} value={t.slug}>{t.name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>{teamDisplayName(team)}</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Team Header (non-coach) */}
      {!isCoach && (
      <div style={{ padding: "12px 14px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: teamColor(team), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#fff", flexShrink: 0 }}>{teamInitial(team)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
              {teamDisplayName(team)}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "#CBD5E1", fontWeight: 600 }}>{seasonStats.played}P {seasonStats.won}W {seasonStats.drawn}D {seasonStats.lost}L</span>
              {winRate > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "#10B981", background: "#10B98122", padding: "1px 6px", borderRadius: 99 }}>{winRate}%</span>}
            </div>
          </div>
        </div>
      </div>
      )}
      {team?.id && <SponsorBanner tier="team" targetId={team.id} size="md" />}

      {/* Tabs */}
      {!selectedMatch && (
      <div style={{ padding: "0 14px 6px" }}>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #334155" }}>
          {liveMatch && (
            <button onClick={() => setTab("live")} style={{
              flex: 1, padding: "9px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: tab === "live" ? "#10B98122" : "#1E293B", color: tab === "live" ? "#10B981" : "#64748B",
            }}>
              <span style={{ animation: "pulse-dot 2s infinite", marginRight: 4 }}>●</span> {isCoach ? "Live Stats" : "Live"}
            </button>
          )}
          {isCoach && (
            <button onClick={() => setTab("overall")} style={{
              flex: 1, padding: "9px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: tab === "overall" ? "#334155" : "#1E293B", color: tab === "overall" ? "#F8FAFC" : "#64748B",
            }}>Overall</button>
          )}
          {upcomingMatches.length > 0 && (
            <button onClick={() => setTab("upcoming")} style={{
              flex: 1, padding: "9px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: tab === "upcoming" ? "#F59E0B22" : "#1E293B", color: tab === "upcoming" ? "#F59E0B" : "#64748B",
            }}>Upcoming ({upcomingMatches.length})</button>
          )}
          <button onClick={() => setTab("results")} style={{
            flex: 1, padding: "9px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
            background: tab === "results" ? "#334155" : "#1E293B", color: tab === "results" ? "#F8FAFC" : "#64748B",
          }}>{isCoach ? "Matches" : `Results (${matches.length})`}</button>
          {isCoach && (
            <button onClick={() => setTab("trends")} style={{
              flex: 1, padding: "9px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: tab === "trends" ? "#334155" : "#1E293B", color: tab === "trends" ? "#F8FAFC" : "#64748B",
            }}>Visuals</button>
          )}
        </div>
      </div>
      )}

      {/* ═══ LIVE TAB ═══ */}
      {(tab === "live" && liveMatch) && (() => {
        // Detect shootout state from live events
        const shootoutStarted = liveEvents.some(e => e.event === "Shootout Start");
        const shootoutEnded = liveEvents.some(e => e.event === "Shootout End");
        const homePens = liveEvents.filter(e => e.event === "Penalty Kick" && e.team === "home" && e.detail === "Goal").length;
        const awayPens = liveEvents.filter(e => e.event === "Penalty Kick" && e.team === "away" && e.detail === "Goal").length;
        const inShootout = shootoutStarted && !shootoutEnded;
        return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Scoreboard */}
          <div style={{ padding: "8px 14px 14px" }}>
            <div style={{ background: "#1E293B", borderRadius: 14, padding: "16px 12px", border: inShootout ? "1px solid #F59E0B66" : "1px solid #10B98122" }}>
              <div style={{ textAlign: "center", marginBottom: 8, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#10B981", background: "#10B98122", padding: "3px 12px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ animation: "pulse-dot 2s infinite" }}>●</span> LIVE
                </span>
                {inShootout && (
                  <span style={{ fontSize: 9, fontWeight: 800, color: "#F59E0B", background: "#F59E0B22", padding: "3px 10px", borderRadius: 99, letterSpacing: 1 }}>⚽ PEN SHOOT-OUT</span>
                )}
                {matchViewers > 0 && (
                  <span style={{ fontSize: 10, color: "#64748B", display: "inline-flex", alignItems: "center", gap: 3 }}>
                    👁 {matchViewers} watching
                  </span>
                )}
                <span onClick={() => handleShareMatch(liveMatch)} title="Share live match link"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#94A3B8", background: "#33415544", border: "1px solid #33415588", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                  <Icon name="share" size={12} /> Share
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: liveColors.homeColor || "#3B82F6", marginBottom: 4 }}>{teamDisplayName(liveMatch.home_team)}</div>
                  <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1 }}>{liveMatch.home_score}</div>
                  {(inShootout || homePens + awayPens > 0) && (
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#F59E0B', marginTop: 4 }}>{homePens} <span style={{ fontSize: 9, color: '#64748B' }}>pen</span></div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "monospace", color: "#F59E0B" }}>{inShootout ? "PEN" : fmtClock(liveTime)}</div>
                </div>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: liveColors.awayColor || "#EF4444", marginBottom: 4 }}>{teamDisplayName(liveMatch.away_team)}</div>
                  <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1 }}>{liveMatch.away_score}</div>
                  {(inShootout || homePens + awayPens > 0) && (
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#F59E0B', marginTop: 4 }}>{awayPens} <span style={{ fontSize: 9, color: '#64748B' }}>pen</span></div>
                  )}
                </div>
              </div>
              {liveMatch.venue && <div style={{ textAlign: "center", marginTop: 8, fontSize: 10, color: "#64748B" }}>{liveMatch.match_type ? (liveMatch.match_type.charAt(0).toUpperCase() + liveMatch.match_type.slice(1)) + ' @ ' : ''}{liveMatch.venue}</div>}
            </div>
          </div>

          {/* Coach: Full CoachLiveScreen */}
          {isCoach ? (
            <CoachLiveScreen
              embedded
              match={{
                teams: {
                  home: { name: teamShortName(liveMatch.home_team), color: liveColors.homeColor, institution: liveMatch.home_team?.institution },
                  away: { name: teamShortName(liveMatch.away_team), color: liveColors.awayColor, institution: liveMatch.away_team?.institution },
                },
                breakFormat: liveMatch.break_format || "quarters",
                matchLength: liveMatch.match_length || 60,
                homeScore: liveMatch.home_score,
                awayScore: liveMatch.away_score,
                status: "live",
              }}
              events={liveEvents.map(e => ({ ...e, time: e.match_time }))}
              matchTime={liveTime}
              running={true}
              seasonAvg={(() => {
                const homeId = liveMatch.home_team_id || liveMatch.home_team?.id;
                const awayId = liveMatch.away_team_id || liveMatch.away_team?.id;
                const teamIsHome = homeId === team?.id;
                return {
                  home: teamIsHome ? seasonAvgForTeam(homeId, matches) : (oppSeasonAvg || seasonAvgForTeam(homeId, matches)),
                  away: teamIsHome ? (oppSeasonAvg || seasonAvgForTeam(awayId, matches)) : seasonAvgForTeam(awayId, matches),
                };
              })()}
              teamTier={teamTier}
            />
          ) : (
            /* Public: Commentary */
            <div style={{ flex: 1, padding: "0 14px 20px", overflowY: "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Live Commentary</div>
              {publicEvents.length === 0 ? (
                <div style={{ fontSize: 13, color: "#94A3B8", fontStyle: "italic", textAlign: "center", padding: 20 }}>Waiting for kickoff...</div>
              ) : publicEvents.slice(0, 30).map((entry, i) => {
                const type = classifyEvent(entry);
                const color = eventColor(type);
                const icon = eventIcon(type);
                const isGoal = type === "goal";
                const teamName = entry.team === "home" ? teamShortName(liveMatch.home_team) : entry.team === "away" ? teamShortName(liveMatch.away_team) : null;

                // Build display text
                let text = entry.detail || entry.event;
                if (isGoal && teamName) text = `GOAL! ${teamName}`;
                if (type === "start") text = entry.detail || "Match underway";
                if (type === "pause") text = entry.detail || entry.event;
                if (type === "pen_goal" && teamName) text = `${teamName} — Penalty scored`;
                if (type === "pen_miss" && teamName) text = `${teamName} — Penalty saved`;
                if (type === "shootout_marker") {
                  if (entry.event === "Shootout Start") {
                    const firstTeam = entry.detail === "home" ? teamShortName(liveMatch.home_team) : teamShortName(liveMatch.away_team);
                    text = `Penalty shoot-out begins — ${firstTeam} kicks first`;
                  } else {
                    text = entry.detail || "Shoot-out complete";
                  }
                }

                const showReactions = ["goal", "narrative", "set_piece"].includes(type);

                return (
                  <div key={entry.id} style={{
                    display: "flex", gap: 10, padding: isGoal ? "10px 0" : "7px 0",
                    borderBottom: "1px solid #1E293B",
                    animation: i === 0 ? "slide-in 0.3s ease-out" : "none",
                  }}>
                    <div style={{ fontSize: 13, fontFamily: "monospace", color: "#CBD5E1", minWidth: 36, fontWeight: 700, paddingTop: 1 }}>
                      {fmtMin(entry.match_time)}
                    </div>
                    <div style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>{icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: isGoal ? 15 : 13, color, fontWeight: isGoal ? 800 : type === "narrative" ? 400 : 600, lineHeight: 1.5, fontStyle: type === "narrative" ? "italic" : "normal" }}>
                        {text}
                      </div>
                      {showReactions && entry.id && (
                        <ReactionBar eventId={entry.id} counts={counts} myReactions={myReactions} onToggle={toggleReaction} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })()}

      {/* ═══ OVERALL TAB (Coach) ═══ */}
      {tab === "overall" && isCoach && !selectedMatch && (
        loadingStats ? (
          <div style={{ textAlign: "center", padding: 40 }}><KykieSpinner /></div>
        ) : (
          <>
          {/* Season stats strip */}
          <div style={{ padding: "8px 14px 0" }}>
            <div style={{ display: "flex", background: "#1E293B", borderRadius: 10, border: "1px solid #334155", overflow: "hidden" }}>
              {[
                { v: seasonStats.played, l: "P", c: "#F8FAFC" },
                { v: seasonStats.won, l: "W", c: "#10B981" },
                { v: seasonStats.drawn, l: "D", c: "#F8FAFC" },
                { v: seasonStats.lost, l: "L", c: "#EF4444" },
                { v: seasonStats.gf, l: "GF", c: "#F8FAFC" },
                { v: seasonStats.ga, l: "GA", c: "#F8FAFC" },
                { v: seasonStats.gf - seasonStats.ga, l: "GD", c: (seasonStats.gf - seasonStats.ga) >= 0 ? "#10B981" : "#EF4444" },
              ].map(s => (
                <div key={s.l} style={{ flex: 1, padding: "10px 2px", textAlign: "center", borderRight: "1px solid #33415533" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, color: s.c }}>{s.l === "GD" && s.v > 0 ? "+" : ""}{s.v}</div>
                  <div style={{ fontSize: 8, color: "#64748B", marginTop: 3, textTransform: "uppercase", letterSpacing: 1 }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <CoachOverall
            matchStatsList={Object.values(matchStatsMap)}
            matchStatsMap={matchStatsMap}
            teamName={teamDisplayName(team)}
            teamColor={teamColor(team)}
            teamId={team.id}
            allMatches={matches}
            matchCount={matches.filter(m => m.duration > 0).length}
            top10Agg={top10Agg}
            top10PM={top10PM}
            teamTier={teamTier}
          />
          </>
        )
      )}

      {/* ═══ TRENDS TAB (Coach) — Visual Play Analysis ═══ */}
      {tab === "trends" && isCoach && !selectedMatch && (
        (teamTier === 'free_plus' || teamTier === 'premium') ? (
          loadingStats ? (
            <div style={{ textAlign: "center", padding: 40 }}><KykieSpinner /></div>
          ) : playPatterns && playPatterns.exit ? (
            <div style={{ padding: "8px 14px 20px" }}>
              <div style={{ background: "#1E293B", borderRadius: 10, padding: "10px 12px", border: "1px solid #334155" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Visual Play Analysis</div>
                <PlayPatternField patterns={playPatterns} prominentZones={prominentZones} ballLossZones={ballLossZones} />
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 40, color: "#475569", fontSize: 12 }}>No Live Pro matches to analyse</div>
          )
        ) : (
          <div style={{ padding: "8px 14px 20px", textAlign: "center" }}>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: "24px 16px", border: "1px solid #334155" }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>🔒</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B" }}>Visual play analysis</div>
              <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Available with Free Plus — increase your team's average credits per match above 20 to unlock</div>
            </div>
          </div>
        )
      )}

      {/* ═══ UPCOMING TAB ═══ */}
      {tab === "upcoming" && !selectedMatch && (
        <div style={{ padding: "8px 14px 20px", flex: 1, overflowY: "auto" }}>
          {upcomingMatches.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "#475569", fontSize: 12 }}>No upcoming matches</div>
          ) : (
            upcomingMatches.map(m => {
              const isHome = m.home_team?.id === team.id;
              const opp = isHome ? m.away_team : m.home_team;
              const d = parseSASTDate(m.match_date);
              // Countdown
              const countdown = (() => {
                if (!m.scheduled_time) return null;
                const kickoff = parseSAST(m.match_date, m.scheduled_time);
                const diff = kickoff - new Date();
                if (diff <= 0) return { text: "Now", color: "#10B981" };
                const mins = Math.floor(diff / 60000);
                const hours = Math.floor(mins / 60);
                const days = Math.floor(hours / 24);
                if (days > 0) return { text: `${days}d ${hours % 24}h`, color: "#64748B" };
                if (hours > 0) return { text: `${hours}h ${mins % 60}m`, color: "#F59E0B" };
                return { text: `${mins}m`, color: "#EF4444" };
              })();
              const homeTeam = m.home_team;
              const awayTeam = m.away_team;
              return (
                <div key={m.id} style={{ background: "#1E293B", borderRadius: 10, padding: 12, marginBottom: 6, border: "1px solid #33415544" }}>
                  {/* Match header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isCoach ? 8 : 0 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, background: "#0B0F1A",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 900, color: "#F59E0B" }}>{d.getDate()}</div>
                      <div style={{ fontSize: 7, fontWeight: 700, color: "#64748B", marginTop: -1, textTransform: "uppercase" }}>{d.toLocaleDateString("en-ZA", { month: "short" })}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <MatchCardTeams home={homeTeam} away={awayTeam} homeRank={latestRankings[homeTeam?.id]?.rank} awayRank={latestRankings[awayTeam?.id]?.rank} homePrevRank={latestRankings[homeTeam?.id]?.prevRank} awayPrevRank={latestRankings[awayTeam?.id]?.prevRank} />
                      <div style={{ fontSize: 9, color: "#64748B", marginTop: 1 }}>
                        {d.toLocaleDateString("en-ZA", { weekday: "short" })}
                        {m.scheduled_time && ` · ${m.scheduled_time.slice(0, 5)}`}
                        {m.match_type && ` · ${m.match_type.charAt(0).toUpperCase() + m.match_type.slice(1)}`}
                        {m.venue && ` @ ${m.venue}`}
                      </div>
                    </div>
                    {countdown && <div style={{ fontSize: 9, fontWeight: 700, color: countdown.color, fontFamily: "monospace" }}>{countdown.text}</div>}
                  </div>
                  {/* Coach scouting: prediction + side-by-side team stats */}
                  {isCoach && (() => {
                    const hRec = oppRecords[homeTeam?.id] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                    const aRec = oppRecords[awayTeam?.id] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                    const pred = predictMatch(hRec, aRec, teamShortName(homeTeam), teamShortName(awayTeam), { homeRank: latestRankings[homeTeam?.id]?.rank, awayRank: latestRankings[awayTeam?.id]?.rank });
                    return (<>
                    {pred && (
                      <div style={{ background: "linear-gradient(135deg,#1E293B,#0F172A)", borderRadius: 8, padding: "10px 12px", marginBottom: 6, border: "1px solid #F59E0B33" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 12 }}>🔮</span>
                          <span style={{ fontSize: 9, fontWeight: 800, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1 }}>kykie predicts</span>
                        </div>
                        <div style={{ textAlign: "center", marginBottom: 10 }}>
                          {pred.draw >= pred.homeWin && pred.draw >= pred.awayWin ? (
                            <div style={{ fontSize: 16, fontWeight: 900, color: "#F59E0B" }}>Draw</div>
                          ) : pred.homeWin >= pred.awayWin ? (
                            <div style={{ fontSize: 16, fontWeight: 900, color: teamColor(homeTeam) || "#10B981" }}>{teamShortName(homeTeam)} to win</div>
                          ) : (
                            <div style={{ fontSize: 16, fontWeight: 900, color: teamColor(awayTeam) || "#3B82F6" }}>{teamShortName(awayTeam)} to win</div>
                          )}
                          <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                            Based on {hRec?.p || 0} and {aRec?.p || 0} matches played
                          </div>
                        </div>
                        <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                          <div style={{ width: `${pred.homeWin}%`, background: "#10B981" }} />
                          <div style={{ width: `${pred.draw}%`, background: "#F59E0B" }} />
                          <div style={{ width: `${pred.awayWin}%`, background: "#3B82F6" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, fontWeight: 700 }}>
                          <span style={{ color: "#10B981" }}>{teamShortName(homeTeam)} {pred.homeWin}%</span>
                          <span style={{ color: "#F59E0B" }}>Draw {pred.draw}%</span>
                          <span style={{ color: "#3B82F6" }}>{teamShortName(awayTeam)} {pred.awayWin}%</span>
                        </div>
                        {pred.reasons.length > 0 && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #33415544" }}>
                            {pred.reasons.map((r, i) => (
                              <div key={i} style={{ fontSize: 9, color: r.type === 'home' ? '#10B981' : r.type === 'away' ? '#3B82F6' : '#F59E0B', lineHeight: 1.6 }}>
                                {r.type === 'home' ? '+' : r.type === 'away' ? '–' : '~'} {r.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      {[homeTeam, awayTeam].map(t => {
                        const r = oppRecords[t?.id] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                        const gd = r.gf - r.ga;
                        const isMine = t?.id === team.id;
                        const rk = latestRankings[t?.id];
                        return (
                          <div key={t?.id || Math.random()} style={{
                            flex: 1, minWidth: 0, background: "#0B0F1A", borderRadius: 8, padding: "8px 8px",
                            border: isMine ? `1px solid ${teamColor(team)}44` : "1px solid #33415533", overflow: "hidden",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, minWidth: 0 }}>
                              <div style={{
                                width: 14, height: 14, borderRadius: 3, background: teamColor(t) || "#334155",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 7, fontWeight: 900, color: "#fff", flexShrink: 0,
                              }}>{teamInitial(t)}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: "#F8FAFC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{teamShortName(t) || 'TBD'}</span>
                                  {rk && <span style={{ fontSize: 8, color: "#10B981", flexShrink: 0 }}>#{rk.rank}</span>}
                                </div>
                                <div style={{ fontSize: 8, color: "#64748B", fontWeight: 600 }}>{teamDerivedName(t)}</div>
                              </div>
                            </div>
                            {r.p > 0 ? (
                              <div style={{ display: "flex", gap: 3, textAlign: "center" }}>
                                {[[r.p, "P", "#F8FAFC"], [r.w, "W", "#10B981"], [r.d, "D", "#F8FAFC"], [r.l, "L", "#EF4444"], [r.gf, "GF", "#F8FAFC"], [r.ga, "GA", "#F8FAFC"], [gd > 0 ? `+${gd}` : gd, "GD", gd > 0 ? "#10B981" : gd < 0 ? "#EF4444" : "#F8FAFC"]].map(([val, label, color]) => (
                                  <div key={label} style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 900, color }}>{val}</div>
                                    <div style={{ fontSize: 7, color: "#64748B" }}>{label}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 9, color: "#475569", textAlign: "center", marginBottom: 4 }}>No matches yet</div>
                            )}
                            {!isMine && t && (
                              <div onClick={() => { window.location.hash = `#/team/${makeTeamSlug(t)}`; }} style={{ fontSize: 8, color: "#8B5CF6", fontWeight: 700, textAlign: "center", marginTop: 6, cursor: "pointer" }}>View stats →</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    </>);
                  })()}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ═══ RESULTS TAB ═══ */}
      {tab === "results" && !selectedMatch && (
        <div style={{ padding: "8px 14px 20px", flex: 1, overflowY: "auto" }}>
          {/* Season stats */}
          <div style={{ background: "#1E293B", borderRadius: 10, padding: "12px 14px", marginBottom: 10, border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
              {[[seasonStats.played, "P"], [seasonStats.won, "W"], [seasonStats.drawn, "D"], [seasonStats.lost, "L"], [seasonStats.gf, "GF"], [seasonStats.ga, "GA"], [gd > 0 ? `+${gd}` : gd, "GD"]].map(([val, label]) => (
                <div key={label}>
                  <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: label === "W" ? "#10B981" : label === "L" ? "#EF4444" : "#F8FAFC" }}>{val}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {matches.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "#94A3B8", fontSize: 14 }}>No matches yet</div>
          ) : matches.map(m => {
            const opp = opponent(m);
            const isHome = m.home_team?.id === team.id;
            const rc = resultColor(m);
            const rl = resultLabel(m);
            const d = parseSASTDate(m.match_date);
            const hasStats = m.duration > 0;
            return (
              <div key={m.id} style={{
                display: "flex", alignItems: "center", padding: "12px 12px", gap: 10,
                background: "#1E293B", borderRadius: 10, marginBottom: 4,
                opacity: m.status === 'abandoned' ? 0.5 : 1,
              }}>
                <div onClick={() => handleMatchTap(m)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: rc + "22", border: `1.5px solid ${rc}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: rl === 'ABN' ? 8 : 12, fontWeight: 900, color: rc, flexShrink: 0 }}>{rl}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8" }}>vs</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#F8FAFC" }}>{teamShortName(opp)}</span>
                      <RankBadge rank={isHome ? m.away_rank : m.home_rank} prevRank={isHome ? m.away_prev_rank : m.home_prev_rank} />
                      {hasStats && <span title="Full stats + commentary" style={{ display: "inline-flex", alignItems: "center", cursor: "help" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>}
                      {matchReportIds[m.id] && (
                        <span onClick={(e) => { e.stopPropagation(); sessionStorage.setItem('kykie-report-return', '#/team/' + teamSlug + '?match=' + m.id); window.location.hash = '#/report/' + matchReportIds[m.id]; }}
                          title="Match report available" style={{
                            display: "inline-flex", alignItems: "center", gap: 2, cursor: "pointer",
                            fontSize: 8, fontWeight: 700, color: "#F59E0B", background: "#F59E0B15",
                            border: "1px solid #F59E0B33", borderRadius: 4, padding: "1px 5px",
                          }}>📊 Report</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 1 }}>{teamDerivedName(opp)}</div>
                    <div style={{ fontSize: 10, color: "#64748B", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                      {d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                      {m.venue && ` · ${m.match_type ? (m.match_type.charAt(0).toUpperCase() + m.match_type.slice(1)) + ' @ ' : ''}${m.venue}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 50 }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#F8FAFC" }}>{isHome ? m.home_score : m.away_score}–{isHome ? m.away_score : m.home_score}</div>
                    {m.home_penalty_score != null && m.away_penalty_score != null && (
                      <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 800, background: '#F59E0B15', borderRadius: 4, padding: '1px 6px', marginTop: 2 }}>{isHome ? m.home_penalty_score : m.away_penalty_score}-{isHome ? m.away_penalty_score : m.home_penalty_score} pen</div>
                    )}
                    {m.status === 'abandoned' && (
                      <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, marginTop: 2 }}>Abandoned</div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "#334155" }}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ MATCH DETAIL (Coach) ═══ */}
      {selectedMatch && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ padding: "6px 14px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button onClick={() => { setSelectedMatch(null); setSelectedEvents([]); setTotalViewers(null); setMatchPredictions(null); setMatchDetailRecords({}); setOppSeasonAvg(null); }} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: 13, cursor: "pointer", padding: 0 }}>← Back to results</button>
            <div style={{ display: 'flex', gap: 6 }}>
              {matchReportIds[selectedMatch.id] && (
                <button onClick={() => { sessionStorage.setItem('kykie-report-return', '#/team/' + teamSlug + '?match=' + selectedMatch.id); window.location.hash = '#/report/' + matchReportIds[selectedMatch.id]; }}
                  style={{ fontSize: 10, fontWeight: 700, color: "#F59E0B", background: "#F59E0B15", border: "1px solid #F59E0B33", borderRadius: 6, padding: "4px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  📊 View Report
                </button>
              )}
              <button onClick={() => handleShareMatch(selectedMatch)} title="Share match link"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#94A3B8", background: "#33415522", border: "1px solid #33415588", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                <Icon name="share" size={12} /> Share
              </button>
            </div>
          </div>
          {/* Match scoreboard */}
          <div style={{ padding: "8px 14px 10px" }}>
            <div style={{ background: "#1E293B", borderRadius: 12, padding: "14px 12px", border: "1px solid #334155" }}>
              <div style={{ textAlign: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: selectedMatch.status === 'abandoned' ? '#64748B' : '#94A3B8' }}>
                  {selectedMatch.status === 'abandoned' ? 'MATCH ABANDONED' : 'FULL TIME'}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#F8FAFC' }}>{teamShortName(selectedMatch.home_team)}</div>
                  <div style={{ fontSize: 9, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: selectedColors.homeColor, display: 'inline-block', flexShrink: 0 }} />
                    {teamDerivedName(selectedMatch.home_team)} <RankBadge rank={selectedMatch.home_rank} prevRank={selectedMatch.home_prev_rank} />
                  </div>
                  <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{selectedMatch.home_score}</div>
                </div>
                <div style={{ fontSize: 14, color: "#94A3B8", padding: "0 8px" }}>–</div>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#F8FAFC' }}>{teamShortName(selectedMatch.away_team)}</div>
                  <div style={{ fontSize: 9, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: selectedColors.awayColor, display: 'inline-block', flexShrink: 0 }} />
                    {teamDerivedName(selectedMatch.away_team)} <RankBadge rank={selectedMatch.away_rank} prevRank={selectedMatch.away_prev_rank} />
                  </div>
                  <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{selectedMatch.away_score}</div>
                </div>
              </div>
              {selectedMatch.home_penalty_score != null && selectedMatch.away_penalty_score != null && (
                <div style={{ textAlign: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', background: '#F59E0B15', borderRadius: 6, padding: '3px 12px' }}>
                    Penalties: {selectedMatch.home_penalty_score} – {selectedMatch.away_penalty_score}
                  </span>
                </div>
              )}
              <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, color: "#94A3B8" }}>
                {parseSASTDate(selectedMatch.match_date).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                {selectedMatch.venue && ` · ${selectedMatch.match_type ? (selectedMatch.match_type.charAt(0).toUpperCase() + selectedMatch.match_type.slice(1)) + ' @ ' : ''}${selectedMatch.venue}`}
              </div>
              {totalViewers > 0 && (
                <div style={{ textAlign: "center", marginTop: 6, fontSize: 10, color: "#64748B", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  👁 {totalViewers} {totalViewers === 1 ? 'viewer' : 'viewers'} watched
                </div>
              )}
            </div>
          </div>
          {loadingEvents ? (
            <div style={{ textAlign: "center", padding: 30 }}><KykieSpinner /></div>
          ) : isCoach ? (
            <CoachLiveScreen
              embedded
              match={{
                teams: {
                  home: { name: teamShortName(selectedMatch.home_team), color: selectedColors.homeColor, institution: selectedMatch.home_team?.institution },
                  away: { name: teamShortName(selectedMatch.away_team), color: selectedColors.awayColor, institution: selectedMatch.away_team?.institution },
                },
                breakFormat: selectedMatch.break_format || "quarters",
                matchLength: selectedMatch.match_length || 60,
                homeScore: selectedMatch.home_score,
                awayScore: selectedMatch.away_score,
                status: "ended",
              }}
              events={selectedEvents.map(e => ({ ...e, time: e.match_time }))}
              matchTime={selectedMatch.duration || 0}
              running={false}
              seasonAvg={(() => {
                const homeId = selectedMatch.home_team_id || selectedMatch.home_team?.id;
                const awayId = selectedMatch.away_team_id || selectedMatch.away_team?.id;
                const teamIsHome = homeId === team?.id;
                return {
                  home: teamIsHome ? seasonAvgForTeam(homeId, matches) : (oppSeasonAvg || seasonAvgForTeam(homeId, matches)),
                  away: teamIsHome ? (oppSeasonAvg || seasonAvgForTeam(awayId, matches)) : seasonAvgForTeam(awayId, matches),
                };
              })()}
              playPatterns={playPatterns}
              matchPlayPatterns={selectedMatchVisuals?.patterns}
              prominentZones={prominentZones}
              matchProminentZones={selectedMatchVisuals?.zones}
              ballLossZones={ballLossZones}
              matchBallLossZones={selectedMatchVisuals?.lossZones}
              teamTier={teamTier}
            />
          ) : (
            <div style={{ padding: "0 14px 20px" }}>
              {/* ── PUBLIC MATCH STATS ── */}
              {(() => {
                const stats = matchStatsMap[selectedMatch.id];
                const hc = selectedColors.homeColor || '#3B82F6';
                const ac = selectedColors.awayColor || '#10B981';
                const isHome = selectedMatch.home_team?.id === team.id;
                if (stats) {
                  const home = isHome ? stats.team : stats.opp;
                  const away = isHome ? stats.opp : stats.team;
                  const rows = [
                    { label: 'Possession', h: `${home.possessionTimePct ?? home.territory}%`, a: `${away.possessionTimePct ?? away.territory}%`, hv: home.possessionTimePct ?? home.territory, av: away.possessionTimePct ?? away.territory },
                    { label: 'Territory', h: `${home.territoryTimePct ?? home.territory}%`, a: `${away.territoryTimePct ?? away.territory}%`, hv: home.territoryTimePct ?? home.territory, av: away.territoryTimePct ?? away.territory },
                    { label: 'Turnovers Won', h: home.turnoversWon, a: away.turnoversWon, hv: home.turnoversWon, av: away.turnoversWon },
                    { label: 'Possession Lost', h: home.possLost, a: away.possLost, hv: home.possLost, av: away.possLost, inverted: true },
                    ...(home.atkChances > 0 || away.atkChances > 0 ? [
                      { label: 'Attack Chances', h: home.atkChances, a: away.atkChances, hv: home.atkChances, av: away.atkChances },
                    ] : []),
                    { label: 'D Entries', h: home.dEntries, a: away.dEntries, hv: home.dEntries, av: away.dEntries },
                    { label: 'Short Corners', h: home.shortCorners, a: away.shortCorners, hv: home.shortCorners, av: away.shortCorners },
                    { label: 'SC Goals', h: home.scGoals || 0, a: away.scGoals || 0, hv: home.scGoals || 0, av: away.scGoals || 0 },
                    { label: 'Shots', h: (home.shotsOn || 0) + (home.shotsOff || 0), a: (away.shotsOn || 0) + (away.shotsOff || 0), hv: (home.shotsOn || 0) + (home.shotsOff || 0), av: (away.shotsOn || 0) + (away.shotsOff || 0) },
                    { label: 'Shots on Target', h: home.shotsOn, a: away.shotsOn, hv: home.shotsOn, av: away.shotsOn },
                  ];
                  return (<>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Match stats</div>
                    <div style={{ background: '#1E293B', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                      {rows.map((r, i) => {
                        const total = (r.hv || 0) + (r.av || 0) || 1;
                        const hPct = Math.round(r.hv / total * 100);
                        return (
                          <div key={r.label} style={{ marginBottom: i < rows.length - 1 ? 12 : 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 18, fontWeight: 900, color: hc, minWidth: 40 }}>{r.h}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8' }}>{r.label}</span>
                              <span style={{ fontSize: 18, fontWeight: 900, color: ac, minWidth: 40, textAlign: 'right' }}>{r.a}</span>
                            </div>
                            <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', gap: 2 }}>
                              <div style={{ width: `${hPct}%`, background: hc, borderRadius: 2 }} />
                              <div style={{ width: `${100 - hPct}%`, background: ac, borderRadius: 2 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>);
                } else {
                  const homeId = selectedMatch.home_team?.id;
                  const awayId = selectedMatch.away_team?.id;
                  const hr = matchDetailRecords[homeId] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                  const ar = matchDetailRecords[awayId] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                  const ScoutCard = ({ t, r, color }) => {
                    const gd = (r.gf || 0) - (r.ga || 0);
                    const rk = latestRankings[t?.id];
                    return (
                      <div style={{
                        flex: 1, minWidth: 0, overflow: 'hidden', background: '#0B0F1A', borderRadius: 8, padding: '8px 8px',
                        border: `1px solid ${color}33`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, background: color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 7, fontWeight: 900, color: '#fff', flexShrink: 0,
                          }}>{teamInitial(t)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: '#F8FAFC', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{teamShortName(t)}</span>
                              {rk && <span style={{ fontSize: 8, color: '#10B981', flexShrink: 0 }}>#{rk.rank}</span>}
                            </div>
                            <div style={{ fontSize: 8, color: '#64748B', fontWeight: 600 }}>{teamDerivedName(t)}</div>
                          </div>
                        </div>
                        {r.p > 0 ? (
                          <div style={{ display: 'flex', gap: 3, textAlign: 'center' }}>
                            {[[r.p, 'P', '#F8FAFC'], [r.w, 'W', '#10B981'], [r.d, 'D', '#F8FAFC'], [r.l, 'L', '#EF4444'], [r.gf, 'GF', '#F8FAFC'], [r.ga, 'GA', '#F8FAFC'], [gd > 0 ? `+${gd}` : gd, 'GD', gd > 0 ? '#10B981' : gd < 0 ? '#EF4444' : '#F8FAFC']].map(([val, label, c]) => (
                              <div key={label} style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 900, color: c }}>{val}</div>
                                <div style={{ fontSize: 7, color: '#64748B' }}>{label}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 9, color: '#475569', textAlign: 'center' }}>No matches yet</div>
                        )}
                      </div>
                    );
                  };
                  return (<>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Season form</div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      <ScoutCard t={selectedMatch.home_team} r={hr} color={hc} />
                      <ScoutCard t={selectedMatch.away_team} r={ar} color={ac} />
                    </div>
                  </>);
                }
              })()}
              {/* ── PREDICTIONS ── */}
              {(() => {
                const hRec = matchDetailRecords[selectedMatch.home_team?.id] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                const aRec = matchDetailRecords[selectedMatch.away_team?.id] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                const hName = teamShortName(selectedMatch.home_team);
                const aName = teamShortName(selectedMatch.away_team);
                const pred = (hRec.p >= 3 || aRec.p >= 3) ? predictMatch(hRec, aRec, hName, aName, { homeRank: latestRankings[selectedMatch.home_team?.id]?.rank, awayRank: latestRankings[selectedMatch.away_team?.id]?.rank }) : null;
                const storedKykie = matchPredictions?.kykie;
                const winner = matchWinner(selectedMatch);
                if (!pred && !storedKykie && !(matchPredictions?.totalVotes > 0)) return null;
                return (<>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Predictions</div>
                  {/* Kykie prediction — stored or computed */}
                  {(storedKykie || pred) && (() => {
                    let predLabel, conf, correct;
                    if (storedKykie) {
                      predLabel = storedKykie.prediction === 'home' ? hName : storedKykie.prediction === 'away' ? aName : 'Draw';
                      conf = storedKykie.home_win_pct != null ? Math.round(Math.max(storedKykie.home_win_pct, storedKykie.draw_pct || 0, storedKykie.away_win_pct || 0)) : null;
                      correct = storedKykie.correct;
                    } else {
                      const kPred = pred.draw >= pred.homeWin && pred.draw >= pred.awayWin ? 'draw' : pred.homeWin >= pred.awayWin ? 'home' : 'away';
                      predLabel = kPred === 'home' ? hName : kPred === 'away' ? aName : 'Draw';
                      conf = Math.round(Math.max(pred.homeWin, pred.draw, pred.awayWin));
                      correct = kPred === winner;
                    }
                    return (
                      <div style={{ background: '#1E293B', borderRadius: 10, padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#F59E0B22', border: '1.5px solid #F59E0B44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🤖</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#F8FAFC' }}>Kykie: {predLabel}</div>
                          {conf != null && <div style={{ fontSize: 9, color: '#64748B' }}>{conf}% confidence</div>}
                        </div>
                        {correct != null && <span style={{ fontSize: 11, fontWeight: 800, color: correct ? '#10B981' : '#EF4444' }}>{correct ? '✓' : '✗'}</span>}
                      </div>
                    );
                  })()}
                  {/* Public predictions */}
                  {matchPredictions?.totalVotes > 0 && (() => {
                    const { topVote, totalVotes } = matchPredictions;
                    const predLabel = topVote[0] === 'home' ? hName : topVote[0] === 'away' ? aName : 'Draw';
                    const pct = Math.round(topVote[1] / totalVotes * 100);
                    const correct = topVote[0] === winner;
                    return (
                      <div style={{ background: '#1E293B', borderRadius: 10, padding: '10px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#8B5CF622', border: '1.5px solid #8B5CF644', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>👥</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#F8FAFC' }}>Public: {predLabel}</div>
                          <div style={{ fontSize: 9, color: '#64748B' }}>{pct}% voted · {totalVotes} prediction{totalVotes !== 1 ? 's' : ''}</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 800, color: correct ? '#10B981' : '#EF4444' }}>{correct ? '✓' : '✗'}</span>
                      </div>
                    );
                  })()}
                </>);
              })()}
            </div>
          )}
        </div>
      )}

      {/* ═══ COACH: Contribute + Account ═══ */}
      {isCoach && !selectedMatch && (
        <div style={{ padding: "0 14px 12px" }}>
          <div style={{ borderTop: `1px solid #1E293B`, paddingTop: 14, marginTop: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Contribute</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["#/submit?mode=result", "📋", "Submit result", "Add a score"],
                ["#/submit?mode=upcoming", "📅", "Add fixture", "Upcoming match"],
                ["#/submit?mode=team", "🏫", "Suggest team", "New school"],
                ["#/issues", "⚠️", "Report issue", "Flag mistake"],
              ].map(([href, icon, title, sub]) => (
                <div key={href} onClick={() => { window.location.hash = href; }} style={{
                  background: "#1E293B", borderRadius: 8, padding: "10px", border: "1px solid #334155",
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{title}</div>
                    <div style={{ fontSize: 9, color: "#64748B" }}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid #1E293B`, paddingTop: 10, marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div onClick={() => { window.location.hash = '#/login?forgot=1'; }} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14 }}>🔐</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700 }}>Security</div>
                <div style={{ fontSize: 9, color: "#64748B" }}>Password & devices</div>
              </div>
            </div>
            <div style={{ fontSize: 9, color: "#334155" }}>v{APP_VERSION}</div>
          </div>
        </div>
      )}

      {/* Version footer (non-coach) */}
      {!isCoach && (
      <div style={{ padding: "12px 14px", textAlign: "center", fontSize: 9, color: "#334155" }}>
        v{APP_VERSION}
      </div>
      )}

      <style>{`
        @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes slide-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes reaction-float { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-40px) scale(1.4); } }
      `}</style>
      {shareToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#10B981', color: '#0B0F1A', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>{shareToast}</div>
      )}
    </div>
  );
}
