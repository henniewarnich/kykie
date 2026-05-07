import { useState, useCallback, useEffect, useRef } from 'react';
import { otherTeam, exportMatchJSON, ensureContrastingColors } from '../utils/helpers.js';
import { generateInsight } from '../utils/commentary.js';
import { S, theme } from '../utils/styles.js';
import { useMatchTimer } from '../hooks/useMatchTimer.js';
import { useAutoSave } from '../hooks/useAutoSave.js';
import { createLiveMatch, pushLiveEvent, updateLiveScore, endLiveMatch, endVideoReview } from '../utils/sync.js';
import { awardLiveMatchCredits, awardVideoReviewCredits } from '../utils/credits.js';
import { supabase } from '../utils/supabase.js';
import Scoreboard from '../components/Scoreboard.jsx';
import FieldRecorder from '../components/FieldRecorder.jsx';
import EventLog from '../components/EventLog.jsx';
import CoachLiveScreen from './CoachLiveScreen.jsx';
import DPopup from '../components/DPopup.jsx';
import PausePopup from '../components/PausePopup.jsx';
import TeamPicker from '../components/TeamPicker.jsx';
import PenaltyShootout, { pushShootoutStart, pushPenaltyKick, deleteLastKickRow, wipeShootoutRows } from '../components/PenaltyShootout.jsx';
import { teamColor, teamDisplayName, teamShortName, teamSlug } from '../utils/teams.js';

const ZONES = [
  { id: "z1", label: "Opp Quarter" },
  { id: "z2", label: "Opp Midfield" },
  { id: "z3", label: "Own Midfield" },
  { id: "z4", label: "Own Quarter" },
];

export default function LiveMatchScreen({ matchConfig, existingMatchId, onSaveGame, onNavigate, onBack, currentUser, onMatchCreated }) {
  const { home, away, matchLength, breakFormat, matchType, venue, date, isDemo, isVideoReview, videoReviewMatchId, savedScore } = matchConfig;
  const { homeColor: hc, awayColor: ac } = ensureContrastingColors(teamColor(home), teamColor(away));
  const timer = useMatchTimer();
  const { matchTime, running, matchState } = timer;

  const [events, setEvents] = useState([]);
  const [possession, setPossession] = useState(null);
  const [ballPos, setBallPos] = useState(null);
  const [prevBallPos, setPrevBallPos] = useState(null);
  const [score, setScore] = useState({ home: 0, away: 0 });
  const [showDPopup, setShowDPopup] = useState(null);
  const [showRestart, setShowRestart] = useState(true);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showPauseReason, setShowPauseReason] = useState(false);
  const [rotation, setRotation] = useState(0);
  const flipped = rotation === 180;
  const [sidelineOut, setSidelineOut] = useState(null);
  const [lastSavedGame, setLastSavedGame] = useState(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [shootoutOpen, setShootoutOpen] = useState(false);
  const [shootoutFirstKicker, setShootoutFirstKicker] = useState(null);
  const [shootoutKicks, setShootoutKicks] = useState([]); // [{ team, result, eventId }]
  const [pauseReason, setPauseReason] = useState(null);
  const [liveMatchId, setLiveMatchId] = useState(null);
  const [matchViewers, setMatchViewers] = useState(0);
  const [showScoreMismatch, setShowScoreMismatch] = useState(null);
  const [showVideoReviewEnd, setShowVideoReviewEnd] = useState(false);
  const [reclassifyToast, setReclassifyToast] = useState(null);
  const toastTimerRef = useRef(null);
  const [homeKitColor, setHomeKitColor] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`kykie-kit-${matchConfig?.supabaseId || 'local'}`))?.home || null; } catch { return null; } });
  const [awayKitColor, setAwayKitColor] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`kykie-kit-${matchConfig?.supabaseId || 'local'}`))?.away || null; } catch { return null; } });
  const [colorPickerFor, setColorPickerFor] = useState(null);
  const [copyToast, setCopyToast] = useState(false);
  const KIT_PALETTE = ["#FFFFFF", "#1E293B", "#1E3A5F", "#EF4444", "#EA580C", "#F59E0B", "#10B981", "#38BDF8", "#8B5CF6", "#7C2D12", "#DB2777"];
  const saveKitColors = (h, a) => {
    setHomeKitColor(h); setAwayKitColor(a);
    sessionStorage.setItem(`kykie-kit-${matchConfig?.supabaseId || 'local'}`, JSON.stringify({ home: h, away: a }));
    setColorPickerFor(null);
  };

  // Teams with kit colour overrides — cascades everywhere
  const applyKit = (team, kitColor) => kitColor ? { ...team, color: kitColor, institution: { ...team.institution, color: kitColor } } : team;
  const teams = {
    home: applyKit({ ...home, color: hc }, homeKitColor),
    away: applyKit({ ...away, color: ac }, awayKitColor),
  };

  const lastEventSeqRef = useRef(0); // seq of last event for Supabase updates

  // Track viewers via presence
  useEffect(() => {
    if (!liveMatchId || isDemo || isVideoReview) { setMatchViewers(0); return; }
    const channel = supabase.channel(`match-viewers-${liveMatchId}`, { config: { presence: { key: 'commentator-' + Math.random().toString(36).slice(2) } } });
    channel.on('presence', { event: 'sync' }, () => {
      const count = Object.keys(channel.presenceState()).length;
      setMatchViewers(Math.max(0, count - 1)); // exclude self
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ role: 'commentator', ts: Date.now() });
    });
    return () => { supabase.removeChannel(channel); };
  }, [liveMatchId, isDemo]);
  const eventSeqRef = useRef(0);

  const topTeam = flipped ? "home" : "away";
  const bottomTeam = flipped ? "away" : "home";

  // Create live match in Supabase on mount (unless demo, video review, or existing match)
  useEffect(() => {
    if (isDemo) return;
    if (isVideoReview && videoReviewMatchId) {
      setLiveMatchId(videoReviewMatchId);
      return;
    }
    if (existingMatchId) {
      setLiveMatchId(existingMatchId);
      return;
    }
    createLiveMatch(matchConfig, currentUser?.id).then(result => {
      if (result) {
        setLiveMatchId(result.id);
        if (onMatchCreated) onMatchCreated(result.id);
        console.log('Live match created:', result.id);
      }
    }).catch(err => console.warn('Could not create live match:', err));
  }, []);

  // Auto-save
  const getState = useCallback(() => ({
    teams, events, matchTime: timer.matchTime, matchState: timer.matchState,
    possession, ballPos, prevBallPos, score, flipped, sidelineOut,
    matchLength, breakFormat, matchType, venue, date,
  }), [teams, events, timer.matchTime, timer.matchState, possession, ballPos, prevBallPos, score, flipped, sidelineOut]);
  const { clearAutoSave } = useAutoSave(getState, matchState !== "idle" && matchState !== "ended");

  // Add log with optional commentary + push to Supabase
  const addLog = useCallback((team, event, zone, detail) => {
    const entry = { id: Date.now(), team, event, zone, detail, time: timer.matchTime };

    setEvents(prev => {
      const upd = [entry, ...prev];
      const triggers = ["D Entry", "Goal!", "Goal! (SC)", "Turnover Won", "Short Corner", "Penalty"];
      if (triggers.includes(event)) {
        const ins = generateInsight(team, event, upd, teams);
        if (ins) {
          const commentaryEntry = { id: Date.now() + 1, team: "commentary", event: "💬", zone: "", detail: ins, time: timer.matchTime };
          // Push commentary to Supabase too
          if (liveMatchId && !isDemo) {
            eventSeqRef.current += 1;
            pushLiveEvent(liveMatchId, commentaryEntry, eventSeqRef.current).catch(() => {});
          }
          // Event on top, insight below it in newest-first feed
          return [entry, commentaryEntry, ...prev];
        }
      }
      return upd;
    });

    // Push event to Supabase
    if (liveMatchId && !isDemo) {
      eventSeqRef.current += 1;
      lastEventSeqRef.current = eventSeqRef.current;
      pushLiveEvent(liveMatchId, entry, eventSeqRef.current).catch(() => {});
    }
  }, [timer.matchTime, teams, liveMatchId, isDemo]);

  // Show reclassify toast (auto-dismiss after 3s)
  const showToast = (options) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setReclassifyToast(options);
    toastTimerRef.current = setTimeout(() => setReclassifyToast(null), 3000);
  };

  const dismissToast = () => {
    setReclassifyToast(null);
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
  };

  // Reclassify last event
  const reclassify = (newEvent) => {
    setEvents(prev => {
      // Find first non-commentary event
      const idx = prev.findIndex(e => e.team !== 'commentary' && e.team !== 'meta');
      if (idx < 0) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], event: newEvent };
      return updated;
    });
    // Update in Supabase
    if (liveMatchId && !isDemo && lastEventSeqRef.current > 0) {
      supabase.from('match_events')
        .update({ event: newEvent })
        .eq('match_id', liveMatchId)
        .eq('seq', lastEventSeqRef.current)
        .then(() => {})
        .catch(() => {});
    }
    dismissToast();
  };

  // Callback from FieldRecorder after ball movement
  const handleBallMoved = (eventType) => {
    // Overhead reclassify now handled by FieldRecorder's inline button
  };

  // Ball tap = swap possession (except in D → show popup)
  const handleBallTap = () => {
    if (!running || showRestart || !possession) return;
    if (ballPos?.type === "d") { setShowDPopup({ end: ballPos.end }); return; }
    const other = otherTeam(possession);
    addLog(other, "Turnover Won", ballPos?.zoneId ? "Centre" : "Centre", `${teamShortName(teams[other])} won possession`);
    setPossession(other);
  };

  // Backline action button (Green Card, Yellow Card, Short Corner, Penalty)
  const handleAction = (actionId, end) => {
    if (!running || !possession) return;
    const attackingTeam = end === "top" ? (flipped ? "away" : "home") : (flipped ? "home" : "away");
    const defendingTeam = otherTeam(attackingTeam);
    const zone = ballPos?.zoneId ? ZONES.find(z => z.id === ballPos.zoneId) : null;
    const zoneLbl = zone ? `${zone.label} (${ballPos.pos || "centre"})` : "Centre";

    if (actionId === "green_card") {
      addLog(defendingTeam, "Green Card", zoneLbl, `Green Card to ${teamShortName(teams[defendingTeam])} in ${zoneLbl}`);
    } else if (actionId === "yellow_card") {
      addLog(defendingTeam, "Yellow Card", zoneLbl, `Yellow Card to ${teamShortName(teams[defendingTeam])} in ${zoneLbl}`);
    } else if (actionId === "short_corner") {
      addLog(attackingTeam, "Short Corner", `${teamShortName(teams[defendingTeam])} D`, `${teamShortName(teams[attackingTeam])} awarded Short Corner in ${zoneLbl}`);
      setPossession(attackingTeam);
      setPrevBallPos(ballPos);
      setBallPos({ type: "sc", end });
    } else if (actionId === "penalty") {
      // Move ball to centre in front of D, give to attacking team
      const penZone = end === "top" ? (flipped ? "z4" : "z1") : (flipped ? "z1" : "z4");
      addLog(attackingTeam, "Penalty", `${teamShortName(teams[defendingTeam])} D`, `${teamShortName(teams[attackingTeam])} awarded Penalty at ${teamShortName(teams[defendingTeam])}'s D`);
      setPossession(attackingTeam);
      setPrevBallPos(ballPos);
      setBallPos({ zoneId: penZone, pos: "centre" });
    }
  };

  // D option
  const handleDOption = (opt) => {
    if (!showDPopup) return;
    const { end, lastShot } = showDPopup;
    const attackingTeam = end === "top" ? (flipped ? "away" : "home") : (flipped ? "home" : "away");
    const defendingTeam = otherTeam(attackingTeam);
    const dLabel = `${teamShortName(teams[defendingTeam])} D`;

    // Shot on/off: log event but keep popup open for follow-up
    if (opt.id === "shot_on" || opt.id === "shot_off") {
      addLog(attackingTeam, opt.label, dLabel, `${teamShortName(teams[attackingTeam])}: ${opt.label} in ${dLabel}`);
      setShowDPopup({ end, lastShot: opt });
      return;
    }

    if (opt.id === "goal") {
      const real = events.filter(e => e.team !== "commentary" && e.team !== "meta");
      const lastSC = real.find(e => e.event === "Short Corner" && e.team === attackingTeam);
      const btw = lastSC ? real.slice(0, real.indexOf(lastSC)) : [];
      const fromSC = lastSC && !btw.some(e => e.event === "Start" || e.event.startsWith("Goal!") || (e.event === "Turnover Won" && e.team === defendingTeam));
      // Only auto-log shot if no shot was already recorded in this D sequence
      if (!lastShot) {
        addLog(attackingTeam, "Shot on Goal", dLabel, `${teamShortName(teams[attackingTeam])} shot on goal`);
      }
      addLog(attackingTeam, fromSC ? "Goal! (SC)" : "Goal!", dLabel, fromSC ? `${teamShortName(teams[attackingTeam])} scored from short corner!` : `${teamShortName(teams[attackingTeam])} scored!`);
      setScore(prev => {
        const newScore = { ...prev, [attackingTeam]: prev[attackingTeam] + 1 };
        if (liveMatchId && !isDemo && !isVideoReview) updateLiveScore(liveMatchId, newScore.home, newScore.away).catch(() => {});
        return newScore;
      });
      setPossession(null); setBallPos(null); setPrevBallPos(null); setShowRestart(true);
    } else if (opt.id === "lost_poss") {
      addLog(attackingTeam, "Poss Conceded", dLabel, `${teamShortName(teams[attackingTeam])} lost possession in ${dLabel}`);
      setPossession(defendingTeam);
    } else if (opt.id === "short_corner") {
      addLog(attackingTeam, "Short Corner", dLabel, `${teamShortName(teams[attackingTeam])}: Short Corner in ${dLabel}`);
      setPrevBallPos(ballPos); setBallPos({ type: "sc", end });
    } else if (opt.id === "dead_ball") {
      addLog(defendingTeam, "Dead Ball", dLabel, `Dead ball in ${dLabel} — ${teamShortName(teams[defendingTeam])} ball`);
      setPossession(defendingTeam);
      const outsideZone = end === "top" ? (flipped ? "z4" : "z1") : (flipped ? "z1" : "z4");
      setPrevBallPos(ballPos);
      setBallPos({ zoneId: outsideZone, pos: "centre", nearLine: true });
    } else if (opt.id === "penalty") {
      addLog(attackingTeam, "Penalty", dLabel, `${teamShortName(teams[attackingTeam])}: Penalty in ${dLabel}`);
      setPossession(attackingTeam);
      const outsideZone = end === "top" ? (flipped ? "z4" : "z1") : (flipped ? "z1" : "z4");
      setPrevBallPos(ballPos);
      setBallPos({ zoneId: outsideZone, pos: "centre" });
    } else if (opt.id === "long_corner") {
      addLog(attackingTeam, "Long Corner", dLabel, `${teamShortName(teams[attackingTeam])}: Long Corner at ${dLabel}`);
      setPossession(attackingTeam);
      const outsideZone = end === "top" ? (flipped ? "z4" : "z1") : (flipped ? "z1" : "z4");
      setPrevBallPos(ballPos);
      setBallPos({ zoneId: outsideZone, pos: "centre", nearLine: true });
    } else {
      addLog(attackingTeam, opt.label, dLabel, `${teamShortName(teams[attackingTeam])}: ${opt.label} in ${dLabel}`);
    }
    setShowDPopup(null);
  };

  // Restart from centre
  const handleRestart = (team) => {
    setSidelineOut(null);
    addLog(team, "Start", "Centre", `${teamShortName(teams[team])} takes centre pass`);
    // On first start, add strip colour commentary if away team colour was changed
    if (events.length === 0) {
      const origAwayColor = teamColor(away);
      if (origAwayColor && ac !== origAwayColor) {
        const colorName = ac === "#F59E0B" ? "yellow" : ac === "#1D4ED8" ? "blue" : "alternate";
        const awayName = teamShortName(teams.away);
        const homeName = teamShortName(teams.home);
        const commentEntry = { id: Date.now() + 2, team: "commentary", event: "💬", zone: "", detail: `${homeName} is the home team. ${awayName} playing in ${colorName} today instead of their normal strip.`, time: 0 };
        setEvents(prev => [commentEntry, ...prev]);
        if (liveMatchId && !isDemo) {
          eventSeqRef.current += 1;
          pushLiveEvent(liveMatchId, commentEntry, eventSeqRef.current).catch(() => {});
        }
      }
    }
    setPossession(team); setPrevBallPos(null);
    setBallPos({ type: "centre", team }); setShowRestart(false); setShowTeamPicker(false);
    if (!running) timer.start();
  };

  // Pause
  const handlePause = (reason) => {
    timer.pause();
    setShowPauseReason(false);
    setPauseReason(reason);
    const entry = { id: Date.now(), team: "meta", event: `Pause: ${reason}`, zone: null, detail: reason, time: timer.matchTime };
    setEvents(prev => [entry, ...prev]);
    // Push to Supabase
    if (liveMatchId && !isDemo) {
      eventSeqRef.current += 1;
      pushLiveEvent(liveMatchId, entry, eventSeqRef.current).catch(() => {});
    }
    if (reason === "Quarter Break" || reason === "Half Time") {
      setBallPos(null); setPrevBallPos(null); setShowRestart(true); setPossession(null);
    }
  };

  // Resume
  const handleResume = () => {
    const entry = { id: Date.now(), team: "meta", event: "Resume", zone: null, detail: `Play resumes${pauseReason ? ` after ${pauseReason}` : ""}`, time: timer.matchTime };
    setEvents(prev => [entry, ...prev]);
    if (liveMatchId && !isDemo) {
      eventSeqRef.current += 1;
      pushLiveEvent(liveMatchId, entry, eventSeqRef.current).catch(() => {});
    }
    timer.resume();
    setPauseReason(null);
  };

  const [showDemoEnd, setShowDemoEnd] = useState(false);

  // End match — penalties are handled via openShootout flow
  const handleEndMatch = () => {
    setShowEndConfirm(false);
    finalizeEnd();
  };

  const handleAbandon = () => {
    setShowEndConfirm(false);
    timer.end();
    clearAutoSave();
    if (liveMatchId) {
      endLiveMatch(liveMatchId, score.home, score.away, timer.matchTime, { abandoned: true }).catch(() => {});
    }
    const game = {
      id: liveMatchId || Date.now().toString(),
      supabase_id: liveMatchId || null,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      teams, events, duration: timer.matchTime,
      matchLength, breakFormat, matchType, venue,
      homeScore: score.home, awayScore: score.away,
      abandoned: true,
    };
    const saved = onSaveGame(game);
    setLastSavedGame(saved || game);
  };

  // ─── Penalty Shoot-out handlers ────────────────────────────
  const openShootout = () => {
    setShowEndConfirm(false);
    if (timer.running) timer.pause();
    setShootoutOpen(true);
  };

  const handlePickFirstKicker = async (team) => {
    setShootoutFirstKicker(team);
    const teamLabel = team === 'home' ? teamShortName(teams.home) : teamShortName(teams.away);
    const startEntry = { id: Date.now(), team: 'meta', event: 'Shootout Start', detail: team, time: timer.matchTime };
    const narrative = { id: Date.now() + 1, team: 'commentary', event: '💬', detail: `Penalty shoot-out begins. ${teamLabel} kicks first.`, time: timer.matchTime };
    setEvents(prev => [narrative, startEntry, ...prev]);
    if (liveMatchId && !isDemo) {
      eventSeqRef.current += 1;
      await pushShootoutStart(liveMatchId, team, timer.matchTime, eventSeqRef.current).catch(() => {});
      eventSeqRef.current += 1;
      await pushLiveEvent(liveMatchId, narrative, eventSeqRef.current).catch(() => {});
    }
  };

  const handleAddKick = async (kick) => {
    const localEntry = { id: Date.now(), team: kick.team, event: 'Penalty Kick', detail: kick.result, time: timer.matchTime };
    setEvents(prev => [localEntry, ...prev]);

    let dbId = null;
    if (liveMatchId && !isDemo) {
      eventSeqRef.current += 1;
      const { id } = await pushPenaltyKick(liveMatchId, kick, timer.matchTime, eventSeqRef.current);
      dbId = id;
    }
    setShootoutKicks(prev => [...prev, { ...kick, eventId: dbId }]);
  };

  const handleUndoKick = async () => {
    if (shootoutKicks.length === 0) return;
    const last = shootoutKicks[shootoutKicks.length - 1];
    setShootoutKicks(prev => prev.slice(0, -1));
    setEvents(prev => {
      const idx = prev.findIndex(e => e.event === 'Penalty Kick');
      if (idx < 0) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    if (liveMatchId && !isDemo && last.eventId) {
      await deleteLastKickRow(liveMatchId, last.eventId);
    }
  };

  const handleCancelShootout = async () => {
    setShootoutOpen(false);
    setShootoutFirstKicker(null);
    setShootoutKicks([]);
    setEvents(prev => prev.filter(e =>
      e.event !== 'Penalty Kick' && e.event !== 'Shootout Start' && e.event !== 'Shootout End'
      && !(e.team === 'commentary' && e.detail?.toLowerCase()?.includes('shoot-out begins'))
    ));
    if (liveMatchId && !isDemo) {
      await wipeShootoutRows(liveMatchId);
      try {
        await supabase.from('match_events').delete().eq('match_id', liveMatchId).eq('team', 'commentary').ilike('detail', '%shoot-out begins%');
      } catch {}
    }
  };

  const handleShootoutComplete = (homePens, awayPens) => {
    // Push a Shootout End meta event for clarity in the feed
    const winLabel = homePens > awayPens ? teamShortName(teams.home) : teamShortName(teams.away);
    const endEntry = { id: Date.now(), team: 'meta', event: 'Shootout End', detail: `${winLabel} win shoot-out ${Math.max(homePens, awayPens)}–${Math.min(homePens, awayPens)}`, time: timer.matchTime };
    setEvents(prev => [endEntry, ...prev]);
    if (liveMatchId && !isDemo) {
      eventSeqRef.current += 1;
      pushLiveEvent(liveMatchId, endEntry, eventSeqRef.current).catch(() => {});
    }
    setShootoutOpen(false);
    finalizeEnd({ homePenalty: homePens, awayPenalty: awayPens });
  };

  // Shared end-match save (used by normal end + shootout completion)
  const finalizeEnd = (penOpts = {}) => {
    timer.end();
    clearAutoSave();
    if (isDemo) { setShowDemoEnd(true); return; }
    if (isVideoReview && videoReviewMatchId) {
      if (savedScore && (score.home !== savedScore.home || score.away !== savedScore.away)) {
        setShowScoreMismatch({ recorded: { ...score }, saved: { ...savedScore } });
        return;
      }
      finalizeVideoReview();
      return;
    }
    const game = {
      id: liveMatchId || Date.now().toString(),
      supabase_id: liveMatchId || null,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      teams, events, duration: timer.matchTime,
      matchLength, breakFormat, matchType, venue,
      homeScore: score.home, awayScore: score.away,
      homePenalty: penOpts.homePenalty ?? null,
      awayPenalty: penOpts.awayPenalty ?? null,
    };
    if (liveMatchId) {
      const opts = (penOpts.homePenalty != null && penOpts.awayPenalty != null) ? penOpts : {};
      endLiveMatch(liveMatchId, score.home, score.away, timer.matchTime, opts).catch(() => {});
      if (currentUser?.id && !isDemo) awardLiveMatchCredits(currentUser.id, liveMatchId, 'pro').catch(() => {});
    }
    const saved = onSaveGame(game);
    setLastSavedGame(saved || game);
  };

  // Discard recording — delete events, revert match to upcoming or delete if new
  const handleDiscard = async () => {
    setShowEndConfirm(false);
    timer.end();
    clearAutoSave();
    if (liveMatchId) {
      try {
        // Delete events
        await supabase.from('match_events').delete().eq('match_id', liveMatchId);
        // Revert to upcoming (or delete if it was a brand new match)
        await supabase.from('matches').update({ status: 'upcoming', duration: 0, locked_by: null }).eq('id', liveMatchId);
      } catch (e) { console.error('Discard error:', e); }
    }
    if (onBack) onBack();
  };

  const finalizeVideoReview = async (updateScore = false) => {
    setShowScoreMismatch(null);
    if (updateScore && videoReviewMatchId) {
      await supabase.from('matches').update({ home_score: score.home, away_score: score.away }).eq('id', videoReviewMatchId);
    }
    await endVideoReview(videoReviewMatchId, score.home, score.away, timer.matchTime);
    if (currentUser?.id) awardVideoReviewCredits(currentUser.id, videoReviewMatchId).catch(() => {});
    setShowVideoReviewEnd(true);
  };

  // Undo last event (for sideline out reversal)
  const undoLastEvent = () => {
    if (events.length === 0) return;
    let rc = 1;
    if (events[0].team === "commentary" && events.length > 1) rc = 2;
    setEvents(prev => prev.slice(rc));
    setPrevBallPos(null);
  };

  // Undo
  const undoLast = () => {
    if (events.length === 0) return;
    let rc = 1;
    if (events[0].team === "commentary" && events.length > 1) rc = 2;
    const removed = events.slice(0, rc);
    const rest = events.slice(rc);
    setEvents(rest); setPrevBallPos(null);
    const hadGoal = removed.some(e => e.event?.startsWith("Goal!"));
    if (hadGoal) {
      const goalEntry = removed.find(e => e.event?.startsWith("Goal!"));
      if (goalEntry) setScore(prev => ({ ...prev, [goalEntry.team]: Math.max(0, prev[goalEntry.team] - 1) }));
      setShowRestart(false);
    }
    if (removed.some(e => e.event?.startsWith("Sideline"))) setSidelineOut(null);
    const prev = rest.find(e => e.team !== "commentary" && e.team !== "meta");
    if (prev) {
      setPossession(prev.team);
      if (prev.zone === "Centre") setBallPos({ type: "centre", team: prev.team });
      else if (prev.zone?.includes(" D")) setBallPos({ type: "d", end: "top" });
      else {
        const ZONES = [{ id: "z1", label: "Opp Quarter" }, { id: "z2", label: "Opp Midfield" }, { id: "z3", label: "Own Midfield" }, { id: "z4", label: "Own Quarter" }];
        const z = ZONES.find(zn => prev.zone?.startsWith(zn.label));
        const pm = prev.zone?.match(/\((left|right|centre)\)/);
        setBallPos(z ? { zoneId: z.id, pos: pm ? pm[1] : "centre" } : null);
      }
    } else { setPossession(null); setBallPos(null); setShowRestart(true); }
  };

  const [liveTab, setLiveTab] = useState("field"); // field | log | coach | share

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {isDemo && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px' }}>
          <button onClick={() => { timer.end(); if (onBack) onBack(); }} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            ← Cancel Demo
          </button>
          <span style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 700 }}>DEMO MODE</span>
        </div>
      )}

      <Scoreboard teams={teams} homeGoals={score.home} awayGoals={score.away}
        matchTime={matchTime} matchState={matchState} running={running} matchId={isDemo ? null : liveMatchId}
        onHomeKitTap={matchState !== "ended" ? () => setColorPickerFor(colorPickerFor === "home" ? null : "home") : undefined}
        onAwayKitTap={matchState !== "ended" ? () => setColorPickerFor(colorPickerFor === "away" ? null : "away") : undefined}
      />

      {/* Speed control — admin only, video review or demo */}
      {(isVideoReview || isDemo) && currentUser && currentUser.role === 'admin' && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '4px 0' }}>
          {[1, 1.5, 2].map(s => (
            <button key={s} onClick={() => timer.setSpeed(s)} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
              border: timer.speed === s ? '1px solid #F59E0B44' : '1px solid #334155',
              background: timer.speed === s ? '#F59E0B22' : '#1E293B',
              color: timer.speed === s ? '#F59E0B' : '#64748B',
            }}>{s}x</button>
          ))}
        </div>
      )}

      {/* Viewer count */}
      {matchViewers > 0 && (
        <div style={{ textAlign: "center", padding: "2px 0 4px" }}>
          <span style={{ fontSize: 10, color: "#10B981", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
            👁 {matchViewers} watching
          </span>
        </div>
      )}

      {/* Possession + Rotate */}
      <div style={{ padding: "0 14px 4px", display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
        {pauseReason ? (
          <div style={{ fontSize: 12, fontWeight: 800, color: "#F59E0B", background: "#F59E0B22", padding: "4px 16px", borderRadius: 99, display: "flex", alignItems: "center", gap: 6 }}>
            ⏸ {pauseReason}
          </div>
        ) : possession ? (
          <div style={{ fontSize: 10, fontWeight: 700, color: teams[possession].color, padding: "2px 10px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: teams[possession].color, display: "inline-block" }} />
              {teamShortName(teams[possession])}: In Possession
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 9, fontWeight: 700, color: theme.textDimmer, padding: "2px 10px" }}>
            {matchState === "ended" ? "MATCH ENDED" : "TAP BALL TO START"}
          </div>
        )}
        {matchState !== "ended" && (
          <button onClick={() => {
            const next = (rotation + 90) % 360;
            const wasFlipped = rotation === 180;
            const willFlip = next === 180;
            if (wasFlipped !== willFlip) {
              const mirrorPos = (p) => p === "left" ? "right" : p === "right" ? "left" : p;
              const mirrorEnd = (e) => e === "top" ? "bottom" : e === "bottom" ? "top" : e;
              setBallPos(bp => {
                if (!bp) return bp;
                const u = { ...bp };
                if (u.pos) u.pos = mirrorPos(u.pos);
                if (u.end) u.end = mirrorEnd(u.end);
                return u;
              });
              setPrevBallPos(bp => {
                if (!bp) return bp;
                const u = { ...bp };
                if (u.pos) u.pos = mirrorPos(u.pos);
                if (u.end) u.end = mirrorEnd(u.end);
                return u;
              });
            }
            setRotation(next);
          }} style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textMuted, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🔄</button>
        )}
        {liveMatchId && (
          <button onClick={() => {
            const slug = teamSlug(teams.home);
            const url = `${window.location.origin}${window.location.pathname}#/team/${slug}?match=${liveMatchId}`;
            navigator.clipboard?.writeText(url).then(() => {
              setCopyToast(true); setTimeout(() => setCopyToast(false), 2000);
            }).catch(() => prompt("Copy this link:", url));
          }} style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textMuted, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🔗</button>
        )}
      </div>

      {/* Kit colour picker panel */}
      {colorPickerFor && (
        <div style={{ padding: "0 14px 6px" }}>
          <div style={{ background: "#1E293B", borderRadius: 8, padding: 10, border: "1px solid #334155" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", minWidth: 70 }}>
                {teamShortName(teams[colorPickerFor])}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {[colorPickerFor === "home" ? hc : ac, ...KIT_PALETTE].map((c, i) => {
                  const isActive = teams[colorPickerFor].color === c;
                  const origColor = colorPickerFor === "home" ? hc : ac;
                  return (
                    <div key={`${c}-${i}`} onClick={() => saveKitColors(
                      colorPickerFor === "home" ? (c === origColor ? null : c) : homeKitColor,
                      colorPickerFor === "away" ? (c === origColor ? null : c) : awayKitColor
                    )} style={{
                      width: 22, height: 22, borderRadius: 5, background: c, cursor: "pointer",
                      border: isActive ? "2px solid #F8FAFC" : c === "#FFFFFF" ? "1px solid #64748B" : "1px solid transparent",
                      boxShadow: isActive ? "0 0 0 1px #F8FAFC44" : "none",
                    }} />
                  );
                })}
              </div>
            </div>
            <button onClick={() => saveKitColors(awayKitColor, homeKitColor)} style={{
              width: "100%", padding: 7, background: "#334155", border: "none", borderRadius: 6,
              color: "#94A3B8", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>⇄ Swap colours</button>
          </div>
        </div>
      )}

      {/* Field — visible on live stats tab */}
      {liveTab === "field" && (
        <FieldRecorder
          teams={teams} possession={possession} setPossession={setPossession}
          ballPos={ballPos} setBallPos={setBallPos}
          prevBallPos={prevBallPos} setPrevBallPos={setPrevBallPos}
          running={running} matchState={matchState}
          showRestart={showRestart} setShowRestart={setShowRestart}
          flipped={flipped}
          rotation={rotation}
          sidelineOut={sidelineOut} setSidelineOut={setSidelineOut}
          score={score} setScore={setScore}
          onAddLog={addLog}
          onUndoLastEvent={undoLastEvent}
          onBallMoved={handleBallMoved}
          onShowDPopup={setShowDPopup} showDPopup={showDPopup}
          onShowTeamPicker={setShowTeamPicker}
          onBallTap={handleBallTap}
          onOverheadDrag={(fromZoneId, fromPos, toZoneId, toPos) => {
            if (!running || !possession) return;
            const fromZone = ZONES.find(z => z.id === fromZoneId);
            const toZone = ZONES.find(z => z.id === toZoneId);
            // Zone labels are home-perspective; invert for away team so commentary reads naturally
            const AWAY_ZONE_MAP = { "Opp Quarter": "Own Quarter", "Opp Midfield": "Own Midfield", "Own Midfield": "Opp Midfield", "Own Quarter": "Opp Quarter" };
            const mapLabel = (z) => possession === "away" && z ? (AWAY_ZONE_MAP[z.label] || z.label) : z?.label || "Centre";
            const fromLabel = fromZone ? `${mapLabel(fromZone)} (${fromPos})` : "Centre";
            const toLabel = toZone ? `${mapLabel(toZone)} (${toPos})` : "Centre";
            // Log throw first, then received — received appears on top in newest-first feed
            addLog(possession, "Overhead throw", fromLabel, `${teamShortName(teams[possession])}: Overhead throw from ${fromLabel}`);
            addLog(possession, "Overhead received", toLabel, `${teamShortName(teams[possession])}: Overhead received in ${toLabel}`);
            setPrevBallPos(ballPos);
            setBallPos({ zoneId: toZoneId, pos: toPos });
          }}
          onAction={handleAction}
        />
      )}

      {/* D Popup */}
      {showDPopup && (() => {
        const popupEnd = showDPopup.end;
        const atkTeam = popupEnd === "top" ? (flipped ? "away" : "home") : (flipped ? "home" : "away");
        const isOwnD = possession && possession !== atkTeam;
        const allOpts = [
          { id: "goal", label: isOwnD ? "Own Goal" : "Goal!", icon: "⚽", color: "#F59E0B" },
          { id: "short_corner", label: "Short Corner", icon: "🔲", color: "#8B5CF6" },
          { id: "shot_on", label: "Shot on Goal", icon: "◉", color: "#10B981" },
          { id: "shot_off", label: "Shot Off Target", icon: "○", color: "#6B7280" },
          { id: "penalty", label: "Penalty", icon: "🟡", color: "#F59E0B" },
          { id: "long_corner", label: "Long Corner", icon: "📐", color: "#3B82F6" },
          { id: "lost_poss", label: "Lost Possession", icon: "✕", color: "#EF4444" },
          { id: "dead_ball", label: "Dead Ball", icon: "⊘", color: "#94A3B8" },
        ];
        const ownDIds = ["goal", "penalty", "long_corner", "lost_poss", "dead_ball"];
        const opts = isOwnD ? allOpts.filter(o => ownDIds.includes(o.id)) : allOpts;
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowDPopup(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: theme.surface, borderRadius: 12, padding: 16, width: 280, border: `1px solid ${showDPopup.lastShot ? showDPopup.lastShot.color + '66' : theme.border}` }}>
            {showDPopup.lastShot ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: showDPopup.lastShot.color, marginBottom: 2, textAlign: "center" }}>
                  After {showDPopup.lastShot.label} — what next?
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginBottom: 10, textAlign: "center" }}>
                  {showDPopup.lastShot.icon} {showDPopup.lastShot.label} logged · tap what happened next
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, fontWeight: 800, color: theme.text, marginBottom: 10, textAlign: "center" }}>{isOwnD ? "In Own D — What happened?" : "In the D — What happened?"}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {opts.map(opt => (
                <button key={opt.id} onClick={() => handleDOption(opt)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderRadius: 8, border: `1px solid ${opt.color}33`, background: `${opt.color}11`,
                  color: theme.text, cursor: "pointer", fontSize: 12, fontWeight: 600,
                }}>
                  <span style={{ fontSize: 16 }}>{opt.icon}</span> {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Team Picker */}
      <TeamPicker show={showTeamPicker} teams={teams} topTeam={topTeam} bottomTeam={bottomTeam}
        onSelect={handleRestart} onClose={() => setShowTeamPicker(false)} />

      {/* Pause Picker */}
      <PausePopup show={showPauseReason} onSelect={handlePause} onClose={() => setShowPauseReason(false)} />

      {/* End Confirm */}
      {showEndConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} onClick={() => setShowEndConfirm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: theme.surface, borderRadius: 16, padding: "20px 16px", width: 280, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{isDemo ? "End Demo?" : isVideoReview ? "End Video Review?" : "End Match?"}</div>
            <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 4 }}>{teamShortName(teams.home)} {score.home} – {score.away} {teamShortName(teams.away)}</div>
            <div style={{ fontSize: 9, color: theme.textDim, marginBottom: 12 }}>{events.filter(e => e.team !== "commentary" && e.team !== "meta").length} events{isDemo ? " (will not be saved)" : ""}</div>
            {/* Premature ending warning */}
            {!isDemo && (timer.matchTime < 300 || events.filter(e => e.team !== "commentary" && e.team !== "meta").length < 10) && (
              <div style={{ background: '#EF444418', border: '1px solid #EF444444', borderRadius: 8, padding: '8px 10px', marginBottom: 12, textAlign: 'left' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#EF4444', marginBottom: 2 }}>Very short recording</div>
                <div style={{ fontSize: 9, color: '#94A3B8', lineHeight: 1.4 }}>This recording has minimal data and may not be useful. Consider using <strong style={{ color: '#F8FAFC' }}>Abandon Match</strong> to discard it, or continue recording.</div>
              </div>
            )}
            {/* Penalty Shoot-out option when tied */}
            {!isDemo && !isVideoReview && score.home === score.away && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={openShootout} style={{
                  width: '100%', padding: 12, borderRadius: 10, border: '1px solid #F59E0B66',
                  background: '#F59E0B22', color: '#F59E0B', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                }}>⚽ Decide by Penalty Shoot-out</button>
                <div style={{ fontSize: 9, color: '#64748B', marginTop: 4 }}>Records each kick live for supporters</div>
              </div>
            )}
            {(() => {
              const realEvents = events.filter(e => e.team !== "commentary" && e.team !== "meta").length;
              const isPremature = !isDemo && (timer.matchTime < 300 || realEvents < 10);
              const showSave = !isPremature || isDemo;
              return (
                <>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowEndConfirm(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textMuted, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Cancel</button>
                  {showSave && <button onClick={handleEndMatch} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #EF444466", background: "#EF444422", color: theme.danger, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{isDemo ? "End & Discard" : isVideoReview ? "End & Save Stats" : "End & Save"}</button>}
                </div>
                {!isDemo && isPremature && (
                  <button onClick={handleDiscard} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #EF444466', background: '#EF444422', color: '#EF4444', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Discard Recording</button>
                )}
                {!isDemo && !isPremature && (
                  <button onClick={handleAbandon} style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #64748B44', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>Match Abandoned (weather/other)</button>
                )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Penalty Shoot-out overlay */}
      {shootoutOpen && (
        <PenaltyShootout
          teams={teams}
          firstKicker={shootoutFirstKicker}
          kicks={shootoutKicks}
          onPickFirstKicker={handlePickFirstKicker}
          onAddKick={handleAddKick}
          onUndoLastKick={handleUndoKick}
          onCancelShootout={handleCancelShootout}
          onComplete={handleShootoutComplete}
        />
      )}

      {/* Score Mismatch Warning (Video Review) */}
      {showScoreMismatch && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: theme.surface, borderRadius: 16, padding: "20px 16px", width: 300, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#F59E0B", marginBottom: 8 }}>Score mismatch</div>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 12 }}>
              Your recorded score differs from the saved score.
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 20, marginBottom: 14 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#64748B", fontWeight: 700, marginBottom: 4 }}>RECORDED</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#F8FAFC" }}>{showScoreMismatch.recorded.home}–{showScoreMismatch.recorded.away}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#64748B", fontWeight: 700, marginBottom: 4 }}>SAVED</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#F8FAFC" }}>{showScoreMismatch.saved.home}–{showScoreMismatch.saved.away}</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={() => finalizeVideoReview(false)} style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textMuted, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Keep saved score ({showScoreMismatch.saved.home}–{showScoreMismatch.saved.away})</button>
              <button onClick={() => finalizeVideoReview(true)} style={{ padding: 10, borderRadius: 8, border: "1px solid #F59E0B44", background: "#F59E0B22", color: "#F59E0B", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Update to recorded score ({showScoreMismatch.recorded.home}–{showScoreMismatch.recorded.away})</button>
              <button onClick={() => { setShowScoreMismatch(null); timer.resume(); }} style={{ padding: 8, borderRadius: 8, background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Cancel — continue recording</button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", padding: "6px 14px 4px", flexWrap: "wrap" }}>
        {matchState !== "ended" ? (
          <>
            {running && <button onClick={() => setShowPauseReason(true)} style={S.btnSm(theme.accent, theme.bg)}>⏸ Pause</button>}
            {matchState === "paused" && <button onClick={handleResume} style={S.btnSm(theme.success, theme.bg)}>▶ Resume</button>}
            {(running || matchState === "paused") && <button onClick={() => setShowEndConfirm(true)} style={S.btnSm(theme.danger, "#FFF")}>⏹ End</button>}
            {events.length > 0 && <button onClick={undoLast} style={{ ...S.btnSm(theme.surface, theme.textMuted), border: `1px solid ${theme.border}` }}>↩ Undo</button>}
            {isVideoReview && <button onClick={async () => {
              if (!confirm('Cancel video review? All recorded events will be discarded.')) return;
              timer.end();
              clearAutoSave();
              if (videoReviewMatchId) {
                await supabase.from('match_events').delete().eq('match_id', videoReviewMatchId);
                await supabase.from('matches').update({ locked_by: null, stats_archived: false }).eq('id', videoReviewMatchId);
                await supabase.from('match_stats').delete().eq('match_id', videoReviewMatchId);
              }
              onNavigate("home");
            }} style={{ ...S.btnSm(theme.surface, theme.textMuted), border: `1px solid ${theme.border}` }}>✕ Cancel</button>}
          </>
        ) : showDemoEnd ? (
          <>
            <button onClick={() => onNavigate("home")} style={S.btnSm(theme.success, "#FFF")}>✓ Discard & Home</button>
          </>
        ) : showVideoReviewEnd ? (
          <>
            <button onClick={() => onNavigate("home")} style={S.btnSm(theme.success, "#FFF")}>✓ Stats saved — Home</button>
          </>
        ) : (
          <>
            <button onClick={() => lastSavedGame && exportMatchJSON(lastSavedGame)} style={S.btnSm(theme.info, "#FFF")}>📦 JSON</button>
            <button onClick={() => onNavigate("game_review", lastSavedGame)} style={S.btnSm(theme.success, "#FFF")}>📊 Review</button>
            <button onClick={() => onNavigate("home")} style={S.btnSm(theme.accent, theme.bg)}>🏠 Home</button>
          </>
        )}
      </div>

      {/* View tabs */}
      <div style={{ display: "flex", margin: "4px 10px 0", borderRadius: 6, overflow: "hidden", border: `1px solid ${theme.border}` }}>
        {[["field", "🏑 Live Stats"], ["log", "☰ Log"]].map(([k, l]) => (
          <button key={k} onClick={() => setLiveTab(k)} style={{
            flex: 1, padding: "5px 0", textAlign: "center", fontSize: 8, fontWeight: 700,
            background: liveTab === k ? theme.border : theme.surface,
            color: liveTab === k ? theme.text : theme.textDim,
            border: "none", cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>

      {/* Tab content */}
      {liveTab === "field" && (
        <CoachLiveScreen
          match={{ teams, breakFormat, matchLength, homeScore: score.home, awayScore: score.away, status: matchState === "ended" ? "ended" : "live" }}
          events={events}
          matchTime={matchTime}
          running={running}
          embedded
        />
      )}
      {liveTab === "log" && <EventLog events={events} teams={teams} />}

      {/* Copy toast */}
      {copyToast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 35, background: "#10B981", color: "#0B0F1A", padding: "6px 16px", borderRadius: 99, fontSize: 11, fontWeight: 700, animation: "toast-in 0.2s ease-out" }}>
          Link copied!
        </div>
      )}

      {/* Reclassify toast */}
      {reclassifyToast && (
        <div style={{
          position: "fixed", bottom: 10, left: "50%", transform: "translateX(-50%)",
          zIndex: 35, display: "flex", alignItems: "center", gap: 6,
          background: "#0F172Aee", padding: "6px 10px", borderRadius: 10,
          border: "1px solid #33415566", backdropFilter: "blur(8px)",
          animation: "toast-in 0.2s ease-out",
        }}>
          {reclassifyToast.buttons.map(b => (
            <button key={b.event} onClick={() => reclassify(b.event)} style={{
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${b.color}44`,
              background: `${b.color}22`, color: b.color, fontSize: 10, fontWeight: 700,
              cursor: "pointer",
            }}>{b.label}</button>
          ))}
          <button onClick={dismissToast} style={{
            background: "none", border: "none", color: "#475569", fontSize: 10, cursor: "pointer", padding: "4px",
          }}>✕</button>
          <div style={{
            position: "absolute", bottom: 0, left: 0, height: 2, borderRadius: "0 0 10px 10px",
            background: reclassifyToast.buttons[0]?.color || "#F59E0B",
            animation: "toast-timer 3s linear forwards",
          }} />
        </div>
      )}
      <style>{`
        @keyframes toast-in { from { transform: translateX(-50%) translateY(10px); opacity: 0; } to { transform: translateX(-50%); opacity: 1; } }
        @keyframes toast-timer { from { width: 100%; } to { width: 0%; } }
      `}</style>
    </div>
  );
}
