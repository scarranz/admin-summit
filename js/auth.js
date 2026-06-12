// Auth module — magic-link login, MFA/TOTP, session management, role gates
import { supabase } from './supabase-client.js';

// ─── Role config ───────────────────────────────────────────

const ROLE_CONFIG = {
  san:     { name: 'San',     label: 'Founder',    allowedPages: ['overview', 'revenue', 'payroll', 'office', 'clock'], defaultPage: 'revenue' },
  deborah: { name: 'Deborah', label: 'Operations', allowedPages: ['revenue', 'office', 'clock'], defaultPage: 'office' },
  oscar:   { name: 'Oscar',   label: 'IT',         allowedPages: ['clock'], defaultPage: 'clock' },
};

let _currentRole = null;  // populated after login

// ─── Public API ────────────────────────────────────────────

export function getCurrentUser() {
  return _currentRole ? { ..._currentRole } : null;
}

export function canAccess(page) {
  return _currentRole?.allowedPages.includes(page) ?? false;
}

// ─── OTP sign-in (email code) ──────────────────────────────

export async function sendOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  return { error };
}

export async function verifyOtp(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });
  return { data, error };
}

// ─── Sign out ──────────────────────────────────────────────

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
}

// ─── Session bootstrap ─────────────────────────────────────
// Called on page load from index.html and login.html

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();

  // No session → go to login
  if (!session) {
    if (!window.location.pathname.endsWith('/login.html')) {
      window.location.href = '/login.html';
    }
    return { status: 'no-session' };
  }

  // Fetch role — try by user_id first, then backfill by email if needed
  let { data: roleRow, error: roleErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', session.user.id)
    .single();

  if (roleErr || !roleRow) {
    // user_id not linked yet — backfill via security-definer RPC
    await supabase.rpc('backfill_user_role_on_login');

    ({ data: roleRow, error: roleErr } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .single());

    if (roleErr || !roleRow) {
      await supabase.auth.signOut();
      return { status: 'unauthorized' };
    }
  }

  const config = ROLE_CONFIG[roleRow.role];
  if (!config) {
    await supabase.auth.signOut();
    return { status: 'unauthorized' };
  }

  _currentRole = { ...config, role: roleRow.role, email: session.user.email };

  // Fully authenticated
  if (window.location.pathname.endsWith('/login.html')) {
    window.location.href = '/index.html';
    return { status: 'redirecting' };
  }

  return { status: 'authenticated', user: _currentRole };
}

// Listen for auth state changes (e.g., token refresh failures)
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    window.location.href = '/login.html';
  }
});
