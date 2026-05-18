// Shared stat computation for coach views

export const STATS = [
  { key: "dEntries", label: "D Entries" },
  { key: "shotsOn", label: "Shots On" },
  { key: "shotsOff", label: "Shots Off" },
  { key: "shortCorners", label: "Short Crnrs" },
  { key: "longCorners", label: "Long Crnrs" },
  { key: "turnoversWon", label: "TOs Won" },
  { key: "possLost", label: "Poss Lost" },
];

export const DISPLAY_STATS = [
  { label: "Shots On %", calc: (s) => { const t = s.shotsOn + s.shotsOff; return t > 0 ? Math.round(s.shotsOn / t * 100) : 0; }, suffix: "%" },
  { label: "Shots Off %", calc: (s) => { const t = s.shotsOn + s.shotsOff; return t > 0 ? Math.round(s.shotsOff / t * 100) : 0; }, suffix: "%" },
  { label: "Short Crnr %", calc: (s) => s.dEntries > 0 ? Math.round(s.shortCorners / s.dEntries * 100) : 0, suffix: "%" },
  { label: "Territory", calc: (s) => s.territory || 0, suffix: "%" },
];

export const INVERTED = ["possLost", "shotsOff"];

export function computeStats(events, team, startTime, endTime) {
  const real = events.filter(e =>
    e.team === team && e.time >= startTime && e.time <= endTime &&
    e.team !== "commentary" && e.team !== "meta"
  );
  const oppTeam = team === "home" ? "away" : "home";
  const oppEvents = events.filter(e =>
    e.team === oppTeam && e.time >= startTime && e.time <= endTime
  );

  // Time-based possession & territory
  const allReal = events.filter(e =>
    (e.team === "home" || e.team === "away") &&
    e.time >= startTime && e.time <= endTime
  ).sort((a, b) => (a.time || 0) - (b.time || 0));

  let possTime = 0;
  let terrTime = 0;
  let totalTime = 0;

  for (let i = 0; i < allReal.length; i++) {
    const cur = allReal[i];
    const nextTime = i < allReal.length - 1 ? allReal[i + 1].time : endTime;
    const dur = Math.max(0, Math.min(nextTime, endTime) - cur.time);
    if (dur > 300) continue; // skip gaps > 5min (pauses)
    totalTime += dur;
    if (cur.team === team) possTime += dur;
    // Territory: where the ball physically IS, regardless of who has it.
    // Zone strings come in two flavours:
    //   (a) Perspective-based: "Opp …" (top half) and "Own …" (bottom half)
    //       — these are written from the HOME team's view of the pitch.
    //   (b) Team-name-based: "<TeamName> D" — names the team whose D it is.
    // The recorder only logs D-zone events from the attacker's hand, so the
    // event's `team` field tells us whose D it is: event.team === "home"
    // means home is attacking, so the D is the AWAY team's D, i.e. home
    // attacking territory. Inverse for away. This avoids the prior bug
    // where `z.includes(" D")` double-credited both sides whenever the
    // ball was in any D.
    const z = cur.zone || "";
    const isD = z.includes(" D");
    const ballInTeamAttackHalf = team === "home"
      ? (z.startsWith("Opp ") || (isD && cur.team === "home"))
      : (z.startsWith("Own ") || (isD && cur.team === "away"));
    if (ballInTeamAttackHalf && !z.includes("Centre")) {
      terrTime += dur;
    }
  }

  const possession = totalTime > 0 ? Math.round(possTime / totalTime * 100) : 0;
  const oppHalfPct = totalTime > 0 ? Math.round(terrTime / totalTime * 100) : 0;

  // Possession Lost = every event where this team gave up the ball:
  //   - own "Poss Conceded" (and "Poss Conceded (LC)") events
  //   - own "Sideline Out (...)" events
  //   - opponent's "Turnover Won" events (they took the ball off us)
  // The first two are how the recorder logs *self*-conceded turnovers;
  // the third is how the recorder logs *opponent-initiated* turnovers
  // (ball tap by the other team) — that path doesn't write a Poss
  // Conceded row, so it must be picked up from the opp side.
  const ownConceded = real.filter(e =>
    (e.event && e.event.startsWith("Poss Conceded")) ||
    (e.event && e.event.startsWith("Sideline Out"))
  ).length;
  const oppTurnovers = oppEvents.filter(e => e.event === "Turnover Won").length;
  const possLost = ownConceded + oppTurnovers;

  return {
    goals: real.filter(e => e.event?.startsWith("Goal!")).length,
    scGoals: real.filter(e => e.event === "Goal! (SC)").length,
    dEntries: real.filter(e => e.event === "D Entry").length,
    atkZoneEntries: real.filter(e => e.zone?.includes("Opp Quarter")).length,
    atkChances: 0, // computed separately via computeAtkChances
    shotsOn: real.filter(e => e.event === "Shot on Goal").length,
    shotsOff: real.filter(e => e.event === "Shot Off Target").length,
    shortCorners: real.filter(e => e.event === "Short Corner").length,
    longCorners: real.filter(e => e.event === "Long Corner").length,
    turnoversWon: real.filter(e => e.event === "Turnover Won").length,
    possLost,
    territory: possession,
    oppHalfPct,
  };
}

// Compute attacking chances by walking the event stream sequentially.
// A "chance" = a distinct opportunity to enter the D:
//   1. Ball crosses into attack zone from another zone
//   2. Ball goes straight into D from outside attack zone (D Entry where prev wasn't atk)
//   3. Ball dead / restart in the attack zone
//   4. Long Corner awarded to the team
//   5. Short Corner awarded to the team
//   6. Turnover Won in the attack zone
function computeAtkChances(events, teamSide, startTime, endTime) {
  const sorted = events
    .filter(e => e.time >= startTime && e.time <= endTime && e.team !== 'commentary' && e.team !== 'meta')
    .sort((a, b) => (a.time || 0) - (b.time || 0) || (a.seq || 0) - (b.seq || 0));

  const isAtk = (zone) => {
    if (!zone) return false;
    return teamSide === 'home' ? zone.includes('Opp Quarter') : zone.includes('Own Quarter');
  };
  const isD = (zone) => zone && zone.includes(' D');

  let chances = 0;
  let prevZone = null;

  for (const e of sorted) {
    const isUs = e.team === teamSide;
    const zone = e.zone || '';
    const event = e.event || '';
    const inAtk = isAtk(zone);
    const prevInAtk = isAtk(prevZone);
    const prevInD = isD(prevZone);

    // 1. D Entry from outside attack zone = chance + D entry
    if (isUs && event === 'D Entry' && !prevInAtk && !prevInD) {
      chances++;
    }
    // 2. Ball crosses into attack zone from non-attack zone
    else if (isUs && inAtk && !prevInAtk && !prevInD && prevZone) {
      chances++;
    }
    // 3. Ball dead in attack zone (restart opportunity)
    else if (event === 'Ball Dead' && inAtk) {
      chances++;
    }
    // 4. Long Corner for us
    else if (isUs && event === 'Long Corner') {
      chances++;
    }
    // 5. Short Corner for us
    else if (isUs && event === 'Short Corner') {
      chances++;
    }
    // 6. Turnover Won in attack zone
    else if (isUs && event === 'Turnover Won' && inAtk) {
      chances++;
    }

    if (zone) prevZone = zone;
  }
  return chances;
}

/**
 * Compute Short Corner outcomes for a team.
 * Walks forward from each SC event to find the terminal outcome.
 * Returns: { goal, shotOn, shotOff, wonSC, lostPoss, deadBall, longCorner, penalty, other }
 */
export function computeSCOutcomes(events, team, startTime, endTime) {
  const SKIP_EVENTS = new Set(['Ball forward', 'Ball back', 'Ball across', 'Ball in play', 'D Entry']);
  const outcomes = { goal: 0, shotOn: 0, shotOff: 0, wonSC: 0, lostPoss: 0, deadBall: 0, longCorner: 0, penalty: 0, other: 0 };

  const sorted = events
    .filter(e => e.time >= startTime && e.time <= endTime && e.team !== 'commentary' && e.team !== 'meta')
    .sort((a, b) => (a.time || 0) - (b.time || 0) || (a.seq || 0) - (b.seq || 0));

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (ev.event !== 'Short Corner' || ev.team !== team) continue;

    // Walk forward to find terminal event
    let found = false;
    for (let j = i + 1; j < sorted.length; j++) {
      const nxt = sorted[j];
      const nxtEvent = nxt.event || '';

      // Skip routine SC events (ball out-and-back)
      if (SKIP_EVENTS.has(nxtEvent)) continue;

      // Terminal events
      if (nxtEvent === 'Goal! (SC)' || nxtEvent === 'Goal!') {
        if (nxt.team === team) outcomes.goal++;
        else outcomes.lostPoss++; // opponent scored somehow
        found = true; break;
      }
      if (nxtEvent === 'Shot on Goal' && nxt.team === team) {
        outcomes.shotOn++; found = true; break;
      }
      if (nxtEvent === 'Shot Off Target' && nxt.team === team) {
        outcomes.shotOff++; found = true; break;
      }
      if (nxtEvent === 'Short Corner' && nxt.team === team) {
        outcomes.wonSC++; found = true; break;
      }
      if (nxtEvent === 'Turnover Won' && nxt.team !== team) {
        outcomes.lostPoss++; found = true; break;
      }
      if (nxtEvent === 'Poss Conceded' && nxt.team === team) {
        outcomes.lostPoss++; found = true; break;
      }
      if (nxtEvent.startsWith('Sideline Out') && nxt.team === team) {
        outcomes.lostPoss++; found = true; break;
      }
      if (nxtEvent === 'Dead Ball') {
        outcomes.deadBall++; found = true; break;
      }
      if (nxtEvent === 'Long Corner' && nxt.team === team) {
        outcomes.longCorner++; found = true; break;
      }
      if (nxtEvent === 'Penalty' && nxt.team === team) {
        outcomes.penalty++; found = true; break;
      }
      if (nxtEvent === 'Start') {
        outcomes.other++; found = true; break;
      }
      // Opponent event that isn't a skip = possession lost
      if (nxt.team !== team && !SKIP_EVENTS.has(nxtEvent)) {
        outcomes.lostPoss++; found = true; break;
      }
    }
    if (!found) outcomes.other++;
  }

  return outcomes;
}

// Compute stats for a team across a match, normalizing home/away
export function computeMatchStats(events, teamId, homeTeamId) {
  const teamSide = teamId === homeTeamId ? "home" : "away";
  const oppSide = teamSide === "home" ? "away" : "home";
  const team = computeStats(events, teamSide, 0, 999999);
  const opp = computeStats(events, oppSide, 0, 999999);
  // Sequential analysis for attacking chances
  team.atkChances = computeAtkChances(events, teamSide, 0, 999999);
  opp.atkChances = computeAtkChances(events, oppSide, 0, 999999);
  // Map time-based fields for aggregateStats compatibility
  team.possessionTimePct = team.territory;
  team.territoryTimePct = team.oppHalfPct;
  opp.possessionTimePct = opp.territory;
  opp.territoryTimePct = opp.oppHalfPct;
  return { team, opp, teamSide, oppSide };
}

export function getQuarters(events, breakFormat, matchLength, matchTime) {
  if (breakFormat === "quarters") {
    const pauses = events.filter(e => e.team === "meta" && e.detail).sort((a, b) => a.time - b.time);
    const boundaries = [0];
    pauses.forEach(p => {
      if (p.detail === "Quarter Break" || p.detail === "Half Time") boundaries.push(p.time);
    });
    boundaries.push(999999);
    return [
      { label: "Q1", start: boundaries[0], end: boundaries[1] || 999999, status: boundaries.length > 2 ? "complete" : "live" },
      { label: "Q2", start: boundaries[1] || 999999, end: boundaries[2] || 999999, status: boundaries.length > 3 ? "complete" : boundaries.length > 2 ? "live" : "upcoming" },
      { label: "Q3", start: boundaries[2] || 999999, end: boundaries[3] || 999999, status: boundaries.length > 4 ? "complete" : boundaries.length > 3 ? "live" : "upcoming" },
      { label: "Q4", start: boundaries[3] || 999999, end: boundaries[4] || 999999, status: boundaries.length > 5 ? "complete" : boundaries.length > 4 ? "live" : "upcoming" },
    ];
  }
  const totalSec = (matchLength || 60) * 60;
  const qLen = totalSec / 4;
  const labels = ["1st", "2nd", "3rd", "4th"];
  const elapsed = matchTime || 0;
  return labels.map((label, i) => {
    const start = Math.round(qLen * i);
    const end = i === 3 ? 999999 : Math.round(qLen * (i + 1));
    const status = elapsed >= end ? "complete" : elapsed >= start ? "live" : "upcoming";
    return { label, start, end, status };
  });
}

// Aggregate stats across multiple matches (each with {team, opp})
export function aggregateStats(matchStatsList) {
  const n = matchStatsList.length || 1;
  const sum = (key) => matchStatsList.reduce((s, m) => s + m.team[key], 0);
  const sumOpp = (key) => matchStatsList.reduce((s, m) => s + m.opp[key], 0);
  const avgTerritory = Math.round(matchStatsList.reduce((s, m) => s + m.team.territory, 0) / n);
  const avgOppTerritory = Math.round(matchStatsList.reduce((s, m) => s + m.opp.territory, 0) / n);

  // Time-based averages (only from matches that have them)
  const withTimePoss = matchStatsList.filter(m => m.team.possessionTimePct != null);
  const withTimeTerritory = matchStatsList.filter(m => m.team.territoryTimePct != null);
  const avgPossTime = withTimePoss.length > 0 ? Math.round(withTimePoss.reduce((s, m) => s + m.team.possessionTimePct, 0) / withTimePoss.length) : null;
  const avgOppPossTime = withTimePoss.length > 0 ? Math.round(withTimePoss.reduce((s, m) => s + m.opp.possessionTimePct, 0) / withTimePoss.length) : null;
  const avgTerritoryTime = withTimeTerritory.length > 0 ? Math.round(withTimeTerritory.reduce((s, m) => s + m.team.territoryTimePct, 0) / withTimeTerritory.length) : null;
  const avgOppTerritoryTime = withTimeTerritory.length > 0 ? Math.round(withTimeTerritory.reduce((s, m) => s + m.opp.territoryTimePct, 0) / withTimeTerritory.length) : null;

  // SC outcomes aggregation
  const scKeys = ['goal', 'shotOn', 'shotOff', 'wonSC', 'lostPoss', 'deadBall', 'longCorner', 'penalty', 'other'];
  const aggSCO = (side) => {
    const result = {};
    scKeys.forEach(k => { result[k] = 0; });
    matchStatsList.forEach(m => {
      const sco = m[side]?.scOutcomes;
      if (sco) scKeys.forEach(k => { result[k] += sco[k] || 0; });
    });
    return result;
  };
  const teamSCO = aggSCO('team');
  const oppSCO = aggSCO('opp');

  return {
    team: {
      goals: sum("goals"), scGoals: sum("scGoals"), dEntries: sum("dEntries"), atkZoneEntries: sum("atkZoneEntries"), atkChances: sum("atkChances"),
      shotsOn: sum("shotsOn"), shotsOff: sum("shotsOff"), shortCorners: sum("shortCorners"),
      longCorners: sum("longCorners"), turnoversWon: sum("turnoversWon"), possLost: sum("possLost"),
      territory: avgTerritory, possessionTimePct: avgPossTime, territoryTimePct: avgTerritoryTime,
      scOutcomes: teamSCO,
    },
    opp: {
      goals: sumOpp("goals"), scGoals: sumOpp("scGoals"), dEntries: sumOpp("dEntries"), atkZoneEntries: sumOpp("atkZoneEntries"), atkChances: sumOpp("atkChances"),
      shotsOn: sumOpp("shotsOn"), shotsOff: sumOpp("shotsOff"), shortCorners: sumOpp("shortCorners"),
      longCorners: sumOpp("longCorners"), turnoversWon: sumOpp("turnoversWon"), possLost: sumOpp("possLost"),
      territory: avgOppTerritory, possessionTimePct: avgOppPossTime, territoryTimePct: avgOppTerritoryTime,
      scOutcomes: oppSCO,
    },
    matchCount: n,
  };
}

// Get Monday of a given date's week
export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
}

// Convert match_stats rows (from archive) into the same format as computeMatchStats
// rows: array of { team, quarter, goals, shots_on, ... } for a single match
// teamId + homeTeamId: to determine which side is "team" vs "opp"
export function statsFromArchive(rows, teamId, homeTeamId) {
  const teamSide = teamId === homeTeamId ? 'home' : 'away';
  const oppSide = teamSide === 'home' ? 'away' : 'home';

  const toStats = (row) => ({
    goals: row?.goals || 0,
    scGoals: row?.sc_goals || 0,
    dEntries: row?.d_entries || 0,
    atkZoneEntries: row?.atk_zone_entries || 0,
    atkChances: row?.atk_chances || row?.atk_zone_entries || 0,
    shotsOn: row?.shots_on || 0,
    shotsOff: row?.shots_off || 0,
    shortCorners: row?.short_corners || 0,
    longCorners: row?.long_corners || 0,
    turnoversWon: row?.turnovers_won || 0,
    possLost: row?.poss_lost || 0,
    territory: row?.territory_pct || 0,
    possessionTimePct: row?.possession_time_pct ?? null,
    territoryTimePct: row?.territory_time_pct ?? null,
    scOutcomes: row?.sc_outcomes ? (typeof row.sc_outcomes === 'string' ? JSON.parse(row.sc_outcomes) : row.sc_outcomes) : null,
  });

  const teamTotals = rows.find(r => r.team === teamSide && (r.quarter === 0 || r.quarter === null));
  const oppTotals = rows.find(r => r.team === oppSide && (r.quarter === 0 || r.quarter === null));

  return {
    team: toStats(teamTotals),
    opp: toStats(oppTotals),
    teamSide,
    oppSide,
  };
}
