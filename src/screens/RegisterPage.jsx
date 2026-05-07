import { useState, useEffect } from 'react';
import { registerUser } from '../utils/auth.js';
import { fetchTeams, fetchInstitutions } from '../utils/sync.js';
import { supabase } from '../utils/supabase.js';
import { APP_VERSION } from '../utils/constants.js';
import { teamDisplayName, teamMatchesSearch, teamColor } from '../utils/teams.js';

const SPORTS = [
  { id: 'hockey', label: 'Hockey', emoji: '🏑' },
  { id: 'rugby', label: 'Rugby', emoji: '🏉' },
  { id: 'netball', label: 'Netball', emoji: '🏐' },
];

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [teams, setTeams] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [instSearch, setInstSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [emailExists, setEmailExists] = useState(false);

  // OTP verification
  const [otpCode, setOtpCode] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [resending, setResending] = useState(false);

  // Step 1 fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 fields
  const [alias, setAlias] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [gender, setGender] = useState('');
  const [hometown, setHometown] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [sportInterest, setSportInterest] = useState([]);
  const [supportingInsts, setSupportingInsts] = useState([]); // UUID[] max 4

  // Role selection
  const [regRole, setRegRole] = useState('supporter'); // 'supporter' | 'commentator' | 'coach'
  const [selectedSport, setSelectedSport] = useState('hockey'); // fixed to hockey for now
  const [coachTeamIds, setCoachTeamIds] = useState([]); // multiple teams

  // Notifications & T&C
  const [notifyLive, setNotifyLive] = useState(true);
  const [notifyRewards, setNotifyRewards] = useState(true);
  const [notifyGeneral, setNotifyGeneral] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const username = `${firstname.trim().toLowerCase()}.${lastname.trim().toLowerCase()}`.replace(/[^a-z0-9.]/g, '');

  useEffect(() => {
    fetchTeams().then(t => { if (t) setTeams(t); });
    fetchInstitutions().then(setInstitutions);
    // Pre-select role from URL param (?role=coach, ?role=commentator, ?role=supporter)
    const hash = window.location.hash || '';
    const qs = hash.split('?')[1];
    if (qs) {
      const params = new URLSearchParams(qs);
      const r = params.get('role');
      if (['supporter', 'commentator', 'coach'].includes(r)) setRegRole(r);
    }
  }, []);

  const checkEmail = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@')) { setEmailExists(false); return; }
    const { data } = await supabase.from('profiles').select('id').eq('email', e).maybeSingle();
    setEmailExists(!!data);
    if (data) setError('');
  };

  const validateStep1 = () => {
    if (!email.trim() || !email.includes('@')) return 'Valid email is required';
    if (emailExists) return 'This email is already registered. Use "Forgot password?" below.';
    if (!firstname.trim()) return 'First name is required';
    if (!lastname.trim()) return 'Last name is required';
    if (password.length < 6) return 'Password must be at least 6 characters';
    if (password !== confirmPw) return 'Passwords do not match';
    return null;
  };

  const handleNext = () => {
    const err = validateStep1();
    if (err) { setError(err); return; }
    setError('');
    if (!alias) setAlias(firstname.trim());
    setStep(2);
  };

  const handleRegister = async () => {
    if (!acceptedTerms) { setError('You must accept the Terms & Conditions'); return; }
    if (regRole === 'commentator' && !selectedSport) { setError('Please select a sport'); return; }
    if (regRole === 'coach' && !selectedSport) { setError('Please select a sport'); return; }
    if (regRole === 'coach' && coachTeamIds.length === 0) { setError('Please select at least one team'); return; }
    setLoading(true);
    setError('');
    const result = await registerUser({
      email: email.trim().toLowerCase(),
      password,
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      username,
      role: regRole,
      alias_nickname: alias || null,
      date_of_birth: dobYear && dobMonth && dobDay ? `${dobYear}-${dobMonth.padStart(2,'0')}-${dobDay.padStart(2,'0')}` : null,
      biological_gender: gender || null,
      home_town: hometown || null,
      mobile_number: mobileNumber || null,
      sport_interest: regRole === 'supporter' ? sportInterest : [selectedSport],
      supporting_institution_ids: supportingInsts,
      teamIds: regRole === 'coach' ? coachTeamIds : [],
      notify_live: notifyLive,
      notify_rewards: notifyRewards,
      notify_general: notifyGeneral,
      accepted_terms_at: new Date().toISOString(),
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) { setOtpError('Enter the verification code'); return; }
    setOtpVerifying(true);
    setOtpError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otpCode.trim(),
      type: 'signup',
    });
    if (error) {
      setOtpError(error.message === 'Token has expired or is invalid' ? 'Invalid or expired code. Try again or resend.' : error.message);
      setOtpVerifying(false);
      return;
    }
    setOtpVerified(true);
    setOtpVerifying(false);
  };

  const handleResendOtp = async () => {
    setResending(true);
    setOtpError('');
    await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
    setResending(false);
    setOtpError('New code sent! Check your inbox.');
  };

  const toggleSport = (id) => {
    setSportInterest(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const toggleInst = (id) => {
    setSupportingInsts(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length >= 4) return prev; // max 4
      return [...prev, id];
    });
  };

  const filteredInstitutions = instSearch.trim().length >= 2
    ? institutions.filter(i => {
        const q = instSearch.toLowerCase();
        return (i.name || '').toLowerCase().includes(q) || (i.short_name || '').toLowerCase().includes(q) || (i.other_names || '').toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  const inputStyle = (hasError) => ({
    width: '100%', padding: 12, borderRadius: 10,
    border: hasError ? '2px solid #EF4444' : '1px solid #334155',
    background: '#1E293B', color: '#F8FAFC', fontSize: 14, outline: 'none',
    boxSizing: 'border-box',
  });

  const labelStyle = { fontSize: 11, color: '#94A3B8', marginBottom: 4 };

  return (
    <div style={{
      fontFamily: "'Outfit','DM Sans',sans-serif", maxWidth: 430, margin: '0 auto',
      background: '#0B0F1A', minHeight: '100vh', color: '#F8FAFC',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: 20, paddingTop: 40,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Logo */}
      <div style={{ marginBottom: 8 }}>
        <svg width="36" height="36" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="20" fill="none" stroke="#10B981" strokeWidth="2"/>
          <circle cx="28" cy="28" r="8" fill="none" stroke="#F59E0B" strokeWidth="2"/>
          <line x1="34" y1="22" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="40" y1="12" x2="44" y2="12" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="44" y1="12" x2="44" y2="16" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#F59E0B', marginBottom: 2 }}>kykie</div>

      {done ? (
        // ── OTP VERIFICATION ──
        otpVerified ? (
          <div style={{ textAlign: 'center', maxWidth: 280, marginTop: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981', marginBottom: 8 }}>You're in!</div>
            <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
              Your account is verified and ready to go.
            </div>
            <button onClick={() => { window.location.hash = '#/login'; }} style={{
              marginTop: 24, width: '100%', background: '#10B981', border: 'none', borderRadius: 10, padding: '14px 24px',
              color: '#F8FAFC', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Sign In →</button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', maxWidth: 280, marginTop: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B', marginBottom: 8 }}>Enter verification code</div>
            <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, marginBottom: 20 }}>
              We sent a verification code to <span style={{ color: '#F8FAFC', fontWeight: 600 }}>{email}</span>
            </div>

            <input
              value={otpCode}
              onChange={e => { setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 8)); setOtpError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
              placeholder="00000000"
              inputMode="numeric"
              autoFocus
              style={{
                width: '100%', padding: 14, borderRadius: 10, border: otpError && !otpError.includes('sent') ? '2px solid #EF4444' : '1px solid #334155',
                background: '#1E293B', color: '#F8FAFC', fontSize: 24, fontWeight: 700,
                textAlign: 'center', letterSpacing: 6, outline: 'none', boxSizing: 'border-box',
              }}
            />

            {otpError && (
              <div style={{ fontSize: 12, color: otpError.includes('sent') ? '#10B981' : '#EF4444', marginTop: 8 }}>
                {otpError}
              </div>
            )}

            <button onClick={handleVerifyOtp} disabled={otpVerifying || otpCode.length < 6} style={{
              width: '100%', padding: 14, borderRadius: 10, border: 'none', marginTop: 16,
              background: otpVerifying || otpCode.length < 6 ? '#334155' : '#10B981',
              color: otpVerifying || otpCode.length < 6 ? '#64748B' : '#F8FAFC',
              fontSize: 14, fontWeight: 700, cursor: otpVerifying ? 'wait' : 'pointer',
            }}>
              {otpVerifying ? 'Verifying...' : 'Verify'}
            </button>

            <button onClick={handleResendOtp} disabled={resending} style={{
              width: '100%', marginTop: 8, padding: 10, borderRadius: 10, border: '1px solid #334155',
              background: 'none', color: '#94A3B8', fontSize: 11, cursor: 'pointer',
            }}>
              {resending ? 'Sending...' : "Didn't get the code? Resend"}
            </button>

            <div style={{ fontSize: 10, color: '#475569', marginTop: 10 }}>
              Check your spam folder if you can't find it.
            </div>
          </div>
        )
      ) : (
        <>
          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 20 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 12, fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#F59E0B', color: '#0B0F1A',
            }}>1</div>
            <div style={{ width: 30, height: 2, background: step >= 2 ? '#F59E0B' : '#334155' }} />
            <div style={{
              width: 24, height: 24, borderRadius: 12, fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step >= 2 ? '#F59E0B' : '#334155',
              color: step >= 2 ? '#0B0F1A' : '#64748B',
            }}>2</div>
          </div>

          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 20 }}>
            {step === 1 ? 'Create your account' : 'Tell us about yourself'}
          </div>

          {step === 1 ? (
            // ── STEP 1: ACCOUNT ──
            <div style={{ width: '100%', maxWidth: 280 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Email Address *</div>
                <input value={email} onChange={e => { setEmail(e.target.value); setError(''); setEmailExists(false); }}
                  onBlur={checkEmail}
                  placeholder="your.email@school.co.za" type="email" autoCapitalize="none" autoFocus
                  style={inputStyle(emailExists)} />
                {emailExists && (
                  <div style={{ marginTop: 6, padding: 8, borderRadius: 6, background: '#F59E0B11', border: '1px solid #F59E0B33' }}>
                    <div style={{ fontSize: 11, color: '#F59E0B', marginBottom: 4 }}>This email is already registered.</div>
                    <button onClick={() => { window.location.hash = '#/login?forgot=1'; }}
                      style={{ background: 'none', border: 'none', color: '#3B82F6', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Forgot your password?
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>First Name *</div>
                  <input value={firstname} onChange={e => { setFirstname(e.target.value); setError(''); }}
                    placeholder="John" style={inputStyle()} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Last Name *</div>
                  <input value={lastname} onChange={e => { setLastname(e.target.value); setError(''); }}
                    placeholder="Smith" style={inputStyle()} />
                </div>
              </div>

              {firstname && lastname && (
                <div style={{ marginBottom: 12 }}>
                  <div style={labelStyle}>Username (auto-generated)</div>
                  <div style={{
                    padding: 12, borderRadius: 10, background: '#1E293B', border: '1px solid #334155',
                    color: '#10B981', fontSize: 14, fontWeight: 600,
                  }}>{username}</div>
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Password *</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
                    type={showPassword ? 'text' : 'password'} placeholder="At least 6 characters"
                    style={{ ...inputStyle(), flex: 1, width: 'auto' }} />
                  <button onClick={() => setShowPassword(p => !p)} style={{
                    background: 'none', border: '1px solid #334155', borderRadius: 10, padding: '0 12px',
                    cursor: 'pointer', color: '#64748B', fontSize: 14,
                  }}>{showPassword ? '🙈' : '👁'}</button>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={labelStyle}>Confirm Password *</div>
                <input value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setError(''); }}
                  type={showPassword ? 'text' : 'password'} placeholder="Re-enter password"
                  onKeyDown={e => e.key === 'Enter' && handleNext()}
                  style={inputStyle()} />
              </div>

              {error && <div style={{ fontSize: 12, color: '#EF4444', marginBottom: 12, textAlign: 'center' }}>{error}</div>}

              <button onClick={handleNext} style={{
                width: '100%', padding: 14, borderRadius: 10, border: 'none',
                background: '#F59E0B', color: '#0B0F1A', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Next →</button>
            </div>
          ) : (
            // ── STEP 2: PROFILE ──
            <div style={{ width: '100%', maxWidth: 280 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Alias / Nickname</div>
                <input value={alias} onChange={e => setAlias(e.target.value)}
                  placeholder="How others will see you" style={inputStyle()} />
                <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>Shown publicly instead of your real name</div>
              </div>

              {/* Role selection */}
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>I want to register as *</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { id: 'supporter', label: 'Supporter', icon: '👀', desc: 'Follow matches' },
                    { id: 'commentator', label: 'Commentator', icon: '🎙️', desc: 'Record live stats' },
                    { id: 'coach', label: 'Coach', icon: '📋', desc: 'Team analytics' },
                  ].map(r => (
                    <button key={r.id} onClick={() => { setRegRole(r.id); if (r.id === 'supporter') { setSelectedSport(''); setCoachTeamIds([]); setCoachTeamSearch(''); } }}
                      style={{
                        flex: 1, padding: '10px 4px', borderRadius: 10, cursor: 'pointer',
                        border: regRole === r.id ? '2px solid #F59E0B' : '1px solid #334155',
                        background: regRole === r.id ? '#F59E0B11' : '#1E293B',
                        color: regRole === r.id ? '#F59E0B' : '#94A3B8',
                        fontSize: 10, fontWeight: regRole === r.id ? 700 : 500,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      }}>
                      <span style={{ fontSize: 18 }}>{r.icon}</span>
                      {r.label}
                      <span style={{ fontSize: 8, color: regRole === r.id ? '#F59E0B88' : '#47556988' }}>{r.desc}</span>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.5, marginTop: 8, padding: '8px 10px', background: '#1E293B', borderRadius: 8 }}>
                  {regRole === 'supporter' && "Pick this if you want to follow the teams you support and get access to match schedules, live commentary and more. You can always apply to be a Commentator or Coach later."}
                  {regRole === 'commentator' && "You will enjoy all Supporter access immediately, but will need to graduate to unlock Commentator features. Graduation involves some training and an online test. Relax, it's easy!"}
                  {regRole === 'coach' && "Register as coach and select your team. Your request will be reviewed by an admin — you'll receive an email once approved."}
                </div>
              </div>
              {(regRole === 'commentator' || regRole === 'coach') && (
                <div style={{ marginBottom: 14 }}>
                  <div style={labelStyle}>Sport</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{
                      flex: 1, padding: '10px 6px', borderRadius: 10,
                      border: '2px solid #F59E0B', background: '#F59E0B11', color: '#F59E0B',
                      fontSize: 12, fontWeight: 700,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    }}>
                      <span style={{ fontSize: 18 }}>🏑</span>
                      Hockey
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>More sports coming soon</div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 2 }}>
                  <div style={labelStyle}>Date of Birth</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select value={dobDay} onChange={e => setDobDay(e.target.value)}
                      style={{ ...inputStyle(), flex: 1, appearance: 'auto', padding: '10px 4px' }}>
                      <option value="">DD</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={String(d)}>{d}</option>
                      ))}
                    </select>
                    <select value={dobMonth} onChange={e => setDobMonth(e.target.value)}
                      style={{ ...inputStyle(), flex: 1.2, appearance: 'auto', padding: '10px 4px' }}>
                      <option value="">Mon</option>
                      {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                        <option key={m} value={String(i + 1)}>{m}</option>
                      ))}
                    </select>
                    <select value={dobYear} onChange={e => setDobYear(e.target.value)}
                      style={{ ...inputStyle(), flex: 1.5, appearance: 'auto', padding: '10px 4px' }}>
                      <option value="">Year</option>
                      {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - i).map(y => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ flex: 0.8 }}>
                  <div style={labelStyle}>Gender</div>
                  <select value={gender} onChange={e => setGender(e.target.value)}
                    style={{ ...inputStyle(), appearance: 'auto' }}>
                    <option value="">Select...</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={labelStyle}>Home Town</div>
                <input value={hometown} onChange={e => setHometown(e.target.value)}
                  placeholder="e.g. Paarl" style={inputStyle()} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={labelStyle}>Mobile Number <span style={{ color: '#475569', fontWeight: 400 }}>(optional)</span></div>
                <input type="tel" value={mobileNumber} onChange={e => setMobileNumber(e.target.value)}
                  placeholder="e.g. 082 123 4567" style={inputStyle()} />
              </div>

              {/* Sport interests (supporters only — commentator/coach select sport above) */}
              {regRole === 'supporter' && (
              <div style={{ marginBottom: 16 }}>
                <div style={labelStyle}>Sports I Follow</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {SPORTS.map(s => {
                    const active = sportInterest.includes(s.id);
                    return (
                      <button key={s.id} onClick={() => toggleSport(s.id)} style={{
                        flex: 1, padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                        border: active ? '2px solid #F59E0B' : '1px solid #334155',
                        background: active ? '#F59E0B11' : '#1E293B',
                        color: active ? '#F59E0B' : '#94A3B8',
                        fontSize: 12, fontWeight: active ? 700 : 500,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      }}>
                        <span style={{ fontSize: 18 }}>{s.emoji}</span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Supporting institutions (all roles) */}
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>
                  {regRole === 'coach' ? 'My Institutions *' : 'Institutions I Support'} 
                  <span style={{ color: '#475569', fontWeight: 400 }}> (max 4)</span>
                </div>
                {supportingInsts.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {supportingInsts.map(iid => {
                      const inst = institutions.find(i => i.id === iid);
                      return inst ? (
                        <span key={iid} onClick={() => toggleInst(iid)} style={{
                          fontSize: 10, padding: '4px 10px', borderRadius: 99, cursor: 'pointer',
                          background: (inst.color || '#64748B') + '33', color: inst.color || '#94A3B8',
                          fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          {inst.short_name || inst.name} ✕
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                {supportingInsts.length < 4 && (
                  <div>
                    <input value={instSearch} onChange={e => setInstSearch(e.target.value)}
                      placeholder="🔍 Search institutions..." style={{ ...inputStyle(), marginBottom: 4 }} />
                    {filteredInstitutions.length > 0 && (
                      <div style={{ maxHeight: 140, overflowY: 'auto', borderRadius: 6, border: '1px solid #1E293B', marginBottom: 4 }}>
                        {filteredInstitutions.filter(i => !supportingInsts.includes(i.id)).map(i => (
                          <div key={i.id} onClick={() => { toggleInst(i.id); setInstSearch(''); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid #1E293B22', fontSize: 12, color: '#CBD5E1' }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, background: i.color || '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#fff' }}>
                              {(i.short_name || i.name || '?').charAt(0)}
                            </div>
                            <span style={{ fontWeight: 600 }}>{i.name}</span>
                            {i.short_name && <span style={{ fontSize: 9, color: '#64748B' }}>({i.short_name})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Coach: team checkboxes within selected institutions */}
              {regRole === 'coach' && supportingInsts.length > 0 && selectedSport && (
                <div style={{ marginBottom: 16 }}>
                  <div style={labelStyle}>My Teams *</div>
                  {supportingInsts.map(iid => {
                    const inst = institutions.find(i => i.id === iid);
                    if (!inst) return null;
                    const instTeams = teams.filter(t =>
                      t.institution_id === iid &&
                      t.sport?.toLowerCase() === selectedSport.toLowerCase()
                    );
                    if (instTeams.length === 0) return (
                      <div key={iid} style={{ fontSize: 10, color: '#475569', padding: '4px 0' }}>
                        No {selectedSport} teams at {inst.short_name || inst.name}
                      </div>
                    );
                    return (
                      <div key={iid} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: inst.color || '#64748B', marginBottom: 4 }}>
                          {inst.short_name || inst.name}
                        </div>
                        {instTeams.map(t => {
                          const checked = coachTeamIds.includes(t.id);
                          return (
                            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid #1E293B22' }}>
                              <input type="checkbox" checked={checked}
                                onChange={() => setCoachTeamIds(prev => checked ? prev.filter(id => id !== t.id) : [...prev, t.id])}
                                style={{ width: 16, height: 16, accentColor: teamColor(t), flexShrink: 0 }} />
                              <span style={{ fontSize: 12, color: checked ? '#F8FAFC' : '#94A3B8', fontWeight: checked ? 700 : 400 }}>
                                {teamDisplayName(t)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>Team assignments will need admin approval</div>
                </div>
              )}

              {/* Notifications */}
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Notifications</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#CBD5E1' }}>
                    <input type="checkbox" checked={notifyLive} onChange={e => setNotifyLive(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: '#F59E0B' }} />
                    Notify me when a live match starts for my teams
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#CBD5E1' }}>
                    <input type="checkbox" checked={notifyRewards} onChange={e => setNotifyRewards(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: '#F59E0B' }} />
                    Notify me about rewards and credit updates
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#CBD5E1' }}>
                    <input type="checkbox" checked={notifyGeneral} onChange={e => setNotifyGeneral(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: '#F59E0B' }} />
                    Feature updates and general announcements
                  </label>
                </div>
              </div>

              {/* Terms & Conditions */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12, color: '#CBD5E1' }}>
                  <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#F59E0B', marginTop: 2, flexShrink: 0 }} />
                  <span>
                    I accept the{' '}
                    <span onClick={e => { e.preventDefault(); setShowTerms(true); }}
                      style={{ color: '#F59E0B', textDecoration: 'underline', cursor: 'pointer' }}>
                      Terms & Conditions
                    </span> *
                  </span>
                </label>
              </div>

              {/* T&C popup */}
              {showTerms && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                  onClick={() => setShowTerms(false)}>
                  <div onClick={e => e.stopPropagation()} style={{
                    background: '#1E293B', borderRadius: 12, padding: 20, maxWidth: 360, maxHeight: '80vh',
                    overflowY: 'auto', border: '1px solid #334155', width: '100%',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#F8FAFC', marginBottom: 12 }}>Terms & Conditions</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                      {`By creating an account on kykie.net, you agree to the following terms.

1. About Kykie
Kykie.net is a platform for recording, viewing, and analysing school sport match statistics.

2. Accounts
You must provide accurate information during registration. You are responsible for keeping your login credentials secure. One account per person.

3. User-Generated Content
Match statistics and scores you submit become part of the Kykie platform. You grant Kykie a non-exclusive, royalty-free licence to use and display this content. You must not submit false or deliberately inaccurate data.

4. Credits & Rewards
Credits are earned through platform activity. Credits have no cash value and cannot be transferred. Vouchers are issued at Kykie's discretion. Kykie reserves the right to modify credit values and thresholds at any time.

5. Privacy & Data
We collect personal information you provide during registration. Match data is publicly visible. We do not sell your personal information to third parties. You can request deletion of your account by contacting us.

6. Notifications
You may opt in to receive notifications about live matches and rewards. You can change preferences at any time.

7. Acceptable Use
You must not manipulate scores, credits, or rankings; harass other users; or use the platform for any unlawful purpose.

8. Disclaimers
Kykie is provided "as is" without warranties. Match statistics are user-generated and may contain inaccuracies.

9. Governing Law
These terms are governed by the laws of the Republic of South Africa.

Full terms: kykie.net/terms.md | Contact: info@kykie.net`}
                    </div>
                    <button onClick={() => { setShowTerms(false); setAcceptedTerms(true); }} style={{
                      width: '100%', marginTop: 12, padding: 10, borderRadius: 8, border: 'none',
                      background: '#F59E0B', color: '#0B0F1A', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>I Accept</button>
                    <button onClick={() => setShowTerms(false)} style={{
                      width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #334155',
                      background: 'none', color: '#94A3B8', fontSize: 11, cursor: 'pointer',
                    }}>Close</button>
                  </div>
                </div>
              )}

              {error && <div style={{ fontSize: 12, color: '#EF4444', marginBottom: 12, textAlign: 'center' }}>{error}</div>}

              <button onClick={handleRegister} disabled={loading} style={{
                width: '100%', padding: 14, borderRadius: 10, border: 'none',
                background: loading ? '#334155' : '#10B981', color: loading ? '#64748B' : '#F8FAFC',
                fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
              }}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>

              <button onClick={() => { setStep(1); setError(''); }} style={{
                width: '100%', marginTop: 8, padding: 10, borderRadius: 10, border: '1px solid #334155',
                background: 'none', color: '#94A3B8', fontSize: 12, cursor: 'pointer',
              }}>← Back</button>
            </div>
          )}

          <button onClick={() => { window.location.hash = '#/login'; }} style={{
            marginTop: 16, background: 'none', border: 'none', color: '#475569', fontSize: 10,
            cursor: 'pointer', textDecoration: 'underline',
          }}>Already have an account? Sign In</button>
        </>
      )}

      <div style={{ marginTop: 20, fontSize: 9, color: '#334155' }}>v{APP_VERSION}</div>
    </div>
  );
}
