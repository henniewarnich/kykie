import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { fetchCommentatorMatches, lockMatch, unlockMatch, createLiveMatch, updateScheduledMatch, snapshotRankings, fetchLatestRankings } from '../utils/sync.js';
import { saveMatchToSupabase } from '../utils/sync.js';
import { APP_VERSION } from '../utils/constants.js';
import { parseSASTDate, parseSAST } from '../utils/helpers.js';
import MatchCardTeams from '../components/MatchCardTeams.jsx';
import RankBadge from '../components/RankBadge.jsx';
import RoleSwitcher from '../components/RoleSwitcher.jsx';
import LiveModeChooser from '../components/LiveModeChooser.jsx';
import LiveMatchScreen from './LiveMatchScreen.jsx';
import LiveLiteScreen from './LiveLiteScreen.jsx';
import PublicMatchesSection from '../components/PublicMatchesSection.jsx';
import { MATCH_AWAY_TEAM, MATCH_HOME_TEAM, teamColor, teamDisplayName, teamMatchesSearch, teamShortName } from '../utils/teams.js';
import KykieSpinner from '../components/KykieSpinner.jsx';

export default function CommentatorDashboard({ currentUser, onLogout, onRoleSwitch }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeMatch, setActiveMatch] = useState(null); // match being recorded
  const [liveMode, setLiveMode] = useState(null); // 'lite' | 'pro' | null
  const [pendingStartMatch, setPendingStartMatch] = useState(null); // match awaiting mode choice
  const [quickScoreMatch, setQuickScoreMatch] = useState(null); // match being quick-scored
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickSaved, setQuickSaved] = useState(false);
  const [latestRankings, setLatestRankings] = useState({});
  const [showCount, setShowCount] = useState(20);
  const [tab, setTab] = useState("upcoming");
  const [search, setSearch] = useState("");

  const DEMO_CONFIG = {
    home: { name: "Demo Lions", color: "#1D4ED8", id: "demo-home", short: "DLI" },
    away: { name: "Demo Eagles", color: "#DC2626", id: "demo-away", short: "DEA" },
    matchLength: 10, breakFormat: "none", venue: "Demo Pitch",
    date: new Date().toISOString().slice(0, 10), isDemo: true,
  };

  const handleStartDemo = () => {
    // Show mode chooser, but flag as demo
    setPendingStartMatch({ _isDemo: true });
  };

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    // Fetch all upcoming/live matches with commentator assignments joined
    const { data: allUpcoming } = await supabase
      .from('matches')
      .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}, match_commentators(commentator_id, commentator:profiles!commentator_id(firstname, lastname))`)
      .in('status', ['upcoming', 'live'])
      .order('match_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    // Tag each match
    const tagged = (allUpcoming || []).map(m => {
      const comms = m.match_commentators || [];
      const assignedToMe = comms.some(c => c.commentator_id === currentUser.id);
      const assignedToAnyone = comms.length > 0;
      const assigneeName = comms.length > 0 ? comms.map(c => `${c.commentator?.firstname || ''} ${c.commentator?.lastname || ''}`).join(', ').trim() : null;
      return {
        ...m,
        _canAction: assignedToMe || !assignedToAnyone,
        _unassigned: !assignedToAnyone,
        _assignedMe: assignedToMe,
        _assignedOther: assignedToAnyone && !assignedToMe,
        _assigneeName: assigneeName,
      };
    });

    // Also fetch completed matches assigned to me
    const assigned = await fetchCommentatorMatches(currentUser.id);
    const completedAssigned = assigned.filter(m => m.status === 'ended');
    
    // Merge: upcoming/live (all) + completed (mine only)
    const seen = new Set();
    const all = [...tagged, ...completedAssigned].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    setMatches(all);
    fetchLatestRankings().then(r => setLatestRankings(r)).catch(() => {});
    setLoading(false);
  };

  const handleStartLive = async (m) => {
    // Show mode chooser
    setPendingStartMatch(m);
  };

  const handleModeChosen = async (mode) => {
    const m = pendingStartMatch;
    setPendingStartMatch(null);
    if (!m) return;

    // Demo mode — no DB, just set config and go
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
      matchType: m.match_type || 'league', venue: m.venue || '', date: m.match_date, isDemo: false,
    };

    if (m._isResume) {
      setLiveMode(mode);
      setActiveMatch(matchData);
      return;
    }

    try {
      const locked = await lockMatch(m.id, currentUser.id);
      if (!locked) {
        alert("Another commentator has already started this match.");
        load();
        return;
      }
      await updateScheduledMatch(m.id, { status: 'live' });
      await snapshotRankings(m.id);
      setLiveMode(mode);
      setActiveMatch(matchData);
    } catch (err) {
      console.error('Start live error:', err);
      alert('Failed to start match. Please try again.');
      load();
    }
  };

  const handleResumeLive = (m) => {
    setPendingStartMatch({ ...m, _isResume: true });
  };

  const handleCancelLive = async (m) => {
    // Only the user who locked it can cancel
    const success = await unlockMatch(m.id, currentUser.id);
    if (success) {
      setActiveMatch(null);
      load();
    }
  };

  const handleQuickScore = (m) => {
    setQuickScoreMatch(m);
    setHomeScore(m.home_score || 0);
    setAwayScore(m.away_score || 0);
  };

  const handleSaveQuickScore = async () => {
    if (!quickScoreMatch) return;
    setQuickSaving(true);

    // Lock it
    const locked = await lockMatch(quickScoreMatch.id, currentUser.id);
    if (!locked && quickScoreMatch.locked_by !== currentUser.id) {
      alert("Another commentator has already scored this match.");
      setQuickSaving(false);
      load();
      return;
    }

    await updateScheduledMatch(quickScoreMatch.id, {
      home_score: homeScore,
      away_score: awayScore,
      status: 'ended',
      duration: 0,
      locked_by: currentUser.id,
    });

    await snapshotRankings(quickScoreMatch.id);

    setQuickSaving(false);
    setQuickSaved(true);
    setTimeout(() => {
      setQuickSaved(false);
      setQuickScoreMatch(null);
      load();
    }, 1500);
  };

  const handleEditQuickScore = async (m) => {
    // Can only edit if I locked it
    if (m.locked_by !== currentUser.id) {
      alert("Only the commentator who scored this match can edit it.");
      return;
    }
    // Revert to upcoming
    await updateScheduledMatch(m.id, { status: 'upcoming', home_score: 0, away_score: 0, duration: null, locked_by: null });
    load();
  };

  const handleSaveLiveGame = (game) => {
    setActiveMatch(null);
    load();
    return game;
  };

  // If recording a live match, show the appropriate screen
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
              if (confirm("Cancel & Revert this match?\n\nAll commentary, events and scores recorded so far will be permanently deleted. The match goes back to 'upcoming' so it can be started fresh.\n\nContinue?")) {
                handleCancelLive({ id: activeMatch.supabaseId, locked_by: currentUser.id });
              }
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
        <LiveMatchScreen
          matchConfig={activeMatch}
          existingMatchId={isDemoMatch ? null : activeMatch.supabaseId}
          onSaveGame={isDemoMatch ? () => { setActiveMatch(null); setLiveMode(null); } : handleSaveLiveGame}
          onNavigate={() => { setActiveMatch(null); setLiveMode(null); if (!isDemoMatch) load(); }}
        />
      </div>
    );
  }

  // Quick score overlay
  if (quickScoreMatch) {
    const m = quickScoreMatch;
    return (
      <div style={{
        fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto",
        background: "#0B0F1A", minHeight: "100vh", color: "#F8FAFC", padding: 20,
      }}>
        <button onClick={() => setQuickScoreMatch(null)} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <MatchCardTeams home={m.home_team} away={m.away_team} homeRank={latestRankings[m.home_team?.id]?.rank} awayRank={latestRankings[m.away_team?.id]?.rank} homePrevRank={latestRankings[m.home_team?.id]?.prevRank} awayPrevRank={latestRankings[m.away_team?.id]?.prevRank} />
          <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
            {parseSASTDate(m.match_date).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
            {m.scheduled_time && ` · ${m.scheduled_time.slice(0, 5)}`}
            {m.venue && ` · ${m.venue}`}
          </div>
        </div>

        <div style={{ background: "#1E293B", borderRadius: 12, padding: 20, border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
            {[[m.home_team, homeScore, setHomeScore], [m.away_team, awayScore, setAwayScore]].map(([t, sc, setSc], i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t?.color, marginBottom: 8 }}>{teamDisplayName(t)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setSc(Math.max(0, sc - 1))} style={{ width: 38, height: 38, borderRadius: 8, border: "1px solid #334155", background: "#0B0F1A", color: "#F8FAFC", fontSize: 20, fontWeight: 700, cursor: "pointer" }}>−</button>
                  <div style={{ fontSize: 32, fontWeight: 800, color: t?.color, minWidth: 40, textAlign: "center" }}>{sc}</div>
                  <button onClick={() => setSc(sc + 1)} style={{ width: 38, height: 38, borderRadius: 8, border: "1px solid #334155", background: "#0B0F1A", color: "#F8FAFC", fontSize: 20, fontWeight: 700, cursor: "pointer" }}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {quickSaved && <div style={{ textAlign: "center", padding: 10, color: "#10B981", fontSize: 13, fontWeight: 700, marginTop: 12 }}>✓ Score saved!</div>}

        <button onClick={handleSaveQuickScore} disabled={quickSaving} style={{
          width: "100%", padding: 14, borderRadius: 10, border: "none", marginTop: 16,
          background: quickSaving ? "#334155" : "#F59E0B", color: quickSaving ? "#64748B" : "#0B0F1A",
          fontSize: 14, fontWeight: 700, cursor: quickSaving ? "wait" : "pointer",
        }}>{quickSaving ? "Saving..." : "💾 Save Score"}</button>
      </div>
    );
  }

  // ── MAIN DASHBOARD ──
  const q = search.trim().toLowerCase();
  const filtered = q ? matches.filter(m =>
    teamMatchesSearch(m.home_team, q) ||
    teamMatchesSearch(m.away_team, q) ||
    (m.venue || "").toLowerCase().includes(q)
  ) : matches;
  const upcomingMatches = filtered.filter(m => m.status === 'upcoming');
  const liveMatches = filtered.filter(m => m.status === 'live');
  const completedMatches = filtered.filter(m => m.status === 'ended');

  return (
    <div style={{
      fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto",
      background: "#0B0F1A", minHeight: "100vh", color: "#F8FAFC",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "16px 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="28" height="28" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="20" fill="none" stroke="#10B981" strokeWidth="2"/>
              <circle cx="28" cy="28" r="8" fill="none" stroke="#F59E0B" strokeWidth="2"/>
              <line x1="34" y1="22" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="40" y1="12" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="44" y1="12" x2="44" y2="16" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#F59E0B" }}>My Matches</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 10, color: "#64748B", textAlign: "right" }}>
              {currentUser.firstname}
              {' '}<RoleSwitcher currentUser={currentUser} onSwitch={onRoleSwitch} />
            </div>
            <button onClick={onLogout} style={{ fontSize: 10, color: "#EF4444", background: "none", border: "1px solid #EF444444", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>Sign out</button>
          </div>
        </div>
      </div>

      {/* Public matches overview */}
      <div style={{ padding: "0 16px 4px" }}>
        <PublicMatchesSection />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", margin: "0 16px 12px", borderRadius: 8, overflow: "hidden", border: "1px solid #334155" }}>
        {[["upcoming", `📅 Upcoming (${upcomingMatches.length + liveMatches.length})`], ["completed", `✓ Completed (${completedMatches.length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
            background: tab === k ? "#F59E0B22" : "#1E293B", color: tab === k ? "#F59E0B" : "#64748B",
          }}>{l}</button>
        ))}
      </div>

      {/* Search */}
      <div style={{ margin: "0 16px 8px", position: "relative" }}>
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setShowCount(20); }}
          placeholder="🔍 Search matches..."
          style={{ width: "100%", padding: "8px 32px 8px 10px", borderRadius: 8, border: "1px solid #334155", background: "#1E293B", color: "#F8FAFC", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
        {search && <button onClick={() => { setSearch(""); setShowCount(20); }} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 14 }}>✕</button>}
      </div>

      <div style={{ padding: "0 16px 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}><KykieSpinner /></div>
        ) : matches.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#64748B" }}>No matches scheduled yet</div>
        ) : tab === "upcoming" ? (
          <>
            {liveMatches.length === 0 && upcomingMatches.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: "#64748B" }}>No upcoming matches</div>
            )}
            {/* Live matches */}
            {liveMatches.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#EF4444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>🔴 Live now</div>
                {liveMatches.map(m => (
                  <MatchCard key={m.id} match={m} currentUser={currentUser} latestRankings={latestRankings}
                    canAction={m._canAction !== false}
                    onStartLive={() => handleStartLive(m)}
                    onResumeLive={() => handleResumeLive(m)}
                    onCancel={() => handleCancelLive(m)}
                  />
                ))}
              </div>
            )}

            {/* Upcoming matches */}
            {upcomingMatches.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>📅 Upcoming ({upcomingMatches.length})</div>
                {upcomingMatches.slice(0, showCount).map(m => (
                  <MatchCard key={m.id} match={m} currentUser={currentUser} latestRankings={latestRankings}
                    canAction={m._canAction !== false}
                    onStartLive={() => handleStartLive(m)}
                    onQuickScore={() => handleQuickScore(m)}
                  />
                ))}
                {upcomingMatches.length > showCount && (
                  <div onClick={() => setShowCount(prev => prev + 20)}
                    style={{ textAlign: "center", padding: "10px 0", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>
                    Show more ({upcomingMatches.length - showCount} remaining)
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {completedMatches.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "#64748B" }}>No completed matches yet</div>
            ) : (
              <div>
                {completedMatches.map(m => {
                  const d = parseSASTDate(m.match_date);
                  const isMyLock = m.locked_by === currentUser.id || m.created_by === currentUser.id;
                  return (
                    <div key={m.id} style={{
                      background: "#1E293B", borderRadius: 10, padding: "10px 12px", marginBottom: 4,
                      border: "1px solid #334155",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: m.home_team?.color }} />
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#F8FAFC", flex: 1 }}>
                          <MatchCardTeams home={m.home_team} away={m.away_team} homeRank={m.home_rank} awayRank={m.away_rank} homePrevRank={m.home_prev_rank} awayPrevRank={m.away_prev_rank} />
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "#F8FAFC" }}>{m.home_score}–{m.away_score}</div>
                      </div>
                      <div style={{ fontSize: 10, color: "#64748B", marginBottom: 4 }}>
                        {d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
                        {m.venue && ` · ${m.venue}`}
                        {m.duration > 0 ? " · Live" : " · Quick"}
                      </div>
                      {isMyLock && m.duration === 0 && (
                        <button onClick={() => handleEditQuickScore(m)} style={{
                          width: "100%", padding: 6, borderRadius: 6, fontSize: 10, fontWeight: 700,
                          border: "1px solid #F59E0B44", background: "transparent", color: "#F59E0B", cursor: "pointer",
                        }}>✏️ Edit Score</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={handleStartDemo} style={{ background: "none", border: "1px solid #8B5CF644", borderRadius: 8, padding: "6px 16px", color: "#8B5CF6", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>🎮 Demo Match</button>
            <button onClick={load} style={{ background: "none", border: "1px solid #334155", borderRadius: 8, padding: "6px 16px", color: "#64748B", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>🔄 Refresh</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: "#334155" }}>v{APP_VERSION}</div>
        </div>
      </div>
      <LiveModeChooser show={!!pendingStartMatch} onSelect={handleModeChosen} onClose={() => setPendingStartMatch(null)} />
    </div>
  );
}

function MatchCard({ match: m, currentUser, canAction = true, onStartLive, onQuickScore, onCancel, onResumeLive, latestRankings = {} }) {
  const d = parseSASTDate(m.match_date);
  const isLocked = m.locked_by && m.locked_by !== currentUser.id && m.created_by !== currentUser.id;
  const isMyLock = m.locked_by === currentUser.id || m.created_by === currentUser.id;
  const disabled = !canAction || isLocked;

  // Countdown
  const countdown = (() => {
    if (!m.scheduled_time || m.status === 'live') return null;
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

  return (
    <div style={{
      background: "#1E293B", borderRadius: 10, padding: "10px 12px", marginBottom: 4,
      border: m.status === 'live' ? "1px solid #EF444444" : "1px solid #334155",
      opacity: disabled ? 0.6 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: m.home_team?.color }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: "#F8FAFC", flex: 1 }}>
          <MatchCardTeams home={m.home_team} away={m.away_team} homeRank={latestRankings[m.home_team?.id]?.rank} awayRank={latestRankings[m.away_team?.id]?.rank} homePrevRank={latestRankings[m.home_team?.id]?.prevRank} awayPrevRank={latestRankings[m.away_team?.id]?.prevRank} />
        </div>
        {m.status === 'live' && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#EF444422", color: "#EF4444", fontWeight: 800 }}>LIVE</span>}
        {countdown && m.status !== 'live' && <span style={{ fontSize: 9, fontWeight: 700, color: countdown.color, fontFamily: "monospace" }}>{countdown.text}</span>}
        {m._unassigned && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#F59E0B22", color: "#F59E0B", fontWeight: 700 }}>OPEN</span>}
        {m._assignedMe && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#10B98122", color: "#10B981", fontWeight: 700 }}>{m._assigneeName || 'You'}</span>}
        {m._assignedOther && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#3B82F622", color: "#3B82F6", fontWeight: 700 }}>{m._assigneeName || 'ASSIGNED'}</span>}
      </div>
      <div style={{ fontSize: 10, color: "#64748B", marginBottom: 6 }}>
        {d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
        {m.scheduled_time && ` · ${m.scheduled_time.slice(0, 5)}`}
        {m.venue && ` · ${m.venue}`}
        {" · "}{m.match_length}min
      </div>
      {isLocked && <div style={{ fontSize: 9, color: "#EF4444", marginBottom: 4 }}>🔒 Started by another commentator</div>}
      {m.status === 'upcoming' && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={disabled ? undefined : onStartLive} style={{
            flex: 1, padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700, border: "none",
            background: disabled ? "#334155" : "#F59E0B", color: disabled ? "#64748B" : "#0B0F1A",
            cursor: disabled ? "default" : "pointer",
          }}>🏑 Start Live</button>
          {onQuickScore && (
            <button onClick={disabled ? undefined : onQuickScore} style={{
              flex: 1, padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700,
              border: `1px solid ${disabled ? "#334155" : "#334155"}`, background: disabled ? "#1E293B" : "#0B0F1A",
              color: disabled ? "#475569" : "#F8FAFC", cursor: disabled ? "default" : "pointer",
            }}>💾 Quick Score</button>
          )}
        </div>
      )}
      {isMyLock && m.status === 'live' && (
        <div style={{ display: "flex", gap: 6 }}>
          {onResumeLive && (
            <button onClick={onResumeLive} style={{
              flex: 1, padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700, border: "none",
              background: "#10B981", color: "#fff", cursor: "pointer",
            }}>🏑 Continue Recording</button>
          )}
          {onCancel && (
            <button onClick={onCancel} style={{
              padding: 8, borderRadius: 8, fontSize: 11, fontWeight: 700,
              border: "1px solid #EF444444", background: "transparent", color: "#EF4444", cursor: "pointer",
            }}>✕ Cancel</button>
          )}
        </div>
      )}
    </div>
  );
}
