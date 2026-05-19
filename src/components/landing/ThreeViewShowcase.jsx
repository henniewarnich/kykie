// Self-running 12-second loop. A short corner unfolds and is shown three ways:
// commentator records it, supporter follows the story, coach gets the insight.
// Pure CSS keyframes + SVG SMIL — no JS, no props, no state. Drop it in and
// it plays forever. Fictional teams only (Oaktree / Meadows) — never real schools.

export default function ThreeViewShowcase() {
  return (
    <div className="tvs">
      <style>{`
        .tvs { padding: 40px 16px 32px; }
        .tvs .scene { max-width: 900px; margin: 0 auto; text-align: center; }
        .tvs .scene-eyebrow { font-size: 12px; color: #10B981; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 10px; }
        .tvs .scene-title { font-size: 28px; font-weight: 900; color: #F8FAFC; margin-bottom: 10px; line-height: 1.15; }
        @media (min-width: 700px) { .tvs .scene-title { font-size: 36px; } }
        .tvs .scene-title .accent { color: #F59E0B; }
        .tvs .scene-sub { font-size: 14px; color: #94A3B8; max-width: 520px; margin: 0 auto 28px; line-height: 1.5; }
        .tvs .live-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #10B981; font-weight: 800; letter-spacing: 1.5px; background: rgba(16,185,129,0.1); padding: 5px 12px; border-radius: 14px; margin-bottom: 16px; }
        .tvs .live-pill .d { width: 6px; height: 6px; background: #10B981; border-radius: 50%; animation: tvsPulse 1.5s infinite; }
        @keyframes tvsPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

        .tvs .phones { display: grid; grid-template-columns: 240px; gap: 32px; margin: 0 auto; justify-content: center; align-items: start; }
        @media (min-width: 700px) { .tvs .phones { grid-template-columns: repeat(3, 240px); gap: 20px; } }
        .tvs .phone-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .tvs .phone { width: 240px; height: 427px; background: #000; border: 3px solid #1E293B; border-radius: 32px; padding: 26px 8px 12px; position: relative; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
        .tvs .notch { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: 60px; height: 7px; background: #1E293B; border-radius: 4px; z-index: 2; }
        .tvs .scr { background: #0B0F1A; border-radius: 18px; height: 100%; overflow: hidden; display: flex; flex-direction: column; padding: 8px 6px; }
        .tvs .phone-label { font-size: 13px; font-weight: 800; color: #F8FAFC; letter-spacing: 0.5px; text-align: center; }
        .tvs .phone-label .role { display: block; font-size: 10px; font-weight: 600; color: #94A3B8; margin-top: 3px; letter-spacing: 1.2px; text-transform: uppercase; }
        .tvs .home-bar { position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); width: 50px; height: 4px; background: #334155; border-radius: 2px; }

        .tvs .sb-top { display: flex; justify-content: space-between; align-items: center; padding: 0 3px 5px; font-size: 8px; color: #64748B; font-weight: 700; }
        .tvs .sb-top .live { color: #10B981; display: flex; align-items: center; gap: 3px; }
        .tvs .sb-top .live::before { content: '●'; }

        /* commentator phone */
        .tvs .c-sb { display: flex; justify-content: space-between; align-items: center; padding: 3px 4px 6px; }
        .tvs .c-tm { font-size: 8px; font-weight: 900; text-align: center; }
        .tvs .c-tm.h { color: #3B82F6; }
        .tvs .c-tm.a { color: #F87171; }
        .tvs .c-tm .sq { display: inline-block; width: 6px; height: 6px; border-radius: 1px; vertical-align: middle; margin: 0 2px; }
        .tvs .c-time { font-size: 13px; font-weight: 900; color: #F59E0B; text-align: center; letter-spacing: 0.5px; }
        .tvs .c-score { font-size: 14px; font-weight: 900; color: #fff; line-height: 1; margin-top: 2px; }
        .tvs .c-score.anim { position: relative; min-width: 14px; height: 14px; display: inline-block; }
        .tvs .c-score.anim .v0, .tvs .c-score.anim .v1 { position: absolute; top: 0; left: 50%; transform: translateX(-50%); }
        .tvs .c-score.anim .v0 { animation: tvsCScoreV0 12s infinite; }
        .tvs .c-score.anim .v1 { animation: tvsCScoreV1 12s infinite; }
        @keyframes tvsCScoreV0 { 0%, 66% { opacity: 1; } 68%, 100% { opacity: 0; } }
        @keyframes tvsCScoreV1 { 0%, 66% { opacity: 0; transform: translateX(-50%) scale(0.7); } 68%, 71% { opacity: 1; transform: translateX(-50%) scale(1.6); color: #10B981; } 74%, 92% { opacity: 1; transform: translateX(-50%) scale(1); color: #fff; } 93%, 100% { opacity: 0; } }
        .tvs .c-strip { display: flex; align-items: center; padding: 3px 4px; gap: 3px; font-size: 6px; font-weight: 800; color: #fff; }
        .tvs .c-strip.top { background: linear-gradient(180deg, #991b1b, #7f1d1d); border-radius: 4px 4px 0 0; }
        .tvs .c-strip.bot { background: linear-gradient(0deg, #1e40af, #1d4ed8); border-radius: 0 0 4px 4px; }
        .tvs .c-strip .ctrl { background: rgba(0,0,0,0.35); padding: 2px 4px; border-radius: 2px; letter-spacing: 0.3px; }
        .tvs .c-strip .name { flex: 1; text-align: center; font-size: 7px; font-weight: 900; letter-spacing: 0.3px; }
        .tvs .c-field { flex: 1; min-height: 0; display: flex; }
        .tvs .c-field svg { width: 100%; height: 100%; display: block; }
        .tvs .c-recent { font-size: 7px; padding: 5px 4px 0; color: #94A3B8; font-weight: 700; display: flex; align-items: center; gap: 4px; min-height: 16px; }
        .tvs .c-recent .tag-h { background: rgba(59,130,246,0.3); color: #93C5FD; padding: 1px 4px; border-radius: 2px; font-size: 6px; font-weight: 900; }
        .tvs .c-recent .ev { color: #CBD5E1; font-weight: 800; }
        .tvs .c-recent .ev.goal { color: #10B981; }

        .tvs .ev-de, .tvs .ev-sc, .tvs .ev-goal { font-weight: 900; text-anchor: middle; opacity: 0; }
        .tvs .ev-de { fill: #F59E0B; font-size: 7px; animation: tvsFlashDE 12s infinite; }
        .tvs .ev-sc { fill: #F59E0B; font-size: 7px; animation: tvsFlashSC 12s infinite; }
        .tvs .ev-goal { fill: #10B981; font-size: 11px; animation: tvsFlashGoal 12s infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes tvsFlashDE { 0%, 27% { opacity: 0; } 29%, 37% { opacity: 1; } 40%, 100% { opacity: 0; } }
        @keyframes tvsFlashSC { 0%, 37% { opacity: 0; } 39%, 46% { opacity: 1; } 49%, 100% { opacity: 0; } }
        @keyframes tvsFlashGoal { 0%, 65% { opacity: 0; transform: scale(0.6); } 68%, 71% { opacity: 1; transform: scale(1.5); } 74%, 87% { opacity: 1; transform: scale(1); } 92%, 100% { opacity: 0; } }

        .tvs .recent-de, .tvs .recent-sc, .tvs .recent-goal { display: none; align-items: center; gap: 4px; }
        .tvs .recent-de { animation: tvsRecDE 12s infinite; }
        .tvs .recent-sc { animation: tvsRecSC 12s infinite; }
        .tvs .recent-goal { animation: tvsRecGoal 12s infinite; }
        @keyframes tvsRecDE { 0%, 28% { display: none; } 30%, 38% { display: flex; } 39%, 100% { display: none; } }
        @keyframes tvsRecSC { 0%, 38% { display: none; } 40%, 66% { display: flex; } 67%, 100% { display: none; } }
        @keyframes tvsRecGoal { 0%, 67% { display: none; } 69%, 92% { display: flex; } 93%, 100% { display: none; } }

        /* supporter phone */
        .tvs .s-hdr { background: linear-gradient(135deg, #1E293B, #0F172A); border-radius: 9px; padding: 9px 7px; margin-bottom: 7px; }
        .tvs .s-teams { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .tvs .s-badge { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; color: #fff; }
        .tvs .s-score { font-size: 20px; font-weight: 900; color: #F8FAFC; letter-spacing: 1px; position: relative; min-width: 60px; height: 22px; white-space: nowrap; }
        .tvs .s-score .v0, .tvs .s-score .v1 { position: absolute; left: 50%; top: 0; transform: translateX(-50%); }
        .tvs .s-score .v0 { animation: tvsScoreV0 12s infinite; }
        .tvs .s-score .v1 { animation: tvsScoreV1 12s infinite; }
        @keyframes tvsScoreV0 { 0%, 66% { opacity: 1; } 68%, 100% { opacity: 0; } }
        @keyframes tvsScoreV1 { 0%, 66% { opacity: 0; transform: translateX(-50%) scale(0.7); } 68%, 71% { opacity: 1; transform: translateX(-50%) scale(1.5); color: #10B981; } 74%, 92% { opacity: 1; transform: translateX(-50%) scale(1); color: #F8FAFC; } 93%, 100% { opacity: 0; } }
        .tvs .s-names { display: flex; justify-content: space-between; font-size: 8px; font-weight: 700; color: #94A3B8; margin-top: 5px; padding: 0 8px; }
        .tvs .s-live { text-align: center; font-size: 7px; color: #10B981; font-weight: 800; letter-spacing: 1px; margin-top: 4px; }
        .tvs .s-live::before { content: '● '; }
        .tvs .s-feed-h { font-size: 7px; color: #64748B; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin: 7px 3px 5px; text-align: left; }
        .tvs .s-feed { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
        .tvs .s-line { background: #1E293B; border-left: 0 solid; padding: 0 7px; border-radius: 0 5px 5px 0; opacity: 0; max-height: 0; overflow: hidden; margin-bottom: 0; }
        .tvs .s-line .t { font-size: 7px; color: #64748B; font-weight: 700; }
        .tvs .s-line .x { font-size: 8px; color: #CBD5E1; font-weight: 700; line-height: 1.3; margin-top: 2px; }
        .tvs .s-line.de   { border-color: #F59E0B; animation: tvsLineDE 12s infinite; }
        .tvs .s-line.sc   { border-color: #F59E0B; animation: tvsLineSC 12s infinite; }
        .tvs .s-line.goal { border-color: #10B981; background: rgba(16,185,129,0.12); animation: tvsLineGoal 12s infinite; }
        .tvs .s-line.goal .x { color: #F8FAFC; font-weight: 900; }
        @keyframes tvsLineDE   { 0%, 27% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border-left-width: 0; margin-bottom: 0; } 30%, 87% { max-height: 60px; opacity: 1; padding-top: 5px; padding-bottom: 5px; border-left-width: 2px; margin-bottom: 5px; } 92%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border-left-width: 0; margin-bottom: 0; } }
        @keyframes tvsLineSC   { 0%, 37% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border-left-width: 0; margin-bottom: 0; } 40%, 87% { max-height: 60px; opacity: 1; padding-top: 5px; padding-bottom: 5px; border-left-width: 2px; margin-bottom: 5px; } 92%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border-left-width: 0; margin-bottom: 0; } }
        @keyframes tvsLineGoal { 0%, 65% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border-left-width: 0; margin-bottom: 0; } 68%, 87% { max-height: 60px; opacity: 1; padding-top: 5px; padding-bottom: 5px; border-left-width: 2px; margin-bottom: 5px; } 92%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border-left-width: 0; margin-bottom: 0; } }
        .tvs .s-reacts { display: flex; gap: 5px; justify-content: center; padding: 6px 0 0; }
        .tvs .s-react { background: #1E293B; padding: 3px 8px; border-radius: 12px; font-size: 9px; color: #94A3B8; font-weight: 700; opacity: 0; }
        .tvs .s-react:nth-child(1) { animation: tvsReact 12s infinite; animation-delay: 0s; }
        .tvs .s-react:nth-child(2) { animation: tvsReact 12s infinite; animation-delay: 0.2s; }
        .tvs .s-react:nth-child(3) { animation: tvsReact 12s infinite; animation-delay: 0.4s; }
        @keyframes tvsReact { 0%, 67% { opacity: 0; transform: scale(0.6); } 70%, 73% { opacity: 1; transform: scale(1.35); color: #F59E0B; } 76%, 92% { opacity: 1; transform: scale(1); color: #94A3B8; } 93%, 100% { opacity: 0; } }

        /* coach phone */
        .tvs .k-hdr { background: linear-gradient(135deg, #1E293B, #0F172A); border-radius: 9px; padding: 8px 7px; margin-bottom: 7px; }
        .tvs .k-title { font-size: 8px; color: #F59E0B; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 3px; }
        .tvs .k-score-row { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; }
        .tvs .k-team { font-size: 8px; font-weight: 900; color: #fff; letter-spacing: 0.5px; padding: 3px 6px; border-radius: 4px; display: inline-flex; align-items: center; }
        .tvs .k-team.h { background: #1d4ed8; }
        .tvs .k-team.a { background: #dc2626; }
        .tvs .k-score { font-size: 16px; font-weight: 900; color: #F8FAFC; position: relative; min-width: 52px; text-align: center; height: 18px; white-space: nowrap; }
        .tvs .k-score .v0, .tvs .k-score .v1 { position: absolute; top: 0; left: 50%; transform: translateX(-50%); }
        .tvs .k-score .v0 { animation: tvsNumV0 12s infinite; animation-delay: -8s; }
        .tvs .k-score .v1 { color: #10B981; animation: tvsNumV1Score 12s infinite; animation-delay: -8s; }
        @keyframes tvsNumV1Score { 0%, 28% { opacity: 0; transform: translateX(-50%) scale(0.5); } 30%, 33% { opacity: 1; transform: translateX(-50%) scale(1.5); } 36%, 92% { opacity: 1; transform: translateX(-50%) scale(1); } 94%, 100% { opacity: 0; } }
        .tvs .k-stats { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
        .tvs .stat-row { display: grid; grid-template-columns: 22px 1fr 78px 1fr 22px; align-items: center; gap: 4px; min-height: 16px; padding: 2px 0; }
        .tvs .stat-row .val { font-size: 11px; font-weight: 900; position: relative; height: 14px; }
        .tvs .stat-row .val.l, .tvs .stat-row .val.r { width: 22px; }
        .tvs .stat-row .val.l { text-align: right; padding-right: 2px; }
        .tvs .stat-row .val.r { text-align: left; padding-left: 2px; }
        .tvs .stat-row .val .v0, .tvs .stat-row .val .v1 { position: absolute; top: 0; }
        .tvs .stat-row .val.l .v0, .tvs .stat-row .val.l .v1 { right: 2px; transform-origin: right center; }
        .tvs .stat-row .val.r .v0, .tvs .stat-row .val.r .v1 { left: 2px; transform-origin: left center; }
        .tvs .stat-row .val.win { color: #10B981; }
        .tvs .stat-row .val.dim { color: #64748B; }
        .tvs .stat-row .val .v0.dim { color: #64748B; }
        .tvs .stat-row .val .v1.win { color: #10B981; }
        .tvs .stat-row .lbl { font-size: 7px; font-weight: 800; color: #94A3B8; letter-spacing: 0.5px; text-transform: uppercase; text-align: center; line-height: 1.1; }
        .tvs .stat-row .bar-track { height: 4px; display: flex; align-items: center; }
        .tvs .stat-row .bar-track.left { justify-content: flex-end; }
        .tvs .stat-row .bar-track.right { justify-content: flex-start; }
        .tvs .bar-fill { height: 4px; border-radius: 2px; background: #475569; }
        .tvs .bar-fill.green-l { background: linear-gradient(90deg, #10B981, rgba(16,185,129,0.4)); }
        .tvs .bar-fill.green-r { background: linear-gradient(90deg, rgba(16,185,129,0.4), #10B981); }
        .tvs .bar-fill.dim-l { background: linear-gradient(90deg, #475569, rgba(71,85,105,0.3)); }
        .tvs .bar-fill.dim-r { background: linear-gradient(90deg, rgba(71,85,105,0.3), #475569); }
        .tvs .bar-fill.anim-tw, .tvs .bar-fill.anim-de, .tvs .bar-fill.anim-sc, .tvs .bar-fill.anim-sot, .tvs .bar-fill.anim-scg { width: 8%; background: #475569; animation-duration: 12s; animation-iteration-count: infinite; animation-fill-mode: both; animation-name: tvsBarGrow; }
        .tvs .bar-fill.anim-tw  { animation-delay: 0s; }
        .tvs .bar-fill.anim-de  { animation-delay: 0s; }
        .tvs .bar-fill.anim-sc  { animation-delay: 1.2s; }
        .tvs .bar-fill.anim-sot { animation-delay: 3.8s; }
        .tvs .bar-fill.anim-scg { animation-delay: 4.4s; animation-name: tvsBarGrowGoal; }
        @keyframes tvsBarGrow { 0%, 28% { width: 8%; background: #475569; } 30%, 34% { width: 100%; background: #10B981; } 36%, 92% { width: 100%; background: #10B981; } 95%, 100% { width: 8%; background: #475569; } }
        @keyframes tvsBarGrowGoal { 0%, 28% { width: 8%; background: #475569; } 30%, 35% { width: 100%; background: #10B981; } 37%, 92% { width: 100%; background: #10B981; } 95%, 100% { width: 8%; background: #475569; } }
        .tvs .r-tw  .val.l .v0 { animation: tvsStatV0 12s infinite 0s; }
        .tvs .r-tw  .val.l .v1 { animation: tvsStatV1 12s infinite 0s; opacity: 0; }
        .tvs .r-de  .val.l .v0 { animation: tvsStatV0 12s infinite 0s; }
        .tvs .r-de  .val.l .v1 { animation: tvsStatV1 12s infinite 0s; opacity: 0; }
        .tvs .r-sc  .val.l .v0 { animation: tvsStatV0 12s infinite 1.2s; }
        .tvs .r-sc  .val.l .v1 { animation: tvsStatV1 12s infinite 1.2s; opacity: 0; }
        .tvs .r-sot .val.l .v0 { animation: tvsStatV0 12s infinite 3.8s; }
        .tvs .r-sot .val.l .v1 { animation: tvsStatV1 12s infinite 3.8s; opacity: 0; }
        .tvs .r-scg .val.l .v0 { animation: tvsStatV0 12s infinite 4.4s; }
        .tvs .r-scg .val.l .v1 { animation: tvsStatV1Goal 12s infinite 4.4s; opacity: 0; }
        @keyframes tvsStatV0 { 0%, 28% { opacity: 1; } 30%, 93% { opacity: 0; } 95%, 100% { opacity: 1; } }
        @keyframes tvsStatV1 { 0%, 28% { opacity: 0; transform: scale(0.5); } 30%, 33% { opacity: 1; transform: scale(1.7); } 36%, 92% { opacity: 1; transform: scale(1); } 94%, 100% { opacity: 0; } }
        @keyframes tvsStatV1Goal { 0%, 28% { opacity: 0; transform: scale(0.5); } 30%, 34% { opacity: 1; transform: scale(2); } 37%, 92% { opacity: 1; transform: scale(1); } 94%, 100% { opacity: 0; } }
        @keyframes tvsNumV0 { 0%, 28% { opacity: 1; } 30%, 93% { opacity: 0; } 95%, 100% { opacity: 1; } }
        .tvs .k-insights { margin-top: 6px; }
        .tvs .k-insights-h { font-size: 7px; color: #64748B; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px; padding-left: 2px; }
        .tvs .k-insight { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.35); border-left: 3px solid #10B981; padding: 0 8px; border-radius: 0 5px 5px 0; max-height: 0; opacity: 0; overflow: hidden; margin-bottom: 0; }
        .tvs .k-insight .ih { font-size: 7.5px; font-weight: 900; color: #F8FAFC; line-height: 1.2; }
        .tvs .k-insight .ib { font-size: 6.5px; color: #94A3B8; line-height: 1.4; margin-top: 2px; }
        .tvs .k-insight .ib b { color: #10B981; font-weight: 800; }
        .tvs .k-insight.ki-1 { animation: tvsKi1 12s infinite; }
        .tvs .k-insight.ki-2 { animation: tvsKi2 12s infinite; }
        .tvs .k-insight.ki-3 { animation: tvsKi3 12s infinite; }
        @keyframes tvsKi1 { 0%, 27% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 30%, 87% { max-height: 40px; opacity: 1; padding-top: 5px; padding-bottom: 5px; margin-bottom: 4px; } 92%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } }
        @keyframes tvsKi2 { 0%, 65% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 68%, 87% { max-height: 40px; opacity: 1; padding-top: 5px; padding-bottom: 5px; margin-bottom: 4px; } 92%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } }
        @keyframes tvsKi3 { 0%, 75% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 78%, 87% { max-height: 40px; opacity: 1; padding-top: 5px; padding-bottom: 5px; margin-bottom: 4px; } 92%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } }
      `}</style>

      <div className="scene">
        <div className="live-pill"><span className="d" />LIVE SIMULATION · 12 SEC LOOP</div>
        <div className="scene-eyebrow">From the field to your screen</div>
        <h1 className="scene-title">One play. <span className="accent">Three views.</span></h1>
        <p className="scene-sub">A short corner unfolds. Watch the commentator record it, the supporter follow the story, and the coach get the insight — all from the same play.</p>

        <div className="phones">

          {/* COMMENTATOR */}
          <div className="phone-wrap">
            <div className="phone">
              <div className="notch" />
              <div className="scr">
                <div className="sb-top"><span>9:41</span><span className="live">REC</span></div>
                <div className="c-sb">
                  <div className="c-tm h">
                    <div><span className="sq" style={{ background: '#3B82F6' }} />OAK</div>
                    <div className="c-score anim"><span className="v0">0</span><span className="v1">1</span></div>
                  </div>
                  <div className="c-time">00:42</div>
                  <div className="c-tm a">
                    <div>MEA<span className="sq" style={{ background: '#F87171' }} /></div>
                    <div className="c-score">0</div>
                  </div>
                </div>
                <div className="c-strip top">
                  <span className="ctrl">DEAD</span><span className="ctrl">◂LC</span>
                  <span className="name">MEADOWS HIGH</span>
                  <span className="ctrl">LC▸</span><span className="ctrl">DEAD</span>
                </div>
                <div className="c-field">
                  <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid meet">
                    <rect x="0" y="0" width="100" height="130" fill="#14532d" />
                    <rect x="0"    y="0"    width="33.3" height="32.5" fill="#16a34a" opacity="0.08" />
                    <rect x="66.7" y="0"    width="33.3" height="32.5" fill="#16a34a" opacity="0.08" />
                    <rect x="33.3" y="32.5" width="33.4" height="32.5" fill="#16a34a" opacity="0.08" />
                    <rect x="0"    y="65"   width="33.3" height="32.5" fill="#16a34a" opacity="0.08" />
                    <rect x="66.7" y="65"   width="33.3" height="32.5" fill="#16a34a" opacity="0.08" />
                    <rect x="33.3" y="97.5" width="33.4" height="32.5" fill="#16a34a" opacity="0.08" />
                    <path d="M 35 0 L 65 0 A 15 15 0 0 1 35 0 Z" fill="#B91C1C" fillOpacity="0.55" stroke="#FCA5A5" strokeWidth="1.3" />
                    <path d="M 35 130 L 65 130 A 15 15 0 0 0 35 130 Z" fill="#1E40AF" fillOpacity="0.6" stroke="#93C5FD" strokeWidth="1.3" />
                    <line x1="33.3" y1="0" x2="33.3" y2="130" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.3" />
                    <line x1="66.7" y1="0" x2="66.7" y2="130" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.3" />
                    <line x1="0" y1="32.5" x2="100" y2="32.5" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.28" />
                    <line x1="0" y1="65"   x2="100" y2="65"   stroke="#fff" strokeWidth="0.55" strokeOpacity="0.4" />
                    <line x1="0" y1="97.5" x2="100" y2="97.5" stroke="#fff" strokeWidth="0.35" strokeOpacity="0.28" />
                    <circle cx="50" cy="65" r="1" fill="#fff" opacity="0.55" />

                    {/* ball glow */}
                    <circle r="6" fill="#F59E0B">
                      <animate attributeName="cx" dur="12s" repeatCount="indefinite"
                        keyTimes="0;0.02;0.05;0.14;0.22;0.29;0.42;0.47;0.56;0.62;0.67;0.87;0.92;1"
                        values="50;50;50;50;28;50;50;25;28;50;50;50;50;50" />
                      <animate attributeName="cy" dur="12s" repeatCount="indefinite"
                        keyTimes="0;0.02;0.05;0.14;0.22;0.29;0.42;0.47;0.56;0.62;0.67;0.87;0.92;1"
                        values="97.5;97.5;97.5;65;42;20;20;5;10;15;3;3;3;3" />
                      <animate attributeName="opacity" dur="12s" repeatCount="indefinite"
                        keyTimes="0;0.02;0.05;0.14;0.22;0.29;0.42;0.47;0.56;0.62;0.67;0.87;0.92;1"
                        values="0;0;0.4;0.4;0.4;0.45;0.45;0.5;0.55;0.55;0.75;0.75;0;0" />
                    </circle>
                    {/* ball */}
                    <circle r="2.8" fill="#fff">
                      <animate attributeName="cx" dur="12s" repeatCount="indefinite"
                        keyTimes="0;0.02;0.05;0.14;0.22;0.29;0.42;0.47;0.56;0.62;0.67;0.87;0.92;1"
                        values="50;50;50;50;28;50;50;25;28;50;50;50;50;50" />
                      <animate attributeName="cy" dur="12s" repeatCount="indefinite"
                        keyTimes="0;0.02;0.05;0.14;0.22;0.29;0.42;0.47;0.56;0.62;0.67;0.87;0.92;1"
                        values="97.5;97.5;97.5;65;42;20;20;5;10;15;3;3;3;3" />
                      <animate attributeName="opacity" dur="12s" repeatCount="indefinite"
                        keyTimes="0;0.02;0.05;0.14;0.22;0.29;0.42;0.47;0.56;0.62;0.67;0.87;0.92;1"
                        values="0;0;1;1;1;1;1;1;1;1;1;1;0;0" />
                    </circle>

                    {/* event flashes */}
                    <text className="ev-de" x="50" y="38">D ENTRY</text>
                    <text className="ev-sc" x="50" y="38">SHORT CORNER</text>
                    <text className="ev-goal" x="50" y="24">GOAL!</text>
                  </svg>
                </div>
                <div className="c-strip bot">
                  <span className="ctrl">DEAD</span><span className="ctrl">◂LC</span>
                  <span className="name">OAKTREE COLLEGE</span>
                  <span className="ctrl">LC▸</span><span className="ctrl">DEAD</span>
                </div>
                <div className="c-recent">
                  <span className="recent-de"><span className="tag-h">OAK</span><span className="ev">D Entry</span></span>
                  <span className="recent-sc"><span className="tag-h">OAK</span><span className="ev">Short Corner</span></span>
                  <span className="recent-goal"><span className="tag-h">OAK</span><span className="ev goal">GOAL!</span></span>
                </div>
              </div>
              <div className="home-bar" />
            </div>
            <div className="phone-label">Commentator<span className="role">Records the play</span></div>
          </div>

          {/* SUPPORTER */}
          <div className="phone-wrap">
            <div className="phone">
              <div className="notch" />
              <div className="scr">
                <div className="sb-top"><span>9:41</span><span className="live">LIVE</span></div>
                <div className="s-hdr">
                  <div className="s-teams">
                    <div className="s-badge" style={{ background: '#1d4ed8' }}>OC</div>
                    <div className="s-score">
                      <span className="v0">0–0</span>
                      <span className="v1">1–0</span>
                    </div>
                    <div className="s-badge" style={{ background: '#dc2626' }}>MH</div>
                  </div>
                  <div className="s-names"><span>Oaktree</span><span>Meadows</span></div>
                  <div className="s-live">LIVE · Q1 · 0:42</div>
                </div>
                <div className="s-feed-h">Commentary</div>
                <div className="s-feed">
                  <div className="s-line goal">
                    <div className="t">0:58</div>
                    <div className="x">GOAL! Oaktree convert the corner</div>
                  </div>
                  <div className="s-line sc">
                    <div className="t">0:42</div>
                    <div className="x">Short Corner awarded to Oaktree</div>
                  </div>
                  <div className="s-line de">
                    <div className="t">0:38</div>
                    <div className="x">Oaktree enters the D from the left</div>
                  </div>
                </div>
                <div className="s-reacts">
                  <span className="s-react">🔥 12</span>
                  <span className="s-react">👏 8</span>
                  <span className="s-react">⚡ 5</span>
                </div>
              </div>
              <div className="home-bar" />
            </div>
            <div className="phone-label">Supporter<span className="role">Follows the story</span></div>
          </div>

          {/* COACH */}
          <div className="phone-wrap">
            <div className="phone">
              <div className="notch" />
              <div className="scr">
                <div className="sb-top"><span>9:41</span><span className="live">LIVE</span></div>
                <div className="k-hdr">
                  <div className="k-title">Live stats · 1st XI</div>
                  <div className="k-score-row">
                    <span className="k-team h">OAK</span>
                    <span className="k-score">
                      <span className="v0">0–0</span>
                      <span className="v1">1–0</span>
                    </span>
                    <span className="k-team a">MEA</span>
                  </div>
                </div>
                <div className="k-stats">
                  <div className="stat-row">
                    <span className="val l win">56%</span>
                    <div className="bar-track left"><div className="bar-fill green-l" style={{ width: '100%' }} /></div>
                    <span className="lbl">Possession</span>
                    <div className="bar-track right"><div className="bar-fill dim-r" style={{ width: '79%' }} /></div>
                    <span className="val r dim">44%</span>
                  </div>
                  <div className="stat-row r-tw">
                    <span className="val l"><span className="v0 dim">0</span><span className="v1 win">1</span></span>
                    <div className="bar-track left"><div className="bar-fill anim-tw" /></div>
                    <span className="lbl">Turnovers Won</span>
                    <div className="bar-track right"><div className="bar-fill dim-r" style={{ width: '8%' }} /></div>
                    <span className="val r dim">0</span>
                  </div>
                  <div className="stat-row r-de">
                    <span className="val l"><span className="v0 dim">0</span><span className="v1 win">1</span></span>
                    <div className="bar-track left"><div className="bar-fill anim-de" /></div>
                    <span className="lbl">D Entries</span>
                    <div className="bar-track right"><div className="bar-fill dim-r" style={{ width: '8%' }} /></div>
                    <span className="val r dim">0</span>
                  </div>
                  <div className="stat-row r-sc">
                    <span className="val l"><span className="v0 dim">0</span><span className="v1 win">1</span></span>
                    <div className="bar-track left"><div className="bar-fill anim-sc" /></div>
                    <span className="lbl">Short Corners</span>
                    <div className="bar-track right"><div className="bar-fill dim-r" style={{ width: '8%' }} /></div>
                    <span className="val r dim">0</span>
                  </div>
                  <div className="stat-row r-sot">
                    <span className="val l"><span className="v0 dim">0</span><span className="v1 win">1</span></span>
                    <div className="bar-track left"><div className="bar-fill anim-sot" /></div>
                    <span className="lbl">Shots on Target</span>
                    <div className="bar-track right"><div className="bar-fill dim-r" style={{ width: '8%' }} /></div>
                    <span className="val r dim">0</span>
                  </div>
                  <div className="stat-row r-scg">
                    <span className="val l"><span className="v0 dim">0</span><span className="v1 win">1</span></span>
                    <div className="bar-track left"><div className="bar-fill anim-scg" /></div>
                    <span className="lbl">SC Goals</span>
                    <div className="bar-track right"><div className="bar-fill dim-r" style={{ width: '8%' }} /></div>
                    <span className="val r dim">0</span>
                  </div>
                </div>
                <div className="k-insights">
                  <div className="k-insights-h">Coach Insights</div>
                  <div className="k-insight ki-1">
                    <div className="ih">Wing pressure building</div>
                    <div className="ib">3rd left-side attack this half</div>
                  </div>
                  <div className="k-insight ki-2">
                    <div className="ih">5th SC · 3rd converted</div>
                    <div className="ib"><b>60%</b> conversion · top 10 avg <b>34%</b></div>
                  </div>
                  <div className="k-insight ki-3">
                    <div className="ih">Maintain momentum</div>
                    <div className="ib">Hold shape · keep pressing</div>
                  </div>
                </div>
              </div>
              <div className="home-bar" />
            </div>
            <div className="phone-label">Coach<span className="role">Gets the insight</span></div>
          </div>

        </div>
      </div>
    </div>
  );
}
