import { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase.js';
import { S, theme } from '../utils/styles.js';
import KykieSpinner from '../components/KykieSpinner.jsx';

export default function ReportScreen({ reportId, matchId, currentUser, onBack }) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [isCoachForMatch, setIsCoachForMatch] = useState(false);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      if (!currentUser) { setError('login'); setLoading(false); return; }
      try {
        let query = supabase.from('match_reports').select('*, matches!inner(home_team_id, away_team_id)');
        if (reportId) { query = query.eq('id', reportId); }
        else if (matchId) { query = query.eq('match_id', matchId); }
        else { setError('not_found'); setLoading(false); return; }
        const { data, error: fetchError } = await query.single();
        if (fetchError || !data) { setError('not_found'); setLoading(false); return; }
        setReport(data);
        const isAdmin = currentUser.role === 'admin';
        if (isAdmin) { setIsCoachForMatch(true); }
        else {
          const { data: coachLinks } = await supabase.from('coach_teams').select('team_id').eq('coach_id', currentUser.id);
          const coachTeamIds = (coachLinks || []).map(c => c.team_id);
          const matchTeams = [data.matches?.home_team_id, data.matches?.away_team_id].filter(Boolean);
          setIsCoachForMatch(matchTeams.some(tid => coachTeamIds.includes(tid)));
        }
      } catch (e) { console.error('Report load error:', e); setError('not_found'); }
      setLoading(false);
    };
    load();
  }, [reportId, matchId, currentUser?.id]);

  useEffect(() => {
    if (!report || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
    doc.open();
    let html = report.html_content;
    if (!isCoachForMatch) {
      const teaserCSS = `<style>.coach-only{display:none!important}.teaser-gate{background:linear-gradient(180deg,transparent 0%,#0B0F1A 40%);padding:40px 20px 30px;margin-top:-40px;position:relative;text-align:center}.teaser-gate .lock{font-size:28px;margin-bottom:8px}.teaser-gate .msg{font-size:13px;font-weight:700;color:#F8FAFC;margin-bottom:4px;font-family:Outfit,sans-serif}.teaser-gate .sub{font-size:11px;color:#94A3B8;line-height:1.5;font-family:Outfit,sans-serif}.teaser-gate .cta{display:inline-block;margin-top:12px;padding:8px 20px;border-radius:8px;background:#10B981;color:#fff;font-size:12px;font-weight:700;text-decoration:none;font-family:Outfit,sans-serif}</style>`;
      const teaserBanner = `<div class="teaser-gate"><div class="lock">\u{1F512}</div><div class="msg">Full tactical analysis available for coaches</div><div class="sub">Team insights, training priorities, and the detailed match narrative are exclusive to registered coaches of the teams involved.</div><a class="cta" href="#/register">Register as a Coach</a></div>`;
      if (html.includes('</head>')) { html = html.replace('</head>', teaserCSS + '</head>'); } else { html = teaserCSS + html; }
      if (html.includes('class="footer"')) { html = html.replace(/<div class="footer"/, teaserBanner + '<div class="footer"'); }
      else if (html.includes('</body>')) { html = html.replace('</body>', teaserBanner + '</body>'); }
      else { html = html + teaserBanner; }
    }
    doc.write(html);
    doc.close();
    const resize = () => { if (iframeRef.current && doc.body) { iframeRef.current.style.height = doc.body.scrollHeight + 'px'; } };
    setTimeout(resize, 200);
    setTimeout(resize, 800);
  }, [report, isCoachForMatch]);

  const handleShare = () => {
    const url = `${window.location.origin}${window.location.pathname}#/report/${report?.id || reportId}`;
    if (navigator.share) { navigator.share({ title: report?.title || 'Kykie Match Report', url }).catch(() => {}); }
    else { navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }
  };

  if (loading) return (<div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><KykieSpinner text message="Loading report..." /></div>);

  if (error === 'login') return (
    <div style={S.app}><div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>{'\u{1F512}'}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#F8FAFC', marginBottom: 6 }}>Sign in to view this report</div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>Match reports are available to registered users.</div>
      <button onClick={() => { window.location.hash = '#/login'; }} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#10B981', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Sign In</button>
      <div style={{ marginTop: 12 }}><button onClick={() => { window.location.hash = '#/register'; }} style={{ background: 'none', border: 'none', color: '#F59E0B', fontSize: 11, cursor: 'pointer' }}>Don't have an account? Register</button></div>
    </div></div>);

  if (error === 'not_found') return (
    <div style={S.app}><div style={{ padding: '10px 14px' }}><button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer' }}>{'\u2190'} Back</button></div>
      <div style={{ textAlign: 'center', padding: 60 }}><div style={{ fontSize: 32, marginBottom: 12 }}>{'\u{1F4CB}'}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#F8FAFC', marginBottom: 6 }}>Report not found</div>
      <div style={{ fontSize: 11, color: '#94A3B8' }}>This report may have been removed or doesn't exist yet.</div></div></div>);

  return (
    <div style={{ fontFamily: "'Outfit',sans-serif", maxWidth: 500, margin: '0 auto', background: '#0B0F1A', minHeight: '100vh' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #1E293B' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer', padding: 0 }}>{'\u2190'} Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={handleShare} style={{ fontSize: 10, fontWeight: 700, color: '#10B981', background: '#10B98115', border: '1px solid #10B98133', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>{copied ? '\u2713 Copied!' : '\u{1F517} Share'}</button>
        <div style={{ fontSize: 9, color: '#64748B', marginLeft: 4 }}>{report.report_type === 'analysis' ? 'Match Analysis' : report.report_type === 'scouting' ? 'Scouting Report' : 'Season Review'}</div>
      </div>
      <iframe ref={iframeRef} style={{ width: '100%', border: 'none', minHeight: 400, background: '#0B0F1A' }} sandbox="allow-same-origin allow-scripts" title={report.title} />
    </div>
  );
}
