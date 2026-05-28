const USERS_KEY = 'am_users';
const SESSION_KEY = 'am_session';
const EVENT_TOKENS_KEY = 'am_event_tokens';

export interface User {
  username: string;
  passwordHash: string;
}

export interface Session {
  username: string;
  token: string;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getUsers(): User[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(USERS_KEY);
  return raw ? (JSON.parse(raw) as User[]) : [];
}

function saveUsers(users: User[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function register(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const users = getUsers();
  if (users.find((u) => u.username === username)) {
    return { ok: false, error: 'Username already exists' };
  }
  const passwordHash = await hashPassword(password);
  users.push({ username, passwordHash });
  saveUsers(users);
  return { ok: true };
}

export async function login(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const users = getUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return { ok: false, error: 'Invalid username or password' };
  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash)
    return { ok: false, error: 'Invalid username or password' };
  const token = crypto.randomUUID();
  const session: Session = { username, token };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true };
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
