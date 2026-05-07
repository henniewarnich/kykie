import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { logAudit, logAuditAs } from './audit.js';
import { teamSlug } from './teams.js';

// Sign in with username or email
export async function signIn(usernameOrEmail, password) {
  let email = usernameOrEmail.trim();
  
  // If no @, treat as username — look up email from profiles
  if (!email.includes('@')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', email.toLowerCase())
      .single();
    if (!profile) return { error: 'User not found' };
    
    // Get the auth user's email via the profile id
    // We need to query auth.users but can't directly — so we store email in profiles
    const { data: p2 } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', email.toLowerCase())
      .single();
    if (!p2?.email) return { error: 'User not found' };
    email = p2.email;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  // Stamp last seen
  if (data.user?.id) {
    supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', data.user.id).then(() => {});
  }
  return { user: data.user, session: data.session };
}

// Sign out
export async function signOut() {
  await logAudit('logout', 'auth');
  await supabase.auth.signOut();
}

// Get current session
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// Get current user's profile
export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return getProfileById(user.id);
}

// Get profile by user ID
export async function getProfileById(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return profile;
}

// Get profile by email
export async function getProfileByEmail(email) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .single();
  return profile;
}

// Get profile by username
export async function getProfileByUsername(username) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();
  return profile;
}

// Create a new user (admin only)
export async function createUser({ firstname, lastname, username, email, password, role, roles }) {
  // Pre-check: username uniqueness
  const { data: existing } = await supabase.from('profiles').select('id').eq('username', username.toLowerCase().trim()).maybeSingle();
  if (existing) return { error: `Username "${username}" is already taken.` };

  // Save current admin session
  const { data: { session: adminSession } } = await supabase.auth.getSession();
  
  // Create auth user — no metadata, no trigger
  const { data, error } = await supabase.auth.signUp({ email, password });
  
  if (error) {
    if (adminSession) await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
    return { error: error.message };
  }

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    if (adminSession) await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
    return { error: `Email "${email}" is already registered.` };
  }

  if (!data.user) {
    if (adminSession) await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
    return { error: 'User creation failed.' };
  }

  // Restore admin session immediately
  if (adminSession) {
    await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
  }

  // Create profile via SECURITY DEFINER function (bypasses RLS)
  const { error: profileErr } = await supabase.rpc('create_profile', {
    p_id: data.user.id,
    p_email: email,
    p_firstname: firstname,
    p_lastname: lastname,
    p_username: username.toLowerCase().trim(),
    p_role: role,
  });

  if (profileErr) return { error: `Auth user created but profile failed: ${profileErr.message}` };

  // Verify it actually inserted
  const { data: verify } = await supabase.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
  if (!verify) return { error: 'Profile creation failed unexpectedly.' };

  // Update roles array if multiple roles provided
  if (roles && roles.length > 0) {
    await supabase.from('profiles').update({ roles }).eq('id', data.user.id);
  }

  // Admin-created commentators are qualified by default (skip training)
  if (role === 'commentator' || roles?.includes('commentator')) {
    await supabase.from('profiles').update({ commentator_status: 'qualified' }).eq('id', data.user.id);
  }

  await logAudit('user_create', 'user', data.user.id, { firstname, lastname, username, email, role, roles });
  return { user: data.user };
}

// Update a user's profile (admin function)
export async function updateProfile(userId, updates) {
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);
  if (error) return { error: error.message };
  await logAudit('user_update', 'user', userId, updates);
  return { success: true };
}

// Reset a user's password (admin function via Edge Function)
export async function resetPassword(userId, newPassword) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ userId, newPassword }),
  });

  const data = await res.json();
  if (!res.ok) return { error: data.error || 'Failed to reset password' };
  await logAudit('password_reset', 'user', userId);
  return { success: true };
}

// Self-register (public registration)
export async function registerUser({ email, password, firstname, lastname, username, role = 'supporter', alias_nickname, date_of_birth, biological_gender, home_town, mobile_number, sport_interest, supporting_institution_ids, teamIds, notify_live, notify_rewards, notify_general, accepted_terms_at }) {
  // Pre-check: username uniqueness
  const { data: existing } = await supabase.from('profiles').select('id').eq('username', username.toLowerCase().trim()).maybeSingle();
  if (existing) return { error: `Username "${username}" is already taken.` };

  // Create auth user
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: `Email "${email}" is already registered.` };
  }

  if (!data.user) return { error: 'Registration failed.' };

  // Create profile via SECURITY DEFINER function
  const { error: profileErr } = await supabase.rpc('register_crowd_profile', {
    p_id: data.user.id,
    p_email: email.toLowerCase().trim(),
    p_firstname: firstname.trim(),
    p_lastname: lastname.trim(),
    p_username: username.toLowerCase().trim(),
    p_role: role,
    p_alias_nickname: alias_nickname?.trim() || null,
    p_date_of_birth: date_of_birth || null,
    p_biological_gender: biological_gender || null,
    p_home_town: home_town?.trim() || null,
    p_sport_interest: sport_interest || [],
    p_supporting_institution_ids: supporting_institution_ids || [],
    p_notify_live: notify_live !== false,
    p_notify_rewards: notify_rewards !== false,
    p_notify_general: notify_general !== false,
    p_accepted_terms_at: accepted_terms_at || null,
    p_mobile_number: mobile_number?.trim() || null,
  });

  if (profileErr) return { error: `Account created but profile failed: ${profileErr.message}` };

  // Coach: link to selected teams
  if (role === 'coach' && teamIds && teamIds.length > 0) {
    const rows = teamIds.map(tid => ({ coach_id: data.user.id, team_id: tid }));
    await supabase.from('coach_teams').upsert(rows, { onConflict: 'coach_id,team_id' });
  }

  return { user: data.user };
}

// Backward compat alias
export const registerCrowdUser = registerUser;

// Request password reset email (self-service)
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/',
  });
  if (error) return { error: error.message };
  return { success: true };
}

// Update own password (used after clicking reset link)
export async function updateOwnPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  await logAudit('password_self_reset', 'auth');
  return { success: true };
}

// Block/unblock a user
export async function toggleBlockUser(userId, blocked) {
  await logAudit(blocked ? 'user_block' : 'user_unblock', 'user', userId);
  return updateProfile(userId, { blocked });
}

// List all users (admin function)
export async function listUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

// List users by role
export async function listUsersByRole(role) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', role)
    .order('firstname');
  if (error) return [];
  return data;
}

// ── COACH TEAM ASSIGNMENTS ──────────────────────────

// Get teams assigned to a coach
export async function getCoachTeams(coachId) {
  const { data, error } = await supabase
    .from('coach_teams')
    .select('team_id, teams(id, name, color, short_name, gender, sport, age_group, variant, institution:institutions(*))')
    .eq('coach_id', coachId);
  if (error) return [];
  return data.map(d => d.teams);
}

// Get all coach_teams records (for admin user list)
export async function getAllCoachTeams() {
  const { data, error } = await supabase
    .from('coach_teams')
    .select('coach_id, team_id, teams(id, name, color, short_name, gender, sport, age_group, variant, institution:institutions(*))');
  if (error) return [];
  return data;
}

// Assign a coach to a team
export async function assignCoachTeam(coachId, teamId) {
  const { error } = await supabase
    .from('coach_teams')
    .upsert({ coach_id: coachId, team_id: teamId }, { onConflict: 'coach_id,team_id' });
  if (error) return { error: error.message };
  await logAudit('coach_assign', 'team', teamId, { coach_id: coachId });
  return { success: true };
}

// Remove a coach from a team
export async function removeCoachTeam(coachId, teamId) {
  const { error } = await supabase
    .from('coach_teams')
    .delete()
    .eq('coach_id', coachId)
    .eq('team_id', teamId);
  if (error) return { error: error.message };
  await logAudit('coach_unassign', 'team', teamId, { coach_id: coachId });
  return { success: true };
}

// Check if a user is an assigned coach for a specific team (by slug)
export async function isCoachForTeam(userId, teamSlug) {
  const slugify = (s) => (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '');
  const { data } = await supabase
    .from('coach_teams')
    .select('team_id, teams!inner(name, age_group, variant, institution:institutions(name))')
    .eq('coach_id', userId);
  if (!data || data.length === 0) return false;
  return data.some(d => {
    const instName = d.teams.institution?.name || '';
    const suffix = d.teams.variant || d.teams.age_group || '';
    const fullSlug = suffix ? slugify(`${instName} ${suffix}`) : slugify(instName);
    return fullSlug === teamSlug || slugify(d.teams.name) === teamSlug;
  });
}
