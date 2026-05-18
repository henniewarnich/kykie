import { useState, useRef } from 'react';
import { BREAK_FORMATS, MATCH_TYPES } from '../utils/constants.js';
import { S, theme } from '../utils/styles.js';
import NavLogo from '../components/NavLogo.jsx';
import LiveModeChooser from '../components/LiveModeChooser.jsx';
import { teamColor, teamDisplayName, teamInitial, teamMatchesSearch, teamShortName } from '../utils/teams.js';

function isDuplicateMatch(games, homeId, awayId, date) {
  const dateStr = new Date(date).toISOString().slice(0, 10);
  return games?.some(g => {
    const gDate = new Date(g.date || g.match_date || 0).toISOString().slice(0, 10);
    const gHome = g.teams?.home?.id || g.home_team_id;
    const gAway = g.teams?.away?.id || g.away_team_id;
    return gDate === dateStr && (
      (gHome === homeId && gAway === awayId) ||
      (gHome === awayId && gAway === homeId)
    );
  });
}

const MODES = [
  { id: "full", icon: "🏑", title: "Live Match", desc: "Live or Live Pro — choose your mode" },
  { id: "quick", icon: "⚡", title: "Quick Score", desc: "Just teams, date & final score" },
  { id: "import", icon: "📦", title: "JSON Import", desc: "Load an exported match file" },
  { id: "demo", icon: "🎮", title: "Demo Match", desc: "Try the recorder, data discarded" },
];

// Reusable team picker with its own search
function TeamPickerWithSearch({ label, teams, selected, onSelect, otherId }) {
  const [search, setSearch] = useState("");
  const filtered = search.trim() ? teams.filter(t => teamMatchesSearch(t, search)) : teams;
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label}>{label}</label>
      <input style={{ ...S.input, fontSize: 11, marginBottom: 6, padding: "8px 10px" }} value={search}
        onChange={e => setSearch(e.target.value)} placeholder={`🔍 Search ${label.toLowerCase()}...`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 140, overflowY: "auto" }}>
        {filtered.map(t => {
          const isSel = selected?.id === t.id;
          const isOth = t.id === otherId;
          return (
            <button key={t.id} onClick={() => !isOth && onSelect(t)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8,
              border: isSel ? `2px solid ${teamColor(t)}` : `1px solid ${theme.border}44`,
              background: isSel ? teamColor(t) + "22" : theme.surface,
              cursor: isOth ? "not-allowed" : "pointer", opacity: isOth ? 0.3 : 1,
            }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, background: teamColor(t), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{teamInitial(t)}</div>
              <div style={{ fontWeight: 600, fontSize: 11, color: theme.text }}>{teamDisplayName(t)}</div>
              {isSel && <div style={{ marginLeft: "auto", fontSize: 11 }}>✓</div>}
            </button>
          );
        })}
        {filtered.length === 0 && <div style={{ fontSize: 10, color: theme.textDim, padding: 8, textAlign: "center" }}>No teams found</div>}
      </div>
    </div>
  );
}

export default function MatchSetupScreen({ teams, games, onStart, onImportGame, onBack, onManageTeams, currentUser }) {
  const [mode, setMode] = useState(null);
  const isAdmin = currentUser?.role === 'admin';
  const modes = isAdmin ? MODES : MODES.filter(m => m.id !== 'import');
  const [liveMode, setLiveMode] = useState(null); // 'lite' | 'pro'
  const [showChooser, setShowChooser] = useState(false);

  const handleModeClick = (id) => {
    if (id === 'full') {
      setShowChooser(true);
    } else {
      setMode(id);
    }
  };

  const handleLiveModeChosen = (chosenMode) => {
    setLiveMode(chosenMode);
    setShowChooser(false);
    setMode('full');
  };

  if (!mode) {
    return (
      <div style={S.app}>
        <div style={S.page}>
          <div style={{ fontSize: 12, color: theme.textDim, marginBottom: 12, textAlign: "center" }}>Choose how to create a match</div>
          {modes.map(m => (
            <div key={m.id} style={{ ...S.card, display: "flex", alignItems: "center", gap: 14 }} onClick={() => handleModeClick(m.id)}>
              <div style={{ fontSize: 28 }}>{m.icon}</div>
              <div><div style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</div><div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>{m.desc}</div></div>
            </div>
          ))}
        </div>
        <LiveModeChooser show={showChooser} onSelect={handleLiveModeChosen} onClose={() => setShowChooser(false)} />
      </div>
    );
  }

  if (mode === "full") return <FullMatchSetup teams={teams} games={games} onStart={onStart} onBack={() => setMode(null)} onManageTeams={onManageTeams} liveMode={liveMode} />;
  if (mode === "quick") return <QuickScoreSetup teams={teams} games={games} onSave={onImportGame} onBack={() => setMode(null)} onManageTeams={onManageTeams} />;
  if (mode === "import") return <JsonImportSetup onImport={onImportGame} onBack={() => setMode(null)} />;
  if (mode === "demo") return <DemoSetup onStart={onStart} onBack={() => setMode(null)} />;
}

// ═══ FULL MATCH ═══
function FullMatchSetup({ teams, games, onStart, onBack, onManageTeams, liveMode }) {
  const navTitle = liveMode === 'lite' ? 'Live Match' : liveMode === 'pro' ? 'Live Pro Match' : 'Live Match';
  const [setupHome, setSetupHome] = useState(null);
  const [setupAway, setSetupAway] = useState(null);
  const [matchLength, setMatchLength] = useState("60");
  const [breakFormat, setBreakFormat] = useState("quarters");
  const [matchType, setMatchType] = useState("league");
  const [venue, setVenue] = useState("");
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 10));

  const canStart = setupHome && setupAway && setupHome.id !== setupAway?.id && parseInt(matchLength) > 0;
  const ml = parseInt(matchLength) || 60;
  const duplicate = setupHome && setupAway ? isDuplicateMatch(games, setupHome.id, setupAway.id, matchDate) : false;

  if (teams.length < 2) {
    return (
      <div style={S.app}>
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}><button onClick={onBack} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button><div style={{ fontSize: 14, fontWeight: 700 }}>{navTitle}</div></div>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 14, color: theme.textMuted, marginBottom: 16 }}>You need at least 2 teams</div>
          <button style={S.btn(theme.accent, theme.bg)} onClick={onManageTeams}>Manage Teams</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}><button onClick={onBack} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button><div style={{ fontSize: 14, fontWeight: 700 }}>{navTitle}</div></div>
      <div style={S.page}>
        <TeamPickerWithSearch label="Home Team" teams={teams} selected={setupHome} onSelect={setSetupHome} otherId={setupAway?.id} />
        <TeamPickerWithSearch label="Away Team" teams={teams} selected={setupAway} onSelect={setSetupAway} otherId={setupHome?.id} />

        <div style={{ background: theme.surface, borderRadius: 12, padding: 14, marginBottom: 16, border: `1px solid ${theme.border}` }}>
          <label style={{ ...S.label, marginBottom: 10 }}>Match Settings</label>

          {/* Match Length — free text input with quick buttons */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Match Length (minutes)</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" style={{ ...S.input, width: 70, textAlign: "center", fontSize: 16, fontWeight: 700, padding: "8px" }}
                value={matchLength} onChange={e => setMatchLength(e.target.value)} min="1" max="120" />
              {[20, 25, 30, 40, 60].map(m => (
                <button key={m} onClick={() => setMatchLength(String(m))} style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: ml === m ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  background: ml === m ? theme.accent + "22" : theme.bg,
                  color: ml === m ? theme.accent : theme.textMuted, cursor: "pointer",
                }}>{m}</button>
              ))}
            </div>
          </div>

          {/* Break Format */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Break Format</div>
            <div style={{ display: "flex", gap: 6 }}>
              {BREAK_FORMATS.map(bf => (
                <button key={bf.id} onClick={() => setBreakFormat(bf.id)} style={{
                  flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: breakFormat === bf.id ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  background: breakFormat === bf.id ? theme.accent + "22" : theme.bg,
                  color: breakFormat === bf.id ? theme.accent : theme.textMuted, cursor: "pointer",
                }}>{bf.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: theme.textDim, marginTop: 4 }}>
              {breakFormat === "quarters" ? `4 × ${Math.floor(ml / 4)} min periods`
                : breakFormat === "halves" ? `2 × ${Math.floor(ml / 2)} min halves`
                : `${ml} min continuous`}
            </div>
          </div>

          {/* Match Type */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Match Type</div>
            <div style={{ display: "flex", gap: 6 }}>
              {MATCH_TYPES.map(mt => (
                <button key={mt.id} onClick={() => setMatchType(mt.id)} style={{
                  flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: matchType === mt.id ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  background: matchType === mt.id ? theme.accent + "22" : theme.bg,
                  color: matchType === mt.id ? theme.accent : theme.textMuted, cursor: "pointer",
                }}>{mt.label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Venue</div>
            <input style={{ ...S.input, fontSize: 12 }} value={venue} onChange={e => setVenue(e.target.value)} placeholder="e.g. Paarl Girls High" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Date</div>
            <input type="date" style={{ ...S.input, fontSize: 12 }} value={matchDate} onChange={e => setMatchDate(e.target.value)} />
          </div>
        </div>

        {duplicate && (
          <div style={{ background: "#EF444422", border: "1px solid #EF444444", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: "#EF4444", fontWeight: 600, textAlign: "center" }}>
            A match between these teams on this date already exists
          </div>
        )}

        <button style={{ ...S.btn(theme.accent, theme.bg), opacity: canStart && !duplicate ? 1 : 0.4 }}
          onClick={() => canStart && !duplicate && onStart({ home: setupHome, away: setupAway, matchLength: ml, breakFormat, matchType, venue: venue.trim(), date: matchDate, liveMode })}>
          🏑 Start Match
        </button>
      </div>
    </div>
  );
}

// ═══ QUICK SCORE ═══
function QuickScoreSetup({ teams, games, onSave, onBack, onManageTeams }) {
  const [setupHome, setSetupHome] = useState(null);
  const [setupAway, setSetupAway] = useState(null);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [venue, setVenue] = useState("");
  const [matchType, setMatchType] = useState("league");

  const canSave = setupHome && setupAway && setupHome.id !== setupAway?.id;
  const duplicate = setupHome && setupAway ? isDuplicateMatch(games, setupHome.id, setupAway.id, matchDate) : false;

  if (teams.length < 2) {
    return (
      <div style={S.app}>
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}><button onClick={onBack} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button><div style={{ fontSize: 14, fontWeight: 700 }}>Quick Score</div></div>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 14, color: theme.textMuted, marginBottom: 16 }}>You need at least 2 teams</div>
          <button style={S.btn(theme.accent, theme.bg)} onClick={onManageTeams}>Manage Teams</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}><button onClick={onBack} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button><div style={{ fontSize: 14, fontWeight: 700 }}>Quick Score</div></div>
      <div style={S.page}>
        <TeamPickerWithSearch label="Home Team" teams={teams} selected={setupHome} onSelect={setSetupHome} otherId={setupAway?.id} />
        <TeamPickerWithSearch label="Away Team" teams={teams} selected={setupAway} onSelect={setSetupAway} otherId={setupHome?.id} />

        {canSave && (
          <div style={{ background: theme.surface, borderRadius: 12, padding: 16, marginBottom: 16, border: `1px solid ${theme.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
              {[["home", setupHome, homeScore, setHomeScore], ["away", setupAway, awayScore, setAwayScore]].map(([key, t, sc, setSc]) => (
                <div key={key} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: teamColor(t), marginBottom: 6 }}>{teamDisplayName(t)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setSc(Math.max(0, sc - 1))} style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, fontSize: 18, fontWeight: 700, cursor: "pointer" }}>−</button>
                    <div style={{ fontSize: 28, fontWeight: 800, color: teamColor(t), minWidth: 36, textAlign: "center" }}>{sc}</div>
                    <button onClick={() => setSc(sc + 1)} style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, fontSize: 18, fontWeight: 700, cursor: "pointer" }}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Match Type</div>
          <div style={{ display: "flex", gap: 6 }}>
            {MATCH_TYPES.map(mt => (
              <button key={mt.id} onClick={() => setMatchType(mt.id)} style={{
                flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                border: matchType === mt.id ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                background: matchType === mt.id ? theme.accent + "22" : theme.bg,
                color: matchType === mt.id ? theme.accent : theme.textMuted, cursor: "pointer",
              }}>{mt.label}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Venue</div>
          <input style={{ ...S.input, fontSize: 12 }} value={venue} onChange={e => setVenue(e.target.value)} placeholder="e.g. Paarl Girls High" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Date</div>
          <input type="date" style={{ ...S.input, fontSize: 12 }} value={matchDate} onChange={e => setMatchDate(e.target.value)} />
        </div>

        {duplicate && (
          <div style={{ background: "#EF444422", border: "1px solid #EF444444", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: "#EF4444", fontWeight: 600, textAlign: "center" }}>
            A match between these teams on this date already exists
          </div>
        )}

        <button style={{ ...S.btn(theme.accent, theme.bg), opacity: canSave && !duplicate ? 1 : 0.4 }}
          onClick={() => canSave && !duplicate && onSave({ id: Date.now().toString(), date: new Date(matchDate).toISOString(), teams: { home: setupHome, away: setupAway }, events: [], duration: 0, homeScore, awayScore, venue: venue.trim(), matchType, quickScore: true })}>
          💾 Save Match
        </button>
      </div>
    </div>
  );
}

// ═══ JSON IMPORT ═══
function JsonImportSetup({ onImport, onBack }) {
  const [imported, setImported] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.teams?.home?.name || !data.teams?.away?.name) { setError("Invalid: missing team data"); return; }
        if (!data.events || !Array.isArray(data.events)) { setError("Invalid: missing events"); return; }
        setImported(data);
      } catch { setError("Could not parse JSON file"); }
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!imported) return;
    onImport({
      id: Date.now().toString(),
      date: imported.date || new Date().toISOString(),
      teams: {
        home: { name: teamShortName(imported.teams.home), color: imported.teamColor(teams.home) || "#1D4ED8" },
        away: { name: teamShortName(imported.teams.away), color: imported.teamColor(teams.away) || "#DC2626" },
      },
      events: imported.events || [], duration: imported.duration || 0,
      homeScore: imported.score?.home ?? 0, awayScore: imported.score?.away ?? 0,
      matchLength: imported.matchLength || null, breakFormat: imported.breakFormat || null,
      venue: imported.venue || null, matchType: imported.matchType || null, imported: true,
    });
  };

  const real = imported?.events?.filter(e => e.team !== "commentary" && e.team !== "meta") || [];

  return (
    <div style={S.app}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}><button onClick={onBack} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button><div style={{ fontSize: 14, fontWeight: 700 }}>JSON Import</div></div>
      <div style={S.page}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 13, color: theme.textMuted }}>Select an exported match JSON file</div>
        </div>
        <input ref={fileRef} type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} />
        <button onClick={() => fileRef.current?.click()} style={{ ...S.btn(theme.info, "#fff"), marginBottom: 12 }}>📂 Choose File</button>
        {error && <div style={{ background: theme.danger + "22", borderRadius: 8, padding: 12, marginBottom: 12, color: theme.danger, fontSize: 12 }}>{error}</div>}
        {imported && (
          <div style={{ background: theme.surface, borderRadius: 12, padding: 14, marginBottom: 16, border: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Match Preview</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ color: imported.teamColor(teams.home) || theme.text, fontWeight: 700, fontSize: 14 }}>{teamShortName(imported.teams.home)}</span>
              <span style={{ fontSize: 20, fontWeight: 800 }}>{imported.score?.home ?? "?"} - {imported.score?.away ?? "?"}</span>
              <span style={{ color: imported.teamColor(teams.away) || theme.text, fontWeight: 700, fontSize: 14 }}>{teamShortName(imported.teams.away)}</span>
            </div>
            <div style={{ fontSize: 10, color: theme.textDim, textAlign: "center" }}>
              {imported.date ? new Date(imported.date).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "Unknown date"}
              {" · "}{real.length} events
              {imported.duration ? ` · ${Math.floor(imported.duration / 60)}m` : ""}
              {imported.reconstructed && " · 🔄 Reconstructed"}
            </div>
            <button style={{ ...S.btn(theme.accent, theme.bg), marginTop: 12 }} onClick={handleImport}>✅ Import Match</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ DEMO ═══
function DemoSetup({ onStart, onBack }) {
  return (
    <div style={S.app}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}><button onClick={onBack} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button><div style={{ fontSize: 14, fontWeight: 700 }}>Demo Match</div></div>
      <div style={S.page}>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎮</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Try the Field Recorder</div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Demo Lions 🔵 vs Demo Eagles 🔴</div>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 24 }}>10 minute match · No breaks · Data discarded on exit</div>
          <button style={S.btn(theme.accent, theme.bg)} onClick={() => {
            onStart({ home: { id: "demo-home", color: "#1D4ED8", short_name: "Demo Lions", sport: "Hockey", age_group: "1st" }, away: { id: "demo-away", color: "#DC2626", short_name: "Demo Eagles", sport: "Hockey", age_group: "1st" }, matchLength: 10, breakFormat: "none", venue: "Demo Pitch", date: new Date().toISOString().slice(0, 10), isDemo: true });
          }}>🏑 Start Demo</button>
        </div>
      </div>
    </div>
  );
}
