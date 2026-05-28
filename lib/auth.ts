const SESSION_KEY = 'am_session';
const EVENT_TOKENS_KEY = 'am_event_tokens';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Session {
  username: string;
  token: string;
}

export async function register(
  username: string,
  password: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.message ?? 'Registration failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Cannot connect to server' };
  }
}

export async function login(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.message ?? 'Invalid username or password' };
    }
    const data = (await res.json()) as { username: string; token: string };
    const session: Session = { username: data.username, token: data.token };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Cannot connect to server' };
  }
}

export async function forgotPassword(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/users/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.message ?? 'Failed to send reset email' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Cannot connect to server' };
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/users/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.message ?? 'Failed to reset password' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Cannot connect to server' };
  }
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function isLoggedIn(): boolean {
  return getSession() !== null;
}

// ---- Event tokens (per-event role) ----

export interface EventToken {
  slug: string;
  role: import('./types').EventRole;
  token: string;
}

function getEventTokens(): Record<string, EventToken> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(EVENT_TOKENS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, EventToken>) : {};
}

export function getEventToken(slug: string): EventToken | null {
  return getEventTokens()[slug] ?? null;
}

export function setEventToken(
  slug: string,
  role: import('./types').EventRole,
  token: string,
): void {
  const tokens = getEventTokens();
  tokens[slug] = { slug, role, token };
  localStorage.setItem(EVENT_TOKENS_KEY, JSON.stringify(tokens));
}

export function clearEventToken(slug: string): void {
  const tokens = getEventTokens();
  delete tokens[slug];
  localStorage.setItem(EVENT_TOKENS_KEY, JSON.stringify(tokens));
}
