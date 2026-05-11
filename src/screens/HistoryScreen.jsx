import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { S, theme } from '../utils/styles.js';
import { MATCH_AWAY_TEAM, MATCH_HOME_TEAM, teamDisplayName, teamShortName } from '../utils/teams.js';
import { logAudit } from '../utils/audit.js';
import { shareMatchLink } from '../utils/share.js';
import Icon from '../components/Icons.jsx';
import MatchCardTeams from '../components/MatchCardTeams.jsx';
import KykieSpinner from '../components/KykieSpinner.jsx';

import AdminBackBar from '../components/AdminBackBar.jsx';

// Build searchable string from all possible name fields
function gameSearchStr(g) {
  try {
    const h = g.teams?.home || {};
    const a = g.teams?.away || {};
    return [
      teamShortName(h), teamShortName(a),
      h.name, a.name, h.instName, a.instName,
      h.institution?.name, a.institution?.name,
      h.institution?.short_name, a.institution?.short_name,
      h.short_name, a.short_name,
      h.short, a.short,
      h.team_description, a.team_description,
      g.venue,
    ].filter(Boolean).join(' ').toLowerCase();
  } catch { return ''; }
}

export default function HistoryScreen({ games, currentUser, onSelect, onBack, onSyncAll, syncing, onVideoReview }) {
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState("desc");
  const [syncResult, setSyncResult] = useState(null);
  const [cloudMatches, setCloudMatches] = useState([]);
  const [loadingCloud, setLoadingCloud] = useState(true);
  const [penEdit, setPenEdit] = useState(null); // { id, home, away }
  const [top10TeamIds, setTop10TeamIds] = useState(new Set());
  const [loadingVideoId, setLoadingVideoId] = useState(null);
  const [reportsByMatch, setReportsByMatch] = useState({});
  const [shareToast, setShareToast] = useState(null);

  const handleShare = async (g, e) => {
    if (e) e.stopPropagation();
    const matchId = g.supabase_id || g.id;
    if (!matchId) { setShareToast('Cannot share — match not synced'); setTimeout(() => setShareToast(null), 2500); return; }
    const home = teamShortName(g.teams?.home) || 'Home';
    const away = teamShortName(g.teams?.away) || 'Away';
    const res = await shareMatchLink(matchId, { title: `${home} vs ${away}`, text: `${home} vs ${away} on Kykie` });
    if (res.ok && res.method === 'clipboard') { setShareToast('Link copied'); setTimeout(() => setShareToast(null), 2500); }
    else if (!res.ok && res.error && res.error !== 'cancelled') { setShareToast(`Share failed: ${res.error}`); setTimeout(() => setShareToast(null), 3000); }
  };

  const isApprentice = currentUser?.role === 'commentator' && currentUser?.commentator_status === 'apprentice';
  const isAdminRole = currentUser?.role === 'admin';

  // Fetch all ended + abandoned matches from Supabase
  const fetchCloud = async () => {
    const { data } = await supabase
      .from('matches')
      .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}, match_commentators(commentator_id, commentator:profiles!commentator_id(firstname, lastname, alias_nickname))`)
      .in('status', ['ended', 'abandoned'])
      .order('match_date', { ascending: false });
    if (data) {
      const mapped = data.map(m => {
        const comms = m.match_commentators || [];
        const recorder = comms[0]?.commentator;
        const recorderName = recorder?.alias_nickname || recorder?.firstname || null;
        return {
          id: m.id,
          supabase_id: m.id,
          date: m.match_date,
          teams: {
            home: { name: teamShortName(m.home_team), displayName: teamDisplayName(m.home_team), color: m.home_team?.color, id: m.home_team?.id, short: teamShortName(m.home_team)?.slice(0, 3).toUpperCase(), instName: m.home_team?.institution?.name || '' },
            away: { name: teamShortName(m.away_team), displayName: teamDisplayName(m.away_team), color: m.away_team?.color, id: m.away_team?.id, short: teamShortName(m.away_team)?.slice(0, 3).toUpperCase(), instName: m.away_team?.institution?.name || '' },
          },
          homeScore: m.home_score,
          awayScore: m.away_score,
          duration: m.duration || 0,
          matchLength: m.match_length || 60,
          breakFormat: m.break_format || "quarters",
          venue: m.venue,
          matchType: m.match_type,
          quickScore: !m.duration || m.duration === 0,
          cloudOnly: true,
          status: m.status,
          homePenalty: m.home_penalty_score,
          awayPenalty: m.away_penalty_score,
          recorderName,
        };
      });
      setCloudMatches(mapped);
    }
    setLoadingCloud(false);
  };

  useEffect(() => {
    fetchCloud();
    if (isAdminRole) {
      supabase.from('match_reports').select('id, match_id, generated_at').order('generated_at', { ascending: false })
        .then(({ data }) => {
          if (!data) return;
          const map = {};
          data.forEach(r => {
            if (!map[r.match_id]) map[r.match_id] = r.id; // most-recent wins (ordered desc)
          });
          setReportsByMatch(map);
        });
    }
    if (isApprentice) {
      // Fetch Top 10 team IDs to filter for apprentice
      supabase.from('ranking_sets').select('id').order('created_at', { ascending: false }).limit(1)
        .then(({ data: sets }) => {
          if (sets?.[0]?.id) {
            supabase.from('rankings').select('team_id').eq('ranking_set_id', sets[0].id).lte('rank', 10)
              .then(({ data: ranks }) => {
                if (ranks) setTop10TeamIds(new Set(ranks.map(r => r.team_id)));
              });
          }
        });
    }
  }, []);

  // ── MERGE + FILTER + SORT — computed every render (600 items = trivial) ──
  const cloudById = {};
  cloudMatches.forEach(cm => { cloudById[cm.id] = cm; });
  const localEnhanced = games.map(g => {
    const cloud = g.supabase_id ? cloudById[g.supabase_id] : null;
    if (!cloud) return g;
    return { ...g, teams: cloud.teams, homePenalty: cloud.homePenalty, awayPenalty: cloud.awayPenalty, status: cloud.status };
  });
  const localIds = new Set(games.filter(g => g.supabase_id).map(g => g.supabase_id));
  const cloudOnly = cloudMatches.filter(cm => !localIds.has(cm.id));
  const allGames = [...localEnhanced, ...cloudOnly];

  let filteredList = allGames;
  if (isApprentice && top10TeamIds.size > 0) {
    filteredList = filteredList.filter(g => !top10TeamIds.has(g.teams?.home?.id) && !top10TeamIds.has(g.teams?.away?.id));
  }
  const q = search.trim().toLowerCase();
  if (q) {
    try {
      const words = q.split(/\s+/).filter(Boolean);
      filteredList = filteredList.filter(g => {
        const s = gameSearchStr(g);
        return words.every(w => s.includes(w));
      });
    } catch (e) {
      console.error('Search filter error:', e);
    }
  }
  filteredList = [...filteredList].sort((a, b) => {
    const da = new Date(a.date || 0).getTime();
    const db = new Date(b.date || 0).getTime();
    return sortDir === "desc" ? db - da : da - db;
  });
  const filtered = filteredList;

  const unsyncedCount = games.filter(g => !g.supabase_id).length;

  const resultColor = (g) => {
    if (g.status === 'abandoned') return "#64748B";
    if (g.homeScore > g.awayScore) return "#10B981";
    if (g.homeScore < g.awayScore) return "#EF4444";
    return "#F59E0B";
  };

  const toggleAbandoned = async (g) => {
    const matchId = g.supabase_id || g.id;
    if (!matchId) return;
    const newStatus = g.status === 'abandoned' ? 'ended' : 'abandoned';
    const label = newStatus === 'abandoned' ? 'Abandon' : 'Restore';
    if (!confirm(`${label} this match?`)) return;
    await supabase.from('matches').update({ status: newStatus }).eq('id', matchId);
    logAudit(newStatus === 'abandoned' ? 'match_abandoned' : 'match_restored', 'match', matchId);
    fetchCloud();
  };

  const savePenalty = async (override) => {
    const edit = override || penEdit;
    if (!edit) return;
    const { id, home, away } = edit;
    const hasValues = home != null && away != null && (home > 0 || away > 0);
    const update = hasValues
      ? { home_penalty_score: home, away_penalty_score: away }
      : { home_penalty_score: null, away_penalty_score: null };
    const { data, error } = await supabase.from('matches').update(update).eq('id', id).select('id, home_penalty_score, away_penalty_score');
    if (error) {
      console.error('Penalty save failed:', error);
      alert(`Could not save penalty score: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      console.error('Penalty save matched no rows:', { id, update });
      alert('Could not save penalty score: match not found or update blocked.');
      return;
    }
    logAudit('penalty_score_edit', 'match', id, update);
    setPenEdit(null);
    fetchCloud();
  };

  const handleSync = async () => {
    if (!onSyncAll || syncing) return;
    setSyncResult(null);
    const result = await onSyncAll();
    setSyncResult(result);
    setTimeout(() => setSyncResult(null), 4000);
  };

  return (
    <div style={S.app}>
      <AdminBackBar title="Game History" onBack={onBack} />
      <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, color: "#475569" }}>{loadingCloud ? <KykieSpinner size={20} /> : `${allGames.length} matches`}</div>
        <button onClick={() => { setLoadingCloud(true); fetchCloud(); }} style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94A3B8", fontSize: 10, cursor: "pointer", padding: "3px 10px", fontWeight: 600 }}>↻ Refresh</button>
      </div>
      <div style={S.page}>
        {/* Sync banner */}
        {unsyncedCount > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", marginBottom: 8,
            background: "#F59E0B11", borderRadius: 10, border: "1px solid #F59E0B33",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B" }}>
                📱 {unsyncedCount} game{unsyncedCount !== 1 ? "s" : ""} not synced
              </div>
            </div>
            <button onClick={handleSync} disabled={syncing} style={{
              padding: "8px 14px", borderRadius: 8, border: "1px solid #F59E0B44",
              background: syncing ? "#334155" : "#F59E0B22", color: "#F59E0B",
              fontSize: 11, fontWeight: 700, cursor: syncing ? "wait" : "pointer",
              whiteSpace: "nowrap",
            }}>
              {syncing ? "⏳ Syncing..." : "☁️ Sync All"}
            </button>
          </div>
        )}

        {syncResult && (
          <div style={{
            padding: "8px 12px", marginBottom: 8, borderRadius: 8,
            background: syncResult.failed > 0 ? "#EF444422" : "#10B98122",
            color: syncResult.failed > 0 ? "#EF4444" : "#10B981",
            fontSize: 11, fontWeight: 600, textAlign: "center",
          }}>
            {syncResult.synced > 0 && `✓ ${syncResult.synced} synced`}
            {syncResult.synced > 0 && syncResult.failed > 0 && " · "}
            {syncResult.failed > 0 && `✗ ${syncResult.failed} failed`}
          </div>
        )}

        {/* Search + Sort */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input style={{ ...S.input, fontSize: 12, flex: 1 }} value={search}
            onChange={e => setSearch(e.target.value)} placeholder="🔍 Search team or venue..." />
          <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")} style={{
            padding: "8px 12px", borderRadius: 8, border: `1px solid ${theme.border}`,
            background: theme.surface, color: theme.textMuted, fontSize: 11, fontWeight: 700,
            cursor: "pointer", whiteSpace: "nowrap",
          }}>
            {sortDir === "desc" ? "↓ New" : "↑ Old"}
          </button>
        </div>

        {/* Game list */}
        {isApprentice && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "#F59E0B11", border: "1px solid #F59E0B33", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 600 }}>Matches involving Top 10 ranked teams are hidden</div>
            <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>Will become available once you qualify by completing one Live and one Recorded match.</div>
          </div>
        )}
        {filtered.length === 0 ? (
          <div style={S.empty}>
            {allGames.length === 0 ? "No games recorded yet." : "No matches found."}
          </div>
        ) : (
          filtered.map(g => {
            const d = new Date(g.date);
            const rc = resultColor(g);
            const isSynced = !!g.supabase_id;
            const hasEvents = g.events && g.events.length > 0;
            const hasZones = hasEvents && g.events.some(e => e.zone);
            const isLivePro = !hasEvents ? false : hasZones;
            const isLive = !hasEvents ? false : !hasZones;
            const recName = g.recorderName;
            const matchLabel = isLivePro
              ? (recName ? `Recorded Live by ${recName}` : 'LIVE PRO')
              : isLive
                ? (recName ? `Recorded from video by ${recName}` : 'LIVE')
                : null;
            const isAdmin = currentUser?.role === 'admin';
            return (
              <div key={g.id} style={{ ...S.card, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", opacity: g.status === 'abandoned' ? 0.5 : 1 }}>
                {/* Video Stats button */}
                {onVideoReview && isSynced && (() => {
                  const isAdminRole = currentUser?.role === 'admin';
                  const hasLiveRecording = (g.duration || 0) > 0;
                  // Hide for non-admin if match already has a live recording
                  if (hasLiveRecording && !isAdminRole) return null;
                  const isLoading = loadingVideoId === g.id;
                  const handleClick = (e) => {
                    e.stopPropagation();
                    if (isLoading) return;
                    if (hasLiveRecording && isAdminRole) {
                      if (!confirm('⚠️ WARNING: This match has an existing live recording with detailed stats and commentary. Starting a video review will PERMANENTLY DELETE all existing event data.\n\nThis action cannot be undone.\n\nAre you absolutely sure?')) return;
                      if (!confirm('⚠️ FINAL CONFIRMATION: All existing match events, stats, and commentary for this match will be permanently lost. Proceed?')) return;
                    }
                    setLoadingVideoId(g.id);
                    onVideoReview(g);
                  };
                  return (
                    <button onClick={handleClick} style={{
                      width: 36, height: 36, borderRadius: 8,
                      border: hasLiveRecording ? '1px solid #EF444444' : '1px solid #8B5CF644',
                      background: isLoading ? '#F59E0B22' : hasLiveRecording ? '#EF444411' : '#8B5CF611',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: isLoading ? 'wait' : 'pointer', flexShrink: 0, padding: 0,
                      opacity: isLoading ? 0.7 : 1,
                    }}>
                      {isLoading ? (
                        <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700, animation: 'pulse 1s infinite' }}>...</span>
                      ) : (
                        <>
                          <span style={{ fontSize: 14, lineHeight: 1 }}>📹</span>
                          <span style={{ fontSize: 6, fontWeight: 700, color: hasLiveRecording ? '#EF4444' : '#8B5CF6', marginTop: 1 }}>
                            {hasLiveRecording ? 'Re-record' : 'Video Stats'}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })()}

                {/* Teams + Meta */}
                <div style={{ flex: 1, cursor: "pointer" }} onClick={() => onSelect(g)}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
                    <MatchCardTeams home={g.teams?.home} away={g.teams?.away} />
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>
                    {d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                    {g.venue && ` · ${g.venue}`}
                    {matchLabel && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#10B981", background: "#10B98118", padding: "1px 5px", borderRadius: 3 }}>{matchLabel}</span>}
                    {g.status === 'abandoned' && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#64748B", background: "#64748B22", padding: "1px 5px", borderRadius: 3 }}>ABANDONED</span>}
                    {isAdminRole && reportsByMatch[g.supabase_id || g.id] && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          sessionStorage.setItem('kykie-report-return', '#/admin');
                          window.location.hash = `#/report/${reportsByMatch[g.supabase_id || g.id]}`;
                        }}
                        style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#F59E0B", background: "#F59E0B18", padding: "1px 5px", borderRadius: 3, cursor: "pointer", border: "1px solid #F59E0B33" }}
                      >📄 REPORT</span>
                    )}
                  </div>
                </div>

                {/* Score + Abandon toggle */}
                <div style={{ minWidth: 44, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: rc, letterSpacing: 1, cursor: "pointer" }} onClick={() => onSelect(g)}>{g.homeScore}–{g.awayScore}</div>
                  {g.homePenalty != null && g.awayPenalty != null && (
                    <div style={{ fontSize: 8, color: '#F59E0B', fontWeight: 700 }}>{g.homePenalty}-{g.awayPenalty} pen</div>
                  )}
                  <div style={{ height: 3, borderRadius: 2, background: rc, marginTop: 3 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', marginTop: 4 }}>
                    {isSynced && g.homeScore === g.awayScore && g.status !== 'abandoned' && !isApprentice && (
                      <span onClick={(e) => { e.stopPropagation(); setPenEdit({ id: g.supabase_id || g.id, home: g.homePenalty || 0, away: g.awayPenalty || 0, homeName: g.teams?.home?.displayName || g.teams?.home?.name || 'Home', awayName: g.teams?.away?.displayName || g.teams?.away?.name || 'Away' }); }}
                        style={{ fontSize: 8, color: '#F59E0B', cursor: 'pointer', fontWeight: 700, border: '1px solid #F59E0B44', borderRadius: 4, padding: '2px 6px', background: '#F59E0B11' }}>
                        {g.homePenalty != null ? '✏ pen' : '+ pen'}
                      </span>
                    )}
                    {isSynced && isAdmin && (
                      <span onClick={(e) => { e.stopPropagation(); toggleAbandoned(g); }}
                        style={{ fontSize: 8, color: '#64748B', cursor: 'pointer', fontWeight: 600, padding: '2px 6px' }}>
                        {g.status === 'abandoned' ? '↩ restore' : '⚡ abandon'}
                      </span>
                    )}
                    {isSynced && (
                      <span onClick={(e) => handleShare(g, e)}
                        title="Share match link"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#94A3B8', cursor: 'pointer', fontWeight: 600, padding: '2px 6px' }}>
                        <Icon name="share" size={11} /> share
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {shareToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#10B981', color: '#0B0F1A', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>{shareToast}</div>
      )}

      {/* Penalty Edit Popup */}
      {penEdit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setPenEdit(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1E293B', borderRadius: 16, padding: 20, width: 260, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', marginBottom: 12 }}>Penalty Shootout</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700, marginBottom: 6 }}>{penEdit.homeName}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setPenEdit(p => ({ ...p, home: Math.max(0, p.home - 1) }))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #334155', background: '#0B0F1A', color: '#F8FAFC', fontSize: 16, cursor: 'pointer' }}>–</button>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#F59E0B', width: 28, textAlign: 'center' }}>{penEdit.home}</div>
                  <button onClick={() => setPenEdit(p => ({ ...p, home: p.home + 1 }))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #F59E0B44', background: '#F59E0B22', color: '#F59E0B', fontSize: 16, cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#475569', marginTop: 24 }}>–</span>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#10B981', fontWeight: 700, marginBottom: 6 }}>{penEdit.awayName}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setPenEdit(p => ({ ...p, away: Math.max(0, p.away - 1) }))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #334155', background: '#0B0F1A', color: '#F8FAFC', fontSize: 16, cursor: 'pointer' }}>–</button>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#F59E0B', width: 28, textAlign: 'center' }}>{penEdit.away}</div>
                  <button onClick={() => setPenEdit(p => ({ ...p, away: p.away + 1 }))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #F59E0B44', background: '#F59E0B22', color: '#F59E0B', fontSize: 16, cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => savePenalty({ ...penEdit, home: null, away: null })}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#64748B', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>Clear</button>
              <button onClick={() => savePenalty()}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: '#F59E0B', color: '#0B0F1A', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Save</button>
            </div>
            <button onClick={() => setPenEdit(null)}
              style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#64748B', cursor: 'pointer', fontSize: 10 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
