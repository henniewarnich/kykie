import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { APP_VERSION } from '../utils/constants.js';
import { S, theme } from '../utils/styles.js';

export default function AdminDashboardPanel({ onNavigate, currentUser }) {
  const [scheduledCount, setScheduledCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);

  useEffect(() => {
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'upcoming')
      .then(({ count }) => setScheduledCount(count || 0));
    supabase.from('teams').select('id', { count: 'exact', head: true }).or('status.eq.active,status.is.null')
      .then(({ count }) => setTeamCount(count || 0));
    Promise.all([
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('teams').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]).then(([{ count: mc }, { count: tc }]) => setPendingCount((mc || 0) + (tc || 0)));
  }, []);

  const cards = [
    ["match_schedule", "📅", "Match Schedule", `${scheduledCount} upcoming match${scheduledCount !== 1 ? "es" : ""}`],
    ["match_setup", "⚡", "New Match", "Live match or quick score"],
    ["what_if", "🔮", "What-If Match", "Pick two teams — see prediction"],
    ["teams", "🏫", "Institutions & Teams", `${teamCount} team${teamCount !== 1 ? "s" : ""}`],
    ["history", "📊", "Game History", "View all recorded matches"],
    ...(currentUser?.role === 'admin' ? [
      ["users", "🔑", "Users", "Manage user accounts"],
      ["rankings", "🏆", "Rankings", "Manage team rankings"],
      ["pending", "📋", "Pending Approvals", pendingCount > 0 ? `${pendingCount} awaiting review` : "No pending items"],
      ["health", "🩺", "System Health", "Database, users & activity"],
      ["sponsors", "🤝", "Sponsors", "Manage sponsor placements"],
    ] : []),
  ];

  return (
    <div style={{ padding: "0 16px 8px" }}>
      {cards.map(([screen, icon, title, sub]) => (
        <div key={screen} onClick={() => onNavigate(screen)} style={{
          ...S.card, display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
        }}>
          <div style={{ fontSize: 24 }}>{icon}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 10, color: theme.textDim, marginTop: 1 }}>{sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
