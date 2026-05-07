import { useState, useEffect, useCallback } from 'react';
import { TEAM_COLORS } from '../utils/constants.js';
import { S, theme } from '../utils/styles.js';
import { teamColor, teamDisplayName, teamDerivedName, teamInitial, teamMatchesSearch, teamSlug } from '../utils/teams.js';
import { fetchInstitutions, upsertInstitution, deleteInstitution, fetchTeams, deleteTeamRemote } from '../utils/sync.js';
import { getAllCoachTeams, assignCoachTeam, removeCoachTeam } from '../utils/auth.js';
import { supabase } from '../utils/supabase.js';
import { setTeamTierOverride, FREE_PLUS_THRESHOLD } from '../utils/credits.js';
import AdminBackBar from '../components/AdminBackBar.jsx';
import KykieSpinner from '../components/KykieSpinner.jsx';

const GENDERS = ['Girls', 'Boys'];
const AGE_GROUPS = ['U14', 'U16', '1st', '2nd', '3rd'];
const SPORTS = ['Hockey', 'Rugby', 'Netball', 'Cricket'];
const TIER_COLORS = { free: '#64748B', free_plus: '#F59E0B', premium: '#10B981' };
const TIER_LABELS = { free: 'Free', free_plus: 'Free+', premium: 'Premium' };

export default function TeamsScreen({ currentUser, onSave, onBack, getShareLink }) {
  const [institutions, setInstitutions] = useState([]);
  const [teams, setTeams] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [coachTeamMap, setCoachTeamMap] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [view, setView] = useState('list');
  const [editInst, setEditInst] = useState(null);
  const [editTeam, setEditTeam] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [coachEmail, setCoachEmail] = useState('');
  const [tierMap, setTierMap] = useState({});  // team_id → tier info
  const [tierEdit, setTierEdit] = useState(null); // { teamId, teamName, ... } for override popup
  const [coachLookup, setCoachLookup] = useState(null);

  const isAdmin = currentUser?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    const [insts, allTeams, ctRecords, { data: coachProfiles }, { data: tiers }] = await Promise.all([
      fetchInstitutions(),
      fetchTeams(),
      getAllCoachTeams(),
      supabase.from('profiles').select('id, firstname, lastname, email, roles').contains('roles', ['coach']),
      supabase.from('team_tiers').select('*'),
    ]);
    setInstitutions(insts);
    setTeams(allTeams || []);
    setCoaches(coachProfiles || []);
    const map = {};
    (ctRecords || []).forEach(ct => {
      if (!map[ct.team_id]) map[ct.team_id] = [];
      const p = (coachProfiles || []).find(c => c.id === ct.coach_id);
      map[ct.team_id].push({ coach_id: ct.coach_id, ...(p || {}) });
    });
    setCoachTeamMap(map);
    // Build tier map
    const tm = {};
    (tiers || []).forEach(tt => {
      const isOverridden = tt.tier_override && (!tt.override_expires || new Date(tt.override_expires) > new Date());
      tm[tt.team_id] = {
        ...tt,
        effectiveTier: isOverridden ? tt.tier_override : (tt.tier || 'free'),
        isOverridden,
      };
    });
    setTierMap(tm);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group teams by institution
  const teamsByInst = {};
  teams.forEach(t => {
    const iid = t.institution_id || '__none';
    if (!teamsByInst[iid]) teamsByInst[iid] = [];
    teamsByInst[iid].push(t);
  });

  const q = search.trim().toLowerCase();
  const filteredInsts = q
    ? institutions.filter(inst => {
        const instMatch = (inst.name || '').toLowerCase().includes(q) ||
          (inst.short_name || '').toLowerCase().includes(q) ||
          (inst.other_names || '').toLowerCase().includes(q) ||
          (inst.domain || '').toLowerCase().includes(q);
        const teamMatch = (teamsByInst[inst.id] || []).some(t => teamMatchesSearch(t, search));
        return instMatch || teamMatch;
      })
    : institutions;

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleEditInst = (inst) => {
    setEditInst(inst ? { ...inst } : { name: '', short_name: '', other_names: '', domain: '', color: TEAM_COLORS[0].hex });
    setView('inst');
  };

  const handleSaveInst = async () => {
    if (!editInst?.name?.trim()) return;
    const result = await upsertInstitution(editInst);
    if (result) { await load(); setView('list'); setEditInst(null); }
  };

  const handleDeleteInst = async (inst) => {
    if (!confirm(`Delete ${inst.name}? Only works if no teams are linked.`)) return;
    const result = await deleteInstitution(inst.id);
    if (result.error) { alert(result.error); return; }
    load();
  };

  const handleEditTeam = (team, inst) => {
    if (team) {
      setEditTeam({ ...team, _inst: inst });
    } else {
      setEditTeam({ institution_id: inst.id, institution: inst, _inst: inst, gender: null, age_group: null, sport: 'Hockey', variant: '' });
    }
    setCoachEmail('');
    setCoachLookup(null);
    setView('team');
  };

  const handleSaveTeam = () => {
    if (!editTeam?.institution_id) return alert('Missing institution');
    if (!editTeam?.gender) return alert('Please select a gender');
    if (!editTeam?.age_group) return alert('Please select an age group');
    const derivedName = teamDerivedName(editTeam);
    onSave({ ...editTeam, name: derivedName, color: editTeam._inst?.color || editTeam.institution?.color || '#1D4ED8' });
    setView('list');
    setEditTeam(null);
    setTimeout(load, 500);
  };

  const handleDeleteTeam = async (team) => {
    if (!confirm(`Delete ${teamDisplayName(team)}?`)) return;
    await deleteTeamRemote(team.id);
    load();
  };

  const handleAssignCoach = async (coachId, teamId) => {
    await assignCoachTeam(coachId, teamId);
    await load();
  };

  const handleRemoveCoach = async (coachId, teamId) => {
    await removeCoachTeam(coachId, teamId);
    await load();
  };

  const handleCoachEmailLookup = async () => {
    if (!coachEmail.trim()) return;
    const { data } = await supabase.from('profiles').select('id, firstname, lastname, email, roles').eq('email', coachEmail.trim().toLowerCase()).maybeSingle();
    if (data && (data.roles || []).includes('coach')) {
      setCoachLookup({ found: true, coach: data });
    } else if (data) {
      setCoachLookup({ found: false, reason: `${data.firstname} ${data.lastname} is registered but doesn't have the Coach role.` });
    } else {
      setCoachLookup({ found: false, reason: 'No registered user with this email. They need to register first.' });
    }
  };

  const handleCoachSelfLink = async (teamId) => {
    if (!coachLookup?.found) return;
    await assignCoachTeam(coachLookup.coach.id, teamId);
    setCoachEmail('');
    setCoachLookup(null);
    await load();
  };

  const Pill = ({ label, options, value, onChange, disabledOptions = [] }) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ ...S.label, fontSize: 10 }}>{label} *</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {options.map(o => {
          const disabled = disabledOptions.includes(o);
          return (
            <button key={o} onClick={() => !disabled && onChange(o)} style={{
              padding: '7px 14px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              border: value === o ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
              background: value === o ? theme.accent + '22' : disabled ? theme.surface : theme.bg,
              color: value === o ? '#F8FAFC' : disabled ? '#334155' : theme.textMuted,
              cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
            }}>{o}</button>
          );
        })}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════
  // VIEW: INSTITUTION FORM
  // ════════════════════════════════════════════════════════
  if (view === 'inst' && editInst) {
    const previewColor = editInst.color || TEAM_COLORS[0].hex;
    return (
      <div style={S.app}>
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => { setView('list'); setEditInst(null); }} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{editInst.id ? 'Edit' : 'Add'} institution</div>
        </div>
        <div style={S.page}>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Full name *</label>
            <input style={S.input} value={editInst.name || ''} autoFocus
              onChange={e => setEditInst(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Paarl Gymnasium" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Short name</label>
            <input style={S.input} value={editInst.short_name || ''}
              onChange={e => setEditInst(p => ({ ...p, short_name: e.target.value }))} placeholder="e.g. PG" />
            <div style={{ fontSize: 9, color: theme.textDim, marginTop: 2 }}>Shows on scoreboards and match cards</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Other names (comma-separated)</label>
            <input style={S.input} value={editInst.other_names || ''}
              onChange={e => setEditInst(p => ({ ...p, other_names: e.target.value }))} placeholder="e.g. Paarl Gim, Gimmies" />
            <div style={{ fontSize: 9, color: theme.textDim, marginTop: 2 }}>Alternative names for search</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Domain</label>
            <input style={S.input} value={editInst.domain || ''}
              onChange={e => setEditInst(p => ({ ...p, domain: e.target.value }))} placeholder="e.g. paarlgim.co.za" />
            <div style={{ fontSize: 9, color: theme.textDim, marginTop: 2 }}>Used to verify coaches registering with a school email</div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={S.label}>Colour</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {TEAM_COLORS.map(c => (
                <button key={c.id} onClick={() => setEditInst(p => ({ ...p, color: c.hex }))} style={{
                  width: '100%', aspectRatio: '1', borderRadius: 10, background: c.hex,
                  border: previewColor === c.hex ? '3px solid #F8FAFC' : '3px solid transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {previewColor === c.hex && <span style={{ color: '#fff', fontSize: 18, fontWeight: 800 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>
          <div style={{ background: theme.surface, borderRadius: 12, padding: 16, marginBottom: 18, textAlign: 'center', borderTop: `4px solid ${previewColor}` }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: previewColor, margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: '#fff' }}>
              {(editInst.short_name || editInst.name || 'I').charAt(0).toUpperCase()}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, color: previewColor }}>{editInst.name || 'Institution Name'}</div>
            {editInst.short_name && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>Short: {editInst.short_name}</div>}
            {editInst.domain && <div style={{ fontSize: 9, color: theme.textDimmer, marginTop: 2 }}>Domain: {editInst.domain}</div>}
          </div>
          <button style={{ ...S.btn(theme.accent, theme.bg), opacity: editInst.name?.trim() ? 1 : 0.4 }} onClick={handleSaveInst}>
            {editInst.id ? 'Save changes' : 'Create institution'}
          </button>
          {editInst.id && isAdmin && (
            <button style={{ ...S.btn(theme.danger, theme.bg), marginTop: 8, opacity: 0.7 }} onClick={() => handleDeleteInst(editInst)}>
              Delete institution
            </button>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW: TEAM FORM
  // ════════════════════════════════════════════════════════
  if (view === 'team' && editTeam) {
    const inst = editTeam._inst || editTeam.institution || {};
    const instColor = inst.color || '#1D4ED8';
    const derivedName = editTeam.gender && editTeam.age_group ? teamDerivedName(editTeam) : '...';
    const previewName = `${inst.short_name || inst.name || '?'} ${derivedName}`;
    const existingCoaches = coachTeamMap[editTeam.id] || [];
    const assignedIds = new Set(existingCoaches.map(c => c.coach_id));
    const availableCoaches = coaches.filter(c => !assignedIds.has(c.id));

    return (
      <div style={S.app}>
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => { setView('list'); setEditTeam(null); }} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{editTeam.id ? 'Edit' : 'Add'} team — {inst.short_name || inst.name || '?'}</div>
        </div>
        <div style={S.page}>
          <Pill label="Sport" options={['Hockey']} value={editTeam.sport || 'Hockey'}
            onChange={v => setEditTeam(p => ({ ...p, sport: v }))} />
          <Pill label="Gender" options={GENDERS} value={editTeam.gender || null}
            onChange={v => setEditTeam(p => ({ ...p, gender: v }))} />
          <Pill label="Age group" options={AGE_GROUPS} value={editTeam.age_group || null}
            onChange={v => setEditTeam(p => ({ ...p, age_group: v }))} />
          <div style={{ marginBottom: 14 }}>
            <label style={{ ...S.label, fontSize: 10 }}>Variant (optional)</label>
            <input style={{ ...S.input, fontSize: 12 }} value={editTeam.variant || ''}
              onChange={e => setEditTeam(p => ({ ...p, variant: e.target.value }))}
              placeholder="e.g. Festival, Development" />
            <div style={{ fontSize: 9, color: theme.textDim, marginTop: 2 }}>Only when multiple teams share the same age group</div>
          </div>
          <div style={{ background: theme.surface, borderRadius: 12, padding: 14, marginBottom: 16, textAlign: 'center', borderTop: `4px solid ${instColor}` }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#F8FAFC' }}>{previewName}</div>
            <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>{derivedName}</div>
          </div>
          <div style={{ height: 1, background: theme.border, margin: '4px 0 12px' }} />
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Coaches</label>
            {existingCoaches.length > 0 ? (
              <div style={{ marginBottom: 8 }}>
                {existingCoaches.map(c => (
                  <div key={c.coach_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${theme.border}22` }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#10B98122', color: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                      {(c.firstname || '?').charAt(0)}{(c.lastname || '').charAt(0)}
                    </div>
                    <div style={{ flex: 1, fontSize: 12, color: '#CBD5E1' }}>
                      {c.firstname || 'Unknown'} {c.lastname || ''}
                      {c.email && <span style={{ color: theme.textDim, fontSize: 10, marginLeft: 4 }}>· {c.email}</span>}
                    </div>
                    {isAdmin && editTeam.id && (
                      <button onClick={() => handleRemoveCoach(c.coach_id, editTeam.id)}
                        style={{ background: 'none', border: 'none', color: theme.danger, fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 8 }}>No coaches assigned</div>
            )}
            {isAdmin && editTeam.id && availableCoaches.length > 0 && (
              <select style={{ ...S.input, fontSize: 12, padding: '8px 10px', marginBottom: 8 }}
                onChange={async (e) => { if (e.target.value) { await handleAssignCoach(e.target.value, editTeam.id); e.target.value = ''; } }}
                defaultValue="">
                <option value="" disabled>+ Assign a coach...</option>
                {availableCoaches.map(c => (
                  <option key={c.id} value={c.id}>{c.firstname} {c.lastname}{c.email ? ` (${c.email})` : ''}</option>
                ))}
              </select>
            )}
            {!isAdmin && editTeam.id && (
              <div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <input style={{ ...S.input, fontSize: 12, flex: 1 }} value={coachEmail}
                    onChange={e => { setCoachEmail(e.target.value); setCoachLookup(null); }}
                    placeholder="Enter coach email..." onKeyDown={e => e.key === 'Enter' && handleCoachEmailLookup()} />
                  <button style={{ ...S.btnSm(theme.accent, theme.bg), whiteSpace: 'nowrap' }} onClick={handleCoachEmailLookup}>Look up</button>
                </div>
                {coachLookup?.found && (
                  <div style={{ fontSize: 11, padding: '6px 8px', background: '#10B98115', borderRadius: 6, marginBottom: 4 }}>
                    <span style={{ color: '#10B981' }}>✓</span> Found: {coachLookup.coach.firstname} {coachLookup.coach.lastname}
                    <button onClick={() => handleCoachSelfLink(editTeam.id)}
                      style={{ ...S.btnSm(theme.accent, theme.bg), marginLeft: 8, fontSize: 10 }}>Link</button>
                  </div>
                )}
                {coachLookup && !coachLookup.found && (
                  <div style={{ fontSize: 11, color: theme.danger, padding: '4px 0' }}>✗ {coachLookup.reason}</div>
                )}
              </div>
            )}
            {!editTeam.id && <div style={{ fontSize: 10, color: theme.textDim, fontStyle: 'italic' }}>Save the team first, then assign coaches</div>}
          </div>
          <button style={{ ...S.btn(theme.accent, theme.bg), opacity: editTeam.gender && editTeam.age_group ? 1 : 0.4 }} onClick={handleSaveTeam}>
            {editTeam.id ? 'Save changes' : 'Create team'}
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW: LIST
  // ════════════════════════════════════════════════════════
  return (
    <div style={S.app}>
      <AdminBackBar title="Teams & Institutions" onBack={onBack} />
      <div style={S.page}>
        <button style={S.btn(theme.accent, theme.bg)} onClick={() => handleEditInst(null)}>+ Add institution</button>
        <div style={{ marginTop: 10, marginBottom: 10 }}>
          <input style={{ ...S.input, fontSize: 12 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search institutions or teams..." />
        </div>
        {loading ? (
          <div style={S.empty}><KykieSpinner /></div>
        ) : filteredInsts.length === 0 ? (
          <div style={S.empty}>{q ? 'No results found' : 'No institutions yet.'}</div>
        ) : (
          <div>
            {filteredInsts.map(inst => {
              const instTeams = (teamsByInst[inst.id] || []).sort((a, b) => teamDerivedName(a).localeCompare(teamDerivedName(b)));
              const isExpanded = expanded.has(inst.id);
              const teamCount = instTeams.length;
              const instColor = inst.color || '#1D4ED8';
              const domainStr = inst.domain ? ` · ${inst.domain}` : '';
              return (
                <div key={inst.id} style={{ borderRadius: 10, border: `1px solid ${theme.border}`, marginBottom: 8, overflow: 'hidden' }}>
                  <div onClick={() => toggleExpand(inst.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', background: isExpanded ? theme.surface : 'transparent' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: instColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {(inst.short_name || inst.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</div>
                      <div style={{ fontSize: 10, color: theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inst.short_name || ''}{inst.short_name ? ' · ' : ''}{teamCount} team{teamCount !== 1 ? 's' : ''}{domainStr}
                      </div>
                    </div>
                    {isAdmin && (
                      <button onClick={e => { e.stopPropagation(); handleEditInst(inst); }}
                        style={{ background: 'none', border: 'none', color: theme.textDim, fontSize: 13, cursor: 'pointer', padding: '2px 6px' }}>✎</button>
                    )}
                    <span style={{ fontSize: 11, color: theme.textDim }}>{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${theme.border}`, padding: '6px 12px 10px', background: theme.surface + '88' }}>
                      {instTeams.length === 0 && <div style={{ fontSize: 11, color: theme.textDim, padding: '8px 0' }}>No teams yet</div>}
                      {instTeams.map(t => {
                        const tCoaches = coachTeamMap[t.id] || [];
                        const tier = tierMap[t.id];
                        const eTier = tier?.effectiveTier || 'free';
                        const tColor = TIER_COLORS[eTier];
                        return (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${theme.border}22` }}>
                            <div style={{ width: 3, height: 28, borderRadius: 2, background: instColor, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {teamDerivedName(t)}
                                <span onClick={e => { e.stopPropagation(); if (isAdmin) setTierEdit({ teamId: t.id, teamName: `${inst.short_name || inst.name} ${teamDerivedName(t)}`, tier: eTier, override: tier?.tier_override || '', expires: tier?.override_expires || '', note: tier?.override_note || '', avg: tier?.avg_per_match || 0, credits: tier?.credits_total || 0, matches: tier?.matches_count || 0 }); }}
                                  style={{ fontSize: 8, padding: '1px 6px', borderRadius: 99, fontWeight: 700, background: tColor + '22', color: tColor, cursor: isAdmin ? 'pointer' : 'default' }}>
                                  {TIER_LABELS[eTier]}{tier?.isOverridden ? ' ⚙' : ''}{tier ? ` · ${Math.round(tier.avg_per_match || 0)}avg` : ''}
                                </span>
                              </div>
                              <div style={{ fontSize: 10, color: theme.textDim, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                {t.sport || 'Hockey'} · {t.gender || '?'} · {t.age_group || '?'}
                                {tCoaches.map(c => (
                                  <span key={c.coach_id} style={{ background: '#10B98118', color: '#10B981', padding: '1px 6px', borderRadius: 99, fontSize: 9, fontWeight: 700 }}>
                                    {c.firstname || '?'} {(c.lastname || '').charAt(0)}.
                                  </span>
                                ))}
                              </div>
                            </div>
                            {getShareLink && (
                              <button onClick={e => { e.stopPropagation(); const link = getShareLink(t); navigator.clipboard?.writeText(link).then(() => alert('Link copied!\n' + link)).catch(() => prompt('Copy this link:', link)); }}
                                style={{ background: 'none', border: '1px solid #10B98133', borderRadius: 4, color: '#10B981', fontSize: 10, cursor: 'pointer', padding: '2px 6px' }}>🔗</button>
                            )}
                            <button onClick={e => { e.stopPropagation(); handleEditTeam(t, inst); }}
                              style={{ background: 'none', border: 'none', color: theme.textDim, fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>✎</button>
                            {isAdmin && (
                              <button onClick={e => { e.stopPropagation(); handleDeleteTeam(t); }}
                                style={{ background: 'none', border: 'none', color: theme.danger, fontSize: 11, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
                            )}
                          </div>
                        );
                      })}
                      <div style={{ paddingTop: 8 }}>
                        <button style={{ ...S.btnSm(theme.accent, theme.bg), fontSize: 10 }} onClick={() => handleEditTeam(null, inst)}>+ Add team</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tier Override Popup */}
      {tierEdit && (
        <div onClick={() => setTierEdit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1E293B', borderRadius: 14, padding: 20, width: 320, maxWidth: '100%' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F8FAFC', marginBottom: 4 }}>{tierEdit.teamName}</div>
            <div style={{ fontSize: 10, color: '#64748B', marginBottom: 14 }}>
              {tierEdit.credits > 0 ? `${Math.round(tierEdit.credits)} credits · ${tierEdit.matches} matches · ${Math.round(tierEdit.avg * 10) / 10} avg/match` : 'No credits yet'}
              {' · '}Calculated: {(tierEdit.avg || 0) >= FREE_PLUS_THRESHOLD ? 'Free+' : 'Free'}
            </div>

            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 6 }}>Tier override</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[['', 'None (use calculated)'], ['free_plus', 'Free Plus'], ['premium', 'Premium']].map(([val, label]) => (
                <button key={val} onClick={() => setTierEdit(prev => ({ ...prev, override: val }))} style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                  border: tierEdit.override === val ? '2px solid #F59E0B' : `1px solid ${theme.border}`,
                  background: tierEdit.override === val ? '#F59E0B22' : '#0B0F1A',
                  color: tierEdit.override === val ? '#F59E0B' : '#64748B', cursor: 'pointer',
                }}>{label}</button>
              ))}
            </div>

            {tierEdit.override && (
              <>
                <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>Expires (optional)</div>
                <input type="date" value={tierEdit.expires || ''} onChange={e => setTierEdit(prev => ({ ...prev, expires: e.target.value }))}
                  style={{ ...S.input, fontSize: 12, marginBottom: 12 }} />

                <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>Note</div>
                <input value={tierEdit.note || ''} onChange={e => setTierEdit(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="e.g. Early adopter, beta tester" style={{ ...S.input, fontSize: 12, marginBottom: 14 }} />
              </>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setTierEdit(null)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: '#64748B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => {
                await setTeamTierOverride(tierEdit.teamId, tierEdit.override || null, tierEdit.expires || null, tierEdit.note || null, currentUser?.id);
                setTierEdit(null);
                await load();
              }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#F59E0B', color: '#0B0F1A', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
