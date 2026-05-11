import { useState } from 'react';
import { fmt, fmtTs, exportMatchJSON } from '../utils/helpers.js';
import { S, theme } from '../utils/styles.js';
import { teamShortName, teamColor } from '../utils/teams.js';
import { supabase } from '../utils/supabase.js';
import { logAudit } from '../utils/audit.js';
import NavLogo from '../components/NavLogo.jsx';

export default function GameReviewScreen({ game, onDelete, onBack, onNavigate, currentUser, onStartVideoReview }) {
  const [deleting, setDeleting] = useState(false);
  const [events, setEvents] = useState(game.events || []);
  const [deletingEventId, setDeletingEventId] = useState(null);
  const [homeScore, setHomeScore] = useState(game.homeScore);
  const [awayScore, setAwayScore] = useState(game.awayScore);
  const G = game;
  const T = G.teams;
  const d = new Date(G.date);
  const isAdmin = currentUser?.role === 'admin';
  const hasRecording = (events.length > 0 || (G.duration && G.duration > 0));
  const matchId = G.supabase_id || G.id;

  const handleDeleteEvent = async (evt) => {
    const isGoal = evt.event?.startsWith('Goal');
    const msg = isGoal
      ? `Delete this goal?\n\n"${evt.event}" at ${fmtTs(evt.time)}\n\nThis will also update the match score.`
      : `Delete this event?\n\n"${evt.event}" at ${fmtTs(evt.time)}`;
    if (!confirm(msg)) return;
    setDeletingEventId(evt.id);
    try {
      const { error } = await supabase.from('match_events').delete().eq('id', evt.id);
      if (error) throw error;
      const remaining = events.filter(e => e.id !== evt.id);
      setEvents(remaining);
      if (isGoal) {
        const newHome = remaining.filter(e => e.team === 'home' && e.event?.startsWith('Goal')).length;
        const newAway = remaining.filter(e => e.team === 'away' && e.event?.startsWith('Goal')).length;
        setHomeScore(newHome);
        setAwayScore(newAway);
        await supabase.from('matches').update({ home_score: newHome, away_score: newAway }).eq('id', matchId);
        await supabase.from('match_stats').delete().eq('match_id', matchId);
      }
      await logAudit('event_deleted', 'match_event', evt.id, {
        match_id: matchId, event: evt.event, team: evt.team, zone: evt.zone, was_goal: isGoal,
      });
    } catch (e) {
      console.error('Delete event error:', e);
      alert('Error deleting event: ' + (e.message || e));
    }
    setDeletingEventId(null);
  };

  const handleDeleteRecording = async () => {
    if (!confirm('Delete only the recording (events, credits, commentator assignments)?\n\nThe match result and scores will be kept.')) return;
    setDeleting(true);
    try {
      // Delete events
      await supabase.from('match_events').delete().eq('match_id', matchId);
      // Delete credits
      await supabase.from('credit_ledger').delete().eq('match_id', matchId);
      await supabase.from('team_credits').delete().eq('match_id', matchId);
      // Delete commentator assignments
      await supabase.from('match_commentators').delete().eq('match_id', matchId);
      // Reset match duration + unlock
      await supabase.from('matches').update({ duration: 0, locked_by: null }).eq('id', matchId);
      // Recalc team tiers
      const { data: match } = await supabase.from('matches').select('home_team_id, away_team_id').eq('id', matchId).single();
      if (match) {
        await supabase.rpc('recalc_team_tier', { p_team_id: match.home_team_id }).catch(() => {});
        await supabase.rpc('recalc_team_tier', { p_team_id: match.away_team_id }).catch(() => {});
      }
      // Audit
      await logAudit('recording_deleted', 'match', matchId, { reason: 'Admin deleted recording' });
      alert('Recording deleted. Match result retained.');
      onBack();
    } catch (e) {
      console.error('Delete recording error:', e);
      alert('Error deleting recording. Check console.');
    }
    setDeleting(false);
  };

  const renderLogEntry = (entry) => {
    const canDelete = isAdmin;
    const isDeleting = deletingEventId === entry.id;
    if (entry.team === "commentary") return (
      <div key={entry.id} style={{
        padding: "6px 10px", borderRadius: 8, marginBottom: 3,
        background: "linear-gradient(135deg, #F59E0B12, #F59E0B08)",
        borderLeft: "3px solid #F59E0B55",
        display: "flex", alignItems: "flex-start", gap: 6,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
            <span style={{ fontSize: 11 }}>💬</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: theme.accent, textTransform: "uppercase" }}>Insight</span>
            <span style={{ fontSize: 8, fontFamily: "monospace", color: theme.textDim, marginLeft: "auto" }}>{fmtTs(entry.time)}</span>
          </div>
          <div style={{ fontSize: 10, color: "#E2E8F0", lineHeight: 1.3, fontStyle: "italic", paddingLeft: 18 }}>{entry.detail}</div>
        </div>
        {canDelete && (
          <button onClick={() => handleDeleteEvent(entry)} disabled={isDeleting} style={{
            background: 'none', border: 'none', color: '#F8717166', fontSize: 12,
            cursor: 'pointer', padding: '2px 4px', flexShrink: 0, opacity: isDeleting ? 0.3 : 1,
          }}>✕</button>
        )}
      </div>
    );
    const isMeta = entry.team === "meta";
    const tc = isMeta ? theme.accent : T[entry.team]?.color || theme.textDimmer;
    const isGoal = entry.event?.startsWith("Goal");
    return (
      <div key={entry.id} style={{
        padding: "5px 8px", borderRadius: 6, background: tc + "08",
        borderLeft: `3px solid ${tc}`, marginBottom: 3,
        display: "flex", alignItems: "flex-start", gap: 6,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ fontSize: 8, fontFamily: "monospace", color: theme.textDim, minWidth: 28 }}>{fmtTs(entry.time)}</div>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: tc, flexShrink: 0 }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: isGoal ? theme.accent : isMeta ? theme.accent : theme.text }}>{entry.event}</div>
            <div style={{ fontSize: 7, color: theme.textMuted, marginLeft: "auto", fontWeight: 600 }}>{entry.zone}</div>
          </div>
          {entry.detail && !isMeta && <div style={{ fontSize: 9, color: theme.textDim, paddingLeft: 40, lineHeight: 1.2 }}>{entry.detail}</div>}
        </div>
        {canDelete && (
          <button onClick={() => handleDeleteEvent(entry)} disabled={isDeleting} style={{
            background: isGoal ? '#F8717122' : 'none', border: isGoal ? '1px solid #F8717133' : 'none',
            color: isGoal ? '#F87171' : '#F8717166', fontSize: isGoal ? 10 : 12, fontWeight: isGoal ? 700 : 400,
            cursor: 'pointer', padding: isGoal ? '2px 6px' : '2px 4px', borderRadius: 4,
            flexShrink: 0, opacity: isDeleting ? 0.3 : 1,
          }}>{isGoal ? '✕ Goal' : '✕'}</button>
        )}
      </div>
    );
  };

  return (
    <div style={S.app}>
      <div style={S.nav}>
        <button style={S.backBtn} onClick={onBack}>←</button>
        <div style={{ flex: 1 }}>
          <div style={S.navTitle}>{teamShortName(T.home)} vs {teamShortName(T.away)}</div>
          <div style={{ fontSize: 10, color: theme.textDim }}>
            {d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
            {G.venue && ` · ${G.matchType ? (G.matchType.charAt(0).toUpperCase() + G.matchType.slice(1)) + ' @ ' : ''}${G.venue}`}
          </div>
        </div>
        <NavLogo />
      </div>

      {/* Score header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: 16 }}>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: teamColor(T.home) }}>{teamShortName(T.home)}</div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>{homeScore}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: theme.accent }}>{fmt(G.duration)}</div>
          <div style={{ fontSize: 8, fontWeight: 700, color: theme.textDim, textTransform: "uppercase" }}>Full Time</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: teamColor(T.away) }}>{teamShortName(T.away)}</div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>{awayScore}</div>
        </div>
      </div>

      {/* Sync status */}
      <div style={{ textAlign: "center", padding: "0 16px 6px", fontSize: 10, color: G.supabase_id ? "#10B981" : "#F59E0B" }}>
        {G.supabase_id ? "☁️ Synced to cloud" : "📱 Local only — not synced"}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, padding: "0 16px 10px", justifyContent: "center", flexWrap: "wrap" }}>
        {/* Admin-only actions */}
        {isAdmin && (
          <>
            <button onClick={() => exportMatchJSON(G)} style={S.btnSm(theme.info, "#FFF")}>📦 JSON</button>
            {onNavigate && events.length > 0 && <button onClick={() => onNavigate("public_view", G)} style={S.btnSm("#10B981", "#FFF")}>📺 Public</button>}
            {onNavigate && events.length > 0 && <button onClick={() => onNavigate("coach_view", G)} style={S.btnSm("#8B5CF6", "#FFF")}>🔒 Coach</button>}
            {onNavigate && <button onClick={() => onNavigate("match_edit", G)} style={S.btnSm(theme.surface, theme.textMuted)}>✏️ Edit</button>}
            {onDelete && <button onClick={() => { if (confirm("Delete this match permanently?")) onDelete(G.id); }}
              style={{ ...S.btnSm("transparent", theme.danger), border: `1px solid ${theme.danger}44` }}>
              🗑 Delete Match
            </button>}
          </>
        )}
        {/* Commentator: Start video recording (only if not yet recorded) + Report Issue */}
        {!isAdmin && currentUser?.role === 'commentator' && (
          <>
            {!hasRecording && onStartVideoReview && (
              <button onClick={() => onStartVideoReview(G)} style={S.btnSm("#8B5CF6", "#FFF")}>
                📹 Start Video Recording
              </button>
            )}
            <button onClick={() => { window.location.hash = '#/issues'; }}
              style={S.btnSm("transparent", "#F59E0B")}>
              ⚠️ Report Issue
            </button>
          </>
        )}
        {/* Public/Coach views also available to commentators if recording exists */}
        {!isAdmin && onNavigate && events.length > 0 && (
          <>
            <button onClick={() => onNavigate("public_view", G)} style={S.btnSm("#10B981", "#FFF")}>📺 Public</button>
            <button onClick={() => onNavigate("coach_view", G)} style={S.btnSm("#8B5CF6", "#FFF")}>🔒 Coach</button>
          </>
        )}
      </div>
      {isAdmin && hasRecording && (
        <div style={{ textAlign: 'center', padding: '0 16px 10px' }}>
          <button onClick={handleDeleteRecording} disabled={deleting}
            style={{ ...S.btnSm("transparent", "#F97316"), border: '1px solid #F9731644', opacity: deleting ? 0.5 : 1 }}>
            {deleting ? '...' : '🧹 Delete Recording Only'}
          </button>
        </div>
      )}

      {/* Match Log */}
      <div style={{ padding: "0 12px 20px" }}>
        {events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 16px", color: theme.textDim }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }}>Detailed analytics not available for this match</div>
            <div style={{ fontSize: 10, color: theme.textDim }}>This match was not recorded — only the final score was captured.</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, fontWeight: 800, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Match Log</div>
            {events.map(e => renderLogEntry(e))}
          </>
        )}
      </div>
    </div>
  );
}
