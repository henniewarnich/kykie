import { supabase } from './supabase.js';

const SESSION_KEY = 'kykie-session-id';
const LAST_PATH_KEY = '__kykie_last_visit_path';
const LAST_PATH_TS_KEY = '__kykie_last_visit_ts';

function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

function normalisePath(rawHash) {
  const h = (rawHash || '').replace(/^#/, '') || '/';
  // Strip trailing slashes (except for "/") so /home/ and /home count the same
  return h.length > 1 ? h.replace(/\/+$/, '') : h;
}

// Fire-and-forget. Dedupes a same-path visit within 1.5s to absorb
// React StrictMode double-renders and rapid back-forward bounces.
export async function logVisit(rawHash, userId) {
  const path = normalisePath(rawHash ?? window.location.hash);
  const now = Date.now();
  try {
    const lastPath = sessionStorage.getItem(LAST_PATH_KEY);
    const lastTs = Number(sessionStorage.getItem(LAST_PATH_TS_KEY) || 0);
    if (lastPath === path && now - lastTs < 1500) return;
    sessionStorage.setItem(LAST_PATH_KEY, path);
    sessionStorage.setItem(LAST_PATH_TS_KEY, String(now));
  } catch {}

  const row = {
    path,
    referrer: document.referrer || null,
    session_id: getSessionId(),
    user_id: userId || null,
    user_agent: navigator.userAgent || null,
  };

  supabase.from('visit_log').insert(row).then(({ error }) => {
    if (error) console.warn('visit log insert failed:', error.message);
  });
}
