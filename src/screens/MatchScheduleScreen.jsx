import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { scheduleMatch, assignCommentators, updateScheduledMatch, lockMatch, unlockMatch, snapshotRankings, fetchLatestRankings } from '../utils/sync.js';
import { awardQuickScoreCredits, awardScheduleCredits } from '../utils/credits.js';
import { listUsersByRole } from '../utils/auth.js';
import { shareMatchLink } from '../utils/share.js';
import Icon from '../components/Icons.jsx';
import { BREAK_FORMATS, MATCH_TYPES } from '../utils/constants.js';
import { S, theme } from '../utils/styles.js';
import { parseSAST, parseSASTDate } from '../utils/helpers.js';
import MatchCardTeams from '../components/MatchCardTeams.jsx';
import RankBadge from '../components/RankBadge.jsx';
import NavLogo from '../components/NavLogo.jsx';
import LiveModeChooser from '../components/LiveModeChooser.jsx';
import AdminBackBar from '../components/AdminBackBar.jsx';
import LiveMatchScreen from './LiveMatchScreen.jsx';
import LiveLiteScreen from './LiveLiteScreen.jsx';
import { MATCH_AWAY_TEAM, MATCH_HOME_TEAM, TEAM_SELECT, teamColor, teamDisplayName, teamMatchesSearch, teamShortName } from '../utils/teams.js';
import KykieSpinner from '../components/KykieSpinner.jsx';

export default function MatchScheduleScreen({ onBack, currentUser }) {
  const [view, setView] = useState("list"); // list | create | edit
  const [upcoming, setUpcoming] = useState([]);
  const [commentators, setCommentators] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCount, setShowCount] = useState(20);

  // Live match
  const [activeMatch, setActiveMatch] = useState(null);
  const [liveMode, setLiveMode] = useState(null); // 'lite' | 'pro'
  const [pendingStartMatch, setPendingStartMatch] = useState(null);
  // Quick score
  const [quickScoreMatch, setQuickScoreMatch] = useState(null);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [quickSaving, setQuickSaving] = useState(false);

  // Create/Edit form
  const [homeTeam, setHomeTeam] = useState(null);
  const [awayTeam, setAwayTeam] = useState(null);
  const [homeSearch, setHomeSearch] = useState("");
  const [awaySearch, setAwaySearch] = useState("");
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduledTime, setScheduledTime] = useState("");
  const [matchLength, setMatchLength] = useState("60");
  const [breakFormat, setBreakFormat] = useState("quarters");
  const [matchType, setMatchType] = useState("league");
  const [venue, setVenue] = useState("");
  const [selectedComms, setSelectedComms] = useState([]);
  const [pastDateMode, setPastDateMode] = useState(false); // true = entering result for past date
  const [pastHomeScore, setPastHomeScore] = useState(0);
  const [pastAwayScore, setPastAwayScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editMatch, setEditMatch] = useState(null);
  const [matchComms, setMatchComms] = useState({}); // matchId -> [commentator profiles]
  const [latestRankings, setLatestRankings] = useState({});
  const [myInstitutionIds, setMyInstitutionIds] = useState(new Set());
  const [commSearch, setCommSearch] = useState("");
  const [reservingMatchId, setReservingMatchId] = useState(null);
  const [shareToast, setShareToast] = useState(null);

  const handleShare = async (m) => {
    const home = teamShortName(m.home_team);
    const away = teamShortName(m.away_team);
    const res = await shareMatchLink(m.id, { title: `${home} vs ${away}`, text: `Follow ${home} vs ${away} live on Kykie` });
    if (res.ok) {
      setShareToast(res.method === 'clipboard' ? 'Link copied' : null);
      if (res.method === 'clipboard') setTimeout(() => setShareToast(null), 2500);
    } else if (res.error && res.error !== 'cancelled') {
      setShareToast(`Share failed: ${res.error}`);
      setTimeout(() => setShareToast(null), 3000);
    }
  };

  const ml = parseInt(matchLength) || 60;
  const inputStyle = { width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.text, fontSize: 13, outline: "none", boxSizing: "border-box" };

  useEffect(() => { load(); }, []);

  // Auto-start demo if flagged from Dashboard
  useEffect(() => {
    if (sessionStorage.getItem('kykie-start-demo') === '1') {
      sessionStorage.removeItem('kykie-start-demo');
      setPendingStartMatch({ _isDemo: true });
    }
  }, []);

  const load = async () => {
    setLoading(true);
    const isCrowd = currentUser?.role === 'supporter';
    const [matches, comms, { data: teams }] = await Promise.all([
      supabase.from('matches').select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`).in('status', ['upcoming', 'live']).order('match_date', { ascending: true }).order('scheduled_time', { ascending: true }).then(r => r.data || []),
      isCrowd ? Promise.resolve([]) : listUsersByRole('commentator'),
      supabase.from('teams').select(TEAM_SELECT),
    ]);
    setUpcoming(matches);
    setCommentators(comms);
    setAllTeams(teams || []);

    // Load commentator assignments (skip for crowd users who don't need them)
    const matchIds = matches.map(m => m.id);
    const commsMap = {};
    if (matchIds.length > 0 && !isCrowd) {
      // Batch in parallel groups of 20 to avoid URL length issues
      const batches = [];
      for (let i = 0; i < matchIds.length; i += 20) {
        batches.push(supabase
          .from('match_commentators')
          .select('*, commentator:profiles!commentator_id(firstname, lastname)')
          .in('match_id', matchIds.slice(i, i + 20)));
      }
      const results = await Promise.all(batches);
      results.forEach(({ data }) => {
        (data || []).forEach(c => {
          if (!commsMap[c.match_id]) commsMap[c.match_id] = [];
          commsMap[c.match_id].push(c);
        });
      });
    }
    setMatchComms(commsMap);
    fetchLatestRankings().then(r => setLatestRankings(r)).catch(() => {});

    // Load current user's institution affinities (coach: from coach_teams; commentator: from profile)
    if (currentUser?.role === 'coach') {
      const { data: ct } = await supabase.from('coach_teams')
        .select('teams(institution_id)')
        .eq('coach_id', currentUser.id);
      setMyInstitutionIds(new Set((ct || []).map(r => r.teams?.institution_id).filter(Boolean)));
    } else if (currentUser?.role === 'commentator') {
      setMyInstitutionIds(new Set(currentUser.supporting_institution_ids || []));
    } else {
      setMyInstitutionIds(new Set());
    }

    setLoading(false);
  };

  const handleReserve = async (m) => {
    if (!currentUser?.id) return;
    setReservingMatchId(m.id);
    const { error } = await supabase.from('match_commentators').insert({
      match_id: m.id, commentator_id: currentUser.id,
    });
    if (error) {
      alert(`Could not reserve: ${error.message}`);
      setReservingMatchId(null);
      return;
    }
    await load();
    setReservingMatchId(null);
  };

  const handleUnreserve = async (m) => {
    if (!currentUser?.id) return;
    if (!confirm('Cancel your reservation for this match?')) return;
    setReservingMatchId(m.id);
    const { error } = await supabase.from('match_commentators').delete()
      .eq('match_id', m.id).eq('commentator_id', currentUser.id);
    if (error) {
      alert(`Could not cancel reservation: ${error.message}`);
      setReservingMatchId(null);
      return;
    }
    await load();
    setReservingMatchId(null);
  };

  const resetForm = () => {
    setHomeTeam(null); setAwayTeam(null); setHomeSearch(""); setAwaySearch("");
    setMatchDate(new Date().toISOString().slice(0, 10)); setScheduledTime("");
    setMatchLength("60"); setBreakFormat("quarters"); setMatchType("league");
    setVenue(""); setSelectedComms([]); setEditMatch(null);
    setPastDateMode(false); setPastHomeScore(0); setPastAwayScore(0);
  };

  const filteredHome = homeSearch.trim()
    ? allTeams.filter(t => teamMatchesSearch(t, homeSearch))
    : allTeams;
  const filteredAway = awaySearch.trim()
    ? allTeams.filter(t => teamMatchesSearch(t, awaySearch) && t.id !== homeTeam?.id)
    : allTeams.filter(t => t.id !== homeTeam?.id);

  const canSave = homeTeam && awayTeam && homeTeam.id !== awayTeam.id && matchDate;
  const isPastDate = matchDate && matchDate < new Date().toISOString().slice(0, 10);

  const handleSave = async () => {
    if (!canSave) return;
    // Block scheduling upcoming matches in the past (unless pastDateMode)
    if (isPastDate && !pastDateMode && !editMatch) {
      setPastDateMode(true);
      return;
    }
    setSaving(true);
    if (pastDateMode && !editMatch) {
      // Save as ended result directly
      const scheduled = await scheduleMatch({
        homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
        matchDate, scheduledTime: scheduledTime || null,
        matchLength: ml, breakFormat, matchType,
        venue: venue.trim() || null, commentatorIds: [],
        createdBy: currentUser?.id,
      });
      if (scheduled?.id) {
        await updateScheduledMatch(scheduled.id, {
          home_score: pastHomeScore, away_score: pastAwayScore,
          status: 'ended', duration: 0, locked_by: currentUser?.id,
        });
        await snapshotRankings(scheduled.id);
        if (currentUser?.id) awardQuickScoreCredits(currentUser.id, scheduled.id).catch(() => {});
      }
    } else if (editMatch) {
      await updateScheduledMatch(editMatch.id, {
        home_team_id: homeTeam.id, away_team_id: awayTeam.id,
        match_date: matchDate, scheduled_time: scheduledTime || null,
        match_length: ml, break_format: breakFormat, match_type: matchType,
        venue: venue.trim() || null,
      });
      await assignCommentators(editMatch.id, selectedComms);
    } else {
      const scheduled = await scheduleMatch({
        homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
        matchDate, scheduledTime: scheduledTime || null,
        matchLength: ml, breakFormat, matchType,
        venue: venue.trim() || null, commentatorIds: selectedComms,
        createdBy: currentUser?.id,
      });
      if (scheduled?.id && currentUser?.id) awardScheduleCredits(currentUser.id, scheduled.id).catch(() => {});
    }
    setSaving(false);
    resetForm();
    setView("list");
    load();
  };

  const handleEdit = async (m) => {
    setEditMatch(m);
    setHomeTeam(m.home_team); setHomeSearch(teamDisplayName(m.home_team) || "");
    setAwayTeam(m.away_team); setAwaySearch(teamDisplayName(m.away_team) || "");
    setMatchDate(m.match_date);
    setScheduledTime(m.scheduled_time || "");
    setMatchLength(String(m.match_length || 60));
    setBreakFormat(m.break_format || "quarters");
    setMatchType(m.match_type || "league");
    setVenue(m.venue || "");
    const comms = matchComms[m.id] || [];
    setSelectedComms(comms.map(c => c.commentator_id));
    setView("create");
  };

  const handleDelete = async (matchId) => {
    const { data, error } = await supabase.rpc('delete_match', { p_match_id: matchId, p_user_id: currentUser?.id });
    if (error) { alert(`Delete failed: ${error.message}`); return; }
    if (data && data !== 'ok') { alert(data); return; }
    load();
  };

  const toggleComm = (id) => {
    setSelectedComms(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  // Live match handlers
  const handleStartLive = (m) => {
    setPendingStartMatch(m);
  };

  const handleResumeLive = (m) => {
    setPendingStartMatch({ ...m, _isResume: true });
  };

  const DEMO_CONFIG = {
    home: { id: "demo-home", color: "#1D4ED8", short_name: "Demo Lions", sport: "Hockey", age_group: "1st" },
    away: { id: "demo-away", color: "#DC2626", short_name: "Demo Eagles", sport: "Hockey", age_group: "1st" },
    matchLength: 10, breakFormat: "none", venue: "Demo Pitch",
    date: new Date().toISOString().slice(0, 10), isDemo: true,
  };

  const handleStartDemo = () => {
    setPendingStartMatch({ _isDemo: true });
  };

  const handleModeChosen = async (mode) => {
    const m = pendingStartMatch;
    setPendingStartMatch(null);
    if (!m) return;

    if (m._isDemo) {
      setLiveMode(mode);
      setActiveMatch(DEMO_CONFIG);
      return;
    }

    const matchData = {
      supabaseId: m.id,
      home: { name: teamShortName(m.home_team) || 'Home', color: teamColor(m.home_team), id: m.home_team?.id, institution: m.home_team?.institution },
      away: { name: teamShortName(m.away_team) || 'Away', color: teamColor(m.away_team), id: m.away_team?.id, institution: m.away_team?.institution },
      matchLength: m.match_length || 60, breakFormat: m.break_format || 'quarters',
      matchType: m.match_type || 'league', venue: m.venue || '', date: m.match_date,
    };

    if (m._isResume) {
      setLiveMode(mode);
      setActiveMatch(matchData);
      return;
    }

    const locked = await lockMatch(m.id, currentUser.id);
    if (!locked) { alert("Another user has already started this match."); load(); return; }
    await updateScheduledMatch(m.id, { status: 'live' });
    await snapshotRankings(m.id);
    setLiveMode(mode);
    setActiveMatch(matchData);
  };

  const handleCancelLive = async (m) => {
    await unlockMatch(m.id, currentUser.id);
    await updateScheduledMatch(m.id, { status: 'upcoming' });
    setActiveMatch(null);
    setLiveMode(null);
    load();
  };

  const handleSaveLiveGame = async (gameData) => {
    setActiveMatch(null);
    load();
  };

  const handleQuickScore = (m) => { setQuickScoreMatch(m); setHomeScore(m.home_score || 0); setAwayScore(m.away_score || 0); };

  const handleSaveQuickScore = async () => {
    if (!quickScoreMatch) return;
    setQuickSaving(true);
    const locked = await lockMatch(quickScoreMatch.id, currentUser.id);
    if (!locked && quickScoreMatch.locked_by !== currentUser.id) {
      alert("Another user has already scored this match."); setQuickSaving(false); load(); return;
    }
    await updateScheduledMatch(quickScoreMatch.id, { home_score: homeScore, away_score: awayScore, status: 'ended', duration: 0, locked_by: currentUser.id });
    await snapshotRankings(quickScoreMatch.id);
    if (currentUser?.id) awardQuickScoreCredits(currentUser.id, quickScoreMatch.id).catch(() => {});
    setQuickSaving(false); setQuickScoreMatch(null); load();
  };

  // Countdown helper
  const getCountdown = (matchDate, scheduledTime, matchLength) => {
    if (!scheduledTime) return null;
    const kickoff = parseSAST(matchDate, scheduledTime);
    const now = new Date();
    const diff = kickoff - now;
    // Before kickoff — countdown to start
    if (diff > 0) {
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return { text: `${days}d ${hours % 24}h`, color: "#64748B" };
      if (hours > 0) return { text: `${hours}h ${mins % 60}m`, color: "#F59E0B" };
      return { text: `${mins}m`, color: "#EF4444" };
    }
    // After kickoff — time remaining in match
    const duration = (matchLength || 60) * 60000;
    const remaining = kickoff.getTime() + duration - now.getTime();
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60000);
      return { text: `${mins}m left`, color: mins <= 5 ? "#EF4444" : mins <= 15 ? "#F59E0B" : "#10B981", inProgress: true };
    }
    // Match time expired
    return { text: "Awaiting score", color: "#EF4444", awaiting: true };
  };

  const filtered = search.trim()
    ? upcoming.filter(m => teamMatchesSearch(m.home_team, search) || teamMatchesSearch(m.away_team, search) || (m.venue || "").toLowerCase().includes(search.toLowerCase()))
    : upcoming;

  // ── LIVE MATCH VIEW ──
  if (activeMatch) {
    const isDemoMatch = activeMatch.isDemo;
    if (liveMode === 'lite') {
      return (
        <LiveLiteScreen
          match={activeMatch}
          currentUser={currentUser}
          onEnd={() => { setActiveMatch(null); setLiveMode(null); if (!isDemoMatch) load(); }}
          onPromote={() => setLiveMode('pro')}
        />
      );
    }
    return (
      <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh" }}>
        <div style={{ padding: "4px 10px", background: "#1E293B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {isDemoMatch ? (
            <button onClick={() => { setActiveMatch(null); setLiveMode(null); }}
              style={{ background: "none", border: "none", color: "#8B5CF6", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>
              ✕ Exit Demo
            </button>
          ) : (
            <button onClick={() => {
              if (confirm("Cancel & Revert this match?\n\nAll commentary, events and scores recorded so far will be permanently deleted. The match goes back to 'upcoming' so it can be started fresh.\n\nContinue?")) handleCancelLive({ id: activeMatch.supabaseId, locked_by: currentUser.id });
            }} style={{ background: "none", border: "none", color: "#EF4444", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>
              ✕ Cancel & Revert
            </button>
          )}
          <button onClick={() => {
              if (activeMatch.supabaseId) {
                if (!window.confirm("Please note that you will lose all statistics and commentary that you have recorded so far.\n\nAre you sure you want to continue?")) return;
              }
              setLiveMode('lite');
            }} style={{ background: "none", border: "1px solid #10B98144", borderRadius: 6, color: "#10B981", fontSize: 9, cursor: "pointer", fontWeight: 700, padding: "3px 8px" }}>
            ↓ Switch to Score only
          </button>
        </div>
        <LiveMatchScreen matchConfig={activeMatch} existingMatchId={isDemoMatch ? null : activeMatch.supabaseId}
          onSaveGame={isDemoMatch ? () => { setActiveMatch(null); setLiveMode(null); } : handleSaveLiveGame}
          onNavigate={() => { setActiveMatch(null); setLiveMode(null); if (!isDemoMatch) load(); }} />
      </div>
    );
  }

  // ── QUICK SCORE VIEW ──
  if (quickScoreMatch) {
    const m = quickScoreMatch;
    return (
      <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", color: "#F8FAFC", padding: 20 }}>
        <button onClick={() => setQuickScoreMatch(null)} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <MatchCardTeams home={m.home_team} away={m.away_team} homeRank={latestRankings[m.home_team?.id]?.rank} awayRank={latestRankings[m.away_team?.id]?.rank} homePrevRank={latestRankings[m.home_team?.id]?.prevRank} awayPrevRank={latestRankings[m.away_team?.id]?.prevRank} />
          <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
            {parseSASTDate(m.match_date).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
            {m.venue && ` · ${m.venue}`}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 20, marginBottom: 24 }}>
          {[["home", m.home_team, homeScore, setHomeScore], ["away", m.away_team, awayScore, setAwayScore]].map(([side, t, score, setScore]) => (
            <div key={side} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: teamColor(t), marginBottom: 8 }}>{teamDisplayName(t)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setScore(Math.max(0, score - 1))} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #334155", background: "#1E293B", color: "#F8FAFC", fontSize: 18, cursor: "pointer" }}>−</button>
                <div style={{ fontSize: 36, fontWeight: 900, fontFamily: "monospace", minWidth: 40, textAlign: "center" }}>{score}</div>
                <button onClick={() => setScore(score + 1)} style={{ width: 36, height: 36, borderRadius: 8, border: "none", background: "#F59E0B", color: "#0B0F1A", fontSize: 18, fontWeight: 800, cursor: "pointer" }}>+</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSaveQuickScore} disabled={quickSaving} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: "#10B981", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", opacity: quickSaving ? 0.5 : 1 }}>
          {quickSaving ? "Saving..." : "Save Final Score"}
        </button>
      </div>
    );
  }

  // ── CREATE/EDIT VIEW ──
  if (view === "create") return (
    <div style={S.app}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => { resetForm(); setView("list"); }} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 16, cursor: 'pointer', padding: 0 }}>←</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{editMatch ? "Edit Match" : "Schedule Match"}</div>
      </div>
      <div style={{ ...S.page, paddingBottom: 30 }}>
        {/* Home Team */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Home Team</div>
          <input style={inputStyle} value={homeSearch} onChange={e => { setHomeSearch(e.target.value); setHomeTeam(null); }} placeholder="🔍 Search..." />
          {!homeTeam && <div style={{ maxHeight: 120, overflowY: "auto", marginTop: 4 }}>
            {filteredHome.slice(0, 20).map(t => (
              <button key={t.id} onClick={() => { setHomeTeam(t); setHomeSearch(teamDisplayName(t)); }} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, width: "100%",
                border: "1px solid #33415533", background: theme.surface, cursor: "pointer", marginBottom: 2,
              }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: teamColor(t), flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>{teamDisplayName(t)}</div>
              </button>
            ))}
          </div>}
        </div>

        {/* Away Team */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Away Team</div>
          <input style={inputStyle} value={awaySearch} onChange={e => { setAwaySearch(e.target.value); setAwayTeam(null); }} placeholder="🔍 Search..." />
          {!awayTeam && <div style={{ maxHeight: 120, overflowY: "auto", marginTop: 4 }}>
            {filteredAway.slice(0, 20).map(t => (
              <button key={t.id} onClick={() => { setAwayTeam(t); setAwaySearch(teamDisplayName(t)); }} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, width: "100%",
                border: "1px solid #33415533", background: theme.surface, cursor: "pointer", marginBottom: 2,
              }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: teamColor(t), flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>{teamDisplayName(t)}</div>
              </button>
            ))}
          </div>}
        </div>

        {/* Date & Time */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Date</div>
            <input type="date" style={inputStyle} value={matchDate} onChange={e => { setMatchDate(e.target.value); setPastDateMode(false); }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Time</div>
            <input type="time" style={inputStyle} value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
          </div>
        </div>

        {/* Past date warning */}
        {isPastDate && !editMatch && !pastDateMode && (
          <div style={{ padding: 10, borderRadius: 8, background: '#F59E0B11', border: '1px solid #F59E0B33', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>This date is in the past</div>
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>You cannot schedule an upcoming match with a past date. Would you like to enter the result instead?</div>
            <button onClick={() => setPastDateMode(true)} style={{
              marginTop: 8, padding: '6px 14px', borderRadius: 6, border: '1px solid #10B98144',
              background: '#10B98122', color: '#10B981', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            }}>Enter Result Instead</button>
          </div>
        )}

        {/* Past date mode: score entry */}
        {pastDateMode && (
          <div style={{ padding: 12, borderRadius: 10, background: '#10B98111', border: '1px solid #10B98133', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700, marginBottom: 8 }}>Enter Final Score</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4 }}>{homeTeam ? teamShortName(homeTeam) : 'Home'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setPastHomeScore(s => Math.max(0, s - 1))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #334155', background: '#0B0F1A', color: '#F8FAFC', fontSize: 14, cursor: 'pointer' }}>–</button>
                  <span style={{ fontSize: 22, fontWeight: 900, color: '#F8FAFC', minWidth: 24, textAlign: 'center' }}>{pastHomeScore}</span>
                  <button onClick={() => setPastHomeScore(s => s + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #F59E0B44', background: '#F59E0B22', color: '#F59E0B', fontSize: 14, cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <span style={{ fontSize: 14, color: '#64748B', fontWeight: 700 }}>–</span>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4 }}>{awayTeam ? teamShortName(awayTeam) : 'Away'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setPastAwayScore(s => Math.max(0, s - 1))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #334155', background: '#0B0F1A', color: '#F8FAFC', fontSize: 14, cursor: 'pointer' }}>–</button>
                  <span style={{ fontSize: 22, fontWeight: 900, color: '#F8FAFC', minWidth: 24, textAlign: 'center' }}>{pastAwayScore}</span>
                  <button onClick={() => setPastAwayScore(s => s + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #F59E0B44', background: '#F59E0B22', color: '#F59E0B', fontSize: 14, cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Settings */}
        <div style={{ background: theme.surface, borderRadius: 10, padding: 12, marginBottom: 12, border: `1px solid ${theme.border}` }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Match Length</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="number" style={{ width: 54, padding: 6, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.text, fontSize: 14, fontWeight: 700, textAlign: "center", outline: "none" }}
                value={matchLength} onChange={e => setMatchLength(e.target.value)} />
              {[20, 25, 30, 40, 60].map(m => (
                <button key={m} onClick={() => setMatchLength(String(m))} style={{
                  flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  border: ml === m ? "2px solid #F59E0B" : `1px solid ${theme.border}`,
                  background: ml === m ? "#F59E0B22" : theme.bg, color: ml === m ? "#F59E0B" : theme.textMuted, cursor: "pointer",
                }}>{m}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Break Format</div>
            <div style={{ display: "flex", gap: 4 }}>
              {BREAK_FORMATS.map(bf => (
                <button key={bf.id} onClick={() => setBreakFormat(bf.id)} style={{
                  flex: 1, padding: "6px 2px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  border: breakFormat === bf.id ? "2px solid #F59E0B" : `1px solid ${theme.border}`,
                  background: breakFormat === bf.id ? "#F59E0B22" : theme.bg, color: breakFormat === bf.id ? "#F59E0B" : theme.textMuted, cursor: "pointer",
                }}>{bf.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Match Type</div>
            <div style={{ display: "flex", gap: 4 }}>
              {MATCH_TYPES.map(mt => (
                <button key={mt.id} onClick={() => setMatchType(mt.id)} style={{
                  flex: 1, padding: "6px 2px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  border: matchType === mt.id ? "2px solid #F59E0B" : `1px solid ${theme.border}`,
                  background: matchType === mt.id ? "#F59E0B22" : theme.bg, color: matchType === mt.id ? "#F59E0B" : theme.textMuted, cursor: "pointer",
                }}>{mt.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Venue</div>
            <input style={inputStyle} value={venue} onChange={e => setVenue(e.target.value)} placeholder="Enter venue" />
          </div>
        </div>

        {/* Assign Commentators — hide in past date mode */}
        {!pastDateMode && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Assign Commentators</div>
          {commentators.length === 0 ? (
            <div style={{ fontSize: 10, color: theme.textDim, fontStyle: "italic" }}>No commentators created yet</div>
          ) : currentUser?.role === 'coach' ? (() => {
            // Coach view: search-based picker, filtered to commentators sharing an institution
            const eligible = commentators.filter(c => {
              const ids = c.supporting_institution_ids || [];
              return ids.some(id => myInstitutionIds.has(id));
            });
            const q = commSearch.trim().toLowerCase();
            const matching = eligible
              .filter(c => !selectedComms.includes(c.id))
              .filter(c => !q || `${c.firstname || ''} ${c.lastname || ''}`.toLowerCase().includes(q));
            return (
              <>
                {selectedComms.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {selectedComms.map(cid => {
                      const c = commentators.find(x => x.id === cid);
                      if (!c) return null;
                      return (
                        <span key={cid} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                          background: '#10B98122', color: '#10B981', border: '1px solid #10B98144',
                        }}>
                          {c.firstname} {c.lastname}
                          <span onClick={() => toggleComm(cid)} style={{ cursor: 'pointer', marginLeft: 2, fontSize: 13, lineHeight: 1 }}>×</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                <input style={{ ...inputStyle, fontSize: 12 }} value={commSearch} onChange={e => setCommSearch(e.target.value)}
                  placeholder={eligible.length === 0 ? 'No commentators support your institution' : '🔍 Search commentators...'}
                  disabled={eligible.length === 0} />
                {commSearch.trim() && (
                  <div style={{ maxHeight: 140, overflowY: 'auto', marginTop: 4, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg }}>
                    {matching.length === 0 ? (
                      <div style={{ padding: '8px 12px', fontSize: 11, color: theme.textDim }}>No matching commentators</div>
                    ) : matching.map(c => (
                      <div key={c.id} onClick={() => { toggleComm(c.id); setCommSearch(''); }}
                        style={{ padding: '8px 12px', fontSize: 12, color: theme.text, cursor: 'pointer', borderBottom: `1px solid ${theme.border}` }}>
                        {c.firstname} {c.lastname}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 9, color: theme.textDim, marginTop: 6 }}>
                  Showing commentators who support {myInstitutionIds.size === 0 ? 'your assigned teams' : `${myInstitutionIds.size} institution${myInstitutionIds.size !== 1 ? 's' : ''} you coach at`}.
                </div>
              </>
            );
          })() : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {commentators.map(c => {
                const sel = selectedComms.includes(c.id);
                const color = "#10B981";
                return (
                  <button key={c.id} onClick={() => toggleComm(c.id)} style={{
                    padding: "6px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                    border: sel ? `2px solid ${color}` : `1px solid ${theme.border}`,
                    background: sel ? color + "22" : theme.bg,
                    color: sel ? color : theme.textMuted, cursor: "pointer",
                  }}>
                    {sel ? "✓ " : ""}{c.firstname} {c.lastname}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}

        <button onClick={handleSave} disabled={(!canSave || saving || (isPastDate && !pastDateMode && !editMatch))} style={{
          ...S.btn(theme.accent, theme.bg), opacity: ((!canSave || saving || (isPastDate && !pastDateMode && !editMatch))) ? 0.5 : 1,
        }}>{saving ? "Saving..." : pastDateMode ? "Save Result" : editMatch ? "Update Match" : "Schedule Match"}</button>
      </div>
    </div>
  );

  // ── LIST VIEW ──
  return (
    <div style={S.app}>
      <AdminBackBar title="Match Schedule" onBack={onBack} />
      <div style={S.page}>
        {currentUser?.commentator_status === 'apprentice' ? (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#F59E0B11", border: "1px solid #F59E0B33", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>You will be able to schedule new matches once you qualify as a Commentator</div>
            <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Complete 1 Live and 1 Recorded match to remove this limitation.</div>
          </div>
        ) : (
          <button style={S.btn(theme.accent, theme.bg)} onClick={() => { resetForm(); setView("create"); }}>+ Schedule Match</button>
        )}

        {/* Search */}
        <div style={{ marginTop: 10 }}>
          <input style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.text, fontSize: 12, outline: "none", boxSizing: "border-box" }}
            value={search} onChange={e => { setSearch(e.target.value); setShowCount(20); }} placeholder="🔍 Search matches..." />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 30 }}><KykieSpinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 30, color: theme.textDim }}>{search.trim() ? "No matches found" : "No upcoming matches"}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
            {filtered.slice(0, showCount).map(m => {
              const comms = matchComms[m.id] || [];
              const d = parseSASTDate(m.match_date);
              const isLive = m.status === 'live';
              const isMyLock = m.locked_by === currentUser?.id || m.created_by === currentUser?.id;
              const countdown = getCountdown(m.match_date, m.scheduled_time, m.match_length);
              const isApprentice = currentUser?.commentator_status === 'apprentice';
              const homeRank = latestRankings[m.home_team?.id]?.rank;
              const awayRank = latestRankings[m.away_team?.id]?.rank;
              const isTop10Match = isApprentice && ((homeRank && homeRank <= 10) || (awayRank && awayRank <= 10));
              // Self-reservation eligibility (commentators only)
              const myReservation = comms.find(c => c.commentator_id === currentUser?.id);
              const homeInstId = m.home_team?.institution?.id;
              const awayInstId = m.away_team?.institution?.id;
              const matchInstitutionMatches = (homeInstId && myInstitutionIds.has(homeInstId)) || (awayInstId && myInstitutionIds.has(awayInstId));
              const canReserve = currentUser?.role === 'commentator' && !myReservation && comms.length === 0 && matchInstitutionMatches && !isApprentice;
              return (
                <div key={m.id} style={{
                  background: theme.surface, borderRadius: 10, padding: "10px 12px",
                  border: isLive ? "1px solid #EF444444" : countdown?.awaiting ? "1px solid #EF444433" : `1px solid ${theme.border}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: m.home_team?.color }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, flex: 1 }}>
                      <MatchCardTeams home={m.home_team} away={m.away_team} homeRank={latestRankings[m.home_team?.id]?.rank} awayRank={latestRankings[m.away_team?.id]?.rank} homePrevRank={latestRankings[m.home_team?.id]?.prevRank} awayPrevRank={latestRankings[m.away_team?.id]?.prevRank} />
                    </div>
                    {isLive && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#EF444422", color: "#EF4444", fontWeight: 800 }}>LIVE</span>}
                    {countdown && !isLive && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: countdown.color, fontFamily: countdown.awaiting ? 'inherit' : 'monospace' }}>{countdown.text}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 4 }}>
                    {d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
                    {m.scheduled_time && ` · ${m.scheduled_time.slice(0, 5)}`}
                    {m.venue && ` · ${m.venue}`}
                    {" · "}{m.match_length}min {m.match_type}
                  </div>
                  {comms.length > 0 && (
                    <div style={{ fontSize: 9, color: "#10B981", marginBottom: 6 }}>
                      🎙 {comms.map(c => `${c.commentator?.firstname} ${c.commentator?.lastname}`).join(", ")}
                    </div>
                  )}
                  {/* Action buttons */}
                  {isTop10Match ? (
                    <div style={{ fontSize: 9, color: "#F59E0B", padding: "4px 0" }}>🔒 Top 10 match — available once you qualify as a Commentator</div>
                  ) : isLive && isMyLock ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleResumeLive(m)} style={{ flex: 1, padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700, border: "none", background: "#10B981", color: "#fff", cursor: "pointer" }}>🏑 Continue Recording</button>
                      <button onClick={() => { if (confirm("Cancel & Revert?\n\nAll commentary, events and scores so far will be permanently deleted and the match goes back to 'upcoming'.\n\nContinue?")) handleCancelLive(m); }} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: "1px solid #EF444444", background: "transparent", color: "#EF4444", cursor: "pointer" }}>✕</button>
                    </div>
                  ) : isLive ? (
                    <div style={{ fontSize: 9, color: "#EF4444" }}>🔒 Started by another user</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 6 }}>
                        {currentUser?.role !== 'supporter' && (
                          <button onClick={() => handleStartLive(m)} style={{ flex: 1, padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700, border: "none", background: "#F59E0B", color: "#0B0F1A", cursor: "pointer" }}>🏑 Start Live</button>
                        )}
                        <button onClick={() => handleQuickScore(m)} style={{ flex: 1, padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.textMuted, cursor: "pointer" }}>💾 Quick Score</button>
                        {currentUser?.role !== 'supporter' && !isApprentice && (
                          <button onClick={() => handleEdit(m)} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.textMuted, cursor: "pointer" }}>✏️</button>
                        )}
                        <button onClick={() => handleShare(m)} title="Share match link"
                          style={{ padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.textMuted, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                          <Icon name="share" size={14} />
                        </button>
                        {(currentUser?.role === 'admin' || m.created_by === currentUser?.id) && (
                          <button onClick={() => { if (confirm("Delete this match?")) handleDelete(m.id); }} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: "1px solid #EF444444", background: "transparent", color: "#EF4444", cursor: "pointer" }}>🗑</button>
                        )}
                      </div>
                      {canReserve && (
                        <button onClick={() => handleReserve(m)} disabled={reservingMatchId === m.id}
                          style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700, border: '1px solid #8B5CF644', background: '#8B5CF611', color: '#8B5CF6', cursor: 'pointer', opacity: reservingMatchId === m.id ? 0.5 : 1 }}>
                          {reservingMatchId === m.id ? 'Reserving…' : '🎙 Reserve this match'}
                        </button>
                      )}
                      {myReservation && currentUser?.role === 'commentator' && (
                        <button onClick={() => handleUnreserve(m)} disabled={reservingMatchId === m.id}
                          style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700, border: '1px solid #EF444444', background: 'transparent', color: '#EF4444', cursor: 'pointer', opacity: reservingMatchId === m.id ? 0.5 : 1 }}>
                          {reservingMatchId === m.id ? 'Cancelling…' : '✕ Cancel reservation'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {filtered.length > showCount && (
              <div onClick={() => setShowCount(prev => prev + 20)}
                style={{ textAlign: "center", padding: "10px 0", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>
                Show more ({filtered.length - showCount} remaining)
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ textAlign: "center", padding: "12px 16px 20px" }}>
        <button onClick={handleStartDemo} style={{ background: "none", border: "1px solid #8B5CF644", borderRadius: 8, padding: "6px 16px", color: "#8B5CF6", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>🎮 Demo Match</button>
      </div>
      <LiveModeChooser show={!!pendingStartMatch} onSelect={handleModeChosen} onClose={() => setPendingStartMatch(null)}
        allowedModes={['lite', 'pro']} />
      {shareToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#10B981', color: '#0B0F1A', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>{shareToast}</div>
      )}
    </div>
  );
}
