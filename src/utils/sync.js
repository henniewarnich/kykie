import { supabase } from './supabase.js';
import { logAudit } from './audit.js';
import { computeStats, computeSCOutcomes, getQuarters } from './stats.js';
import { predictMatch } from './predict.js';
import { matchOutcome, matchWinner } from './helpers.js';
import { MATCH_AWAY_TEAM, MATCH_HOME_TEAM, TEAM_SELECT, teamDerivedName, teamShortName } from './teams.js';

// ─── TEAMS ───────────────────────────────────────────

export async function fetchTeams() {
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_SELECT)
    .order('name');
  if (error) { console.error('Fetch teams error:', error); return null; }
  return data;
}

export async function upsertTeam(team) {
  const gender = team.gender || 'Girls';
  const sport = team.sport || 'Hockey';
  const age_group = team.age_group || '1st';
  const variant = team.variant?.trim() || null;
  const derivedName = variant ? `${gender} ${sport} ${variant}` : `${gender} ${sport} ${age_group}`;

  const row = {
    name: derivedName,
    color: team.institution?.color || team.color || '#1D4ED8',
    short_name: team.short_name || null,
    school: team.school || false,
    coach_pin: team.coach_pin || null,
    commentator_pin: team.commentator_pin || null,
    institution_id: team.institution_id || null,
    gender,
    age_group,
    sport,
    variant,
  };

  if (team.supabase_id || team.id) {
    const id = team.supabase_id || team.id;
    const { data, error } = await supabase
      .from('teams')
      .update(row)
      .eq('id', id)
      .select(TEAM_SELECT)
      .single();
    if (error) { console.error('Update team error:', error); return null; }
    return data;
  } else {
    const { data, error } = await supabase
      .from('teams')
      .insert(row)
      .select(TEAM_SELECT)
      .single();
    if (error) { console.error('Insert team error:', error); return null; }
    return data;
  }
}

// ─── INSTITUTIONS ─────────────────────────────────────

export async function fetchInstitutions() {
  const { data, error } = await supabase
    .from('institutions')
    .select('*')
    .order('name');
  if (error) { console.error('Fetch institutions error:', error); return []; }
  return data || [];
}

export async function upsertInstitution(inst) {
  const row = {
    name: inst.name.trim(),
    short_name: inst.short_name?.trim() || null,
    other_names: inst.other_names?.trim() || null,
    color: inst.color || '#1D4ED8',
    domain: inst.domain?.trim() || null,
  };

  if (inst.id) {
    const { data, error } = await supabase
      .from('institutions')
      .update(row)
      .eq('id', inst.id)
      .select()
      .single();
    if (error) { console.error('Update institution error:', error); return null; }
    await logAudit('institution_update', 'institution', data.id, { name: row.name });
    return data;
  } else {
    const { data, error } = await supabase
      .from('institutions')
      .insert(row)
      .select()
      .single();
    if (error) { console.error('Insert institution error:', error); return null; }
    await logAudit('institution_create', 'institution', data.id, { name: row.name });
    return data;
  }
}

export async function deleteInstitution(id) {
  // Check if any teams reference this institution
  const { count } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('institution_id', id);
  if (count > 0) {
    return { error: `Cannot delete — ${count} team(s) linked to this institution` };
  }
  const { error } = await supabase.from('institutions').delete().eq('id', id);
  if (error) { console.error('Delete institution error:', error); return { error: error.message }; }
  await logAudit('institution_delete', 'institution', id, {});
  return { success: true };
}

export async function deleteTeamRemote(supabaseId) {
  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', supabaseId);
  if (error) console.error('Delete team error:', error);
  return !error;
}

// ─── MATCHES ─────────────────────────────────────────

export async function saveMatchToSupabase(game) {
  // 1. Resolve team IDs
  const homeTeam = await findOrCreateTeam(game.teams.home);
  const awayTeam = await findOrCreateTeam(game.teams.away);
  if (!homeTeam || !awayTeam) return null;

  const matchRow = {
    home_team_id: homeTeam.id,
    away_team_id: awayTeam.id,
    home_score: game.homeScore || 0,
    away_score: game.awayScore || 0,
    match_date: game.date ? new Date(game.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    match_length: game.matchLength || 60,
    break_format: game.breakFormat || 'quarters',
    venue: game.venue || null,
    match_type: game.matchType || 'league',
    duration: game.duration || 0,
    status: game.abandoned ? 'abandoned' : 'ended',
  };

  let match;

  // 2. If game already has a Supabase ID (from createLiveMatch), UPDATE instead of INSERT
  const existingId = game.supabase_id || game.id;
  if (existingId) {
    // Try to update first
    const { data: updated, error: updateError } = await supabase
      .from('matches')
      .update(matchRow)
      .eq('id', existingId)
      .select()
      .single();
    
    if (!updateError && updated) {
      match = updated;
    } else {
      // Row doesn't exist — fall through to insert
      console.warn('Update failed, inserting new:', updateError?.message);
      const { data: inserted, error: insertError } = await supabase
        .from('matches')
        .insert(matchRow)
        .select()
        .single();
      if (insertError) { console.error('Insert match error:', insertError); return null; }
      match = inserted;
    }
  } else {
    // No existing ID — insert new
    const { data: inserted, error: insertError } = await supabase
      .from('matches')
      .insert(matchRow)
      .select()
      .single();
    if (insertError) { console.error('Insert match error:', insertError); return null; }
    match = inserted;
  }

  // 3. Insert events (only if not already pushed via live events)
  // Check if events already exist for this match
  const { data: existingEvents } = await supabase
    .from('match_events')
    .select('id')
    .eq('match_id', match.id)
    .limit(1);

  if ((!existingEvents || existingEvents.length === 0) && game.events && game.events.length > 0) {
    const eventRows = game.events.map((e, i) => ({
      match_id: match.id,
      team: e.team,
      event: e.event,
      zone: e.zone || null,
      detail: e.detail || null,
      match_time: e.time || 0,
      seq: game.events.length - i,
    }));

    for (let i = 0; i < eventRows.length; i += 500) {
      const batch = eventRows.slice(i, i + 500);
      const { error: evError } = await supabase
        .from('match_events')
        .insert(batch);
      if (evError) console.error('Insert events error (batch):', evError);
    }
  }

  return match;
}

export async function fetchMatches() {
  const { data, error } = await supabase
    .from('matches')
    .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
    .order('match_date', { ascending: false });

  if (error) { console.error('Fetch matches error:', error); return null; }
  return data;
}

// Fetch all matches with events, converted to local app format
export async function fetchMatchesForLocal() {
  // Only pull ended matches — upcoming/live don't belong in local game history
  const { data: matches, error } = await supabase
    .from('matches')
    .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
    .eq('status', 'ended')
    .order('match_date', { ascending: false });
  if (error || !matches) return null;

  const results = [];
  for (const m of matches) {
    // Fetch events for this match
    const { data: events } = await supabase
      .from('match_events')
      .select('*')
      .eq('match_id', m.id)
      .order('seq', { ascending: false });

    results.push({
      id: m.id, // use Supabase UUID as local id
      supabase_id: m.id,
      date: m.match_date ? new Date(m.match_date).toISOString() : new Date(m.created_at).toISOString(),
      teams: {
        // Preserve all team fields (gender, age_group, sport, variant, institution)
        // so downstream display helpers can produce correct subtitles.
        home: { ...m.home_team, name: teamShortName(m.home_team) || "Home", color: m.home_team?.color || "#1D4ED8" },
        away: { ...m.away_team, name: teamShortName(m.away_team) || "Away", color: m.away_team?.color || "#DC2626" },
      },
      events: (events || []).map(e => ({
        id: e.id,
        team: e.team,
        event: e.event,
        zone: e.zone,
        detail: e.detail,
        time: e.match_time,
      })),
      duration: m.duration || 0,
      homeScore: m.home_score || 0,
      awayScore: m.away_score || 0,
      matchLength: m.match_length,
      breakFormat: m.break_format,
      venue: m.venue,
      matchType: m.match_type,
      status: m.status,
    });
  }
  return results;
}

export async function fetchMatchEvents(matchId) {
  const { data, error } = await supabase
    .from('match_events')
    .select('*')
    .eq('match_id', matchId)
    .order('seq', { ascending: false });

  if (error) { console.error('Fetch events error:', error); return null; }
  return data;
}

export async function deleteMatchRemote(matchId) {
  // Events cascade-delete due to FK constraint
  const { error } = await supabase
    .from('matches')
    .delete()
    .eq('id', matchId);
  if (error) console.error('Delete match error:', error);
  return !error;
}

// ─── HELPERS ─────────────────────────────────────────

async function findOrCreateTeam(team) {
  // Try to find by ID first (preferred post-institution migration)
  if (team.id) {
    const { data: byId } = await supabase
      .from('teams')
      .select(TEAM_SELECT)
      .eq('id', team.id)
      .single();
    if (byId) return byId;
  }

  // Fallback: find by name
  const { data: existing } = await supabase
    .from('teams')
    .select(TEAM_SELECT)
    .ilike('name', team.name.trim())
    .limit(1)
    .single();

  if (existing) return existing;

  // Create new
  const { data: created, error } = await supabase
    .from('teams')
    .insert({ name: team.name.trim(), color: team.color })
    .select()
    .single();

  if (error) { console.error('Create team error:', error); return null; }
  return created;
}

// ─── LIVE MATCH (for future real-time) ───────────────

export async function createLiveMatch(config, userId) {
  const homeTeam = await findOrCreateTeam(config.home);
  const awayTeam = await findOrCreateTeam(config.away);
  if (!homeTeam || !awayTeam) return null;

  const pin = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit PIN

  const { data, error } = await supabase
    .from('matches')
    .insert({
      home_team_id: homeTeam.id,
      away_team_id: awayTeam.id,
      match_date: config.date ? new Date(config.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      match_length: config.matchLength || 60,
      break_format: config.breakFormat || 'quarters',
      venue: config.venue || null,
      match_type: config.matchType || 'league',
      status: 'live',
      share_pin: pin,
      locked_by: userId || null,
      created_by: userId || null,
    })
    .select()
    .single();

  if (error) { console.error('Create live match error:', error); return null; }
  await logAudit('match_start_live', 'match', data.id, { home: config.home?.name, away: config.away?.name, matchType: config.matchType });
  // Record who is commentating this match
  if (userId) {
    try { await supabase.from('match_commentators').upsert({ match_id: data.id, commentator_id: userId }, { onConflict: 'match_id,commentator_id' }); } catch(e) {}
  }
  return { ...data, pin };
}

export async function updateLiveScore(matchId, homeScore, awayScore) {
  const { error } = await supabase
    .from('matches')
    .update({ home_score: homeScore, away_score: awayScore, status: 'live' })
    .eq('id', matchId);
  if (error) console.error('Update score error:', error);
  return !error;
}

export async function endLiveMatch(matchId, homeScore, awayScore, duration, opts = {}) {
  const { homePenalty, awayPenalty, abandoned } = opts;
  const update = {
    home_score: homeScore, away_score: awayScore,
    status: abandoned ? 'abandoned' : 'ended',
    duration, locked_by: null,
  };
  if (homePenalty != null && awayPenalty != null) {
    update.home_penalty_score = homePenalty;
    update.away_penalty_score = awayPenalty;
  }
  const { error } = await supabase.from('matches').update(update).eq('id', matchId);
  if (error) console.error('End live match error:', error);
  if (!error) await logAudit(abandoned ? 'match_abandoned' : 'match_end', 'match', matchId, { homeScore, awayScore, duration, ...opts });
  if (!error && !abandoned) archiveMatchStats(matchId).catch(e => console.error('Archive stats error:', e));
  return !error;
}

// Pre-compute and store match stats so raw events can be pruned later
export async function archiveMatchStats(matchId) {
  // Fetch match metadata
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('break_format, match_length, duration')
    .eq('id', matchId)
    .single();
  if (matchErr) { console.error('Archive: match fetch error', matchId, matchErr.message); return { ok: false, reason: 'match fetch: ' + matchErr.message }; }
  if (!match) { console.error('Archive: match not found', matchId); return { ok: false, reason: 'match not found' }; }

  // Fetch all events
  const { data: rawEvents, error: evErr } = await supabase
    .from('match_events')
    .select('team, event, match_time, detail, zone')
    .eq('match_id', matchId)
    .order('match_time');
  if (evErr) { console.error('Archive: events fetch error', matchId, evErr.message); return { ok: false, reason: 'events fetch: ' + evErr.message }; }
  if (!rawEvents || rawEvents.length === 0) { return { ok: false, reason: 'no events' }; }

  const events = rawEvents.map(e => ({ team: e.team, event: e.event, time: e.match_time, detail: e.detail, zone: e.zone }));
  const rows = [];

  // Compute time-based possession and territory from zone events
  function computeTimeBased(evts, startTime, endTime) {
    const zoned = evts
      .filter(e => e.team === 'home' || e.team === 'away')
      .filter(e => e.zone && e.time >= startTime && e.time <= endTime)
      .sort((a, b) => (a.time || 0) - (b.time || 0));
    const ballTime = { home: 0, away: 0 };
    const oppHalfTime = { home: 0, away: 0 };
    let totalTime = 0;
    for (let i = 0; i < zoned.length - 1; i++) {
      const ev = zoned[i];
      const dur = (zoned[i + 1].time || 0) - (ev.time || 0);
      if (dur <= 0 || dur > 300) continue; // skip pauses > 5min
      totalTime += dur;
      ballTime[ev.team] += dur;
      const z = ev.zone || '';
      // Territory: where the ball IS, regardless of who has it
      // "Opp" zones = top half = home's attacking half
      // "Own" zones = bottom half = away's attacking half
      if (z.includes('Opp Quarter') || z.includes('Opp Midfield')) oppHalfTime.home += dur;
      if (z.includes('Own Quarter') || z.includes('Own Midfield')) oppHalfTime.away += dur;
    }
    const totalBall = ballTime.home + ballTime.away || 1;
    const totalTerr = oppHalfTime.home + oppHalfTime.away || 1;
    return {
      home: {
        possessionTimePct: Math.round(ballTime.home / totalBall * 100),
        territoryTimePct: Math.round(oppHalfTime.home / totalTerr * 100),
      },
      away: {
        possessionTimePct: Math.round(ballTime.away / totalBall * 100),
        territoryTimePct: Math.round(oppHalfTime.away / totalTerr * 100),
      },
    };
  }

  // Compute totals for home and away
  const totalTimeBased = computeTimeBased(events, 0, 999999);
  for (const side of ['home', 'away']) {
    const s = computeStats(events, side, 0, 999999);
    const tb = totalTimeBased[side];
    const sco = computeSCOutcomes(events, side, 0, 999999);
    rows.push({
      match_id: matchId, team: side, quarter: 0,
      goals: s.goals, sc_goals: s.scGoals, shots_on: s.shotsOn, shots_off: s.shotsOff,
      d_entries: s.dEntries, atk_zone_entries: s.atkZoneEntries,
      short_corners: s.shortCorners,
      long_corners: s.longCorners, turnovers_won: s.turnoversWon,
      poss_lost: s.possLost, territory_pct: tb.possessionTimePct,
      possession_time_pct: tb.possessionTimePct,
      territory_time_pct: tb.territoryTimePct,
      sc_outcomes: JSON.stringify(sco),
    });
  }

  // Compute per-quarter stats
  const quarters = getQuarters(events, match.break_format || 'quarters', match.match_length || 60, match.duration || 0);
  for (const q of quarters) {
    const qTimeBased = computeTimeBased(events, q.start, q.end);
    for (const side of ['home', 'away']) {
      const s = computeStats(events, side, q.start, q.end);
      const tb = qTimeBased[side];
      const sco = computeSCOutcomes(events, side, q.start, q.end);
      rows.push({
        match_id: matchId, team: side, quarter: parseInt(q.label.replace(/\D/g, '')) || quarters.indexOf(q) + 1,
        goals: s.goals, sc_goals: s.scGoals, shots_on: s.shotsOn, shots_off: s.shotsOff,
        d_entries: s.dEntries, atk_zone_entries: s.atkZoneEntries,
        short_corners: s.shortCorners,
        long_corners: s.longCorners, turnovers_won: s.turnoversWon,
        poss_lost: s.possLost, territory_pct: tb.possessionTimePct,
        possession_time_pct: tb.possessionTimePct,
        territory_time_pct: tb.territoryTimePct,
        sc_outcomes: JSON.stringify(sco),
      });
    }
  }

  // Delete existing stats for this match, then insert fresh
  const { error: delErr } = await supabase.from('match_stats').delete().eq('match_id', matchId);
  if (delErr) { console.error('Archive: delete old stats error', matchId, delErr.message); return { ok: false, reason: 'delete old: ' + delErr.message }; }

  const { error } = await supabase.from('match_stats').insert(rows);
  if (error) { console.error('Archive: insert stats error', matchId, error.message); return { ok: false, reason: 'insert: ' + error.message }; }

  return { ok: true };
}

export async function pushLiveEvent(matchId, event, seq) {
  const { error } = await supabase
    .from('match_events')
    .insert({
      match_id: matchId,
      team: event.team,
      event: event.event,
      zone: event.zone || null,
      detail: event.detail || null,
      match_time: event.time || 0,
      seq,
    });
  if (error) console.error('Push event error:', error);
  return !error;
}

// Subscribe to live match updates (for spectator view)
export function subscribeLiveMatch(matchId, onMatchUpdate, onNewEvent) {
  const channel = supabase.channel(`match-${matchId}`);

  channel
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (payload) => onMatchUpdate(payload.new)
    )
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` },
      (payload) => onNewEvent(payload.new)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ─── MATCH SCHEDULING ────────────────────────────────

export async function scheduleMatch({ homeTeamId, awayTeamId, matchDate, scheduledTime, matchLength, breakFormat, matchType, venue, commentatorIds, createdBy }) {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      match_date: matchDate,
      scheduled_time: scheduledTime || null,
      match_length: matchLength || 60,
      break_format: breakFormat || 'quarters',
      match_type: matchType || 'league',
      venue: venue || null,
      status: 'upcoming',
      created_by: createdBy || null,
    })
    .select()
    .single();

  if (error) { console.error('Schedule match error:', error); return null; }

  await logAudit('match_schedule', 'match', data.id, { homeTeamId, awayTeamId, matchDate, matchType, venue });

  // Snapshot rankings from latest ranking_set
  await snapshotRankings(data.id);

  // Assign commentators
  if (commentatorIds?.length > 0) {
    const rows = commentatorIds.map(cid => ({ match_id: data.id, commentator_id: cid }));
    await supabase.from('match_commentators').insert(rows);
  }

  return data;
}

// Snapshot latest rankings onto a match
export async function snapshotRankings(matchId) {
  try {
    await supabase.rpc('snapshot_match_rankings', { p_match_id: matchId });
  } catch (err) {
    console.warn('Snapshot rankings failed:', err);
  }
}

export async function updateScheduledMatch(matchId, updates) {
  const { error } = await supabase
    .from('matches')
    .update(updates)
    .eq('id', matchId);
  if (error) console.error('Update scheduled match error:', error);
  if (!error) await logAudit('match_update', 'match', matchId, updates);
  return !error;
}

export async function assignCommentators(matchId, commentatorIds) {
  await supabase.from('match_commentators').delete().eq('match_id', matchId);
  if (commentatorIds?.length > 0) {
    const rows = commentatorIds.map(cid => ({ match_id: matchId, commentator_id: cid }));
    await supabase.from('match_commentators').insert(rows);
  }
  await logAudit('commentator_assign', 'match', matchId, { commentator_ids: commentatorIds });
}

export async function fetchUpcomingMatches() {
  const { data, error } = await supabase
    .from('matches')
    .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
    .eq('status', 'upcoming')
    .order('match_date', { ascending: true });
  if (error) { console.error('Fetch upcoming error:', error); return []; }
  return data;
}

export async function fetchMatchCommentators(matchId) {
  const { data, error } = await supabase
    .from('match_commentators')
    .select('*, commentator:profiles!commentator_id(*)')
    .eq('match_id', matchId);
  if (error) return [];
  return data;
}

export async function fetchCommentatorMatches(commentatorId) {
  const { data: assignments, error } = await supabase
    .from('match_commentators')
    .select('match_id')
    .eq('commentator_id', commentatorId);
  if (error || !assignments?.length) return [];

  const matchIds = assignments.map(a => a.match_id);
  const { data: matches } = await supabase
    .from('matches')
    .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}`)
    .in('id', matchIds)
    .order('match_date', { ascending: false });
  return matches || [];
}

export async function lockMatch(matchId, userId) {
  // Try lock where unlocked
  const { data, error } = await supabase
    .from('matches')
    .update({ locked_by: userId })
    .eq('id', matchId)
    .is('locked_by', null)
    .select()
    .single();
  if (!error && data) {
    await logAudit('match_lock', 'match', matchId);
    // Record who is commentating this match
    if (userId) {
      try { await supabase.from('match_commentators').upsert({ match_id: matchId, commentator_id: userId }, { onConflict: 'match_id,commentator_id' }); } catch(e) {}
    }
    return data;
  }
  // Already locked — check if by same user (allow re-lock)
  const { data: existing } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('locked_by', userId)
    .single();
  return existing || null;
}

export async function unlockMatch(matchId, userId) {
  const { error } = await supabase
    .from('matches')
    .update({ locked_by: null, status: 'upcoming' })
    .eq('id', matchId)
    .eq('locked_by', userId);
  if (!error) await logAudit('match_unlock', 'match', matchId);
  return !error;
}

// ── VIDEO REVIEW ──

export async function startVideoReview(matchId, userId) {
  // Check if already locked by someone else
  const { data: match } = await supabase.from('matches').select('locked_by, home_score, away_score, status').eq('id', matchId).single();
  if (!match) return { error: 'Match not found' };
  // Only block if locked by someone else AND match is currently being recorded (status=live or locked for video review)
  // Stale locks from ended live matches are safe to override
  if (match.locked_by && match.locked_by !== userId && match.status === 'live') {
    return { error: 'Match has an active live recording by another user' };
  }

  // Lock the match (keep status as 'ended')
  await supabase.from('matches').update({ locked_by: userId }).eq('id', matchId);

  // Record who is commentating this match
  if (userId) {
    try { await supabase.from('match_commentators').upsert({ match_id: matchId, commentator_id: userId }, { onConflict: 'match_id,commentator_id' }); } catch(e) {}
  }

  // Check for existing events
  const { count } = await supabase.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', matchId);

  await logAudit('video_review_start', 'match', matchId, { existingEvents: count || 0 });
  return { match, existingEvents: count || 0 };
}

export async function clearMatchEvents(matchId) {
  const { error } = await supabase.from('match_events').delete().eq('match_id', matchId);
  if (error) console.error('Clear events error:', error);
  // Reset stats_archived so archive can run fresh
  await supabase.from('matches').update({ stats_archived: false }).eq('id', matchId);
  // Clear archived stats
  await supabase.from('match_stats').delete().eq('match_id', matchId);
  return !error;
}

export async function endVideoReview(matchId, homeScore, awayScore, duration) {
  // Update duration + unlock, but keep status as 'ended' and keep original scores
  const { error } = await supabase
    .from('matches')
    .update({ locked_by: null, duration, stats_archived: false })
    .eq('id', matchId);
  if (error) console.error('End video review error:', error);
  if (!error) await logAudit('video_review_end', 'match', matchId, { homeScore, awayScore, duration });
  // Archive stats
  if (!error) archiveMatchStats(matchId).catch(e => console.error('Archive stats error:', e));
  return !error;
}

/**
 * Fetch latest 2 ranking sets and return a map: teamId → { rank, prevRank }
 * Used for upcoming matches where we want current rankings, not snapshot.
 */
// Returns each team's rank computed WITHIN its peer group (same sport,
// gender, age_group). Today's data is all Girls 1st so peer-group rank
// equals global rank, but this keeps the app honest once other peer
// groups (Boys 1st, U16, etc.) get ranked.
//
// Output shape unchanged from previous implementation:
//   { team_id: { rank, prevRank } }
export async function fetchLatestRankings() {
  const { data: sets } = await supabase
    .from('ranking_sets')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(2);
  if (!sets || sets.length === 0) return {};

  const latestId = sets[0].id;
  const prevId = sets.length > 1 ? sets[1].id : null;

  const { data: latest } = await supabase
    .from('rankings')
    .select('team_id, position')
    .eq('ranking_set_id', latestId);
  if (!latest || latest.length === 0) return {};

  let prev = null;
  if (prevId) {
    const { data: prevData } = await supabase
      .from('rankings')
      .select('team_id, position')
      .eq('ranking_set_id', prevId);
    prev = prevData;
  }

  // Fetch demographic metadata for every team that appears in either snapshot
  const teamIds = Array.from(new Set([
    ...latest.map(r => r.team_id),
    ...(prev || []).map(r => r.team_id),
  ]));
  const { data: teams } = await supabase
    .from('teams')
    .select('id, sport, gender, age_group')
    .in('id', teamIds);
  const peerKey = (id) => {
    const t = (teams || []).find(x => x.id === id);
    if (!t || !t.sport || !t.gender || !t.age_group) return null;
    return `${t.sport}|${t.gender}|${t.age_group}`;
  };

  // Within each peer group, sort by global position and number 1..N
  const rerank = (rows) => {
    const groups = {};
    const orphans = []; // teams with missing metadata — keep global position
    for (const r of rows) {
      const key = peerKey(r.team_id);
      if (key) {
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      } else {
        orphans.push(r);
      }
    }
    const out = {};
    for (const key in groups) {
      groups[key].sort((a, b) => a.position - b.position);
      groups[key].forEach((r, i) => { out[r.team_id] = i + 1; });
    }
    orphans.forEach(r => { out[r.team_id] = r.position; });
    return out;
  };

  const latestPeer = rerank(latest);
  const prevPeer = prev ? rerank(prev) : {};

  const result = {};
  for (const r of latest) {
    result[r.team_id] = {
      rank: latestPeer[r.team_id],
      prevRank: prevPeer[r.team_id] ?? null,
    };
  }
  return result;
}

// Returns a Set of team IDs that sit in the top N of THEIR peer group
// (same sport + gender + age_group). Used by the apprentice gate so
// apprentice commentators are barred from top-N matches within each
// peer group, not against a global cross-demographic Top N pool.
export async function fetchPeerTopTeamIds(topN = 10) {
  const { data: sets } = await supabase
    .from('ranking_sets')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!sets || sets.length === 0) return new Set();
  const { data: rows } = await supabase
    .from('rankings')
    .select('team_id, position')
    .eq('ranking_set_id', sets[0].id);
  if (!rows || rows.length === 0) return new Set();
  const { data: teams } = await supabase
    .from('teams')
    .select('id, sport, gender, age_group')
    .in('id', rows.map(r => r.team_id));
  const teamMap = Object.fromEntries((teams || []).map(t => [t.id, t]));
  const groups = {};
  for (const r of rows) {
    const t = teamMap[r.team_id];
    if (!t || !t.sport || !t.gender || !t.age_group) continue;
    const key = `${t.sport}|${t.gender}|${t.age_group}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const top = new Set();
  for (const key in groups) {
    groups[key].sort((a, b) => a.position - b.position);
    groups[key].slice(0, topN).forEach(r => top.add(r.team_id));
  }
  return top;
}

// ─── CROWD SUBMISSIONS ──────────────────────────────

// Submit a pending result (crowd user)
export async function submitCrowdResult({ homeTeamId, awayTeamId, homeScore, awayScore, matchDate, venue, matchType, submittedBy }) {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_score: homeScore || 0,
      away_score: awayScore || 0,
      match_date: matchDate,
      venue: venue || null,
      match_type: matchType || 'league',
      status: 'pending',
      submitted_by: submittedBy,
      submitted_type: 'supporter',
    })
    .select()
    .single();

  if (error) { console.error('Submit crowd result error:', error); return null; }
  await logAudit('crowd_submit_result', 'match', data.id, { homeTeamId, awayTeamId, homeScore, awayScore });
  return data;
}

// Submit a pending upcoming match (crowd user)
export async function submitCrowdUpcoming({ homeTeamId, awayTeamId, matchDate, scheduledTime, venue, matchType, submittedBy }) {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      match_date: matchDate,
      scheduled_time: scheduledTime || null,
      venue: venue || null,
      match_type: matchType || 'league',
      status: 'pending',
      submitted_by: submittedBy,
      submitted_type: 'supporter',
    })
    .select()
    .single();

  if (error) { console.error('Submit crowd upcoming error:', error); return null; }
  await logAudit('crowd_submit_upcoming', 'match', data.id, { homeTeamId, awayTeamId, matchDate });
  return data;
}

// Suggest a new team (crowd user)
export async function suggestTeam({ institutionId, newInstitutionName, newInstitutionColor, gender, ageGroup, sport, suggestedBy }) {
  let instId = institutionId;

  // Create new institution if needed
  if (!instId && newInstitutionName?.trim()) {
    const { data: inst, error: instErr } = await supabase
      .from('institutions')
      .insert({ name: newInstitutionName.trim(), color: newInstitutionColor || '#64748B' })
      .select()
      .single();
    if (instErr) { console.error('Create institution error:', instErr); return null; }
    instId = inst.id;
    await logAudit('crowd_suggest_institution', 'institution', inst.id, { name: newInstitutionName.trim() });
  }

  if (!instId) { console.error('suggestTeam: no institution'); return null; }

  const g = gender || 'Girls';
  const s = sport || 'Hockey';
  const ag = ageGroup || '1st';
  const derivedName = `${g} ${s} ${ag}`;

  const { data, error } = await supabase
    .from('teams')
    .insert({
      name: derivedName,
      institution_id: instId,
      gender: g,
      age_group: ag,
      sport: s,
      color: newInstitutionColor || '#64748B',
      status: 'pending',
      suggested_by: suggestedBy,
    })
    .select()
    .single();

  if (error) { console.error('Suggest team error:', error); return null; }
  await logAudit('crowd_suggest_team', 'team', data.id, { name: derivedName, institution_id: instId });
  return data;
}

// Fetch pending items for approval
export async function fetchPending() {
  const [{ data: pendingMatches }, { data: pendingTeams }] = await Promise.all([
    supabase.from('matches')
      .select(`*, ${MATCH_HOME_TEAM}, ${MATCH_AWAY_TEAM}, submitter:profiles!submitted_by(firstname, lastname, alias_nickname)`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase.from('teams')
      .select(`${TEAM_SELECT}, suggester:profiles!suggested_by(firstname, lastname, alias_nickname)`)
      .eq('status', 'pending')
      .order('name'),
  ]);
  return { pendingMatches: pendingMatches || [], pendingTeams: pendingTeams || [] };
}

// Approve a pending match
export async function approvePendingMatch(matchId, approverId, newStatus = 'ended') {
  const { error } = await supabase.rpc('approve_match', {
    p_match_id: matchId,
    p_approver_id: approverId,
    p_new_status: newStatus,
  });
  if (error) console.error('Approve match error:', error);
  return !error;
}

// Reject a pending match
export async function rejectPendingMatch(matchId, userId) {
  const { error } = await supabase.rpc('reject_match', {
    p_match_id: matchId,
    p_user_id: userId,
  });
  if (error) console.error('Reject match error:', error);
  return !error;
}

// Approve a pending team
export async function approvePendingTeam(teamId, approverId) {
  const { error } = await supabase.rpc('approve_team', {
    p_team_id: teamId,
    p_approver_id: approverId,
  });
  if (error) console.error('Approve team error:', error);
  return !error;
}

// Reject a pending team
export async function rejectPendingTeam(teamId, approverId) {
  const { error } = await supabase.rpc('reject_team', {
    p_team_id: teamId,
    p_approver_id: approverId,
  });
  if (error) console.error('Reject team error:', error);
  return !error;
}

/**
 * Retrofit predictions for Kykie + fictitious users on all completed matches.
 * Builds progressive records chronologically so each prediction only uses
 * data available before that match.
 * 
 * Returns { total, inserted, skipped, errors }
 */
export async function retrofitPredictions(onProgress) {
  const PETE_ID = '873d6669-255c-46fb-add2-76ef69cf80d8';
  const SUZI_ID = 'c05930be-7d2e-4b96-ba28-e406be0205a3';

  // Fetch all ended matches ordered by date
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, match_date, home_score, away_score, home_team_id, away_team_id, home_rank, away_rank, home_penalty_score, away_penalty_score')
    .eq('status', 'ended')
    .not('home_score', 'is', null)
    .order('match_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (mErr) return { total: 0, inserted: 0, skipped: 0, errors: [mErr.message] };

  // Fetch team names for predictMatch reasons
  const { data: teams } = await supabase.from('teams').select(TEAM_SELECT);
  const teamMap = {};
  (teams || []).forEach(t => { teamMap[t.id] = t.institution?.short_name || t.institution?.name || t.name; });

  // Fetch latest rankings for Suzi
  const { data: rankData } = await supabase
    .from('rankings')
    .select('team_id, position')
    .order('created_at', { ascending: false });
  const rankMap = {};
  (rankData || []).forEach(r => {
    if (!rankMap[r.team_id]) rankMap[r.team_id] = r.position;
  });

  // Delete existing predictions for Kykie, Pete, Suzi
  await supabase.from('predictions').delete().is('user_id', null);
  await supabase.from('predictions').delete().eq('user_id', PETE_ID);
  await supabase.from('predictions').delete().eq('user_id', SUZI_ID);

  // Build progressive records
  const records = {};
  const getRec = (teamId) => records[teamId] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };

  const allRows = [];
  let skipped = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const hId = m.home_team_id;
    const aId = m.away_team_id;
    const hs = m.home_score;
    const as_ = m.away_score;
    const hName = teamMap[hId] || 'Home';
    const aName = teamMap[aId] || 'Away';
    const actual = matchWinner(m);

    const hRec = { ...getRec(hId) };
    const aRec = { ...getRec(aId) };

    // Kykie prediction — V3 model (ranking + record + GD)
    const hRank = rankMap[hId] || m.home_rank || 99;
    const aRank = rankMap[aId] || m.away_rank || 99;
    const kykie = predictMatch(hRec, aRec, hName, aName, { homeRank: hRank, awayRank: aRank });
    if (kykie) {
      const kPred = kykie.draw >= kykie.homeWin && kykie.draw >= kykie.awayWin ? 'draw'
        : kykie.homeWin >= kykie.awayWin ? 'home' : 'away';
      const kCorrect = kPred === actual;
      allRows.push({
        user_id: null, match_id: m.id, prediction: kPred,
        home_win_pct: kykie.homeWin, draw_pct: kykie.draw, away_win_pct: kykie.awayWin,
        points: kCorrect ? 1 : 0, correct: kCorrect, scored_at: new Date().toISOString(),
      });
    } else {
      // Fallback: ranking-based (same as Suzi's logic)
      const hRank = rankMap[hId] || m.home_rank || 199;
      const aRank = rankMap[aId] || m.away_rank || 199;
      let kPred;
      if (Math.abs(hRank - aRank) <= 2) kPred = 'draw';
      else if (hRank < aRank) kPred = 'home';
      else kPred = 'away';
      const kCorrect = kPred === actual;
      allRows.push({
        user_id: null, match_id: m.id, prediction: kPred,
        home_win_pct: null, draw_pct: null, away_win_pct: null,
        points: kCorrect ? 1 : 0, correct: kCorrect, scored_at: new Date().toISOString(),
      });
    }

    // Pete: highest GD wins, within 10 = draw. No data = GD 0, predicts draw.
    {
      const hGD = hRec.p > 0 ? hRec.gf - hRec.ga : 0;
      const aGD = aRec.p > 0 ? aRec.gf - aRec.ga : 0;
      let petePred;
      if (Math.abs(hGD - aGD) <= 10) petePred = 'draw';
      else if (hGD > aGD) petePred = 'home';
      else petePred = 'away';
      const pCorrect = petePred === actual;
      allRows.push({
        user_id: PETE_ID, match_id: m.id, prediction: petePred,
        home_win_pct: null, draw_pct: null, away_win_pct: null,
        points: pCorrect ? 1 : 0, correct: pCorrect, scored_at: new Date().toISOString(),
      });
    }

    // Suzi: lowest rank wins, within 2 = draw. No rank = 199, both unranked = draw.
    {
      const hRank = rankMap[hId] || m.home_rank || 199;
      const aRank = rankMap[aId] || m.away_rank || 199;
      let suziPred;
      if (Math.abs(hRank - aRank) <= 2) suziPred = 'draw';
      else if (hRank < aRank) suziPred = 'home';
      else suziPred = 'away';
      const sCorrect = suziPred === actual;
      allRows.push({
        user_id: SUZI_ID, match_id: m.id, prediction: suziPred,
        home_win_pct: null, draw_pct: null, away_win_pct: null,
        points: sCorrect ? 1 : 0, correct: sCorrect, scored_at: new Date().toISOString(),
      });
    }

    // Update progressive records AFTER prediction
    if (!records[hId]) records[hId] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    if (!records[aId]) records[aId] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    records[hId].p++; records[aId].p++;
    records[hId].gf += hs; records[hId].ga += as_;
    records[aId].gf += as_; records[aId].ga += hs;
    const hOutcome = matchOutcome(m, hId);
    if (hOutcome === 'W') { records[hId].w++; records[aId].l++; }
    else if (hOutcome === 'L') { records[aId].w++; records[hId].l++; }
    else { records[hId].d++; records[aId].d++; }

    if (onProgress && i % 50 === 0) onProgress(i, matches.length);
  }

  // Insert in batches of 100
  const errors = [];
  for (let i = 0; i < allRows.length; i += 100) {
    const batch = allRows.slice(i, i + 100);
    const { error } = await supabase.from('predictions').insert(batch);
    if (error) errors.push(`Batch ${i}: ${error.message}`);
  }

  return { total: matches.length, inserted: allRows.length, skipped, errors };
}