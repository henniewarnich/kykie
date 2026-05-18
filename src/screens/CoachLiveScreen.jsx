import { useState } from 'react';
import { theme } from '../utils/styles.js';
import { teamColor, teamInitial, teamShortName } from '../utils/teams.js';
import { FREE_PLUS_THRESHOLD } from '../utils/credits.js';
import { computeStats } from '../utils/stats.js';

import PlayPatternField from '../components/PlayPatternField.jsx';

const HC = "#22C55E"; // home colour — always green
const AC = "#64748B"; // away colour — always grey

const fmt = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

const STATS = [
  { key: "dEntries", label: "D Entries" },
  { key: "shotsOn", label: "Shots On" },
  { key: "shotsOff", label: "Shots Off" },
  { key: "shortCorners", label: "Short Crnrs" },
  { key: "longCorners", label: "Long Crnrs" },
  { key: "turnoversWon", label: "TOs Won" },
  { key: "possLost", label: "Poss Lost" },
];

const DISPLAY_STATS = [
  { label: "Shots On %", calc: (s) => { const t = s.shotsOn + s.shotsOff; return t > 0 ? Math.round(s.shotsOn / t * 100) : 0; }, suffix: "%" },
  { label: "Shots Off %", calc: (s) => { const t = s.shotsOn + s.shotsOff; return t > 0 ? Math.round(s.shotsOff / t * 100) : 0; }, suffix: "%" },
  { label: "Short Crnr %", calc: (s) => s.dEntries > 0 ? Math.round(s.shortCorners / s.dEntries * 100) : 0, suffix: "%" },
  { label: "Territory", calc: (s) => s.territory || 0, suffix: "%" },
];

const INVERTED = ["possLost", "shotsOff"];

// Generate coach insights for a team in a period
function generatePeriodInsights(stats, oppStats, teamName, oppName) {
  const insights = [];
  const { goals, dEntries, shotsOn, shotsOff, shortCorners, longCorners, turnoversWon, possLost, territory } = stats;
  const totalShots = shotsOn + shotsOff;
  const dConv = dEntries > 0 ? Math.round(totalShots / dEntries * 100) : 0;
  const shotConv = shotsOn > 0 ? Math.round(goals / shotsOn * 100) : 0;

  // Strengths
  if (territory >= 65) insights.push({ type: "strength", text: `Dominant territory (${territory}%) — controlling the game` });
  else if (territory >= 55) insights.push({ type: "strength", text: `Good territorial advantage (${territory}%)` });

  if (dEntries >= 4 && dConv >= 60) insights.push({ type: "strength", text: `Efficient in the D — converting ${dConv}% of entries into shots` });
  if (turnoversWon >= 3 && turnoversWon > possLost) insights.push({ type: "strength", text: `Winning the turnover battle (${turnoversWon} won vs ${possLost} lost)` });
  if (goals >= 2) insights.push({ type: "strength", text: `Clinical finishing — ${goals} goals from ${shotsOn} shots on target` });
  if (shortCorners >= 2 && goals > 0) insights.push({ type: "strength", text: `Set-piece threat — ${shortCorners} short corners earned` });
  if (possLost <= 1 && dEntries >= 2) insights.push({ type: "strength", text: `Tidy possession — only ${possLost} ball lost` });

  // Weaknesses
  if (dEntries >= 3 && totalShots === 0) insights.push({ type: "weakness", text: `Getting into the D (${dEntries}×) but creating no shots` });
  else if (dEntries >= 3 && dConv < 30) insights.push({ type: "weakness", text: `Poor D conversion — only ${dConv}% of entries producing shots` });

  if (shotsOn >= 3 && goals === 0) insights.push({ type: "weakness", text: `${shotsOn} shots on target but can't find the net` });
  if (shotsOff >= 2 && shotsOff > shotsOn) insights.push({ type: "weakness", text: `Accuracy issue — more shots off target (${shotsOff}) than on (${shotsOn})` });
  if (possLost >= 3 && possLost > turnoversWon) insights.push({ type: "weakness", text: `Giving the ball away too often (${possLost} lost vs ${turnoversWon} won)` });
  if (territory <= 35) insights.push({ type: "weakness", text: `Under pressure — only ${territory}% territory` });
  else if (territory <= 45 && dEntries === 0) insights.push({ type: "weakness", text: `Can't get into the opposition half — 0 D entries` });

  if (territory >= 55 && dEntries === 0) insights.push({ type: "weakness", text: `Territory without penetration — 0 D entries despite ${territory}% territory` });
  if (oppStats.shortCorners >= 2) insights.push({ type: "weakness", text: `Conceding set pieces — ${oppStats.shortCorners} short corners against` });

  // Limit to top 3 per type
  const strengths = insights.filter(i => i.type === "strength").slice(0, 3);
  const weaknesses = insights.filter(i => i.type === "weakness").slice(0, 3);
  return [...strengths, ...weaknesses];
}

// Generate match-level insights by aggregating all periods
function generateMatchInsights(quarterData, teams, homeScore, awayScore) {
  const activeQs = quarterData.filter(q => q.status !== "upcoming");
  if (activeQs.length === 0) return { home: [], away: [] };

  const agg = (team, key) => activeQs.reduce((s, q) => s + q[team][key], 0);
  const _hTerr = (() => {
    const hSum = activeQs.reduce((s, q) => s + q.home.territory, 0);
    const total = activeQs.reduce((s, q) => s + q.home.territory + q.away.territory, 0);
    return total > 0 ? Math.round(hSum / total * 100) : 50;
  })();
  const avgTerr = (team) => team === "home" ? _hTerr : 100 - _hTerr;

  // Pre-compute both sides for h2h comparisons
  const s = {};
  for (const t of ["home", "away"]) {
    const son = agg(t, "shotsOn"), soff = agg(t, "shotsOff"), de = agg(t, "dEntries");
    s[t] = {
      terr: avgTerr(t), de, son, soff, sc: agg(t, "shortCorners"),
      tw: agg(t, "turnoversWon"), pl: agg(t, "possLost"),
      goals: t === "home" ? homeScore : awayScore,
      totalShots: son + soff,
      dConv: de > 0 ? Math.round((son + soff) / de * 100) : 0,
    };
  }

  const buildInsights = (t, opp) => {
    const ins = [];
    const my = s[t], their = s[opp];

    // ── STRENGTHS ──

    // Territory (only if clearly ahead of opponent)
    if (my.terr >= 60 && my.terr > their.terr + 10) {
      ins.push({ type: "strength", text: `Controlled territory at ${my.terr}% — pinned opponent in their own half` });
    } else if (my.terr >= 55 && my.terr > their.terr + 5) {
      ins.push({ type: "strength", text: `Territorial advantage at ${my.terr}% vs ${their.terr}%` });
    }

    // D conversion (only if better than opponent's rate)
    if (my.dConv >= 50 && my.de >= 4 && my.dConv > their.dConv) {
      ins.push({ type: "strength", text: `Efficient in the D — ${my.dConv}% conversion (${my.totalShots} shots from ${my.de} entries)` });
    }

    // Turnovers (h2h comparison — only the team that won MORE turnovers gets this)
    if (my.tw > their.tw && my.tw > my.pl) {
      ins.push({ type: "strength", text: `Won the turnover battle — ${my.tw} vs ${their.tw} (net +${my.tw - my.pl})` });
    }

    // Clinical finishing
    if (my.goals >= 2 && my.son <= my.goals + 1) {
      ins.push({ type: "strength", text: `Clinical — ${my.goals} goals from ${my.son} shots on target` });
    }

    // Set pieces (only if clearly more than opponent)
    if (my.sc >= 4 && my.sc > their.sc) {
      ins.push({ type: "strength", text: `Set-piece threat — earned ${my.sc} short corners vs ${their.sc}` });
    }

    // Shot dominance
    if (my.totalShots >= my.de * 0.6 && my.totalShots > their.totalShots + 2) {
      ins.push({ type: "strength", text: `Outshot opponent ${my.totalShots}–${their.totalShots}` });
    }

    // D entry dominance
    if (my.de >= their.de * 1.8 && my.de >= 6) {
      ins.push({ type: "strength", text: `Dominated attacking entries — ${my.de} vs ${their.de} D entries` });
    }

    // ── WEAKNESSES ──

    // Scoreless despite chances (only for the team with MORE attacking output)
    if (my.de >= 6 && my.goals === 0 && my.de > their.de) {
      ins.push({ type: "weakness", text: `${my.de} D entries, ${my.totalShots} shots, zero goals — conversion letting them down` });
    } else if (my.de >= 3 && my.goals === 0 && my.son === 0 && my.de <= their.de) {
      ins.push({ type: "weakness", text: `${my.de} D entries but couldn't test the keeper — no shots on target` });
    }

    // Shot accuracy (only if opponent was more accurate)
    if (my.soff > my.son && my.totalShots >= 4) {
      const myAcc = my.totalShots > 0 ? Math.round(my.son / my.totalShots * 100) : 0;
      ins.push({ type: "weakness", text: `Shot accuracy at ${myAcc}% — ${my.soff} off target vs ${my.son} on` });
    }

    // Lost the turnover battle
    if (their.tw > my.tw && my.pl > my.tw) {
      ins.push({ type: "weakness", text: `Lost the turnover battle — ${my.tw} won vs ${their.tw} by opponent` });
    }

    // Under pressure (only if opponent had significantly more territory)
    if (my.terr <= 40 && their.terr >= 55) {
      ins.push({ type: "weakness", text: `Under pressure at ${my.terr}% territory — opponent controlled the game` });
    }

    // Conceding set pieces (only if significantly more than own)
    if (their.sc >= 4 && their.sc > my.sc + 1) {
      ins.push({ type: "weakness", text: `Conceded ${their.sc} short corners — defensive discipline needs work` });
    }

    // Limited attacking output (for the team that was outplayed on attack)
    if (my.de <= their.de * 0.5 && their.de >= 6) {
      ins.push({ type: "weakness", text: `Limited to ${my.de} D entries — couldn't penetrate the attacking third` });
    }

    // ── SCORE CONTEXT ──
    if (my.goals > their.goals && my.terr < 45) {
      ins.push({ type: "info", text: `Winning despite less territory — effective on the counter` });
    }
    if (my.goals < their.goals && my.terr >= 55) {
      ins.push({ type: "info", text: `Losing despite territorial dominance — must be more clinical` });
    }
    if (my.goals === 0 && their.goals === 0 && my.de > their.de + 8) {
      ins.push({ type: "info", text: `Dominant display without reward — the draw flatters the opponent` });
    }

    return ins.slice(0, 6);
  };

  return {
    home: buildInsights("home", "away"),
    away: buildInsights("away", "home"),
  };
}


// Find quarter boundaries from pause events (real quarters) or time-based (halves/none)
function getQuarters(events, breakFormat, matchLength, matchTime) {
  // Real quarters: use actual pause events
  if (breakFormat === "quarters") {
    const pauses = events.filter(e => e.team === "meta" && e.detail).sort((a, b) => a.time - b.time);
    const boundaries = [0];
    pauses.forEach(p => {
      if (p.detail === "Quarter Break" || p.detail === "Half Time") {
        boundaries.push(p.time);
      }
    });
    boundaries.push(999999);
    return [
      { label: "Q1", start: boundaries[0], end: boundaries[1] || 999999, status: boundaries.length > 2 ? "complete" : "live" },
      { label: "Q2", start: boundaries[1] || 999999, end: boundaries[2] || 999999, status: boundaries.length > 3 ? "complete" : boundaries.length > 2 ? "live" : "upcoming" },
      { label: "Q3", start: boundaries[2] || 999999, end: boundaries[3] || 999999, status: boundaries.length > 4 ? "complete" : boundaries.length > 3 ? "live" : "upcoming" },
      { label: "Q4", start: boundaries[3] || 999999, end: boundaries[4] || 999999, status: boundaries.length > 5 ? "complete" : boundaries.length > 4 ? "live" : "upcoming" },
    ];
  }

  // Halves / No breaks: derive virtual quarters from matchLength
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

export default function CoachLiveScreen({ match, events, matchTime, running, onBack, embedded, seasonAvg, playPatterns, matchPlayPatterns, prominentZones, matchProminentZones, ballLossZones, matchBallLossZones, teamTier = 'free' }) {
  const teams = match?.teams || { home: { name: "Home", color: "#3B82F6" }, away: { name: "Away", color: "#EF4444" } };
  const breakFormat = match?.breakFormat || "quarters";
  const isEnded = match?.status === "ended";

  const matchLength = match?.matchLength || 60;

  const quarters = getQuarters(events, breakFormat, matchLength, matchTime);
  // Mark last active quarter as live if match not ended
  if (!isEnded) {
    const lastActive = [...quarters].reverse().find(q => q.status !== "upcoming");
    if (lastActive) lastActive.status = "live";
  }

  const [expandedQ, setExpandedQ] = useState(quarters.find(q => q.status === "live")?.label || quarters[0]?.label);

  const hc = HC;
  const ac = AC;

  const homeScore = match?.homeScore ?? events.filter(e => e.team === "home" && e.event?.startsWith("Goal!")).length;
  const awayScore = match?.awayScore ?? events.filter(e => e.team === "away" && e.event?.startsWith("Goal!")).length;

  // Compute stats per quarter
  const quarterData = quarters.map(q => ({
    ...q,
    home: computeStats(events, "home", q.start, q.end),
    away: computeStats(events, "away", q.start, q.end),
  }));

  const activeQs = quarterData.filter(q => q.status !== "upcoming");
  const totalStat = (team, key) => activeQs.reduce((sum, q) => sum + q[team][key], 0);
  // Territory: compute from weighted totals, guarantee home + away = 100%
  const _homeTerr = (() => {
    const hSum = activeQs.reduce((s, q) => s + q.home.territory, 0);
    const total = activeQs.reduce((s, q) => s + q.home.territory + q.away.territory, 0);
    return total > 0 ? Math.round(hSum / total * 100) : 50;
  })();
  const avgTerritory = (team) => team === "home" ? _homeTerr : 100 - _homeTerr;
  // Territory (% in opp half): weighted from oppHalfPct per quarter, guarantee home + away = 100%
  const _homeOppHalf = (() => {
    const hSum = activeQs.reduce((s, q) => s + q.home.oppHalfPct, 0);
    const total = activeQs.reduce((s, q) => s + q.home.oppHalfPct + q.away.oppHalfPct, 0);
    return total > 0 ? Math.round(hSum / total * 100) : 50;
  })();
  const avgOppHalf = (team) => team === "home" ? _homeOppHalf : 100 - _homeOppHalf;
  const convRate = (team) => { const s = totalStat(team, "shotsOn") + totalStat(team, "shotsOff"), g = team === "home" ? homeScore : awayScore; return s > 0 ? Math.round(g / s * 100) : 0; };
  const dConv = (team) => { const d = totalStat(team, "dEntries"), s = totalStat(team, "shotsOn") + totalStat(team, "shotsOff"); return d > 0 ? Math.round(s / d * 100) : 0; };
  const atkConv = (team) => { const a = totalStat(team, "atkZoneEntries"), d = totalStat(team, "dEntries"); return a > 0 ? Math.round(d / a * 100) : 0; };
  const shotsTaken = (team) => totalStat(team, "shotsOn") + totalStat(team, "shotsOff");
  const onTargetPct = (team) => { const s = shotsTaken(team); return s > 0 ? Math.round(totalStat(team, "shotsOn") / s * 100) : 0; };
  const goalPct = (team) => { const on = totalStat(team, "shotsOn"); const g = team === "home" ? homeScore : awayScore; return on > 0 ? Math.round(g / on * 100) : 0; };
  const dToSC = (team) => { const d = totalStat(team, "dEntries"), sc = totalStat(team, "shortCorners"); return d > 0 ? Math.round(sc / d * 100) : 0; };
  const scToGoal = (team) => { const sc = totalStat(team, "shortCorners"), g = totalStat(team, "scGoals"); return sc > 0 ? Math.round(g / sc * 100) : 0; };
  const matchInsights = generateMatchInsights(quarterData, teams, homeScore, awayScore);

  const StatBar = ({ hVal, aVal, label, suffix = "" }) => {
    const total = hVal + aVal;
    const hPct = total > 0 ? (hVal / total) * 100 : 50;
    const aPct = total > 0 ? (aVal / total) * 100 : 50;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
        <div style={{ width: 28, fontSize: 12, fontWeight: 800, textAlign: "right", fontFamily: "monospace", color: hVal >= aVal ? hc : "#64748B" }}>{hVal}{suffix}</div>
        <div style={{ flex: 1, display: "flex", height: 7, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${hPct}%`, background: hc, transition: "width 0.5s" }} />
          <div style={{ width: `${aPct}%`, background: ac, transition: "width 0.5s" }} />
        </div>
        <div style={{ width: 28, fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: aVal >= hVal ? ac : "#64748B" }}>{aVal}{suffix}</div>
        <div style={{ width: 90, fontSize: 9, color: "#94A3B8", fontWeight: 600 }}>{label}</div>
      </div>
    );
  };

  const Wrapper = embedded ? ({ children }) => <div style={{ flex: 1 }}>{children}</div> : ({ children }) => (
    <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: "0 auto", background: "#0B0F1A", minHeight: "100vh", color: "#E2E8F0", userSelect: "none" }}>{children}</div>
  );

  return (
    <Wrapper>
      {!embedded && <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />}

      {!embedded && <>
      {/* Header */}
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: 18, cursor: "pointer" }}>←</button>}
          <div style={{ fontSize: 9, fontWeight: 700, color: isEnded ? theme.textDim : "#10B981", display: "flex", alignItems: "center", gap: 4 }}>
            {!isEnded && <span style={{ animation: "pulse-dot 2s infinite" }}>●</span>}
            {isEnded ? "FULL TIME — COACH VIEW" : "LIVE — COACH VIEW"}
          </div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#8B5CF6", background: "#8B5CF622", padding: "2px 8px", borderRadius: 99 }}>🔒 Coach</div>
      </div>

      {/* Compact scoreboard */}
      <div style={{ padding: "10px 14px 8px", display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: hc, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {teamShortName(teams.home)}
          </div>
          <div style={{ fontSize: 32, fontWeight: 900 }}>{homeScore}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: isEnded ? theme.danger : "#F59E0B" }}>
            {isEnded ? "FT" : fmt(matchTime)}
          </div>
          {!isEnded && <div style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#10B98122", color: "#10B981" }}>
            {quarters.find(q => q.status === "live")?.label || "—"}
          </div>}
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: ac, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {teamShortName(teams.away)}
          </div>
          <div style={{ fontSize: 32, fontWeight: 900 }}>{awayScore}</div>
        </div>
      </div>
      </>}

      {/* Match Stats */}
      <div style={{ padding: "0 14px 8px" }}>
        <div style={{ background: "#1E293B", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Match Stats</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #33415544" }}>
            <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: hc }}>{teamShortName(teams.home)}</div>
            <div style={{ width: 90 }} />
            <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: ac }}>{teamShortName(teams.away)}</div>
          </div>
          {[
            { label: "Possession", sub: "% of play", hVal: avgTerritory("home"), aVal: avgTerritory("away"), suffix: "%" },
            { label: "Territory", sub: "% in opp half", hVal: avgOppHalf("home"), aVal: avgOppHalf("away"), suffix: "%" },
            { label: "Turnovers Won", sub: "", hVal: totalStat("home", "turnoversWon"), aVal: totalStat("away", "turnoversWon"), suffix: "" },
            { label: "Possession Lost", sub: "", hVal: totalStat("home", "possLost"), aVal: totalStat("away", "possLost"), suffix: "", inverted: true },
            ...(totalStat("home", "atkZoneEntries") > 0 || totalStat("away", "atkZoneEntries") > 0
              ? [{ label: "Attack Chances", sub: "", hVal: totalStat("home", "atkZoneEntries"), aVal: totalStat("away", "atkZoneEntries"), suffix: "" }]
              : []),
            { label: "D Entries", sub: "", hVal: totalStat("home", "dEntries"), aVal: totalStat("away", "dEntries"), suffix: "" },
            { label: "Short Corners", sub: "", hVal: totalStat("home", "shortCorners"), aVal: totalStat("away", "shortCorners"), suffix: "" },
            { label: "SC Goals", sub: "", hVal: totalStat("home", "scGoals"), aVal: totalStat("away", "scGoals"), suffix: "" },
            { label: "Shots", sub: "", hVal: shotsTaken("home"), aVal: shotsTaken("away"), suffix: "" },
            { label: "Shots on Target", sub: "", hVal: totalStat("home", "shotsOn"), aVal: totalStat("away", "shotsOn"), suffix: "" },
          ].map((r, i, arr) => {
            const higher = r.inverted ? r.hVal < r.aVal : r.hVal > r.aVal;
            const lower = r.inverted ? r.hVal > r.aVal : r.hVal < r.aVal;
            const hColor = higher ? "#10B981" : lower ? "#EF4444" : "#F59E0B";
            const aHigher = r.inverted ? r.aVal < r.hVal : r.aVal > r.hVal;
            const aLower = r.inverted ? r.aVal > r.hVal : r.aVal < r.hVal;
            const aColor = aHigher ? "#10B981" : aLower ? "#EF4444" : "#F59E0B";
            return (
              <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: i < arr.length - 1 ? "1px solid #1a2536" : "none" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: hColor }}>{r.hVal}{r.suffix}</div>
                </div>
                <div style={{ textAlign: "center", width: 90 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: r.color || "#94A3B8" }}>{r.label}</div>
                  <div style={{ fontSize: 7, color: "#475569" }}>{r.sub}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: aColor }}>{r.aVal}{r.suffix}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Match Insights */}
      <div style={{ padding: "0 14px 14px" }}>
        {activeQs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "#475569", fontSize: 11 }}>Insights will appear as the match progresses</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {["home", "away"].map(t => {
              const ins = matchInsights[t];
              if (!ins || ins.length === 0) return null;
              const teamCol = t === "home" ? hc : ac;
              const strengths = ins.filter(i => i.type === "strength");
              const concerns = ins.filter(i => i.type !== "strength");
              const periodScores = activeQs.map(q => ({ label: q.label, score: q[t].dEntries + q[t].shotsOn + q[t].turnoversWon - q[t].possLost }));
              const strongest = periodScores.length > 0 ? periodScores.reduce((a, b) => b.score > a.score ? b : a).label : null;
              const weakest = periodScores.length > 1 ? periodScores.reduce((a, b) => b.score < a.score ? b : a).label : null;
              return (
                <div key={t} style={{ background: "#1E293B", borderRadius: 10, borderLeft: `3px solid ${teamCol}`, border: "1px solid #33415544", borderLeftWidth: 3, borderLeftColor: teamCol, overflow: "hidden" }}>
                  <div style={{ padding: "10px 12px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: teamCol, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: "#0B0F1A", flexShrink: 0 }}>
                      {teamInitial(teams[t])}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#F8FAFC" }}>{teamShortName(teams[t])}</div>
                    {strongest && <div style={{ fontSize: 9, color: "#475569", marginLeft: "auto" }}>Best: {strongest}{weakest && weakest !== strongest ? ` · Weakest: ${weakest}` : ""}</div>}
                  </div>
                  <div style={{ padding: "0 12px 10px" }}>
                    {strengths.map((i, idx) => (
                      <div key={`s${idx}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0" }}>
                        <span style={{ color: "#10B981", fontWeight: 700, fontSize: 12, width: 18, textAlign: "center", flexShrink: 0 }}>+</span>
                        <span style={{ fontSize: 12, color: "#10B981", lineHeight: 1.5 }}>{i.text}</span>
                      </div>
                    ))}
                    {concerns.map((i, idx) => (
                      <div key={`c${idx}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0" }}>
                        <span style={{ color: "#F59E0B", fontWeight: 700, fontSize: 12, width: 18, textAlign: "center", flexShrink: 0 }}>!</span>
                        <span style={{ fontSize: 12, color: "#F59E0B", lineHeight: 1.5 }}>{i.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visuals (if available) */}
      {matchPlayPatterns && playPatterns && (
        (teamTier === 'free_plus' || teamTier === 'premium') ? (
        <div style={{ padding: "0 14px 20px" }}>
          <div style={{ background: "#1E293B", borderRadius: 10, padding: "10px 12px", border: "1px solid #334155" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Play Pattern & Prominent Players</div>
            <PlayPatternField
              patterns={playPatterns}
              matchPatterns={matchPlayPatterns}
              prominentZones={prominentZones}
              matchProminentZones={matchProminentZones}
              ballLossZones={ballLossZones}
              matchBallLossZones={matchBallLossZones}
            />
          </div>
        </div>
        ) : (
        <div style={{ padding: "0 14px 20px" }}>
          <div style={{ background: "#1E293B", borderRadius: 10, padding: "24px 16px", border: "1px solid #334155", textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>🔒</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B" }}>Visual play analysis</div>
            <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Available with Free Plus — increase your team's average credits per match above {FREE_PLUS_THRESHOLD} to unlock</div>
          </div>
        </div>
        )
      )}

      {!embedded && <style>{`@keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>}
    </Wrapper>
  );
}
