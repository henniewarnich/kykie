import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { APP_VERSION } from '../utils/constants.js';
import { S, theme } from '../utils/styles.js';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icons.jsx';

export default function HomeScreen({ teamCount, gameCount, onNavigate, syncing, lastSyncError, currentUser, onLogout, onRoleSwitch }) {
  const [scheduledCount, setScheduledCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [playedCount, setPlayedCount] = useState(null);

  useEffect(() => {
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'upcoming')
      .then(({ count }) => setScheduledCount(count || 0));
    supabase.from('matches').select('id', { count: 'exact', head: true }).in('status', ['ended', 'abandoned'])
      .then(({ count }) => setPlayedCount(count || 0));
    // Fetch pending count for admin badge
    Promise.all([
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('teams').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]).then(([{ count: mc }, { count: tc }]) => setPendingCount((mc || 0) + (tc || 0)));

    // Auto-promote apprentice if criteria met
    if (currentUser?.commentator_status === 'apprentice') {
      checkApprenticePromotion();
    }
  }, []);

  const checkApprenticePromotion = async () => {
    // Count live and recorded matches from audit_log
    const { data: liveAudits } = await supabase.from('audit_log')
      .select('target_id').eq('user_id', currentUser.id).eq('action', 'match_start_live');
    const { data: recordAudits } = await supabase.from('audit_log')
      .select('target_id').eq('user_id', currentUser.id).eq('action', 'video_review_start');
    const liveCount = liveAudits?.length || 0;
    const recordCount = recordAudits?.length || 0;
    const totalMatches = liveCount + recordCount;

    if (liveCount >= 1 && recordCount >= 1) {
      // Promote to qualified
      await supabase.from('profiles').update({ commentator_status: 'qualified' }).eq('id', currentUser.id);
      currentUser.commentator_status = 'qualified';
    }
  };

  const handleClearCache = () => {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('CLEAR_CACHE');
    }
    caches?.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
      navigator.serviceWorker?.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
      window.location.reload(true);
    }).catch(() => window.location.reload(true));
  };

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <PageHeader currentUser={currentUser} onLogout={onLogout} onRoleSwitch={onRoleSwitch}
        onBack={() => { window.location.hash = '#/browse'; }} />
      <div style={{ padding: "0 16px 20px" }}>
        {(() => {
          const isApprentice = currentUser?.role === 'commentator' && currentUser?.commentator_status === 'apprentice';
          return <>
            {isApprentice && (
              <div style={{ background: "#F59E0B18", border: "1px solid #F59E0B44", borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 24 }}>🎓</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B" }}>Apprentice Commentator</div>
                  <div style={{ fontSize: 10, color: "#94A3B8", lineHeight: 1.4 }}>You can schedule matches and try the demo. Complete 1 Live and 1 Recorded match to qualify and start earning credits.</div>
                </div>
              </div>
            )}
            {[
            ...(['commentator'].includes(currentUser?.role) ? [
              ["training", "school", "#06B6D4", "Training", "Training materials & benchmark test"],
              ["start_demo", "bolt", "#8B5CF6", "Try Demo Match", "Practice the recorder — data is discarded"],
            ] : []),
            ["match_schedule", "calendar", "#F59E0B", "Match Schedule", `${scheduledCount} upcoming match${scheduledCount !== 1 ? "es" : ""}`],
            ["match_setup", "bolt", "#10B981", "New Match", "Live match, quick score or demo"],
            ...(!['commentator'].includes(currentUser?.role) ? [
              ["teams", "buildings", "#3B82F6", "Institutions & Teams", `${teamCount} team${teamCount !== 1 ? "s" : ""}`],
            ] : []),
            ["history", "bar_chart", "#8B5CF6", "Game History", (() => { const n = playedCount ?? gameCount; return `${n} game${n !== 1 ? "s" : ""}`; })()],
            ...(['commentator'].includes(currentUser?.role) && currentUser?.commentator_status === 'qualified' ? [
              ["credits", "coins", "#F59E0B", "My Credits", "Your credit statement & vouchers"],
            ] : []),
            ...(currentUser?.role === 'admin' ? [
              ["users", "user_plus", "#EF4444", "Users", "Manage user accounts"],
              ["rankings", "trophy", "#F59E0B", "Rankings", "Manage team rankings"],
              ["pending", "pending", "#EC4899", "Pending Approvals", pendingCount > 0 ? `${pendingCount} awaiting review` : "No pending items"],
              ["notify_coaches", "mail", "#F59E0B", "Notify Coaches", "Email new match reports to coaches"],
              ["health", "heartbeat", "#06B6D4", "System Health", "Database, users & activity"],
              ["sponsors", "layers", "#14B8A6", "Sponsors", "Manage sponsor placements"],
              ["vouchers", "coins", "#10B981", "Vouchers", "Manage voucher pool"],
              ["admin_credits", "mic", "#F97316", "Credits Overview", "Commentator credits & vouchers"],
            ] : []),
          ].map(([screen, iconName, iconColor, title, sub]) => {
            return (
              <div key={screen} style={{ ...S.card, display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }} onClick={() => onNavigate(screen)}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: iconColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={iconName} size={20} color={iconColor} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
                  <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>{sub}</div>
                </div>
              </div>
            );
          })}
          </>;
        })()}
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 10, color: theme.textDimmer }}>v{APP_VERSION}</div>
            <div style={{ fontSize: 9, color: syncing ? theme.accent : theme.success, display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 6 }}>{syncing ? "⏳" : "☁️"}</span>
              {syncing ? "Syncing..." : "Cloud connected"}
            </div>
            <button onClick={handleClearCache} style={{
              padding: "4px 12px", borderRadius: 6, border: `1px solid ${theme.border}`,
              background: theme.surface, color: theme.textDim, fontSize: 10, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            }}>
              🔄 Update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
