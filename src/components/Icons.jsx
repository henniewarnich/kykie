// Centralized SVG icons — no emoji, pure SVG
// Usage: <Icon name="calendar" size={20} color="#F59E0B" />
//        <Icon name="home" size={22} filled />

const paths = {
  home: {
    stroke: <><path d="M3 9.5L12 2l9 7.5V20a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    filled: <><path d="M3 9.5L12 2l9 7.5V20a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5z" fill="currentColor"/><rect x="9" y="12" width="6" height="10" rx="1" fill="#0B0F1A"/></>,
  },
  scoreboard: {
    stroke: <><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="12" y1="9" x2="12" y2="21"/></>,
    filled: <><rect x="2" y="3" width="20" height="18" rx="2" fill="currentColor" opacity="0.2"/><rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="12" y1="9" x2="12" y2="21"/></>,
  },
  teams: {
    stroke: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
    filled: <><circle cx="9" cy="7" r="4" fill="currentColor"/><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" fill="currentColor" opacity="0.3"/><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
  },
  trophy: {
    stroke: <><path d="M6 9H4.5a2.5 2.5 0 010-5C7 4 7 7 7 7"/><path d="M18 9h1.5a2.5 2.5 0 000-5C17 4 17 7 17 7"/><rect x="5" y="9" width="14" height="12" rx="2"/><path d="M12 9v12"/></>,
    filled: <><path d="M6 9H4.5a2.5 2.5 0 010-5C7 4 7 7 7 7"/><path d="M18 9h1.5a2.5 2.5 0 000-5C17 4 17 7 17 7"/><rect x="5" y="9" width="14" height="12" rx="2" fill="currentColor" opacity="0.2"/><rect x="5" y="9" width="14" height="12" rx="2"/><path d="M12 9v12"/></>,
  },
  more_dots: {
    stroke: <><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/></>,
  },
  calendar: {
    stroke: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  },
  bolt: {
    stroke: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
  },
  buildings: {
    stroke: <><rect x="3" y="8" width="7" height="13" rx="1.5"/><rect x="14" y="3" width="7" height="18" rx="1.5"/></>,
  },
  bar_chart: {
    stroke: <><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></>,
  },
  user_plus: {
    stroke: <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></>,
  },
  heartbeat: {
    stroke: <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>,
  },
  pending: {
    stroke: <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/><circle cx="12" cy="15" r="1.5"/></>,
  },
  layers: {
    stroke: <><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></>,
  },
  mail: {
    stroke: <><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></>,
  },
  edit: {
    stroke: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
  },
  calendar_plus: {
    stroke: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></>,
  },
  school: {
    stroke: <><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/><line x1="12" y1="7" x2="12" y2="10"/></>,
  },
  alert_triangle: {
    stroke: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  },
  lock: {
    stroke: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>,
  },
  mic: {
    stroke: <><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>,
  },
  coins: {
    stroke: <><circle cx="9" cy="12" r="7"/><path d="M15 5a7 7 0 015 6.7"/><path d="M15 19a7 7 0 005-6.7"/><line x1="9" y1="9" x2="9" y2="15"/><line x1="7" y1="11" x2="11" y2="11"/><line x1="7" y1="13" x2="11" y2="13"/></>,
  },
  coach: {
    stroke: <><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M6 10l3-3 2 2 4-4 3 3"/></>,
  },
  share: {
    stroke: <><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></>,
  },
};

export default function Icon({ name, size = 20, color, filled, style = {} }) {
  const p = paths[name];
  if (!p) return null;
  const content = filled && p.filled ? p.filled : p.stroke;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>
      {content}
    </svg>
  );
}
