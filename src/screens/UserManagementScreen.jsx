import { useState, useEffect } from 'react';
import { listUsers, createUser, updateProfile, toggleBlockUser, resetPassword, getAllCoachTeams, assignCoachTeam, removeCoachTeam } from '../utils/auth.js';
import { supabase } from '../utils/supabase.js';
import { S, theme } from '../utils/styles.js';
import { logAudit } from '../utils/audit.js';
import AdminBackBar from '../components/AdminBackBar.jsx';
import { TEAM_SELECT, teamColor, teamDisplayName, teamMatchesSearch } from '../utils/teams.js';
import KykieSpinner from '../components/KykieSpinner.jsx';

const timeAgo = (ts) => {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

const ROLES = [
  { id: 'admin', label: 'Admin', color: '#EF4444' },
  { id: 'commentator', label: 'Commentator', color: '#10B981' },
  { id: 'coach', label: 'Coach', color: '#8B5CF6' },
];

export default function UserManagementScreen({ currentUser, onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | create | edit
  const [editUser, setEditUser] = useState(null);
  const [search, setSearch] = useState("");
  const [allTeams, setAllTeams] = useState([]);
  const [allInstitutions, setAllInstitutions] = useState([]);
  const [coachTeamsMap, setCoachTeamsMap] = useState({}); // { coachId: [team, ...] }
  const [editCoachTeams, setEditCoachTeams] = useState([]); // team IDs for edit view
  const [editRoles, setEditRoles] = useState([]);
  const [teamSearch, setTeamSearch] = useState("");

  // Create form state
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("commentator");
  const [selectedRoles, setSelectedRoles] = useState(["commentator"]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [userTab, setUserTab] = useState("active");

  // Which roles can this user manage?
  const isAdmin = currentUser?.role === 'admin';
  const manageableRoles = isAdmin ? ROLES : ROLES.filter(r => r.id === 'commentator');

  useEffect(() => { loadUsers(); loadTeams(); }, []);

  const loadTeams = async () => {
    const [{ data: t }, { data: insts }] = await Promise.all([
      supabase.from('teams').select(TEAM_SELECT).order('name'),
      supabase.from('institutions').select('id, name, short_name').order('name'),
    ]);
    setAllTeams(t || []);
    setAllInstitutions(insts || []);
  };

  const loadCoachTeams = async () => {
    const assignments = await getAllCoachTeams();
    const map = {};
    assignments.forEach(a => {
      if (!map[a.coach_id]) map[a.coach_id] = [];
      map[a.coach_id].push(a.teams);
    });
    setCoachTeamsMap(map);
  };

  const loadUsers = async () => {
    setLoading(true);
    const data = await listUsers();
    // Non-admins only see commentators
    setUsers(isAdmin ? data : data.filter(u => u.role === 'commentator'));
    setLoading(false);
    // Also refresh coach team assignments
    loadCoachTeams();
  };

  const autoUsername = (fn, ln) => {
    const u = `${fn.trim()}.${ln.trim()}`.toLowerCase().replace(/[\s@]/g, '');
    setUsername(u);
  };

  const handleCreate = async () => {
    if (!firstname.trim() || !lastname.trim() || !username.trim() || !email.trim() || password.length < 6) {
      setSaveError("All fields required. Password must be 6+ characters.");
      return;
    }
    if (username.includes('@')) {
      setSaveError("Username cannot contain @ symbol.");
      return;
    }
    if (!email.includes('@')) {
      setSaveError("Please enter a valid email address.");
      return;
    }
    setSaving(true); setSaveError(""); setSaveSuccess("");
    const result = await createUser({ firstname: firstname.trim(), lastname: lastname.trim(), username: username.trim(), email: email.trim().toLowerCase(), password, role, roles: selectedRoles });
    if (result.error) {
      setSaveError(result.error);
      setSaving(false);
      return;
    }
    setSaveSuccess(`${firstname} ${lastname} created!`);
    setSaving(false);
    setFirstname(""); setLastname(""); setUsername(""); setEmail(""); setPassword(""); setRole("commentator"); setSelectedRoles(["commentator"]);
    setTimeout(() => { setSaveSuccess(""); loadUsers(); setView("list"); }, 1500);
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    setSaving(true); setSaveError("");

    const origUser = users.find(u => u.id === editUser.id);
    const commStatusChanged = origUser && editUser.commentator_status !== origUser.commentator_status;
    const coachStatusChanged = origUser && editUser.coach_status !== origUser.coach_status;

    const result = await updateProfile(editUser.id, {
      firstname: editUser.firstname,
      lastname: editUser.lastname,
      role: editUser.role,
      roles: editRoles,
      mobile_number: editUser.mobile_number?.trim() || null,
      commentator_status: editUser.commentator_status || null,
      coach_status: editUser.coach_status || null,
    });
    if (result.error) { setSaveError(result.error); setSaving(false); return; }

    if (commStatusChanged) {
      logAudit('commentator_status_override', 'profile', editUser.id, {
        from: origUser.commentator_status,
        to: editUser.commentator_status,
        name: `${editUser.firstname} ${editUser.lastname}`,
      }).catch(() => {});
    }

    if (coachStatusChanged) {
      logAudit('coach_status_change', 'profile', editUser.id, {
        from: origUser.coach_status,
        to: editUser.coach_status,
        name: `${editUser.firstname} ${editUser.lastname}`,
      }).catch(() => {});
    }

    // Save coach team assignments if roles include coach
    if (editRoles.includes('coach')) {
      const current = (coachTeamsMap[editUser.id] || []).map(t => t.id);
      // Remove unassigned
      for (const tid of current) {
        if (!editCoachTeams.includes(tid)) await removeCoachTeam(editUser.id, tid);
      }
      // Add new
      for (const tid of editCoachTeams) {
        if (!current.includes(tid)) await assignCoachTeam(editUser.id, tid);
      }
    }

    setSaving(false);
    loadUsers();
    setView("list");
  };

  const openEdit = (u) => {
    setEditUser({ ...u });
    setEditRoles(u.roles?.length > 0 ? [...u.roles] : [u.role]);
    setEditCoachTeams((coachTeamsMap[u.id] || []).map(t => t.id));
    setTeamSearch("");
    setView("edit");
    setSaveError("");
  };

  const handleToggleBlock = async (user) => {
    await toggleBlockUser(user.id, !user.blocked);
    loadUsers();
  };

  const filtered = search.trim()
    ? users.filter(u => `${u.firstname} ${u.lastname} ${u.username}`.toLowerCase().includes(search.toLowerCase()))
    : users;

  const roleColor = (r) => ROLES.find(x => x.id === r)?.color || "#64748B";
  const roleLabel = (r) => ROLES.find(x => x.id === r)?.label || r;
  const activeUsers = filtered.filter(u => !u.blocked);
  const blockedUsers = filtered.filter(u => u.blocked);
  const displayUsers = userTab === "active" ? activeUsers : blockedUsers;

  // ── CREATE VIEW ──
  if (view === "create") return (
    <div style={S.app}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => { setView("list"); setSaveError(""); setSaveSuccess(""); }} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>New User</div>
      </div>
      <div style={S.page}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>First Name</div>
          <input style={S.input} value={firstname} onChange={e => { setFirstname(e.target.value); autoUsername(e.target.value, lastname); }} placeholder="e.g. John" autoFocus />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Last Name</div>
          <input style={S.input} value={lastname} onChange={e => { setLastname(e.target.value); autoUsername(firstname, e.target.value); }} placeholder="e.g. Smith" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Username</div>
          <input style={{ ...S.input, fontSize: 12, color: "#F59E0B" }} value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[\s@]/g, ''))} />
          <div style={{ fontSize: 9, color: theme.textDim, marginTop: 3 }}>Auto-generated from name — you can edit it</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Email</div>
          <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. john@school.co.za" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Password</div>
          <input style={S.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Roles <span style={{ fontSize: 9, color: "#475569" }}>(tap to toggle, first = primary)</span></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {manageableRoles.map(r => {
              const isOn = selectedRoles.includes(r.id);
              return (
                <button key={r.id} onClick={() => {
                  setSelectedRoles(prev => {
                    if (isOn) {
                      const next = prev.filter(x => x !== r.id);
                      if (next.length === 0) return prev; // must have at least one
                      setRole(next[0]);
                      return next;
                    }
                    const next = [...prev, r.id];
                    return next;
                  });
                  if (!isOn) setRole(r.id);
                }} style={{
                  padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: isOn ? `2px solid ${r.color}` : `1px solid ${theme.border}`,
                  background: isOn ? r.color + "22" : theme.bg,
                  color: isOn ? r.color : theme.textMuted, cursor: "pointer",
                }}>{r.label}{isOn && selectedRoles[0] === r.id ? ' ★' : ''}</button>
              );
            })}
          </div>
        </div>

        {saveError && <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 10, textAlign: "center" }}>{saveError}</div>}
        {saveSuccess && <div style={{ fontSize: 11, color: "#10B981", marginBottom: 10, textAlign: "center" }}>{saveSuccess}</div>}

        <button onClick={handleCreate} disabled={saving} style={{
          ...S.btn(theme.accent, theme.bg), opacity: saving ? 0.5 : 1,
        }}>{saving ? "Creating..." : "Create User"}</button>
      </div>
    </div>
  );

  // ── EDIT VIEW ──
  if (view === "edit" && editUser) return (
    <div style={S.app}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => { setView("list"); setSaveError(""); }} style={{ background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 0 }}>←</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Edit User</div>
      </div>
      <div style={S.page}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>First Name</div>
          <input style={S.input} value={editUser.firstname} onChange={e => setEditUser(p => ({ ...p, firstname: e.target.value }))} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Last Name</div>
          <input style={S.input} value={editUser.lastname} onChange={e => setEditUser(p => ({ ...p, lastname: e.target.value }))} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Username</div>
          <div style={{ fontSize: 13, color: "#F59E0B", padding: "10px 0" }}>{editUser.username}</div>
          <div style={{ fontSize: 9, color: theme.textDim }}>Username cannot be changed</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Mobile Number</div>
          <input style={S.input} type="tel" value={editUser.mobile_number || ''}
            onChange={e => setEditUser(p => ({ ...p, mobile_number: e.target.value }))}
            placeholder="e.g. 082 123 4567" />
        </div>

        {/* Profile details — read-only summary of registration data */}
        {(() => {
          const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          const instLookup = id => allInstitutions.find(i => i.id === id);
          const supportingNames = (editUser.supporting_institution_ids || [])
            .map(id => instLookup(id))
            .filter(Boolean)
            .map(i => i.short_name || i.name);
          const sportLabel = (editUser.sport_interest || []).join(', ') || '—';
          const notifBits = [];
          if (editUser.notify_live) notifBits.push('Live');
          if (editUser.notify_rewards) notifBits.push('Rewards');
          if (editUser.notify_general) notifBits.push('General');
          const Row = ({ label, value }) => (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 10, color: theme.textDim, flex: '0 0 110px' }}>{label}</div>
              <div style={{ fontSize: 11, color: theme.text, flex: 1, wordBreak: 'break-word' }}>{value || '—'}</div>
            </div>
          );
          return (
            <div style={{ marginBottom: 16, background: theme.surface, borderRadius: 10, padding: '4px 12px', border: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.5, padding: '8px 0 4px', textTransform: 'uppercase' }}>Profile details</div>
              <Row label="Email" value={editUser.email} />
              <Row label="Date of birth" value={editUser.date_of_birth ? fmtDate(editUser.date_of_birth) : null} />
              <Row label="Gender" value={editUser.biological_gender ? editUser.biological_gender.charAt(0).toUpperCase() + editUser.biological_gender.slice(1) : null} />
              <Row label="Home town" value={editUser.home_town} />
              <Row label="Sport interest" value={sportLabel === '—' ? null : sportLabel} />
              <Row label="Supporting" value={supportingNames.length > 0 ? supportingNames.join(', ') : null} />
              <Row label="Notifications" value={notifBits.length > 0 ? notifBits.join(' · ') : 'None'} />
              <Row label="Terms accepted" value={editUser.accepted_terms_at ? fmtDate(editUser.accepted_terms_at) : null} />
              <Row label="Last seen" value={editUser.last_seen_at ? fmtDate(editUser.last_seen_at) : null} />
              <Row label="Joined" value={editUser.created_at ? fmtDate(editUser.created_at) : null} />
            </div>
          );
        })()}

        {isAdmin && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Roles <span style={{ fontSize: 9, color: "#475569" }}>(tap to toggle, first = primary)</span></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ROLES.map(r => {
                const isOn = editRoles.includes(r.id);
                return (
                  <button key={r.id} onClick={() => {
                    setEditRoles(prev => {
                      if (isOn) {
                        const next = prev.filter(x => x !== r.id);
                        if (next.length === 0) return prev;
                        setEditUser(p => ({ ...p, role: next[0] }));
                        return next;
                      }
                      return [...prev, r.id];
                    });
                    if (!isOn && editRoles.length === 0) setEditUser(p => ({ ...p, role: r.id }));
                  }} style={{
                    padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    border: isOn ? `2px solid ${r.color}` : `1px solid ${theme.border}`,
                    background: isOn ? r.color + "22" : theme.bg,
                    color: isOn ? r.color : theme.textMuted, cursor: "pointer",
                  }}>{r.label}{isOn && editRoles[0] === r.id ? ' ★' : ''}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* Commentator status override */}
        {isAdmin && editRoles.includes('commentator') && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Commentator Status</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: 'trainee', label: 'Trainee', color: '#64748B' },
                { id: 'apprentice', label: 'Apprentice', color: '#F59E0B' },
                { id: 'qualified', label: 'Qualified', color: '#10B981' },
              ].map(s => {
                const isOn = editUser.commentator_status === s.id;
                return (
                  <button key={s.id} onClick={() => setEditUser(p => ({ ...p, commentator_status: s.id }))} style={{
                    flex: 1, padding: "8px 6px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    border: isOn ? `2px solid ${s.color}` : `1px solid ${theme.border}`,
                    background: isOn ? s.color + "22" : theme.bg,
                    color: isOn ? s.color : theme.textMuted, cursor: "pointer",
                  }}>{s.label}</button>
                );
              })}
            </div>
            {editUser.commentator_status !== users.find(u => u.id === editUser.id)?.commentator_status && (
              <div style={{ fontSize: 9, color: '#F59E0B', marginTop: 4 }}>Status will be changed — logged in audit trail</div>
            )}
          </div>
        )}

        {/* Coach status */}
        {isAdmin && editRoles.includes('coach') && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Coach Status</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: 'pending', label: 'Pending', color: '#F59E0B' },
                { id: 'approved', label: 'Approved', color: '#10B981' },
              ].map(s => {
                const isOn = editUser.coach_status === s.id;
                return (
                  <button key={s.id} onClick={() => setEditUser(p => ({ ...p, coach_status: s.id }))} style={{
                    flex: 1, padding: "8px 6px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    border: isOn ? `2px solid ${s.color}` : `1px solid ${theme.border}`,
                    background: isOn ? s.color + "22" : theme.bg,
                    color: isOn ? s.color : theme.textMuted, cursor: "pointer",
                  }}>{s.label}</button>
                );
              })}
            </div>
            {editUser.coach_status !== users.find(u => u.id === editUser.id)?.coach_status && (
              <div style={{ fontSize: 9, color: '#F59E0B', marginTop: 4 }}>Status will be changed — logged in audit trail</div>
            )}
            {editUser.coach_status === 'pending' && editUser.email && (
              <div style={{ fontSize: 9, color: '#64748B', marginTop: 4 }}>Email domain: <span style={{ color: '#94A3B8', fontWeight: 600 }}>{editUser.email.split('@')[1]}</span></div>
            )}
          </div>
        )}

        {/* Coach team assignments */}
        {editRoles.includes('coach') && isAdmin && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Assigned Teams</div>
            {/* Selected teams */}
            {editCoachTeams.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                {editCoachTeams.map(tid => {
                  const t = allTeams.find(x => x.id === tid);
                  if (!t) return null;
                  return (
                    <span key={tid} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                      background: (teamColor(t)) + "22", color: teamColor(t),
                      border: `1px solid ${teamColor(t)}44`,
                    }}>
                      {teamDisplayName(t)}
                      <span onClick={() => setEditCoachTeams(prev => prev.filter(x => x !== tid))}
                        style={{ cursor: "pointer", marginLeft: 2, fontSize: 13, lineHeight: 1 }}>×</span>
                    </span>
                  );
                })}
              </div>
            )}
            {/* Team search + add */}
            <input style={{ ...S.input, fontSize: 11 }} value={teamSearch} onChange={e => setTeamSearch(e.target.value)} placeholder="🔍 Search teams to add..." />
            {teamSearch.trim() && (
              <div style={{ maxHeight: 140, overflowY: "auto", marginTop: 4, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg }}>
                {allTeams.filter(t => !editCoachTeams.includes(t.id) && teamMatchesSearch(t, teamSearch)).map(t => (
                  <div key={t.id} onClick={() => { setEditCoachTeams(prev => [...prev, t.id]); setTeamSearch(""); }}
                    style={{ padding: "8px 12px", fontSize: 12, color: theme.text, cursor: "pointer", borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: teamColor(t), flexShrink: 0 }} />
                    {teamDisplayName(t)}
                  </div>
                ))}
                {allTeams.filter(t => !editCoachTeams.includes(t.id) && teamMatchesSearch(t, teamSearch)).length === 0 && (
                  <div style={{ padding: "8px 12px", fontSize: 11, color: theme.textDim }}>No matching teams</div>
                )}
              </div>
            )}
            {editCoachTeams.length === 0 && !teamSearch.trim() && (
              <div style={{ fontSize: 10, color: theme.textDim, marginTop: 4 }}>No teams assigned — search above to add</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={async () => {
            await handleToggleBlock(editUser);
            setEditUser(prev => ({ ...prev, blocked: !prev.blocked }));
            setSaveSuccess(editUser.blocked ? "User unblocked" : "User blocked");
            setTimeout(() => setSaveSuccess(""), 3000);
          }} style={{
            flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${editUser.blocked ? "#10B98144" : "#EF444444"}`,
            background: "transparent", color: editUser.blocked ? "#10B981" : "#EF4444",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>{editUser.blocked ? "Unblock User" : "Block User"}</button>
          <button onClick={async () => {
            const newPw = prompt("Enter new password for " + editUser.firstname + " (min 6 characters):");
            if (!newPw || newPw.length < 6) { if (newPw !== null) setSaveError("Password must be 6+ characters"); return; }
            const result = await resetPassword(editUser.id, newPw);
            if (result.error) { setSaveError(result.error); }
            else { setSaveSuccess(`Password reset for ${editUser.firstname}`); setTimeout(() => setSaveSuccess(""), 4000); }
          }} style={{
            flex: 1, padding: 12, borderRadius: 10, border: "1px solid #F59E0B44",
            background: "transparent", color: "#F59E0B",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>🔑 Reset Password</button>
        </div>

        <button onClick={async () => {
          if (!confirm(`Permanently delete ${editUser.firstname} ${editUser.lastname}? This cannot be undone.`)) return;
          const { error } = await supabase.rpc('delete_user', { p_id: editUser.id });
          if (error) {
            if (error.message.includes('foreign key') || error.message.includes('violates') || error.message.includes('referenced')) {
              setSaveError(`Cannot delete — this user has match history. Use "Block User" instead.`);
            } else {
              setSaveError(`Delete failed: ${error.message}`);
            }
            return;
          }
          setView("list"); loadUsers();
        }} style={{
          width: "100%", padding: 10, borderRadius: 10, border: "1px solid #EF444444",
          background: "#EF444411", color: "#EF4444",
          fontSize: 11, fontWeight: 700, cursor: "pointer", marginBottom: 12,
        }}>🗑 Delete User Permanently</button>

        {saveError && <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 10, textAlign: "center" }}>{saveError}</div>}
        {saveSuccess && <div style={{ fontSize: 11, color: "#10B981", marginBottom: 10, textAlign: "center" }}>{saveSuccess}</div>}

        <button onClick={handleUpdate} disabled={saving} style={{
          ...S.btn(theme.accent, theme.bg), opacity: saving ? 0.5 : 1,
        }}>{saving ? "Saving..." : "Save Changes"}</button>
      </div>
    </div>
  );

  // ── LIST VIEW ──

  return (
    <div style={S.app}>
      <AdminBackBar title="User Management" onBack={onBack} />
      <div style={S.page}>
        <button style={S.btn(theme.accent, theme.bg)} onClick={() => setView("create")}>+ New User</button>

        {/* Tabs */}
        <div style={{ display: "flex", marginTop: 10, marginBottom: 10, borderRadius: 8, overflow: "hidden", border: `1px solid ${theme.border}` }}>
          <button onClick={() => setUserTab("active")} style={{
            flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
            background: userTab === "active" ? "#33415577" : "#1E293B", color: userTab === "active" ? "#F8FAFC" : "#64748B",
          }}>Active ({activeUsers.length})</button>
          <button onClick={() => setUserTab("blocked")} style={{
            flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
            background: userTab === "blocked" ? "#EF444422" : "#1E293B", color: userTab === "blocked" ? "#EF4444" : "#64748B",
          }}>Blocked ({blockedUsers.length})</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <input style={{ ...S.input, fontSize: 12 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search users..." />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 30 }}><KykieSpinner /></div>
        ) : displayUsers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 30, color: theme.textDim }}>{userTab === "blocked" ? "No blocked users" : "No users found"}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {displayUsers.map(u => (
              <div key={u.id} onClick={() => openEdit(u)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  background: theme.surface, borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${theme.border}`,
                }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, background: roleColor(u.role) + "22",
                  border: `1.5px solid ${roleColor(u.role)}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, color: roleColor(u.role), flexShrink: 0,
                }}>{u.firstname?.charAt(0)}{u.lastname?.charAt(0)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
                    {u.firstname} {u.lastname}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textDim, marginTop: 1 }}>{u.username} · {u.email}</div>
                  {u.last_seen_at && (
                    <div style={{ fontSize: 9, color: timeAgo(u.last_seen_at).startsWith('Just') || timeAgo(u.last_seen_at).match(/^\d+[mh]/) ? "#10B981" : "#64748B", marginTop: 2 }}>
                      Last seen {timeAgo(u.last_seen_at)}
                    </div>
                  )}
                  {(u.roles?.includes('coach') || u.role === 'coach') && coachTeamsMap[u.id]?.length > 0 && (
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
                      {coachTeamsMap[u.id].map(t => (
                        <span key={t.id} style={{
                          fontSize: 8, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                          background: (teamColor(t)) + "22", color: teamColor(t),
                        }}>{teamDisplayName(t)}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flexShrink: 0, alignItems: "center" }}>
                  {(u.roles?.length > 1 ? u.roles : [u.role]).map(r => (
                    <span key={r} style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99,
                      background: roleColor(r) + "22", color: roleColor(r),
                    }}>{roleLabel(r)}</span>
                  ))}
                  {u.commentator_status && (u.roles?.includes('commentator') || u.role === 'commentator') && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 99,
                      background: u.commentator_status === 'qualified' ? '#10B98122' : u.commentator_status === 'apprentice' ? '#F59E0B22' : '#64748B22',
                      color: u.commentator_status === 'qualified' ? '#10B981' : u.commentator_status === 'apprentice' ? '#F59E0B' : '#64748B',
                    }}>{u.commentator_status}</span>
                  )}
                  {u.coach_status && (u.roles?.includes('coach') || u.role === 'coach') && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 99,
                      background: u.coach_status === 'approved' ? '#10B98122' : '#F59E0B22',
                      color: u.coach_status === 'approved' ? '#10B981' : '#F59E0B',
                    }}>{u.coach_status === 'pending' ? '⏳ pending' : 'coach ✓'}</span>
                  )}
                </div>
                <span style={{ color: "#334155", fontSize: 14 }}>›</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
