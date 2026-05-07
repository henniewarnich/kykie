import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase.js';
import { APP_VERSION } from '../utils/constants.js';
import { saveBenchmarkResult } from '../utils/benchmark.js';
import RoleSwitcher from '../components/RoleSwitcher.jsx';
import LiveModeChooser from '../components/LiveModeChooser.jsx';
import LiveMatchScreen from './LiveMatchScreen.jsx';
import LiveLiteScreen from './LiveLiteScreen.jsx';
import TrainingWizard, { STEPS as WIZARD_STEPS } from '../components/TrainingWizard.jsx';
import BenchmarkTest from '../components/BenchmarkTest.jsx';

const DEMO_CONFIG = {
  home: { name: 'Demo Lions', color: '#1D4ED8', id: 'demo-home', short: 'DLI' },
  away: { name: 'Demo Eagles', color: '#DC2626', id: 'demo-away', short: 'DEA' },
  matchLength: 10, breakFormat: 'none', venue: 'Demo Pitch',
  date: new Date().toISOString().slice(0, 10), isDemo: true,
};

export default function TrainingScreen({ currentUser, onLogout, onRoleSwitch, onQualified }) {
  const [view, setView] = useState('home'); // home | learn | benchmark_test
  const [viewedSteps, setViewedSteps] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kykie-training-steps') || '[]'); } catch { return []; }
  });
  const [practiceCount, setPracticeCount] = useState(() => {
    return parseInt(localStorage.getItem('kykie-training-practices') || '0', 10);
  });
  const [saving, setSaving] = useState(false);

  // Live match state for demo/benchmark
  const [activeMatch, setActiveMatch] = useState(null);
  const [liveMode, setLiveMode] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);

  const handleStepView = (stepIndex) => {
    if (!viewedSteps.includes(stepIndex)) {
      const next = [...viewedSteps, stepIndex];
      setViewedSteps(next);
      localStorage.setItem('kykie-training-steps', JSON.stringify(next));
    }
  };

  const handleWizardComplete = () => {
    // Mark all steps as viewed
    const all = WIZARD_STEPS.map((_, i) => i);
    setViewedSteps(all);
    localStorage.setItem('kykie-training-steps', JSON.stringify(all));
    setView('home');
  };

  const allRead = viewedSteps.length >= WIZARD_STEPS.length;
  const practiced = practiceCount > 0;
  const stepsComplete = (allRead ? 1 : 0) + (practiced ? 1 : 0);
  const canTest = allRead && practiced;

  // ── Demo match handlers ──
  const handleStartDemo = () => {
    setPendingStart({ _isDemo: true });
  };

  const handleModeChosen = (mode) => {
    const config = { ...DEMO_CONFIG, liveMode: mode };
    setActiveMatch(config);
    setLiveMode(mode);
    setPendingStart(null);
  };

  const handleDemoEnd = () => {
    setActiveMatch(null);
    setLiveMode(null);
    const next = practiceCount + 1;
    setPracticeCount(next);
    localStorage.setItem('kykie-training-practices', String(next));
  };

  // ── Rendering active match ──
  if (pendingStart) {
    return (
      <LiveModeChooser
        show={true}
        onSelect={handleModeChosen}
        onClose={() => setPendingStart(null)}
      />
    );
  }

  if (activeMatch && liveMode === 'pro') {
    return (
      <LiveMatchScreen
        matchConfig={activeMatch}
        onSaveGame={(game) => { handleDemoEnd(); return game; }}
        onNavigate={() => { handleDemoEnd(); }}
        currentUser={currentUser}
      />
    );
  }

  if (activeMatch && liveMode === 'lite') {
    return (
      <LiveLiteScreen
        match={activeMatch}
        onEnd={handleDemoEnd}
        currentUser={currentUser}
      />
    );
  }

  const S = {
    page: {
      fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: '0 auto',
      background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC', padding: '16px 16px 24px',
    },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    statusBadge: {
      background: '#F59E0B18', border: '1px solid #F59E0B44', borderRadius: 10, padding: 12,
      marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
    },
    card: {
      background: '#1E293B', borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer',
    },
    btn: (bg = '#10B981', disabled = false) => ({
      width: '100%', padding: 12, borderRadius: 10, border: 'none',
      background: disabled ? '#334155' : bg, color: disabled ? '#64748B' : bg === '#F59E0B' ? '#0B0F1A' : '#F8FAFC',
      fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    }),
    backBtn: {
      background: 'none', border: 'none', color: '#64748B', fontSize: 13, cursor: 'pointer', padding: 0,
    },
  };

  // ── Learn view (animated wizard) ──
  if (view === 'learn') {
    return (
      <div style={S.page}>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={S.header}>
          <button onClick={() => setView('home')} style={S.backBtn}>← Back</button>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Learn the basics</span>
          <div style={{ width: 40 }} />
        </div>

        <TrainingWizard
          completedSteps={viewedSteps}
          onStepView={handleStepView}
          onComplete={handleWizardComplete}
        />
      </div>
    );
  }

  // ── Benchmark test (interactive) ──
  if (view === 'benchmark_test') {
    return (
      <BenchmarkTest
        onPass={async () => {
          setSaving(true);
          try {
            await saveBenchmarkResult(currentUser.id, 100, true);
          } catch (e) { console.error('Save benchmark error:', e); }
          setSaving(false);
          if (onQualified) onQualified();
          else window.location.reload();
        }}
        onBack={() => setView('home')}
      />
    );
  }

  // ── Home view ──
  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="24" height="24" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="20" fill="none" stroke="#10B981" strokeWidth="2"/>
            <circle cx="28" cy="28" r="8" fill="none" stroke="#F59E0B" strokeWidth="2"/>
            <line x1="34" y1="22" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="40" y1="12" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="44" y1="12" x2="44" y2="16" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#F59E0B' }}>kykie</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {currentUser?.roles?.length > 1 && (
            <RoleSwitcher currentUser={currentUser} onSwitch={onRoleSwitch} />
          )}
          <button onClick={onLogout} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 10, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Status badge */}
      <div style={S.statusBadge}>
        <div style={{ fontSize: 28 }}>{currentUser?.role === 'coach' ? '🏑' : '🎙️'}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>
            {currentUser?.role === 'coach' ? 'Coach training' : 'Commentator trainee'}
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.4 }}>
            {currentUser?.role === 'coach'
              ? 'Learn how to record matches accurately so the stats reflect what really happened on the pitch.'
              : 'Complete training to unlock live recording, scheduling, and earn credits.'}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B', marginBottom: 6 }}>
          <span>Progress</span>
          <span>{stepsComplete} of {currentUser?.role === 'coach' ? 2 : 3} complete</span>
        </div>
        <div style={{ height: 6, background: '#1E293B', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${(stepsComplete / (currentUser?.role === 'coach' ? 2 : 3)) * 100}%`, height: '100%', background: '#10B981', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Step 1: Learn */}
      <div style={{
        ...S.card, borderLeft: allRead ? '3px solid #10B981' : '3px solid #F59E0B',
        cursor: 'pointer',
      }} onClick={() => setView('learn')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14,
              background: allRead ? '#10B981' : '#F59E0B',
              color: '#0B0F1A', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{allRead ? '✓' : '1'}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Learn the basics</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>Events, zones, and how to record</div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: allRead ? '#10B981' : '#F59E0B', fontWeight: 600 }}>
            {allRead ? 'Done' : `${viewedSteps.length}/${WIZARD_STEPS.length}`} ›
          </div>
        </div>
      </div>

      {/* Step 2: Practice */}
      <div style={{
        ...S.card,
        borderLeft: practiced ? '3px solid #10B981' : allRead ? '3px solid #F59E0B' : '3px solid #334155',
        opacity: allRead ? 1 : 0.6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14,
              background: practiced ? '#10B981' : allRead ? '#F59E0B' : '#334155',
              color: practiced || allRead ? '#0B0F1A' : '#64748B',
              fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{practiced ? '✓' : '2'}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: allRead ? '#F8FAFC' : '#64748B' }}>Practice recording</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>
                {practiced ? `${practiceCount} demo match${practiceCount !== 1 ? 'es' : ''} completed` : 'Try a demo match with no pressure'}
              </div>
            </div>
          </div>
          {practiced && <div style={{ fontSize: 10, color: '#10B981', fontWeight: 600 }}>Done</div>}
        </div>
        {allRead && (
          <button onClick={handleStartDemo} style={{ ...S.btn(practiced ? '#334155' : '#F59E0B'), marginTop: 10, background: practiced ? '#334155' : '#F59E0B', color: practiced ? '#94A3B8' : '#0B0F1A' }}>
            {practiced ? 'Practice again' : 'Start demo match'}
          </button>
        )}
      </div>

      {/* Step 3: Benchmark test — commentators only */}
      {currentUser?.role !== 'coach' && (
      <div style={{
        ...S.card,
        borderLeft: canTest ? '3px solid #F59E0B' : '3px solid #334155',
        opacity: canTest ? 1 : 0.5,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14,
              background: canTest ? '#F59E0B' : '#334155',
              color: canTest ? '#0B0F1A' : '#64748B',
              fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>3</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: canTest ? '#F8FAFC' : '#64748B' }}>Benchmark test</div>
              <div style={{ fontSize: 10, color: '#475569' }}>Interactive test — complete all 14 challenges</div>
            </div>
          </div>
          {!canTest && <div style={{ fontSize: 9, color: '#475569' }}>
            {!allRead ? 'Read topics first' : 'Practice first'}
          </div>}
        </div>
        {canTest && (
          <button onClick={() => setView('benchmark_test')} style={{ ...S.btn('#F59E0B'), marginTop: 10 }}>
            Start benchmark test →
          </button>
        )}
      </div>
      )}

      {/* What you'll unlock — commentators only */}
      {currentUser?.role !== 'coach' && (
      <>
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, fontWeight: 600 }}>After qualifying you can:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {[
            'Record live matches (earn 50 credits)',
            'Record video reviews (earn 20-30 credits)',
            'Schedule and claim matches',
            'Earn vouchers (100 credits = R100)',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94A3B8' }}>
              <span style={{ color: '#10B981' }}>●</span> {item}
            </div>
          ))}
        </div>
      </>
      )}

      {/* Home link */}
      <button onClick={() => { window.location.hash = '#/browse'; }} style={{
        width: '100%', padding: 10, borderRadius: 10, border: '1px solid #334155',
        background: 'none', color: '#64748B', fontSize: 11, cursor: 'pointer', marginBottom: 8,
      }}>
        Browse matches as supporter
      </button>

      <div style={{ fontSize: 9, color: '#334155', textAlign: 'center' }}>v{APP_VERSION}</div>
    </div>
  );
}
