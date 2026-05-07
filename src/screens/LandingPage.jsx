import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { APP_VERSION } from '../utils/constants.js';
import { parseSAST, parseSASTDate, matchOutcome, matchWinner, formatScore } from '../utils/helpers.js';
import { fetchLatestRankings, approvePendingMatch } from '../utils/sync.js';
import { logAudit } from '../utils/audit.js';
import RankBadge from '../components/RankBadge.jsx';
import MatchCardTeams from '../components/MatchCardTeams.jsx';
import SponsorBanner from '../components/SponsorBanner.jsx';
import AdminDashboardPanel from '../components/AdminDashboardPanel.jsx';
import CommDashboardPanel from '../components/CommDashboardPanel.jsx';
import CoachDashboardPanel from '../components/CoachDashboardPanel.jsx';
import CrowdDashboardPanel from '../components/CrowdDashboardPanel.jsx';
import RoleSwitcher from '../components/RoleSwitcher.jsx';
import { predictMatch } from '../utils/predict.js';
import KykieSpinner from '../components/KykieSpinner.jsx';
import { teamDisplayName, teamInitial, teamMatchesSearch, teamShortName, teamSlug, teamColor, teamDerivedName, TEAM_SELECT, MATCH_HOME_TEAM, MATCH_AWAY_TEAM } from '../utils/teams.js';
import FilterBar, { matchPassesFilter, teamPassesFilter } from '../components/FilterBar.jsx';
import BottomNav from '../components/BottomNav.jsx';
import Homepage from '../components/Homepage.jsx';
import MoreMenu from '../components/MoreMenu.jsx';

import PageHeader from '../components/PageHeader.jsx';

export default function LandingPage({ currentUser, onLogout, emailConfirmed, initialTab, onNavigate, onRoleSwitch, onBack }) {
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [liveMatches, setLiveMatches] = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [visitorCount, setVisitorCount] = useState(0);
  const [liveMatchViewers, setLiveMatchViewers] = useState({});
  const [activeTab, setActiveTab] = useState('home');
  const [scoresSub, setScoresSub] = useState('live'); // live | upcoming | results
  const [filters, setFilters] = useState({ sport: 'Hockey', gender: null, age: null });
  const [latestRankings, setLatestRankings] = useState({});
  const [showUpcoming, setShowUpcoming] = useState(20);
  const [showResults, setShowResults] = useState(20);
  const [expandedUpcoming, setExpandedUpcoming] = useState(null);
  const [searchResults, setSearchResults] = useState(null); // null = use default matches, array = search results
  const [allRecords, setAllRecords] = useState([]); // lightweight: all ended matches for record computation
  const [resultsCount, setResultsCount] = useState(0);
  const [tick, setTick] = useState(0); // forces re-render for countdown timers
  const [scoreEntryMatch, setScoreEntryMatch] = useState(null); // match to enter score for
  const [seHomeScore, setSeHomeScore] = useState(0);
  const [seAwayScore, setSeAwayScore] = useState(0);
  const [seHomePen, setSeHomePen] = useState(null);
  const [seAwayPen, setSeAwayPen] = useState(null);
  const [seSubmitting, setSeSubmitting] = useState(false);
  const [pendingScoreMatches, setPendingScoreMatches] = useState([]); // crowd-submitted scores awaiting approval
  const [userPredictions, setUserPredictions] = useState({}); // match_id -> { prediction, correct, points }
  const [leaderboard, setLeaderboard] = useState(null); // [{ user_id, name, points, correct, total }]

  // Tick every 30s for in-progress countdowns
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const openScoreEntry = (m) => {
    setScoreEntryMatch(m);
    setSeHomeScore(m.home_score || 0);
    setSeAwayScore(m.away_score || 0);
    setSeHomePen(m.home_penalty_score ?? null);
    setSeAwayPen(m.away_penalty_score ?? null);
  };

  const handleScoreSubmit = async () => {
    if (!scoreEntryMatch || !currentUser) return;
    setSeSubmitting(true);
    const m = scoreEntryMatch;
    const isAdmin = ['admin', 'commentator'].includes(currentUser.role);
    const penFields = seHomeScore === seAwayScore && seHomePen != null && seAwayPen != null
      ? { home_penalty_score: seHomePen, away_penalty_score: seAwayPen }
      : { home_penalty_score: null, away_penalty_score: null };

    if (isAdmin) {
      await supabase.from('matches').update({
        home_score: seHomeScore, away_score: seAwayScore, ...penFields,
        status: 'ended', approved_by: currentUser.id, approved_at: new Date().toISOString(),
      }).eq('id', m.id);
      logAudit('quick_score_admin', 'match', m.id, { home: seHomeScore, away: seAwayScore, ...penFields });
      setUpcomingMatches(prev => prev.filter(u => u.id !== m.id));
      setPendingScoreMatches(prev => prev.filter(p => p.id !== m.id));
    } else {
      await supabase.from('matches').update({
        home_score: seHomeScore, away_score: seAwayScore, ...penFields,
        status: 'pending', submitted_by: currentUser.id, submitted_type: 'supporter',
      }).eq('id', m.id);
      logAudit('quick_score_crowd', 'match', m.id, { home: seHomeScore, away: seAwayScore, ...penFields });
      setUpcomingMatches(prev => prev.filter(u => u.id !== m.id));
      setPendingScoreMatches(prev => [...prev, { ...m, home_score: seHomeScore, away_score: seAwayScore, ...penFields, status: 'pending', submitted_by: currentUser.id }]);
    }
    setScoreEntryMatch(null);
    setSeSubmitting(false);
  };

  const handleApproveScore = async (m) => {
    if (!confirm(`Approve ${teamDisplayName(m.home_team)} ${m.home_score}–${m.away_score} ${teamDisplayName(m.away_team)}?`)) return;
    await approvePendingMatch(m.id, currentUser.id, 'ended');
    setPendingScoreMatches(prev => prev.filter(p => p.id !== m.id));
  };

  const toggleAbandoned = async (m) => {
    const newStatus = m.status === 'abandoned' ? 'ended' : 'abandoned';
    const label = newStatus === 'abandoned' ? 'Abandon' : 'Restore';
    if (!confirm(`${label} this match?`)) return;
    await supabase.from('matches').update({ status: newStatus }).eq('id', m.id);
    logAudit(newStatus === 'abandoned' ? 'match_abandoned' : 'match_restored', 'match', m.id);
    setMatches(prev => prev.map(x => x.id === m.id ? { ...x, status: newStatus } : x));
  };

  const savePrediction = async (matchId, prediction) => {
    if (!currentUser) return;
    const existing = userPredictions[matchId];
    // Toggle off if same prediction tapped again
    if (existing && existing.prediction === prediction) {
      await supabase.from('predictions').delete().eq('user_id', currentUser.id).eq('match_id', matchId);
      setUserPredictions(prev => { const n = { ...prev }; delete n[matchId]; return n; });
      return;
    }
    const row = { user_id: currentUser.id, match_id: matchId, prediction };
    if (existing) {
      await supabase.from('predictions').update({ prediction }).eq('user_id', currentUser.id).eq('match_id', matchId);
    } else {
      await supabase.from('predictions').insert(row);
    }
    setUserPredictions(prev => ({ ...prev, [matchId]: { prediction, correct: null, points: null } }));
  };

  // Global presence tracking
  useEffect(() => {
    const channel = supabase.channel('site-presence', { config: { presence: { key: Math.random().toString(36).slice(2) } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      setVisitorCount(Object.keys(state).length);
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ page: 'landing', ts: Date.now() });
    });
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Per-match viewer counts for live matches
  useEffect(() => {
    if (liveMatches.length === 0) return;
    const channels = liveMatches.map(m => {
      const ch = supabase.channel(`match-viewers-${m.id}`, { config: { presence: { key: Math.random().toString(36).slice(2) } } });
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        setLiveMatchViewers(prev => ({ ...prev, [m.id]: Object.keys(state).length }));
      });
      ch.subscribe();
      return ch;
    });
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [liveMatches.map(m => m.id).join()]);

  useEffect(() => {
    const load = async () => {
      try {
        const [{ data: allTeams }, { data: allMatches }, { data: live }, { data: upcoming }, { data: allRecords }, { count: totalResults }] = await Promise.all([
          supabase.from('teams').select(TEAM_SELECT).or('status.eq.active,status.is.null').order('name'),
          supabase.from('matches')
            .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
            .in('status', ['ended', 'abandoned'])
            .order('match_date', { ascending: false })
            .limit(20),
          supabase.from('matches')
            .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
            .eq('status', 'live'),
          supabase.from('matches')
            .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
            .eq('status', 'upcoming')
            .order('match_date', { ascending: true })
            .order('scheduled_time', { ascending: true }),
          supabase.from('matches')
            .select('home_team_id, away_team_id, home_score, away_score, match_type, home_penalty_score, away_penalty_score')
            .eq('status', 'ended'),
          supabase.from('matches').select('id', { count: 'exact', head: true }).in('status', ['ended', 'abandoned']),
        ]);

        if (allTeams) setTeams(allTeams);
        if (allMatches) setMatches(allMatches);
        if (live) setLiveMatches(live);
        if (upcoming) setUpcomingMatches(upcoming);
        if (allRecords) setAllRecords(allRecords);
        setResultsCount(totalResults || 0);

        // Fetch pending matches with scores (crowd-submitted, awaiting approval)
        supabase.from('matches')
          .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
          .eq('status', 'pending')
          .not('home_score', 'is', null)
          .then(({ data }) => setPendingScoreMatches(data || []))
          .catch(() => {});

        // Fetch latest rankings for upcoming/live badges
        fetchLatestRankings().then(r => setLatestRankings(r)).catch(() => {});

        // Fetch predictions (user's + leaderboard)
        (async () => {
          // User's own predictions
          if (currentUser) {
            const { data: myPreds } = await supabase.from('predictions')
              .select('match_id, prediction, correct, points')
              .eq('user_id', currentUser.id);
            if (myPreds) {
              const pm = {};
              myPreds.forEach(p => { pm[p.match_id] = p; });
              setUserPredictions(pm);
            }
          }
          // Leaderboard: aggregate predictions by user
          const { data: allPreds } = await supabase.from('predictions')
            .select('user_id, correct, points')
            .not('scored_at', 'is', null);
          if (allPreds) {
            const byUser = {};
            allPreds.forEach(p => {
              const uid = p.user_id || '__kykie__';
              if (!byUser[uid]) byUser[uid] = { user_id: p.user_id, points: 0, correct: 0, total: 0 };
              byUser[uid].total++;
              byUser[uid].points += p.points || 0;
              if (p.correct) byUser[uid].correct++;
            });
            // Fetch names for non-Kykie users
            const userIds = Object.keys(byUser).filter(k => k !== '__kykie__');
            let nameMap = {};
            if (userIds.length > 0) {
              const { data: profiles } = await supabase.from('profiles')
                .select('id, username, firstname, lastname, alias_nickname')
                .in('id', userIds);
              if (profiles) profiles.forEach(p => {
                nameMap[p.id] = p.alias_nickname || p.username || `${p.firstname || ''} ${p.lastname || ''}`.trim() || 'User';
              });
            }
            const lb = Object.values(byUser).map(u => ({
              ...u,
              name: u.user_id ? (nameMap[u.user_id] || 'User') : '🤖 Kykie',
              accuracy: u.total > 0 ? Math.round(u.correct / u.total * 100) : 0,
            })).sort((a, b) => b.points - a.points || b.accuracy - a.accuracy);
            setLeaderboard(lb);
          }
        })();

        // Auto-select best scores sub-tab
        if (live && live.length > 0) setScoresSub("live");
        else if (upcoming && upcoming.length > 0) setScoresSub("upcoming");
        else setScoresSub("results");
      } catch (err) { console.error('Landing load error:', err); }
      setLoading(false);
    };
    load();

    // Poll live matches every 10s; refresh results if a match ended
    const prevLiveIdsRef = { current: new Set((liveMatches || []).map(m => m.id)) };
    const poll = setInterval(async () => {
      try {
        const { data: live } = await supabase.from('matches')
          .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
          .eq('status', 'live');
        if (live) {
          const newIds = new Set(live.map(m => m.id));
          const prevIds = prevLiveIdsRef.current;
          setLiveMatches(live);
          // If a match disappeared from live (i.e. ended), refresh results
          if (prevIds && [...prevIds].some(id => !newIds.has(id))) {
            const [{ data: freshResults }, { count: freshCount }] = await Promise.all([
              supabase.from('matches')
                .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
                .in('status', ['ended', 'abandoned']).order('match_date', { ascending: false }).limit(20),
              supabase.from('matches').select('id', { count: 'exact', head: true }).in('status', ['ended', 'abandoned']),
            ]);
            if (freshResults) setMatches(freshResults);
            setResultsCount(freshCount || 0);
            // Refresh allRecords for team stats
            const { data: freshRecords } = await supabase.from('matches')
              .select('home_team_id, away_team_id, home_score, away_score, match_type, home_penalty_score, away_penalty_score')
              .eq('status', 'ended');
            if (freshRecords) setAllRecords(freshRecords);
          }
          prevLiveIdsRef.current = newIds;
        }
      } catch {}
    }, 10000);
    return () => clearInterval(poll);
  }, []);

  // Search results from Supabase when filtering on results tab
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q || !(activeTab === 'scores' && scoresSub === 'results')) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      // Find teams matching search (search institution name, short_name, other_names, or team description)
      const { data: matchingTeams } = await supabase
        .from('teams').select('id, institution:institutions(name, short_name, other_names)').or('status.eq.active,status.is.null');
      const filtered = (matchingTeams || []).filter(t => {
        const inst = t.institution;
        const hay = [inst?.name, inst?.short_name, inst?.other_names].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
      if (!filtered.length) { setSearchResults([]); return; }
      const ids = filtered.map(t => t.id);
      // Fetch results for those teams
      const { data } = await supabase
        .from('matches')
        .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
        .in('status', ['ended', 'abandoned'])
        .or(ids.map(id => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(','))
        .order('match_date', { ascending: false })
        .limit(50);
      setSearchResults(data || []);
    }, 300); // debounce
    return () => clearTimeout(timer);
  }, [search, activeTab, scoresSub]);

  // Compute team records from ALL ended matches (exclude friendlies)
  const teamRecords = {};
  allRecords.forEach(m => {
    [m.home_team_id, m.away_team_id].forEach((tid, i) => {
      if (!tid) return;
      if (!teamRecords[tid]) teamRecords[tid] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
      const my = i === 0 ? m.home_score : m.away_score;
      const their = i === 0 ? m.away_score : m.home_score;
      teamRecords[tid].p++;
      teamRecords[tid].gf += my;
      teamRecords[tid].ga += their;
      const o = matchOutcome(m, tid);
      if (o === 'W') teamRecords[tid].w++;
      else if (o === 'D') teamRecords[tid].d++;
      else teamRecords[tid].l++;
    });
  });

  // Derive recently active team IDs from matches (ordered by most recent)
  const recentTeamIds = [];
  matches.forEach(m => {
    [m.home_team?.id, m.away_team?.id].forEach(id => {
      if (id && !recentTeamIds.includes(id)) recentTeamIds.push(id);
    });
  });

  const filteredTeams = (() => {
    let list = teams.filter(t => teamPassesFilter(t, filters));
    if (search.trim()) {
      list = list.filter(t => teamMatchesSearch(t, search));
    }
    return list.sort((a, b) => teamDisplayName(a).localeCompare(teamDisplayName(b)));
  })();

  // teamSlug imported from teams.js

  // "In Progress" = upcoming matches whose kickoff has passed (up to 2h after estimated end for "Awaiting score")
  const now = Date.now();
  const inProgressUpcoming = upcomingMatches.filter(m => {
    if (!m.scheduled_time) return false;
    const kickoff = parseSAST(m.match_date, m.scheduled_time).getTime();
    const awaitingBuffer = ((m.match_length || 60) + 120) * 60000; // match + 2h buffer
    return now >= kickoff && now <= kickoff + awaitingBuffer;
  });
  // Combined: live matches + in-progress upcoming + pending scores (deduplicated by id)
  const liveIds = new Set(liveMatches.map(m => m.id));
  const inProgressIds = new Set(inProgressUpcoming.map(m => m.id));
  const allInProgress = [
    ...liveMatches,
    ...inProgressUpcoming.filter(m => !liveIds.has(m.id)),
    ...pendingScoreMatches.filter(m => !liveIds.has(m.id) && !inProgressIds.has(m.id)),
  ];

  const resultBadge = (m, teamId) => {
    if (m.status === 'abandoned') return { label: "ABN", cls: "rb-abn" };
    const o = matchOutcome(m, teamId);
    const hasPen = m.home_penalty_score != null && m.away_penalty_score != null;
    if (o === 'W') return { label: "W", cls: "rb-w", pen: hasPen };
    if (o === 'L') return { label: "L", cls: "rb-l", pen: hasPen };
    return { label: "D", cls: "rb-d" };
  };

  const CommentaryIcon = ({ title }) => (
    <span title={title || "Full stats + commentary"} style={{ display: "inline-flex", alignItems: "center", cursor: "help" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </span>
  );

  const venueDisplay = (m) => {
    if (!m.venue) return "";
    const prefix = m.match_type ? m.match_type.charAt(0).toUpperCase() + m.match_type.slice(1) + " @ " : "";
    return prefix + m.venue;
  };

  const getCountdown = (matchDate, scheduledTime) => {
    if (!scheduledTime) return null;
    const kickoff = parseSAST(matchDate, scheduledTime);
    const now = new Date();
    const diff = kickoff - now;
    if (diff <= 0) return { text: "Now", color: "#10B981" };
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return { text: `${days}d ${hours % 24}h`, color: "#64748B" };
    if (hours > 0) return { text: `${hours}h ${mins % 60}m`, color: "#F59E0B" };
    return { text: `${mins}m`, color: "#EF4444" };
  };

  return (
    <div style={styles.page}>
      <style>{`
        .rb-w { background: #10B98122; color: #10B981; border: 1.5px solid #10B98144; }
        .rb-l { background: #EF444422; color: #EF4444; border: 1.5px solid #EF444444; }
        .rb-d { background: #F59E0B22; color: #F59E0B; border: 1.5px solid #F59E0B44; }
        .rb-abn { background: #64748B22; color: #64748B; border: 1.5px solid #64748B44; font-size: 8px !important; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Hero - scrolls away */}
      {/* Header */}
      <PageHeader currentUser={currentUser} onLogout={onLogout} onRoleSwitch={onRoleSwitch}
        onBack={activeTab !== 'home' ? () => setActiveTab('home') : (onBack || null)} />

      <SponsorBanner tier="platform" size="lg" />

      {/* Email confirmation banner */}
      {emailConfirmed && (
        <div style={{
          margin: "8px 16px", padding: "12px 16px", borderRadius: 10,
          background: "#10B98122", border: "1px solid #10B98144",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#10B981" }}>Email verified!</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>Your account is active. Welcome to kykie!</div>
          </div>
        </div>
      )}

      {/* Search + filters (for scores and teams tabs) */}
      {(activeTab === "scores" || activeTab === "teams") && (
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#0B0F1A", padding: "8px 16px" }}>
        {activeTab === "scores" && (
          <div style={{ display: "flex", gap: 0, justifyContent: "center", borderRadius: 8, overflow: "hidden", border: "1px solid #334155", marginBottom: 8 }}>
            {[
              { id: "live", label: "Live", count: allInProgress.length, dot: liveMatches.length > 0 },
              { id: "upcoming", label: "Upcoming", count: upcomingMatches.length - inProgressUpcoming.length },
              { id: "results", label: "Results", count: resultsCount },
            ].map(t => (
              <button key={t.id} onClick={() => setScoresSub(t.id)} style={{
                flex: 1, padding: "7px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
                background: scoresSub === t.id ? "#10B98122" : "#1E293B",
                color: scoresSub === t.id ? "#10B981" : "#64748B",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  {t.dot && t.count > 0 && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />}
                  {t.label}
                </div>
                {t.count > 0 && <div style={{ fontSize: 9, opacity: 0.7 }}>({t.count})</div>}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1E293B", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
          <span style={{ color: "#475569", fontSize: 13 }}>🔍</span>
          <input
            style={styles.searchInput}
            value={search}
            onChange={e => { setSearch(e.target.value); setShowUpcoming(20); setShowResults(20); }}
            placeholder="Search..."
          />
            {search && (
              <button onClick={() => { setSearch(""); setShowUpcoming(20); setShowResults(20); }} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 14 }}>✕</button>
            )}
          </div>
          <FilterBar sport={filters.sport} gender={filters.gender} age={filters.age} onChange={setFilters} />
        </div>
        )}

      {loading ? (
        <KykieSpinner />
      ) : (
        <>

          {/* ═══ HOME TAB ═══ */}
          {activeTab === "home" && (
            <Homepage currentUser={currentUser} liveMatches={liveMatches} onNavigate={(tab) => { setActiveTab(tab); }} />
          )}

          {/* ═══ MORE TAB ═══ */}
          {activeTab === "more" && (
            <MoreMenu currentUser={currentUser} onLogout={onLogout} />
          )}

          {/* ═══ RANKINGS TAB ═══ */}
          {activeTab === "rankings" && (() => {
            const ranked = Object.entries(latestRankings)
              .filter(([,r]) => r.rank)
              .sort((a, b) => a[1].rank - b[1].rank);
            const teamMap = {};
            teams.forEach(t => { teamMap[t.id] = t; });
            return (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Rankings</div>
                <FilterBar sport={filters.sport} gender={filters.gender} age={filters.age} onChange={setFilters} />
                <div style={{ marginTop: 8 }}>
                  {ranked.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 30, color: "#475569", fontSize: 12 }}>No rankings yet</div>
                  ) : ranked.map(([teamId, r]) => {
                    const t = teamMap[teamId];
                    if (!t) return null;
                    if (!teamPassesFilter(t, filters)) return null;
                    const c = teamColor(t) || '#64748B';
                    return (
                      <div key={teamId} onClick={() => { window.location.hash = `#/team/${teamSlug(t)}`; }}
                        style={{ ...styles.teamRow, cursor: 'pointer' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#fff' }}>
                          {r.rank}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={styles.teamName}>{teamDisplayName(t)}</div>
                          <div style={styles.teamRecord}>{teamDerivedName(t)}</div>
                        </div>
                        {r.prevRank && r.prevRank !== r.rank && (
                          <div style={{ fontSize: 10, color: r.rank < r.prevRank ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                            {r.rank < r.prevRank ? '▲' : '▼'}{Math.abs(r.rank - r.prevRank)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ═══ IN PROGRESS TAB ═══ */}
          {activeTab === "scores" && scoresSub === "live" && (() => {
            const q = search.trim().toLowerCase();
            const filtered = allInProgress.filter(m =>
              matchPassesFilter(m, filters) &&
              (!q || teamMatchesSearch(m.home_team, q) || teamMatchesSearch(m.away_team, q) || (m.venue || "").toLowerCase().includes(q))
            );

            return (
            <div style={styles.section}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#475569", fontSize: 12 }}>
                  {q ? "No matches found" : "No matches in progress"}
                </div>
              ) : (
                filtered.map(m => {
                  const isLive = m.status === 'live';
                  const isPending = m.status === 'pending';
                  const homeSlug = teamSlug(m.home_team);
                  const d = parseSASTDate(m.match_date);
                  const isAdmin = currentUser && ['admin', 'commentator'].includes(currentUser.role);

                  // Determine awaiting state for upcoming matches
                  const kickoff = m.scheduled_time ? parseSAST(m.match_date, m.scheduled_time).getTime() : 0;
                  const duration = (m.match_length || 60) * 60000;
                  const endTime = kickoff + duration;
                  const remaining = Math.max(0, endTime - Date.now());
                  const expired = !isLive && !isPending && remaining <= 0;
                  const mins = Math.ceil(remaining / 60000);

                  const cardClick = isLive
                    ? () => { window.location.hash = `#/team/${homeSlug}`; }
                    : (expired && currentUser) ? () => openScoreEntry(m)
                    : undefined;

                  const borderColor = isLive ? "#10B98133" : isPending ? "#8B5CF633" : "#F59E0B33";
                  const bgColor = isLive ? "#10B98108" : isPending ? "#8B5CF608" : "#F59E0B08";

                  return (
                    <div key={m.id}
                      onClick={cardClick}
                      style={{
                        ...styles.scoreCard,
                        border: `1px solid ${borderColor}`,
                        background: bgColor,
                        cursor: (isLive || (expired && currentUser)) ? "pointer" : "default",
                      }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 7,
                        background: isLive ? "#10B98122" : isPending ? "#8B5CF622" : "#F59E0B22",
                        border: isLive ? "1.5px solid #10B98144" : isPending ? "1.5px solid #8B5CF644" : "1.5px solid #F59E0B33",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {isLive ? (
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", animation: "pulse 2s infinite", display: "inline-block" }} />
                        ) : isPending ? (
                          <span style={{ fontSize: 10 }}>⏳</span>
                        ) : (
                          <span style={{ fontSize: 12 }}>🏑</span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <MatchCardTeams home={m.home_team} away={m.away_team}
                          homeRank={latestRankings[m.home_team?.id]?.rank}
                          awayRank={latestRankings[m.away_team?.id]?.rank}
                          meta={isLive
                            ? `${m.venue ? (m.match_type ? m.match_type.charAt(0).toUpperCase() + m.match_type.slice(1) + ' @ ' : '') + m.venue : ''}`
                            : `${d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}${m.scheduled_time ? ' · ' + m.scheduled_time.slice(0, 5) : ''}${m.venue ? ' · ' + m.venue : ''}`
                          } />
                        {isLive && liveMatchViewers[m.id] > 0 && (
                          <div style={{ fontSize: 9, color: "#10B981", fontWeight: 700, marginTop: 2 }}>👁 {liveMatchViewers[m.id]} watching</div>
                        )}
                      </div>
                      {isLive ? (
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#10B981" }}>{m.home_score}–{m.away_score}</div>
                      ) : isPending ? (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 18, fontWeight: 900, color: "#8B5CF6" }}>{m.home_score}–{m.away_score}</div>
                          {isAdmin ? (
                            <button onClick={(e) => { e.stopPropagation(); handleApproveScore(m); }} style={{
                              fontSize: 8, fontWeight: 700, color: '#10B981', background: '#10B98122', border: '1px solid #10B98144',
                              borderRadius: 4, padding: '2px 6px', cursor: 'pointer', marginTop: 2,
                            }}>Approve</button>
                          ) : (
                            <div style={{ fontSize: 8, fontWeight: 700, color: '#8B5CF6', marginTop: 2 }}>Pending Approval</div>
                          )}
                        </div>
                      ) : (
                        <div style={{ textAlign: 'right' }}>
                          {!expired && <div style={{ fontSize: 11, fontWeight: 900, fontFamily: 'monospace', color: mins <= 5 ? '#EF4444' : mins <= 15 ? '#F59E0B' : '#10B981' }}>{mins}m</div>}
                          <div style={{ fontSize: 8, fontWeight: 700, color: expired ? (currentUser ? '#F59E0B' : '#EF4444') : '#F59E0B' }}>
                            {expired ? (currentUser ? 'Enter score →' : 'Awaiting score') : 'In progress'}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
            </div>
            );
          })()}

          {/* ═══ UPCOMING TAB ═══ */}
          {activeTab === "scores" && scoresSub === "upcoming" && (() => {
            const inProgressIds = new Set(inProgressUpcoming.map(m => m.id));
            const notStarted = upcomingMatches.filter(m => !inProgressIds.has(m.id));
            const q = search.trim().toLowerCase();
            const filtered = notStarted.filter(m =>
              matchPassesFilter(m, filters) &&
              (!q || teamMatchesSearch(m.home_team, q) || teamMatchesSearch(m.away_team, q) || (m.venue || "").toLowerCase().includes(q))
            );
            const LeaderboardSummary = () => {
              if (!currentUser || !leaderboard || leaderboard.length === 0) return null;
              const myEntry = leaderboard.find(l => l.user_id === currentUser.id);
              const myRank = myEntry ? leaderboard.indexOf(myEntry) + 1 : null;
              const kykieEntry = leaderboard.find(l => !l.user_id);
              const kykieRank = kykieEntry ? leaderboard.indexOf(kykieEntry) + 1 : null;
              const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
              return (
                <div onClick={() => onNavigate && onNavigate('predictions')} style={{
                  background: "linear-gradient(135deg,#1E293B,#0F172A)", borderRadius: 10, padding: "10px 12px",
                  marginBottom: 8, border: "1px solid #F59E0B33", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#3B82F622", border: "2px solid #3B82F644", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: "#3B82F6", flexShrink: 0 }}>
                    {myRank ? ordinal(myRank) : '—'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#F8FAFC" }}>
                      {myEntry ? `${myEntry.points} pts · ${myEntry.accuracy}% accuracy` : 'No predictions yet'}
                    </div>
                    <div style={{ fontSize: 8, color: "#475569" }}>
                      {myEntry ? `${myEntry.total} predictions` : 'Predict upcoming matches below'}
                      {kykieEntry && kykieRank ? ` · 🤖 Kykie is ${ordinal(kykieRank)} (${kykieEntry.accuracy}%)` : ''}
                    </div>
                  </div>
                  <div style={{ color: "#475569", fontSize: 14 }}>›</div>
                </div>
              );
            };
            return (
            <div style={styles.section}>
              <LeaderboardSummary />
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#475569", fontSize: 12 }}>
                  {q ? "No matches found" : "No upcoming matches scheduled"}
                  {!currentUser && !q && <div style={{ marginTop: 12 }}><button onClick={() => { window.location.hash = "#/register"; }} style={{ fontSize: 11, color: "#F59E0B", background: "#F59E0B11", border: "1px solid #F59E0B44", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>Register to add upcoming matches</button></div>}
                </div>
              ) : (
                <>
                {filtered.slice(0, showUpcoming).map(m => {
                  const d = parseSASTDate(m.match_date);
                  const homeSlug = teamSlug(m.home_team);
                  const awaySlug = teamSlug(m.away_team);
                  const hc = m.home_team?.color || "#3B82F6";
                  const ac = m.away_team?.color || "#EF4444";
                  const isExp = expandedUpcoming === m.id;
                  return (
                    <div key={m.id} style={{ marginBottom: 4 }}>
                      <div onClick={() => setExpandedUpcoming(isExp ? null : m.id)}
                        style={{ ...styles.scoreCard, cursor: "pointer", borderRadius: isExp ? "10px 10px 0 0" : 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 7, background: hc, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{d.getDate()}</div>
                          <div style={{ fontSize: 7, fontWeight: 700, color: "#ffffffcc", textTransform: "uppercase" }}>{d.toLocaleDateString("en-ZA", { month: "short" })}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <MatchCardTeams home={m.home_team} away={m.away_team}
                            homeRank={latestRankings[m.home_team?.id]?.rank}
                            awayRank={latestRankings[m.away_team?.id]?.rank}
                            meta={`${d.toLocaleDateString("en-ZA", { weekday: "short" })}${m.scheduled_time ? ' · ' + m.scheduled_time.slice(0, 5) : ''}${m.match_type ? ' · ' + m.match_type.charAt(0).toUpperCase() + m.match_type.slice(1) : ''}`} />
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          {(() => { const cd = getCountdown(m.match_date, m.scheduled_time); return cd ? <div style={{ fontSize: 10, fontWeight: 700, color: cd.color, fontFamily: "monospace" }}>{cd.text}</div> : null; })()}
                          {m.venue && <div style={{ fontSize: 9, color: "#475569", fontWeight: 600 }}>{m.venue}</div>}
                        </div>
                      </div>
                      {/* Prediction buttons */}
                      {currentUser && (() => {
                        const myPred = userPredictions[m.id];
                        const hRec = teamRecords[m.home_team?.id];
                        const aRec = teamRecords[m.away_team?.id];
                        const kp = predictMatch(hRec, aRec, teamShortName(m.home_team), teamShortName(m.away_team), { homeRank: latestRankings[m.home_team?.id]?.rank, awayRank: latestRankings[m.away_team?.id]?.rank });
                        const kPred = kp ? (kp.draw >= kp.homeWin && kp.draw >= kp.awayWin ? 'draw' : kp.homeWin >= kp.awayWin ? 'home' : 'away') : null;
                        const kLabel = kp ? (kPred === 'home' ? teamShortName(m.home_team) : kPred === 'away' ? teamShortName(m.away_team) : 'Draw') : null;
                        const kConf = kp ? Math.max(kp.homeWin, kp.draw, kp.awayWin) : null;
                        const agree = myPred && kPred && myPred.prediction === kPred;
                        const disagree = myPred && kPred && myPred.prediction !== kPred;
                        const btnStyle = (key) => ({
                          flex: key === 'draw' ? 0.7 : 1, padding: "5px 0", borderRadius: 5,
                          border: `1px solid ${myPred?.prediction === key ? '#F59E0B' : '#33415566'}`,
                          background: myPred?.prediction === key ? '#F59E0B11' : '#0B0F1A',
                          textAlign: "center", cursor: "pointer", fontSize: 9, fontWeight: 700,
                          color: myPred?.prediction === key ? '#F59E0B' : '#64748B',
                        });
                        return (
                          <div style={{ background: "#1E293B", borderRadius: isExp ? 0 : "0 0 10px 10px", padding: "4px 10px 6px", marginTop: -4, border: "1px solid #334155", borderTop: "1px solid #33415522" }}>
                            <div style={{ display: "flex", gap: 3 }}>
                              {['home', 'draw', 'away'].map(key => (
                                <div key={key} onClick={(e) => { e.stopPropagation(); savePrediction(m.id, key); }}
                                  style={btnStyle(key)}>
                                  {myPred?.prediction === key ? '✓ ' : ''}{key === 'home' ? teamShortName(m.home_team) : key === 'away' ? teamShortName(m.away_team) : 'Draw'}
                                </div>
                              ))}
                            </div>
                            <div style={{ textAlign: "center", fontSize: 7, color: "#475569", marginTop: 3 }}>
                              {kp ? `🤖 Kykie: ${kLabel} (${kConf}%)` : '🤖 Kykie: not enough data'}
                              {agree && <span style={{ color: "#10B981" }}> · you agree</span>}
                              {disagree && <span style={{ color: "#EF4444" }}> · you disagree</span>}
                            </div>
                          </div>
                        );
                      })()}
                      {!currentUser && (
                        <div style={{ background: "#1E293B", borderRadius: isExp ? 0 : "0 0 10px 10px", padding: "6px 10px", marginTop: -4, border: "1px solid #334155", borderTop: "1px solid #33415522", textAlign: "center", fontSize: 9, color: "#475569" }}>
                          <span onClick={() => { window.location.hash = '#/login'; }} style={{ color: "#F59E0B", cursor: "pointer", fontWeight: 700 }}>Log in</span> to predict
                        </div>
                      )}
                      {isExp && (() => {
                        const hRec = teamRecords[m.home_team?.id];
                        const aRec = teamRecords[m.away_team?.id];
                        const pred = predictMatch(hRec, aRec, teamShortName(m.home_team), teamShortName(m.away_team), { homeRank: latestRankings[m.home_team?.id]?.rank, awayRank: latestRankings[m.away_team?.id]?.rank });
                        return (
                        <div style={{ background: "#1E293B", borderRadius: "0 0 10px 10px", padding: "6px 8px 8px", borderTop: "1px solid #33415544" }}>
                          {/* Prediction */}
                          {pred && (() => {
                            const isDraw = pred.draw >= pred.homeWin && pred.draw >= pred.awayWin;
                            const homeWins = pred.homeWin >= pred.awayWin && pred.homeWin > pred.draw;
                            const winner = homeWins ? teamShortName(m.home_team) : teamShortName(m.away_team);
                            return (
                            <div style={{ background: "linear-gradient(135deg,#1E293B,#0F172A)", borderRadius: 8, padding: "10px 12px", marginBottom: 6, border: "1px solid #F59E0B33" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                <span style={{ fontSize: 12 }}>🔮</span>
                                <span style={{ fontSize: 9, fontWeight: 800, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1 }}>kykie predicts</span>
                              </div>
                              <div style={{ textAlign: "center", marginBottom: 10 }}>
                                <div style={{ fontSize: 18, fontWeight: 900, color: isDraw ? "#F59E0B" : "#F8FAFC" }}>
                                  {isDraw ? "Draw" : `${winner} to win`}
                                </div>
                                <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>
                                  Based on {hRec?.p || 0} and {aRec?.p || 0} matches played
                                </div>
                              </div>
                              <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                                <div style={{ width: `${pred.homeWin}%`, background: "#10B981" }} />
                                <div style={{ width: `${pred.draw}%`, background: "#F59E0B" }} />
                                <div style={{ width: `${pred.awayWin}%`, background: "#64748B" }} />
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, fontWeight: 700 }}>
                                <span style={{ color: "#10B981" }}>{teamShortName(m.home_team)} {pred.homeWin}%</span>
                                <span style={{ color: "#F59E0B" }}>Draw {pred.draw}%</span>
                                <span style={{ color: "#64748B" }}>{teamShortName(m.away_team)} {pred.awayWin}%</span>
                              </div>
                              {pred.reasons.length > 0 && (
                                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #33415544" }}>
                                  {pred.reasons.map((r, i) => (
                                    <div key={i} style={{ fontSize: 9, color: r.type === 'home' ? '#10B981' : r.type === 'away' ? '#64748B' : '#F59E0B', lineHeight: 1.6 }}>
                                      {r.type === 'neutral' ? '~' : '+'} {r.text}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            );
                          })()}
                          {/* Scouting cards */}
                          <div style={{ display: "flex", gap: 6 }}>
                          {[[m.home_team, homeSlug, hc], [m.away_team, awaySlug, ac]].map(([t, slug, c]) => {
                            const rec = teamRecords[t?.id];
                            return (
                            <div key={slug} onClick={(e) => { e.stopPropagation(); window.location.hash = `#/team/${slug}`; }}
                              style={{
                                flex: 1, minWidth: 0, overflow: "hidden", padding: "8px 10px",
                                background: "#0B0F1A", borderRadius: 8, cursor: "pointer",
                                border: `1px solid ${c}33`,
                              }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <div style={{
                                  width: 28, height: 28, borderRadius: 7, background: c + "22", border: `1.5px solid ${c}44`,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 11, fontWeight: 800, color: c, flexShrink: 0,
                                }}>{teamInitial(t)}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontSize: 12, fontWeight: 800, color: "#F8FAFC", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{teamShortName(t)}</span>
                                    {(() => { const r = latestRankings[t?.id]; return r ? <span style={{ flexShrink: 0 }}><RankBadge rank={r.rank} /></span> : null; })()}
                                  </div>
                                  <div style={{ fontSize: 9, color: "#64748B", fontWeight: 600 }}>{teamDerivedName(t)}</div>
                                </div>
                              </div>
                              {rec ? (
                                <div style={{ display: "flex", justifyContent: "space-between", textAlign: "center", marginBottom: 4 }}>
                                  {[["P", rec.p, "#F8FAFC"], ["W", rec.w, "#10B981"], ["D", rec.d, "#64748B"], ["L", rec.l, "#EF4444"]].map(([lbl, val, clr]) => (
                                    <div key={lbl}>
                                      <div style={{ fontSize: 13, fontWeight: 900, color: clr }}>{val}</div>
                                      <div style={{ fontSize: 7, fontWeight: 700, color: "#475569" }}>{lbl}</div>
                                    </div>
                                  ))}
                                  {[["GF", rec.gf], ["GA", rec.ga], ["GD", rec.gf - rec.ga]].map(([lbl, val]) => (
                                    <div key={lbl}>
                                      <div style={{ fontSize: 13, fontWeight: 900, color: "#F8FAFC" }}>{val}</div>
                                      <div style={{ fontSize: 7, fontWeight: 700, color: "#475569" }}>{lbl}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ fontSize: 9, color: "#475569", textAlign: "center", marginBottom: 4 }}>No matches yet</div>
                              )}
                              <div style={{ fontSize: 9, color: c, fontWeight: 700, textAlign: "center" }}>View stats →</div>
                            </div>
                          );})}
                          </div>
                        </div>
                        );
                      })()}
                    </div>
                  );
                })}
                {filtered.length > showUpcoming && (
                  <div onClick={() => setShowUpcoming(prev => prev + 20)}
                    style={{ textAlign: "center", padding: "10px 0", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>
                    Show more ({filtered.length - showUpcoming} remaining)
                  </div>
                )}
                </>
              )}
              {currentUser && (
                <div style={{ textAlign: "center", padding: "12px 0 4px", display: "flex", justifyContent: "center", gap: 8 }}>
                  <button onClick={() => { window.location.hash = '#/submit?mode=upcoming'; }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 8, background: "#F59E0B", color: "#0B0F1A", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}>+ Add upcoming match</button>
                  <button onClick={() => { window.location.hash = '#/issues'; }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 8, background: "transparent", color: "#EF4444", fontSize: 11, fontWeight: 700, border: "1px solid #EF444444", cursor: "pointer" }}>Report issue</button>
                </div>
              )}
              {!currentUser && filtered.length > 0 && (
                <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
                  <button onClick={() => { window.location.hash = '#/register'; }} style={{ display: "inline-block", padding: "6px 14px", borderRadius: 6, border: "1px solid #F59E0B44", background: "#F59E0B11", color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Register to add upcoming matches</button>
                </div>
              )}
            </div>
            );
          })()}

          {/* ═══ RESULTS TAB ═══ */}
          {activeTab === "scores" && scoresSub === "results" && (() => {
            const q = search.trim().toLowerCase();
            const base = q ? (searchResults || []) : matches;
            const filtered = base.filter(m => matchPassesFilter(m, filters));
            const LeaderboardSummary = () => {
              if (!currentUser || !leaderboard || leaderboard.length === 0) return null;
              const myEntry = leaderboard.find(l => l.user_id === currentUser.id);
              const myRank = myEntry ? leaderboard.indexOf(myEntry) + 1 : null;
              const kykieEntry = leaderboard.find(l => !l.user_id);
              const kykieRank = kykieEntry ? leaderboard.indexOf(kykieEntry) + 1 : null;
              const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
              return (
                <div onClick={() => onNavigate && onNavigate('predictions')} style={{
                  background: "linear-gradient(135deg,#1E293B,#0F172A)", borderRadius: 10, padding: "10px 12px",
                  marginBottom: 8, border: "1px solid #F59E0B33", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#3B82F622", border: "2px solid #3B82F644", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: "#3B82F6", flexShrink: 0 }}>
                    {myRank ? ordinal(myRank) : '—'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#F8FAFC" }}>
                      {myEntry ? `${myEntry.points} pts · ${myEntry.accuracy}% accuracy` : 'No predictions yet'}
                    </div>
                    <div style={{ fontSize: 8, color: "#475569" }}>
                      {myEntry ? `${myEntry.total} predictions` : 'Predict upcoming matches'}
                      {kykieEntry && kykieRank ? ` · 🤖 Kykie is ${ordinal(kykieRank)} (${kykieEntry.accuracy}%)` : ''}
                    </div>
                  </div>
                  <div style={{ color: "#475569", fontSize: 14 }}>›</div>
                </div>
              );
            };
            return (
            <div style={styles.section}>
              <LeaderboardSummary />
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#475569", fontSize: 12 }}>
                  {q ? "No matches found" : "No results yet"}
                  {!currentUser && !q && <div style={{ marginTop: 12 }}><button onClick={() => { window.location.hash = "#/register"; }} style={{ fontSize: 11, color: "#F59E0B", background: "#F59E0B11", border: "1px solid #F59E0B44", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>Register to add past results</button></div>}
                </div>
              ) : (
                filtered.slice(0, showResults).map(m => {
                  const homeR = resultBadge(m, m.home_team?.id);
                  const d = parseSASTDate(m.match_date);
                  const homeSlug = teamSlug(m.home_team);
                  const myPred = userPredictions[m.id];
                  return (
                    <div key={m.id} style={{ marginBottom: 4, opacity: m.status === 'abandoned' ? 0.5 : 1 }}>
                      <div onClick={() => { window.location.hash = `#/team/${homeSlug}?match=${m.id}`; }}
                        style={{ ...styles.scoreCard, cursor: "pointer", borderRadius: myPred ? "10px 10px 0 0" : 10 }}>
                        <div className={homeR.cls} style={styles.resultBadge}>{homeR.label}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...styles.matchTeams, display: "flex", alignItems: "center", gap: 5 }}>
                            <MatchCardTeams home={m.home_team} away={m.away_team}
                              homeRank={m.home_rank ?? latestRankings[m.home_team?.id]?.rank}
                              awayRank={m.away_rank ?? latestRankings[m.away_team?.id]?.rank}
                              meta={`${d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}${m.venue ? ` · ${venueDisplay(m)}` : ''}`} />
                            {m.duration > 0 && <CommentaryIcon />}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 50 }}>
                          <div style={styles.matchScore}>{m.home_score}–{m.away_score}</div>
                          {m.home_penalty_score != null && m.away_penalty_score != null && (
                            <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 800, background: '#F59E0B15', borderRadius: 4, padding: '1px 6px', marginTop: 2 }}>{m.home_penalty_score}-{m.away_penalty_score} pen</div>
                          )}
                          {m.status === 'abandoned' && (
                            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, marginTop: 2 }}>Abandoned</div>
                          )}
                        </div>
                      </div>
                      {myPred && myPred.correct !== null && (() => {
                        const actual = matchWinner(m);
                        // Find Kykie's prediction for this match
                        const kykiePredObj = leaderboard ? null : null; // loaded separately below
                        return (
                          <div style={{ background: "#1E293B", borderRadius: "0 0 10px 10px", padding: "3px 10px 6px", border: "1px solid #334155", borderTop: "1px solid #33415522", display: "flex", gap: 4 }}>
                            <div style={{ flex: 1, textAlign: "center", padding: 3, borderRadius: 4, background: myPred.correct ? '#10B98118' : '#EF444418', fontSize: 8, fontWeight: 700, color: myPred.correct ? '#10B981' : '#EF4444' }}>
                              {myPred.correct ? '✓' : '✗'} You: {myPred.prediction === 'home' ? teamShortName(m.home_team) : myPred.prediction === 'away' ? teamShortName(m.away_team) : 'Draw'} ({myPred.correct ? '+1' : '0'})
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })
              )}
              {filtered.length > showResults && (
                <div onClick={() => setShowResults(prev => prev + 20)} style={{ textAlign: "center", padding: "10px 0", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>
                  Show more ({filtered.length - showResults} remaining)
                </div>
              )}
              {currentUser && (
                <div style={{ textAlign: "center", padding: "12px 0 4px", display: "flex", justifyContent: "center", gap: 8 }}>
                  <button onClick={() => { window.location.hash = '#/submit?mode=result'; }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 8, background: "#F59E0B", color: "#0B0F1A", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}>+ Add a result</button>
                  <button onClick={() => { window.location.hash = '#/issues'; }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 8, background: "transparent", color: "#EF4444", fontSize: 11, fontWeight: 700, border: "1px solid #EF444444", cursor: "pointer" }}>Report issue</button>
                </div>
              )}
              {!currentUser && (
                <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
                  <button onClick={() => { window.location.hash = '#/register'; }} style={{ display: "inline-block", padding: "6px 14px", borderRadius: 6, border: "1px solid #F59E0B44", background: "#F59E0B11", color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Register to add past results</button>
                </div>
              )}
            </div>
            );
          })()}

          {/* ═══ TEAMS TAB ═══ */}
          {activeTab === "teams" && (() => {
            // Group filtered teams by institution
            const byInst = {};
            filteredTeams.forEach(t => {
              const instId = t.institution?.id || 'unknown';
              if (!byInst[instId]) byInst[instId] = { institution: t.institution, teams: [] };
              byInst[instId].teams.push(t);
            });
            const instGroups = Object.values(byInst).sort((a, b) =>
              (a.institution?.name || '').localeCompare(b.institution?.name || '')
            );

            return (
            <div style={styles.section}>
              {filteredTeams.length === 0 ? (
                <div style={{ textAlign: "center", padding: 16, color: "#475569", fontSize: 12 }}>
                  {search.trim() ? "No teams found" : "No teams yet"}
                  {!currentUser && !search.trim() && <div style={{ marginTop: 12 }}><button onClick={() => { window.location.hash = "#/register"; }} style={{ fontSize: 11, color: "#F59E0B", background: "#F59E0B11", border: "1px solid #F59E0B44", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>Register to add your team</button></div>}
                </div>
              ) : (
                instGroups.map(({ institution: inst, teams: instTeams }) => (
                  <div key={inst?.id || 'unknown'} style={{ marginBottom: 12 }}>
                    {/* Institution header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', marginBottom: 2 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 7, background: inst?.color || '#334155',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0,
                      }}>{(inst?.short_name || inst?.name || '?').charAt(0)}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', flex: 1 }}>{inst?.name || 'Unknown'}</div>
                      {(() => { const rk = instTeams[0] ? latestRankings[instTeams[0].id] : null; return rk ? <RankBadge rank={rk.rank} /> : null; })()}
                    </div>
                    {/* Teams under this institution */}
                    {instTeams.map(t => {
                      const r = teamRecords[t.id];
                      const winRate = r && r.p > 0 ? Math.round(r.w / r.p * 100) : 0;
                      const barColor = winRate >= 50 ? '#10B981' : winRate >= 25 ? '#F59E0B' : r?.p > 0 ? '#EF4444' : '#334155';
                      const gd = r ? r.gf - r.ga : 0;
                      return (
                        <div key={t.id} onClick={() => { window.location.hash = `#/team/${teamSlug(t)}`; }}
                          style={{ marginLeft: 38, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#1E293B', borderRadius: '0 8px 8px 0', marginBottom: 4, borderLeft: `3px solid ${teamColor(t)}`, cursor: 'pointer' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#CBD5E1' }}>{teamDerivedName(t)}</div>
                            {r && r.p > 0 ? (<>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#334155', overflow: 'hidden', maxWidth: 100 }}>
                                  <div style={{ width: `${winRate}%`, height: '100%', background: barColor }} />
                                </div>
                                <span style={{ fontSize: 9, color: '#94A3B8' }}>{r.p}P {r.w}W {r.d}D {r.l}L · {winRate}%</span>
                              </div>
                            </>) : (
                              <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>No matches yet</div>
                            )}
                          </div>
                          <span style={{ color: "#334155", fontSize: 12 }}>›</span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              {currentUser && (
                <div style={{ textAlign: "center", padding: "12px 0 4px", display: "flex", justifyContent: "center", gap: 8 }}>
                  <button onClick={() => { window.location.hash = '#/submit?mode=team'; }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 8, background: "#F59E0B", color: "#0B0F1A", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}>+ Suggest a team</button>
                  <button onClick={() => { window.location.hash = '#/issues'; }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 8, background: "transparent", color: "#EF4444", fontSize: 11, fontWeight: 700, border: "1px solid #EF444444", cursor: "pointer" }}>Report issue</button>
                </div>
              )}
              {!currentUser && (
                <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
                  <button onClick={() => { window.location.hash = '#/register'; }} style={{ display: "inline-block", padding: "6px 14px", borderRadius: 6, border: "1px solid #F59E0B44", background: "#F59E0B11", color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Register to add missing teams</button>
                </div>
              )}
            </div>
            );
          })()}
        </>
      )}

      {/* Footer */}
      <div style={styles.footer}>
        {(
          <div style={{ fontSize: 10, color: "#64748B", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
            {visitorCount + 100} visitors online
          </div>
        )}
        <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>kykie · v{APP_VERSION}</div>
      </div>

      {/* Score Entry Popup */}
      {scoreEntryMatch && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          onClick={() => setScoreEntryMatch(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#1E293B", borderRadius: 16, padding: "20px 16px", width: 300, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#F8FAFC", marginBottom: 4 }}>
              {teamDisplayName(scoreEntryMatch.home_team)} vs {teamDisplayName(scoreEntryMatch.away_team)}
            </div>
            <div style={{ fontSize: 10, color: "#64748B", marginBottom: 16 }}>
              {parseSASTDate(scoreEntryMatch.match_date).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
              {scoreEntryMatch.venue && ` · ${scoreEntryMatch.venue}`}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700, marginBottom: 6 }}>{teamShortName(scoreEntryMatch.home_team)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => setSeHomeScore(Math.max(0, seHomeScore - 1))} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #334155", background: "#0B0F1A", color: "#F8FAFC", fontSize: 18, cursor: "pointer" }}>–</button>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#F8FAFC", width: 40 }}>{seHomeScore}</div>
                  <button onClick={() => setSeHomeScore(seHomeScore + 1)} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #F59E0B44", background: "#F59E0B22", color: "#F59E0B", fontSize: 18, cursor: "pointer" }}>+</button>
                </div>
              </div>
              <div style={{ fontSize: 14, color: "#475569", marginTop: 20 }}>–</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#10B981", fontWeight: 700, marginBottom: 6 }}>{teamShortName(scoreEntryMatch.away_team)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => setSeAwayScore(Math.max(0, seAwayScore - 1))} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #334155", background: "#0B0F1A", color: "#F8FAFC", fontSize: 18, cursor: "pointer" }}>–</button>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#F8FAFC", width: 40 }}>{seAwayScore}</div>
                  <button onClick={() => setSeAwayScore(seAwayScore + 1)} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #F59E0B44", background: "#F59E0B22", color: "#F59E0B", fontSize: 18, cursor: "pointer" }}>+</button>
                </div>
              </div>
            </div>
            {/* Penalty shootout — only when tied */}
            {seHomeScore === seAwayScore && (
              <div style={{ marginBottom: 12 }}>
                <div onClick={() => { if (seHomePen == null) { setSeHomePen(0); setSeAwayPen(0); } else { setSeHomePen(null); setSeAwayPen(null); } }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', padding: '6px 0' }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid #F59E0B44', background: seHomePen != null ? '#F59E0B' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {seHomePen != null && <span style={{ color: '#0B0F1A', fontSize: 10, fontWeight: 900 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600 }}>Decided by penalties</span>
                </div>
                {seHomePen != null && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => setSeHomePen(Math.max(0, (seHomePen || 0) - 1))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #334155', background: '#0B0F1A', color: '#F8FAFC', fontSize: 14, cursor: 'pointer' }}>–</button>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#F59E0B', width: 24, textAlign: 'center' }}>{seHomePen}</div>
                      <button onClick={() => setSeHomePen((seHomePen || 0) + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #F59E0B44', background: '#F59E0B22', color: '#F59E0B', fontSize: 14, cursor: 'pointer' }}>+</button>
                    </div>
                    <span style={{ fontSize: 10, color: '#475569' }}>pen</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => setSeAwayPen(Math.max(0, (seAwayPen || 0) - 1))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #334155', background: '#0B0F1A', color: '#F8FAFC', fontSize: 14, cursor: 'pointer' }}>–</button>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#F59E0B', width: 24, textAlign: 'center' }}>{seAwayPen}</div>
                      <button onClick={() => setSeAwayPen((seAwayPen || 0) + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #F59E0B44', background: '#F59E0B22', color: '#F59E0B', fontSize: 14, cursor: 'pointer' }}>+</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <button disabled={seSubmitting} onClick={handleScoreSubmit} style={{
              width: "100%", padding: 12, borderRadius: 8, border: "none",
              background: "#10B981", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              opacity: seSubmitting ? 0.5 : 1,
            }}>
              {seSubmitting ? "Saving..." : currentUser && ['admin', 'commentator'].includes(currentUser.role) ? "Save Final Score" : "Submit Score for Approval"}
            </button>
            <button onClick={() => setScoreEntryMatch(null)} style={{
              width: "100%", marginTop: 6, padding: 8, borderRadius: 8,
              border: "1px solid #334155", background: "transparent", color: "#64748B",
              fontSize: 11, cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <BottomNav active={activeTab} onChange={(tab) => { if (!onBack) window.location.hash = ''; setActiveTab(tab); }} liveBadge={liveMatches.length} />
    </div>
  );
}

const styles = {
  page: { fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 600, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", color: "#E2E8F0", userSelect: "none", paddingBottom: 60 },
  hero: { padding: "18px 20px 16px", textAlign: "center" },
  logo: { fontSize: 38, fontWeight: 900, letterSpacing: -1, color: "#F59E0B" },
  tagline: { fontSize: 13, color: "#94A3B8", fontWeight: 500, marginTop: 5 },
  section: { padding: "0 16px 16px" },
  sectionTitle: { fontSize: 11, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8, padding: "0 2px" },
  searchBox: { display: "flex", alignItems: "center", gap: 8, background: "#1E293B", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", marginBottom: 10 },
  searchInput: { flex: 1, minWidth: 0, background: "none", border: "none", color: "#E2E8F0", fontSize: 14, outline: "none", fontFamily: "'Outfit',sans-serif" },
  teamRow: { display: "flex", alignItems: "center", gap: 10, background: "#1E293B", borderRadius: 10, padding: "10px 12px", marginBottom: 4, border: "1px solid #1E293B", cursor: "pointer" },
  teamDot: { width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#fff", flexShrink: 0 },
  teamName: { fontSize: 13, fontWeight: 700, color: "#F8FAFC" },
  teamRecord: { fontSize: 10, color: "#94A3B8", marginTop: 1 },
  scoreCard: { display: "flex", alignItems: "center", background: "#1E293B", borderRadius: 10, padding: "10px 12px", marginBottom: 4, gap: 10, border: "1px solid #1E293B" },
  resultBadge: { width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, flexShrink: 0 },
  matchTeams: { fontSize: 12, fontWeight: 700, color: "#F8FAFC", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  matchMeta: { fontSize: 10, color: "#64748B", marginTop: 2 },
  matchScore: { fontSize: 18, fontWeight: 900, color: "#F8FAFC" },
  footer: { textAlign: "center", padding: "20px 16px 24px" },
  adminBtn: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "#475569", background: "#1E293B", border: "1px solid #334155", borderRadius: 6, padding: "4px 12px", marginBottom: 8, cursor: "pointer" },
};
