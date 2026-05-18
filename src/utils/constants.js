export const APP_VERSION = "7.24.16";

export const ZONES = [
  { id: "opp_quarter", label: "Opp Quarter" },
  { id: "opp_mid", label: "Opp Midfield" },
  { id: "own_mid", label: "Own Midfield" },
  { id: "own_quarter", label: "Own Quarter" },
];

export const POSITIONS = ["left", "centre", "right"];

export const D_OPTIONS = [
  { id: "shot_on", label: "Shot on Goal", icon: "◉", color: "#10B981" },
  { id: "shot_off", label: "Shot Off Target", icon: "○", color: "#6B7280" },
  { id: "goal", label: "Goal!", icon: "⚽", color: "#F59E0B" },
  { id: "short_corner", label: "Short Corner", icon: "◧", color: "#8B5CF6" },
  { id: "long_corner", label: "Long Corner", icon: "◨", color: "#EC4899" },
  { id: "penalty", label: "Penalty", icon: "⬡", color: "#EF4444" },
  { id: "lost_poss", label: "Lost Possession", icon: "✕", color: "#F97316" },
  { id: "dead_ball", label: "Dead Ball", icon: "⊘", color: "#94A3B8" },
];

export const PAUSE_REASONS = [
  { id: "injury", label: "Injury", icon: "🏥" },
  { id: "quarter_break", label: "Quarter Break", icon: "🔄" },
  { id: "half_time", label: "Half Time", icon: "⏱" },
  { id: "weather", label: "Weather", icon: "🌧" },
  { id: "other", label: "Other", icon: "📋" },
];

export const TEAM_COLORS = [
  { id: "blue", hex: "#1D4ED8" },
  { id: "red", hex: "#DC2626" },
  { id: "green", hex: "#16A34A" },
  { id: "purple", hex: "#7C3AED" },
  { id: "orange", hex: "#EA580C" },
  { id: "teal", hex: "#0D9488" },
  { id: "pink", hex: "#DB2777" },
  { id: "yellow", hex: "#CA8A04" },
  { id: "slate", hex: "#475569" },
  { id: "indigo", hex: "#4338CA" },
];

export const BREAK_FORMATS = [
  { id: "quarters", label: "Quarters", periods: 4 },
  { id: "halves", label: "Halftime Only", periods: 2 },
  { id: "none", label: "No Breaks", periods: 1 },
];

export const MATCH_TYPES = [
  { id: "league", label: "League" },
  { id: "tournament", label: "Tournament" },
  { id: "friendly", label: "Friendly" },
];

export const GRASS_A = "#116B35";
export const GRASS_B = "#138A3F";

// Key events shown in filtered log views
export const KEY_EVENTS = [
  "D Entry", "Goal!", "Goal! (SC)", "Shot on Goal", "Shot Off Target",
  "Short Corner", "Long Corner", "Penalty", "Turnover Won",
  "Poss Conceded", "Sideline Out", "Ball Dead", "Start",
];

// Events visible to public viewers (trimmed supporter feed — no firehose)
// Keep: match starts, D-Entry + its outcomes (shots/SC/goals), penalties, cards, shootouts.
// Drop: Dead Ball, Long Corner, Lost Possession, Turnover Won, Poss Conceded, Sideline Out.
export const PUBLIC_EVENTS = [
  "Start", "Goal!", "Goal! (SC)", "Short Corner",
  "D Entry", "Shot on Goal", "Shot Off Target",
  "Penalty", "Penalty Stroke", "Penalty Kick",
  "Green Card", "Yellow Card",
  "Shootout Start", "Shootout End",
];
