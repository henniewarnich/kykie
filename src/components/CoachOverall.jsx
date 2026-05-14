import { useState } from 'react';
import { aggregateStats } from '../utils/stats.js';

function MiniTrend({ points, oppAvg, top10Avg, teamColor: tc }) {
  if (!points || points.length === 0) return null;
  const W = 320, H = 70, PL = 8, PR = 8, PT = 4, PB = 18;
  const plotW = W - PL - PR, plotH = H - PT - PB;

  // Auto-scale Y axis
  const allVals = [...points.map(p => p.val), oppAvg, top10Avg].filter(v => v != null && !isNaN(v));
  const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
  const range = rawMax - rawMin || 10;
  const yMin = Math.max(0, rawMin - range * 0.15);
  const yMax = rawMax + range * 0.15;
  const toY = (v) => PT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const toX = (i) => PL + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.val).toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L${toX(points.length - 1).toFixed(1)},${toY(yMin).toFixed(1)} L${toX(0).toFixed(1)},${toY(yMin).toFixed(1)} Z`;

  // Grid lines (3)
  const gridVals = [yMin + (yMax - yMin) * 0.25, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.75];

  // Date labels
  const first = points[0]?.label || '';
  const last = points[points.length - 1]?.label || '';
  const mid = points.length > 2 ? points[Math.floor(points.length / 2)]?.label || '' : '';

  // Last 5 avg
  const last5 = points.slice(-5);
  const last5Avg = last5.reduce((s, p) => s + p.val, 0) / last5.length;
  const overallAvg = points.reduce((s, p) => s + p.val, 0) / points.length;
  const trending = last5Avg > overallAvg + 0.5 ? 'up' : last5Avg < overallAvg - 0.5 ? 'down' : 'flat';

  return (
    <div style={{ padding: '6px 0 10px' }}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#64748B' }}>
          <span style={{ width: 12, height: 2, background: '#10B981', borderRadius: 1, display: 'inline-block' }} /> Team
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#64748B' }}>
          <span style={{ width: 12, height: 2, background: '#94A3B8', borderRadius: 1, display: 'inline-block' }} /> OPP
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#64748B' }}>
          <span style={{ width: 12, height: 0, borderTop: '2px dashed #8B5CF6', borderRadius: 1, display: 'inline-block' }} /> Top 10
        </span>
      </div>
      <div style={{ background: '#0B0F1A', borderRadius: 6, padding: '2px 0' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          {gridVals.map((v, i) => (
            <g key={i}>
              <line x1={PL} y1={toY(v)} x2={W - PR} y2={toY(v)} stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
              <text x={PL + 2} y={toY(v) - 2} fill="#475569" fontSize="7">{Math.round(v)}%</text>
            </g>
          ))}
          {/* OPP avg flat line */}
          {oppAvg != null && <line x1={PL} y1={toY(oppAvg)} x2={W - PR} y2={toY(oppAvg)} stroke="#94A3B8" strokeWidth="1.5" opacity="0.45" />}
          {/* TOP10 benchmark dashed */}
          {top10Avg != null && <line x1={PL} y1={toY(top10Avg)} x2={W - PR} y2={toY(top10Avg)} stroke="#8B5CF6" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.65" />}
          {/* Area fill */}
          <path d={areaPath} fill="#10B981" opacity="0.08" />
          {/* Team line */}
          <path d={linePath} fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Dots */}
          {points.map((p, i) => (
            <circle key={i} cx={toX(i)} cy={toY(p.val)} r={i === points.length - 1 ? 3.5 : 2.5}
              fill={i === points.length - 1 ? '#F59E0B' : '#10B981'} />
          ))}
          {/* X-axis */}
          <line x1={PL} y1={H - PB + 4} x2={W - PR} y2={H - PB + 4} stroke="#334155" strokeWidth="0.5" />
          <text x={toX(0)} y={H - 4} textAnchor="start" fill="#475569" fontSize="7">{first}</text>
          {points.length > 2 && <text x={toX(Math.floor(points.length / 2))} y={H - 4} textAnchor="middle" fill="#475569" fontSize="7">{mid}</text>}
          <text x={toX(points.length - 1)} y={H - 4} textAnchor="end" fill="#475569" fontSize="7">{last}</text>
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#475569', marginTop: 3, padding: '0 4px' }}>
        <span>{points.length} matches</span>
        <span>
          Avg: <span style={{ color: '#10B981', fontWeight: 700 }}>{Math.round(overallAvg)}%</span>
          {' '}Last 5: <span style={{ color: '#10B981', fontWeight: 700 }}>{Math.round(last5Avg)}%</span>
          {' '}<span style={{ color: trending === 'up' ? '#10B981' : trending === 'down' ? '#EF4444' : '#64748B' }}>
            {trending === 'up' ? '\u2191' : trending === 'down' ? '\u2193' : '\u2192'}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function CoachOverall({ matchStatsList, matchStatsMap, teamName, teamColor, teamId, allMatches, matchCount, top10Agg, top10PM, teamTier = 'free' }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const canSeeOpp = teamTier === 'free_plus' || teamTier === 'premium';

  if (!matchStatsList || matchStatsList.length === 0) {
    return <div style={{ textAlign: "center", padding: 40, color: "#475569", fontSize: 12 }}>No match data available yet</div>;
  }

  const agg = aggregateStats(matchStatsList);
  const n = agg.matchCount;
  const abbr = (teamName || "TEAM").slice(0, 3).toUpperCase();

  const tShots = agg.team.shotsOn + agg.team.shotsOff;
  const oShots = agg.opp.shotsOn + agg.opp.shotsOff;
  const t10 = top10Agg;
  const t10n = t10?.matchCount || 1;
  const t10Shots = t10 ? t10.team.shotsOn + t10.team.shotsOff : 0;

  const pct = (num, den) => den > 0 ? Math.round(num / den * 100) : 0;

  // Rank 3 values: best=green, second=yellow, worst=grey. higherBetter controls direction.
  const rank3 = (a, b, c, higherBetter = true) => {
    const vals = [{ v: a, i: 0 }, { v: b ?? -Infinity, i: 1 }, { v: c ?? -Infinity, i: 2 }];
    if (higherBetter) vals.sort((x, y) => y.v - x.v);
    else vals.sort((x, y) => x.v - y.v);
    const cols = ['', '', ''];
    cols[vals[0].i] = '#10B981'; cols[vals[1].i] = '#F59E0B'; cols[vals[2].i] = '#64748B';
    if (vals[0].v === vals[1].v) { cols[vals[0].i] = cols[vals[1].i] = '#10B981'; }
    if (vals[1].v === vals[2].v && cols[vals[1].i] === '#F59E0B') { cols[vals[2].i] = '#F59E0B'; }
    if (b == null) cols[1] = '#475569';
    if (c == null) cols[2] = '#475569';
    return cols;
  };

  const avgPM = (total, count) => count > 0 ? +(total / count).toFixed(1) : null;

  // Build per-match trend data (sorted by date)
  const matchesMap = {};
  (allMatches || []).forEach(m => { matchesMap[m.id] = m; });
  const trendData = [];
  if (matchStatsMap) {
    Object.entries(matchStatsMap).forEach(([matchId, stats]) => {
      const m = matchesMap[matchId];
      if (!m) return;
      const d = new Date(m.match_date || m.created_at);
      const label = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
      const ts = stats.team.shotsOn + stats.team.shotsOff;
      trendData.push({
        matchId, date: d, label,
        poss: stats.team.possessionTimePct != null ? stats.team.possessionTimePct : stats.team.territory,
        terr: stats.team.territoryTimePct != null ? stats.team.territoryTimePct : stats.team.territory,
        turnoversWon: stats.team.turnoversWon || null,
        possLost: stats.team.possLost || null,
        atkChances: stats.team.atkChances || null,
        dEntry: stats.team.dEntries || null,
        dToSC: stats.team.shortCorners || null,
        scToGoal: (stats.team.scGoals || 0) || null,
        shotsTaken: ts || null,
        onTarget: stats.team.shotsOn || null,
      });
    });
  }
  trendData.sort((a, b) => a.date - b.date);
  const getTrend = (key) => trendData.filter(d => d[key] != null).map(d => ({ val: d[key], label: d.label }));

  // Possession & territory
  const tPoss = agg.team.possessionTimePct != null ? agg.team.possessionTimePct : agg.team.territory;
  const oPoss = agg.opp.possessionTimePct != null ? agg.opp.possessionTimePct : agg.opp.territory;
  const t10Poss = t10 ? (t10.team.possessionTimePct != null ? t10.team.possessionTimePct : t10.team.territory) : null;
  const tTerr = agg.team.territoryTimePct != null ? agg.team.territoryTimePct : agg.team.territory;
  const oTerr = agg.opp.territoryTimePct != null ? agg.opp.territoryTimePct : agg.opp.territory;
  const t10Terr = t10 ? (t10.team.territoryTimePct != null ? t10.team.territoryTimePct : t10.team.territory) : null;

  const rows = [
    { key: 'poss', label: "Possession", sub: "% of play", tVal: tPoss, oVal: oPoss, t10Val: t10Poss, suffix: "%", trendKey: 'poss' },
    { key: 'terr', label: "Territory", sub: "% in opp half", tVal: tTerr, oVal: oTerr, t10Val: t10Terr, suffix: "%", trendKey: 'terr' },
    { key: 'turnoversWon', label: "Turnovers Won", sub: "per match",
      tVal: avgPM(agg.team.turnoversWon, n), oVal: avgPM(agg.opp.turnoversWon, n),
      t10Val: t10 ? avgPM(t10.team.turnoversWon, t10n) : null,
      suffix: "", trendKey: 'turnoversWon',
    },
    { key: 'possLost', label: "Possession Lost", sub: "per match",
      tVal: avgPM(agg.team.possLost, n), oVal: avgPM(agg.opp.possLost, n),
      t10Val: t10 ? avgPM(t10.team.possLost, t10n) : null,
      suffix: "", trendKey: 'possLost', higher: false,
    },
    { key: 'atkChances', label: "Attack Chances", sub: "per match",
      tVal: avgPM(agg.team.atkChances, n), oVal: avgPM(agg.opp.atkChances, n),
      t10Val: t10 ? avgPM(t10.team.atkChances, t10n) : null,
      suffix: "", trendKey: 'atkChances',
    },
    { key: 'dEntry', label: "D Entries", sub: "per match",
      tVal: avgPM(agg.team.dEntries, n), oVal: avgPM(agg.opp.dEntries, n),
      t10Val: t10 ? avgPM(t10.team.dEntries, t10n) : null,
      suffix: "", trendKey: 'dEntry',
    },
    { key: 'dsc', label: "Short Corners", sub: "per match",
      tVal: avgPM(agg.team.shortCorners, n), oVal: avgPM(agg.opp.shortCorners, n),
      t10Val: t10 ? avgPM(t10.team.shortCorners, t10n) : null,
      suffix: "", trendKey: 'dToSC',
    },
    { key: 'scg', label: "SC Goals", sub: "per match",
      tVal: avgPM(agg.team.scGoals || 0, n), oVal: avgPM(agg.opp.scGoals || 0, n),
      t10Val: t10 ? avgPM(t10.team.scGoals || 0, t10n) : null,
      suffix: "", trendKey: 'scToGoal',
    },
    { key: 'shots', label: "Shots", sub: "per match",
      tVal: avgPM(tShots, n), oVal: avgPM(oShots, n),
      t10Val: t10 ? avgPM(t10Shots, t10n) : null,
      suffix: "", trendKey: 'shotsTaken',
    },
    { key: 'onTarget', label: "Shots on Target", sub: "per match",
      tVal: avgPM(agg.team.shotsOn, n), oVal: avgPM(agg.opp.shotsOn, n),
      t10Val: t10 ? avgPM(t10.team.shotsOn, t10n) : null,
      suffix: "", trendKey: 'onTarget',
    },
  ];

  // Per-match averages
  const allEnded = (allMatches || []).filter(m => m.status === 'ended');
  const totalMatches = allEnded.length;
  let allGoalsFor = 0, allGoalsAgainst = 0;
  allEnded.forEach(m => {
    const isHome = m.home_team_id === teamId || m.home_team?.id === teamId;
    allGoalsFor += isHome ? (m.home_score || 0) : (m.away_score || 0);
    allGoalsAgainst += isHome ? (m.away_score || 0) : (m.home_score || 0);
  });
  const allGD = allGoalsFor - allGoalsAgainst;
  const gfPM = totalMatches > 0 ? +(allGoalsFor / totalMatches).toFixed(1) : 0;
  const gaPM = totalMatches > 0 ? +(allGoalsAgainst / totalMatches).toFixed(1) : 0;
  const gdPM = totalMatches > 0 ? +(allGD / totalMatches).toFixed(1) : 0;
  const oppGF = n > 0 ? +(agg.opp.goals / n).toFixed(1) : 0;
  const oppGA = n > 0 ? +(agg.team.goals / n).toFixed(1) : 0;
  const oppGD = +(oppGF - oppGA).toFixed(1);
  const t10GF = top10PM ? +top10PM.gf.toFixed(1) : null;
  const t10GA = top10PM ? +top10PM.ga.toFixed(1) : null;
  const t10GD = top10PM ? +top10PM.gd.toFixed(1) : null;

  const ST = {
    card: { background: "#1E293B", borderRadius: 10, padding: "10px 12px", marginBottom: 8, border: "1px solid #334155" },
    title: { fontSize: 10, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 },
    colH: { display: "grid", gridTemplateColumns: "1fr 80px 70px 70px", gap: 4, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid #33415544" },
    hdr: { fontSize: 9, fontWeight: 800, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 },
  };

  const ValCell = ({ val, suffix, color, avgPM }) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, color }}>{val != null ? `${val}${suffix}` : "\u2013"}</div>
      {avgPM != null && <div style={{ fontSize: 8, color: "#64748B", marginTop: 1 }}>{avgPM}/match</div>}
    </div>
  );

  const BlurCell = ({ val, suffix, color, avgPM }) => (
    <div style={{ textAlign: "center", filter: "blur(6px)", userSelect: "none", WebkitUserSelect: "none" }}>
      <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, color }}>{val != null ? `${val}${suffix}` : "\u2013"}</div>
      {avgPM != null && <div style={{ fontSize: 8, color: "#475569", marginTop: 1 }}>{avgPM}/match</div>}
    </div>
  );

  const GatedCell = (props) => canSeeOpp ? <ValCell {...props} /> : <BlurCell {...props} />;

  return (
    <div style={{ padding: "8px 14px 20px" }}>

      {/* Detailed Live Pro Stats */}
      <div style={ST.card}>
        <div style={ST.title}>Detailed Live Pro Stats <span style={{ fontWeight: 400, color: "#64748B" }}>— based on {n}/{totalMatches} matches</span></div>
        <div style={ST.colH}>
          <div />
          <div style={{ ...ST.hdr, color: teamColor }}>{abbr}</div>
          <div style={{ ...ST.hdr, color: "#94A3B8" }}>VS OPP</div>
          <div style={{ ...ST.hdr, color: "#8B5CF6", lineHeight: 1.3 }}>Benchmark<br/><span style={{ fontSize: 7 }}>TOP 10{top10Label ? ` · ${top10Label}` : ''}</span></div>
        </div>
        {rows.map((r, i) => {
          const isExp = expanded[r.key];
          const trend = getTrend(r.trendKey);
          const hasTrend = trend.length >= 2;
          const canExpand = canSeeOpp ? hasTrend : true; // locked rows always expandable
          const cols = canSeeOpp ? rank3(r.tVal, r.oVal, r.t10Val, r.higher !== false) : ['#F8FAFC', '#94A3B8', '#8B5CF6'];
          return (
            <div key={r.key}>
              <div
                onClick={() => canExpand && toggle(r.key)}
                style={{ display: "grid", gridTemplateColumns: "1fr 80px 70px 70px", gap: 4, alignItems: "center", padding: "8px 0", borderBottom: (i < rows.length - 1 && !isExp) ? "1px solid #1a2536" : "none", cursor: canExpand ? "pointer" : "default" }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: r.color || "#CBD5E1", display: "flex", alignItems: "center", gap: 4 }}>
                    {canExpand && <span style={{ fontSize: 8, color: "#475569", transition: "transform 0.2s", transform: isExp ? "rotate(90deg)" : "none", display: "inline-block" }}>{"\u203A"}</span>}
                    {r.label}
                  </div>
                  <div style={{ fontSize: 8, color: "#475569", marginTop: 1, paddingLeft: canExpand ? 12 : 0 }}>{r.sub}</div>
                </div>
                <ValCell val={r.tVal} suffix={r.suffix} color={cols[0]} avgPM={r.tAvgPM} />
                <GatedCell val={r.oVal} suffix={r.suffix} color={cols[1]} avgPM={r.oAvgPM} />
                <GatedCell val={r.t10Val} suffix={r.suffix} color={cols[2]} avgPM={r.t10AvgPM} />
              </div>
              {/* Unlocked: show trend chart */}
              {isExp && canSeeOpp && hasTrend && (
                <div style={{ borderBottom: i < rows.length - 1 ? "1px solid #1a2536" : "none", paddingBottom: 4 }}>
                  <MiniTrend points={trend} oppAvg={r.oVal} top10Avg={r.t10Val} teamColor={teamColor} />
                </div>
              )}
              {/* Locked: show unlock explanation */}
              {isExp && !canSeeOpp && (
                <div style={{ padding: "8px 0 10px", borderBottom: i < rows.length - 1 ? "1px solid #1a2536" : "none" }}>
                  <div style={{ background: "#F59E0B08", border: "1px solid #F59E0B22", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#F59E0B", marginBottom: 4 }}>🔒 Free Plus required</div>
                    <div style={{ fontSize: 9, color: "#94A3B8", lineHeight: 1.5 }}>
                      See how your <strong style={{ color: "#CBD5E1" }}>{r.label}</strong> compares to opponents and TOP 10 teams. Unlock by increasing your team's average credits per match above 20.
                    </div>
                    <div style={{ fontSize: 9, color: "#64748B", lineHeight: 1.5, marginTop: 6 }}>
                      Every Live Pro recording earns <strong style={{ color: "#10B981" }}>+50</strong>, video review <strong style={{ color: "#10B981" }}>+20–30</strong>, each viewer <strong style={{ color: "#10B981" }}>+1</strong>. Share match links with parents to boost viewership.
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); window.location.hash = '#/info/coach'; }} style={{ marginTop: 8, padding: "6px 14px", borderRadius: 6, border: "1px solid #F59E0B44", background: "#F59E0B11", color: "#F59E0B", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Learn more about Free Plus →</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-match averages */}
      <div style={ST.card}>
        <div style={ST.title}>Per-Match Averages</div>
        <div style={ST.colH}>
          <div />
          <div style={{ ...ST.hdr, color: teamColor }}>{abbr}</div>
          <div style={{ ...ST.hdr, color: "#94A3B8" }}>VS OPP</div>
          <div style={{ ...ST.hdr, color: "#8B5CF6", lineHeight: 1.3 }}>Benchmark<br/><span style={{ fontSize: 7 }}>TOP 10{top10Label ? ` · ${top10Label}` : ''}</span></div>
        </div>
        {[
          { label: "Goals For", tVal: gfPM, oVal: oppGF, t10Val: t10GF, higher: true, color: "#F59E0B" },
          { label: "Goals Against", tVal: gaPM, oVal: oppGA, t10Val: t10GA, higher: false },
          { label: "Goal Difference", tVal: gdPM, oVal: oppGD, t10Val: t10GD, higher: true, fmtPlus: true },
        ].map((r, i, arr) => {
          const cols = canSeeOpp ? rank3(r.tVal, r.oVal, r.t10Val, r.higher) : ['#F8FAFC', '#94A3B8', '#8B5CF6'];
          const fmtV = (v, c, blur) => (
            <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, textAlign: "center", color: c, ...(blur ? { filter: "blur(6px)", userSelect: "none", WebkitUserSelect: "none" } : {}) }}>
              {v == null ? "\u2013" : (r.fmtPlus && v > 0 ? "+" : "") + v}
            </div>
          );
          return (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr 80px 70px 70px", gap: 4, alignItems: "center", padding: "8px 0", borderBottom: i < arr.length - 1 ? "1px solid #1a2536" : "none" }}>
              <div><div style={{ fontSize: 11, fontWeight: 700, color: r.color || "#CBD5E1" }}>{r.label}</div></div>
              {fmtV(r.tVal, cols[0], false)}
              {fmtV(r.oVal, cols[1], !canSeeOpp)}
              {fmtV(r.t10Val, cols[2], !canSeeOpp)}
            </div>
          );
        })}
        {totalMatches > n && (
          <div style={{ fontSize: 8, color: "#475569", textAlign: "center", marginTop: 6 }}>
            Goals from all {totalMatches} matches · other stats from {n} recorded
          </div>
        )}
      </div>

      {/* Legend */}
      {canSeeOpp && (
      <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "6px 0" }}>
        {[["#10B981", "Best"], ["#F59E0B", "Second"], ["#64748B", "Lowest"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#64748B" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
            {l}
          </div>
        ))}
      </div>
      )}
      <div style={{ textAlign: "center", fontSize: 9, color: "#334155" }}>
        Tap any metric with trends for per-match chart
      </div>
    </div>
  );
}
