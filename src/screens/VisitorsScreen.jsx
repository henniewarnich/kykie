import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { S, theme } from '../utils/styles.js';
import AdminBackBar from '../components/AdminBackBar.jsx';
import KykieSpinner from '../components/KykieSpinner.jsx';

function dayStart(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d;
}

function referrerHost(r) {
  if (!r) return '(direct)';
  try {
    const url = new URL(r);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return r.slice(0, 40);
  }
}

function topN(rows, key, n = 10) {
  const counts = {};
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export default function VisitorsScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const since = dayStart(6).toISOString();
      const { data, error } = await supabase
        .from('visit_log')
        .select('created_at, path, referrer, session_id, user_id')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10000);
      if (error) {
        setError(error.message);
        setRows([]);
      } else {
        setRows(data || []);
      }
      setLoading(false);
    };
    load();
  }, []);

  // Bucket rows by day-window
  const todayStart = dayStart(0).getTime();
  const yesterdayStart = dayStart(1).getTime();
  const weekStart = dayStart(6).getTime();

  const inWindow = (since, until = Infinity) =>
    rows.filter(r => {
      const t = new Date(r.created_at).getTime();
      return t >= since && t < until;
    });

  const today = inWindow(todayStart);
  const yesterday = inWindow(yesterdayStart, todayStart);
  const week = inWindow(weekStart);

  const uniqueSessions = (rs) => new Set(rs.map(r => r.session_id)).size;

  // Returning vs new (last 7 days): a session is "returning" if it
  // appears on more than one calendar day in the window.
  const sessionsByDay = {};
  for (const r of week) {
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    if (!sessionsByDay[r.session_id]) sessionsByDay[r.session_id] = new Set();
    sessionsByDay[r.session_id].add(day);
  }
  const returning = Object.values(sessionsByDay).filter(s => s.size > 1).length;
  const newVisitors = Object.values(sessionsByDay).filter(s => s.size === 1).length;

  const topPages = topN(week, r => r.path, 10);
  const topReferrers = topN(week, r => referrerHost(r.referrer), 10);

  const tileStyle = {
    flex: 1,
    background: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: '12px 14px',
    minWidth: 0,
  };

  return (
    <div style={S.app}>
      <AdminBackBar title="Visitors" onBack={onBack} />

      <div style={S.page}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><KykieSpinner /></div>
        ) : error ? (
          <div style={{ ...S.empty, color: '#EF4444' }}>Could not load: {error}</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={tileStyle}>
                <div style={{ fontSize: 10, color: theme.textDim, fontWeight: 700, letterSpacing: 1 }}>TODAY</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: theme.text, marginTop: 4 }}>{today.length}</div>
                <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>{uniqueSessions(today)} unique</div>
              </div>
              <div style={tileStyle}>
                <div style={{ fontSize: 10, color: theme.textDim, fontWeight: 700, letterSpacing: 1 }}>YESTERDAY</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: theme.text, marginTop: 4 }}>{yesterday.length}</div>
                <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>{uniqueSessions(yesterday)} unique</div>
              </div>
              <div style={tileStyle}>
                <div style={{ fontSize: 10, color: theme.textDim, fontWeight: 700, letterSpacing: 1 }}>LAST 7 DAYS</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: theme.text, marginTop: 4 }}>{week.length}</div>
                <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>{uniqueSessions(week)} unique</div>
              </div>
            </div>

            <div style={{ ...tileStyle, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: theme.textDim, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
                RETURNING VS NEW (LAST 7 DAYS)
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#10B981' }}>{returning}</div>
                  <div style={{ fontSize: 10, color: theme.textDim }}>returning visitors</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#3B82F6' }}>{newVisitors}</div>
                  <div style={{ fontSize: 10, color: theme.textDim }}>new visitors</div>
                </div>
              </div>
            </div>

            <Section title="TOP PAGES (LAST 7 DAYS)" rows={topPages} empty="No visits yet." />
            <Section title="TOP REFERRERS (LAST 7 DAYS)" rows={topReferrers} empty="No referrers yet." />

            <div style={{ fontSize: 10, color: theme.textDim, textAlign: 'center', marginTop: 16 }}>
              Showing up to {rows.length.toLocaleString()} visits from the last 7 days. Counts include bots.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, rows, empty }) {
  return (
    <div style={{
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: theme.textDim, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.textDim, padding: '8px 0' }}>{empty}</div>
      ) : (
        <div>
          {rows.map(([label, count], i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: i < rows.length - 1 ? '1px solid #1E293B' : 'none',
              gap: 12,
            }}>
              <div style={{
                fontSize: 12,
                color: theme.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>{count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
