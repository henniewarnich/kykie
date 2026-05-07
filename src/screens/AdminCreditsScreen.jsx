import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { VOUCHER_THRESHOLD, CREDIT_VALUES as CV } from '../utils/credits.js';
import Icon from '../components/Icons.jsx';
import KykieSpinner from '../components/KykieSpinner.jsx';
import AdminBackBar from '../components/AdminBackBar.jsx';

export default function AdminCreditsScreen({ currentUser, onBack }) {
  const [loading, setLoading] = useState(true);
  const [commentators, setCommentators] = useState([]);
  const [voucherPool, setVoucherPool] = useState({ available: 0, issued: 0, viewed: 0 });
  const [issuingId, setIssuingId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userLedger, setUserLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [matchDetails, setMatchDetails] = useState({});
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [eventBreakdown, setEventBreakdown] = useState({});

  const load = async () => {
    setLoading(true);

    // Get all commentator-role profiles
    const { data: profiles } = await supabase.from('profiles')
      .select('id, firstname, lastname, alias_nickname, email, role, roles, commentator_status')
      .or('role.in.(admin,commentator),roles.cs.{commentator}');

    // Get contributor_stats for all
    const { data: stats } = await supabase.from('contributor_stats').select('*');
    const statsMap = {};
    (stats || []).forEach(s => { statsMap[s.user_id] = s; });

    // Get audit_log match counts per user
    const { data: audits } = await supabase.from('audit_log')
      .select('user_id, action, target_id')
      .in('action', ['match_start_live', 'video_review_end', 'match_end', 'live_lite_start', 'quick_score_save', 'quick_score_admin', 'schedule_match', 'match_end_live_lite']);

    const auditCounts = {};
    (audits || []).forEach(a => {
      if (!auditCounts[a.user_id]) auditCounts[a.user_id] = { live_pro: 0, video: 0, lite: 0, quick: 0, schedule: 0, total_completed: 0 };
      const c = auditCounts[a.user_id];
      if (a.action === 'match_start_live') c.live_pro++;
      if (a.action === 'video_review_end') c.video++;
      if (a.action === 'match_end_live_lite') c.lite++;
      if (a.action === 'quick_score_save' || a.action === 'quick_score_admin') c.quick++;
      if (a.action === 'schedule_match') c.schedule++;
      if (['match_end', 'video_review_end', 'match_end_live_lite'].includes(a.action)) c.total_completed++;
    });

    // Get voucher pool counts
    const { data: vouchers } = await supabase.from('vouchers').select('status');
    const vc = { available: 0, issued: 0, viewed: 0 };
    (vouchers || []).forEach(v => { vc[v.status] = (vc[v.status] || 0) + 1; });
    setVoucherPool(vc);

    // Build commentator list
    const list = (profiles || []).map(p => {
      const s = statsMap[p.id] || { credits: 0, vouchers_earned: 0 };
      const ac = auditCounts[p.id] || { live_pro: 0, video: 0, lite: 0, quick: 0, schedule: 0, total_completed: 0 };
      const isQualified = p.commentator_status === 'qualified';
      const isEarning = isQualified && ac.total_completed >= 5;
      const credits = s.credits || 0;
      const vouchersEarnable = Math.floor(credits / VOUCHER_THRESHOLD);
      const progressToNext = credits % VOUCHER_THRESHOLD;
      return {
        ...p,
        credits,
        vouchersEarned: s.vouchers_earned || 0,
        isQualified,
        isEarning,
        matchCounts: ac,
        vouchersEarnable,
        progressToNext,
        name: p.alias_nickname || p.firstname || p.email || '?',
      };
    });

    // Sort: earning first (by credits desc), then non-earning
    list.sort((a, b) => {
      if (a.isEarning && !b.isEarning) return -1;
      if (!a.isEarning && b.isEarning) return 1;
      return b.credits - a.credits;
    });

    setCommentators(list);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleIssueVoucher = async (userId) => {
    if (voucherPool.available <= 0) { alert('No vouchers available. Add vouchers first.'); return; }
    setIssuingId(userId);
    const { data, error } = await supabase.rpc('issue_voucher', { p_user_id: userId, p_admin_id: currentUser.id });
    if (error) alert('Error: ' + error.message);
    else if (data?.error) alert(data.error);
    else await load();
    setIssuingId(null);
  };

  const viewLedger = async (user) => {
    setSelectedUser(user);
    setLedgerLoading(true);
    const { data: ledger } = await supabase.from('credit_ledger')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch match details for all ledger entries with match_ids
    const matchIds = [...new Set((ledger || []).map(l => l.match_id).filter(Boolean))];
    let matchMap = {};
    if (matchIds.length > 0) {
      const { data: matches } = await supabase.from('matches')
        .select('id, home_team_id, away_team_id, home_score, away_score, match_date, duration, match_length, status')
        .in('id', matchIds);
      (matches || []).forEach(m => { matchMap[m.id] = m; });

      // Fetch team names
      const teamIds = [...new Set((matches || []).flatMap(m => [m.home_team_id, m.away_team_id]))];
      const { data: teams } = await supabase.from('teams').select('id, name, institution_id').in('id', teamIds);
      const instIds = [...new Set((teams || []).map(t => t.institution_id).filter(Boolean))];
      const { data: insts } = await supabase.from('institutions').select('id, name, short_name').in('id', instIds);
      const instMap = {};
      (insts || []).forEach(i => { instMap[i.id] = i; });
      const teamNames = {};
      (teams || []).forEach(t => {
        const inst = instMap[t.institution_id];
        teamNames[t.id] = inst?.short_name || inst?.name || t.name;
      });
      Object.values(matchMap).forEach(m => {
        m.homeName = teamNames[m.home_team_id] || '?';
        m.awayName = teamNames[m.away_team_id] || '?';
      });

      // Fetch event counts per match (use head:true count to avoid row limit)
      const eventCounts = {};
      await Promise.all(matchIds.map(async mid => {
        const { count } = await supabase.from('match_events')
          .select('*', { count: 'exact', head: true })
          .eq('match_id', mid);
        eventCounts[mid] = count || 0;
      }));
      Object.values(matchMap).forEach(m => { m.eventCount = eventCounts[m.id] || 0; });
    }

    setMatchDetails(matchMap);
    setUserLedger(ledger || []);
    setLedgerLoading(false);
  };

  const getQualityRating = (m) => {
    if (!m || !m.match_length) return { label: '—', color: '#64748B', stars: 0 };
    const durPct = Math.min(100, ((m.duration || 0) / (m.match_length * 60)) * 100);
    const evtPerMin = m.duration > 0 ? (m.eventCount / (m.duration / 60)) : 0;
    // Score: 40% duration coverage + 40% event density + 20% absolute events
    const durScore = Math.min(1, durPct / 95); // 95%+ = full marks
    const densityScore = Math.min(1, evtPerMin / 18); // 18 events/min = excellent
    const evtScore = Math.min(1, (m.eventCount || 0) / 350); // 350+ events = full marks
    const score = durScore * 0.4 + densityScore * 0.4 + evtScore * 0.2;
    const pct = Math.round(score * 100);
    if (pct >= 85) return { label: `${pct}%`, color: '#10B981', stars: 5 };
    if (pct >= 70) return { label: `${pct}%`, color: '#3B82F6', stars: 4 };
    if (pct >= 50) return { label: `${pct}%`, color: '#F59E0B', stars: 3 };
    if (pct >= 30) return { label: `${pct}%`, color: '#F97316', stars: 2 };
    return { label: `${pct}%`, color: '#EF4444', stars: 1 };
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const LEDGER_LABELS = {
    live_pro: 'Live Pro', live_lite: 'Live Basic', video_same_day: 'Video (same day)',
    video_older: 'Video review', quick_score: 'Quick score', schedule: 'Scheduled',
    result_approved: 'Result approved', submission: 'Submission', issue_confirmed: 'Issue confirmed',
    voucher_issued: 'Voucher issued', voucher_claim: 'Voucher claimed', penalty: 'Penalty',
    quick_approved: 'Quick approved',
  };

  const totalCredits = commentators.reduce((s, c) => s + c.credits, 0);
  const earningCount = commentators.filter(c => c.isEarning).length;
  const earning = commentators.filter(c => c.isEarning);
  const notEarning = commentators.filter(c => !c.isEarning);

  const toggleMatchExpand = async (matchId) => {
    if (expandedMatch === matchId) { setExpandedMatch(null); return; }
    setExpandedMatch(matchId);
    if (eventBreakdown[matchId]) return; // already cached
    const { data: events } = await supabase.from('match_events')
      .select('team, event')
      .eq('match_id', matchId)
      .not('team', 'in', '("commentary","meta")')
      .limit(5000);
    if (!events) return;
    const bd = { home: {}, away: {}, total: events.length };
    events.forEach(e => {
      const side = e.team === 'home' ? 'home' : 'away';
      bd[side][e.event] = (bd[side][e.event] || 0) + 1;
    });
    setEventBreakdown(prev => ({ ...prev, [matchId]: bd }));
  };

  // ── LEDGER DETAIL VIEW ──
  if (selectedUser) {
    return (
      <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: '0 auto', background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setSelectedUser(null)} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 16, cursor: 'pointer', padding: 0 }}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedUser.name} — credit statement</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1E293B', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Balance</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#10B981' }}>{Math.round(selectedUser.credits)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#64748B' }}>Vouchers earned</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#F59E0B' }}>{selectedUser.vouchersEarned}</div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 8 }}>Transaction history</div>

        {ledgerLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><KykieSpinner /></div>
        ) : userLedger.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#475569', padding: 30, fontSize: 12 }}>No credit transactions yet</div>
        ) : (
          userLedger.map(l => {
            const m = matchDetails[l.match_id];
            const q = m ? getQualityRating(m) : null;
            const durMin = m ? ((m.duration || 0) / 60).toFixed(1) : null;
            const durPct = m && m.match_length ? Math.round(((m.duration || 0) / (m.match_length * 60)) * 100) : null;
            return (
            <div key={l.id} style={{ background: '#1E293B', borderRadius: 8, padding: '10px 12px', marginBottom: 6, cursor: m ? 'pointer' : 'default' }}
              onClick={() => m && m.duration > 0 && toggleMatchExpand(l.match_id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {LEDGER_LABELS[l.action] || l.action}
                    {m && m.duration > 0 && <span style={{ fontSize: 9, color: '#475569' }}>{expandedMatch === l.match_id ? '▾' : '▸'}</span>}
                  </div>
                  {m ? (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#CBD5E1' }}>{m.homeName} vs {m.awayName}</div>
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                        {m.home_score}–{m.away_score} · {fmtDate(m.match_date)}
                      </div>
                      <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>
                        Recorded {new Date(l.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} at {new Date(l.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>{fmtDate(l.created_at)}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: l.credits >= 0 ? '#10B981' : '#EF4444' }}>{l.credits >= 0 ? '+' : ''}{Math.round(l.credits)}</div>
                  <div style={{ fontSize: 9, color: '#64748B' }}>bal: {Math.round(l.balance_after)}</div>
                </div>
              </div>
              {m && m.duration > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#0F172A', color: '#94A3B8' }}>{durMin}m / {m.match_length}m ({durPct}%)</span>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#0F172A', color: '#94A3B8' }}>{m.eventCount} events</span>
                  {q && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: q.color + '22', color: q.color, fontWeight: 700 }}>{'★'.repeat(q.stars)}{'☆'.repeat(5 - q.stars)} {q.label}</span>}
                </div>
              )}
              {/* Expanded match stats */}
              {expandedMatch === l.match_id && (() => {
                const bd = eventBreakdown[l.match_id];
                if (!bd) return <div style={{ marginTop: 8, textAlign: 'center' }}><KykieSpinner size={16} /></div>;
                const STAT_EVENTS = ['Goal', 'Shot on Goal', 'Shot off Target', 'D Entry', 'Short Corner', 'Long Corner', 'Poss Conceded'];
                const hasData = STAT_EVENTS.some(ev => (bd.home[ev] || 0) + (bd.away[ev] || 0) > 0);
                if (!hasData) return <div style={{ marginTop: 8, fontSize: 9, color: '#475569' }}>No event breakdown available</div>;
                return (
                  <div style={{ marginTop: 8, borderTop: '1px solid #334155', paddingTop: 8 }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 60px 60px', gap: '3px 0', alignItems: 'center' }}>
                      <div /><div style={{ fontSize: 8, color: '#475569', fontWeight: 700 }}>EVENT</div>
                      <div style={{ fontSize: 8, color: '#3B82F6', fontWeight: 700, textAlign: 'center' }}>{m.homeName}</div>
                      <div style={{ fontSize: 8, color: '#EF4444', fontWeight: 700, textAlign: 'center' }}>{m.awayName}</div>
                      {STAT_EVENTS.map(ev => {
                        const h = bd.home[ev] || 0, a = bd.away[ev] || 0;
                        if (h === 0 && a === 0) return null;
                        const short = ev.replace('Shot on Goal', 'Shots on').replace('Shot off Target', 'Shots off').replace('Poss Conceded', 'Turnovers');
                        return [
                          <div key={ev+'i'} style={{ fontSize: 8, color: ev === 'Goal' ? '#10B981' : '#475569' }}>{ev === 'Goal' ? '⚽' : '·'}</div>,
                          <div key={ev+'l'} style={{ fontSize: 10, color: '#94A3B8' }}>{short}</div>,
                          <div key={ev+'h'} style={{ fontSize: 11, fontWeight: 700, textAlign: 'center', color: h > a ? '#F8FAFC' : '#64748B' }}>{h}</div>,
                          <div key={ev+'a'} style={{ fontSize: 11, fontWeight: 700, textAlign: 'center', color: a > h ? '#F8FAFC' : '#64748B' }}>{a}</div>,
                        ];
                      })}
                    </div>
                    {/* Conversion rate */}
                    {(bd.home['Goal'] || bd.away['Goal']) > 0 && (bd.home['D Entry'] || bd.away['D Entry']) > 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-around' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#F59E0B' }}>{bd.home['D Entry'] > 0 ? Math.round((bd.home['Goal'] || 0) / bd.home['D Entry'] * 100) : 0}%</div>
                          <div style={{ fontSize: 8, color: '#64748B' }}>Conversion</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#F59E0B' }}>{bd.away['D Entry'] > 0 ? Math.round((bd.away['Goal'] || 0) / bd.away['D Entry'] * 100) : 0}%</div>
                          <div style={{ fontSize: 8, color: '#64748B' }}>Conversion</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            );
          })
        )}
      </div>
    );
  }

  // ── MAIN VIEW ──
  return (
    <div style={{ fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: '0 auto', background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', padding: 0 }}>
      <AdminBackBar title="Admin Credits" onBack={onBack} />
      <div style={{ padding: 16 }}>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><KykieSpinner /></div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
            <div style={{ background: '#1E293B', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#10B981' }}>{Math.round(totalCredits)}</div>
              <div style={{ fontSize: 9, color: '#64748B' }}>Total credits in system</div>
            </div>
            <div style={{ background: '#1E293B', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#F59E0B' }}>{earningCount}</div>
              <div style={{ fontSize: 9, color: '#64748B' }}>Earning commentators</div>
            </div>
            <div style={{ background: '#1E293B', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#3B82F6' }}>{voucherPool.available}</div>
              <div style={{ fontSize: 9, color: '#64748B' }}>Vouchers available</div>
            </div>
            <div style={{ background: '#1E293B', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#8B5CF6' }}>{voucherPool.issued + voucherPool.viewed}</div>
              <div style={{ fontSize: 9, color: '#64748B' }}>Vouchers issued</div>
            </div>
          </div>

          {/* Credit values reference */}
          <div style={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8, padding: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4, fontWeight: 600 }}>Credit values</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                ['Live Pro', CV.live_pro], ['Video (same day)', CV.video_same_day], ['Video (older)', CV.video_older],
                ['Live Basic', CV.live_lite], ['Quick score', CV.quick_score], ['Schedule', CV.schedule], ['Issue report', CV.issue],
              ].map(([l, v]) => (
                <span key={l} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#1E293B', color: '#94A3B8' }}>{l}: <span style={{ color: '#10B981', fontWeight: 700 }}>+{v}</span></span>
              ))}
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#1E293B', color: '#94A3B8' }}>Voucher: <span style={{ color: '#F59E0B', fontWeight: 700 }}>100 cr = R100</span></span>
            </div>
          </div>

          {/* Pool warning */}
          {voucherPool.available === 0 && (
            <div style={{ background: '#EF444422', border: '1px solid #EF444444', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 11, color: '#EF4444', fontWeight: 600 }}>
              Voucher pool empty — add codes in Voucher Management
            </div>
          )}

          {/* Earning commentators */}
          {earning.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 8 }}>Commentator leaderboard</div>
              {earning.map(c => {
                const eligible = c.vouchersEarnable > 0;
                const progressPct = Math.min(100, Math.round(c.progressToNext / VOUCHER_THRESHOLD * 100));
                const toNext = VOUCHER_THRESHOLD - c.progressToNext;
                return (
                  <div key={c.id} onClick={() => viewLedger(c)} style={{
                    background: eligible ? '#10B98111' : '#1E293B',
                    border: eligible ? '1px solid #10B98133' : '1px solid transparent',
                    borderRadius: 10, padding: 12, marginBottom: 6, cursor: 'pointer',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#F59E0B33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#F59E0B' }}>
                          {c.name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</div>
                          <div style={{ fontSize: 9, color: '#64748B' }}>{c.role} · qualified</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: eligible ? '#10B981' : '#F59E0B' }}>{Math.round(c.credits)}</div>
                        <div style={{ fontSize: 8, color: '#64748B' }}>credits</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 9, color: '#94A3B8', marginBottom: 8, flexWrap: 'wrap' }}>
                      <span>{c.matchCounts.live_pro} Live Pro</span>
                      <span>{c.matchCounts.video} Video</span>
                      <span>{c.matchCounts.lite} Lite</span>
                      <span>{c.matchCounts.quick} Quick</span>
                      <span>{c.matchCounts.schedule} Sched</span>
                      {c.vouchersEarned > 0 && <span style={{ color: '#F59E0B' }}>{c.vouchersEarned} voucher{c.vouchersEarned !== 1 ? 's' : ''}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: '#0B0F1A', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${progressPct}%`, height: '100%', background: eligible ? '#10B981' : '#F59E0B', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 9, color: '#64748B' }}>{Math.round(c.progressToNext)}/{VOUCHER_THRESHOLD}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                      <span style={{ fontSize: 9, color: eligible ? '#10B981' : '#64748B', fontWeight: eligible ? 700 : 400 }}>
                        {eligible ? `Eligible for ${c.vouchersEarnable}× R100 voucher` : `${Math.round(toNext)} to next voucher`}
                      </span>
                      {eligible ? (
                        <button onClick={(e) => { e.stopPropagation(); handleIssueVoucher(c.id); }} disabled={issuingId === c.id || voucherPool.available <= 0}
                          style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#10B981', color: '#0B0F1A', fontSize: 10, fontWeight: 700, cursor: 'pointer', opacity: issuingId === c.id ? 0.5 : 1 }}>
                          {issuingId === c.id ? '...' : 'Issue'}
                        </button>
                      ) : (
                        <span style={{ padding: '4px 10px', borderRadius: 6, background: '#334155', color: '#64748B', fontSize: 9, fontWeight: 700 }}>Not eligible yet</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Not yet earning */}
          {notEarning.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginTop: 14, marginBottom: 8 }}>Not yet earning</div>
              {notEarning.map(c => {
                const status = c.commentator_status || 'unknown';
                const matchesNeeded = Math.max(0, 5 - c.matchCounts.total_completed);
                let statusText = '';
                if (status === 'trainee') statusText = 'Needs benchmark test';
                else if (status === 'apprentice') statusText = `Apprentice · ${c.matchCounts.total_completed} match${c.matchCounts.total_completed !== 1 ? 'es' : ''}`;
                else if (status === 'qualified' && c.matchCounts.total_completed < 5) statusText = `${matchesNeeded} more match${matchesNeeded !== 1 ? 'es' : ''} to earn`;
                else statusText = status;

                const badgeColor = status === 'trainee' ? '#334155' : status === 'apprentice' ? '#F59E0B' : '#10B981';
                const badgeBg = status === 'trainee' ? '#33415566' : status === 'apprentice' ? '#F59E0B22' : '#10B98122';

                return (
                  <div key={c.id} onClick={() => viewLedger(c)} style={{ background: '#1E293B', borderRadius: 10, padding: '10px 12px', marginBottom: 6, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#33415566', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#64748B' }}>
                          {c.name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>{c.name}</div>
                          <div style={{ fontSize: 9, color: '#475569' }}>{c.role} · {statusText}</div>
                        </div>
                      </div>
                      <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: badgeBg, color: badgeColor, fontWeight: 600 }}>{status}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
      </div>
    </div>
  );
}
