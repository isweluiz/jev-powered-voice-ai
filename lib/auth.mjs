import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createPostgresStore } from './database.mjs';

export const hashToken = token => createHash('sha256').update(token).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const list = value => (value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
export const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const isLoopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
const authError = (code, message) => Object.assign(new Error(message), { authCode: code });

export function publicOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))) throw new Error('APP_BASE_URL must be an HTTPS origin, or HTTP localhost for development.');
  return url.origin;
}
function cookie(req, name) {
  const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

// A separate, ephemeral identity: never reads or writes Google accounts or sessions.
function developmentAuth(origin) {
  const sessions = new Map();
  const secure = origin?.startsWith('https:') || false;
  const name = secure ? '__Host-cayana_dev_session' : 'cayana_dev_session';
  const ttl = 8 * 60 * 60;
  const setCookie = (value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const user = { id: 'development', name: 'Developer', email: 'developer@localhost', role: 'admin' };
  const sessionHash = req => { const token = cookie(req, name); return token ? hashToken(token) : null; };
  const cleanup = () => { for (const [hash, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(hash); };
  return {
    enabled: true, configured: false, development: true, origin,
    async beginDevelopment(req) {
      cleanup();
      const previousHash = sessionHash(req);
      sessions.delete(previousHash);
      // Bound memory even if a local client repeatedly starts fresh sessions.
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const token = randomToken();
      sessions.set(hashToken(token), { csrfToken: randomToken(), expiresAt: new Date(Date.now() + ttl * 1000) });
      return { cookie: setCookie(token, ttl), previousHash };
    },
    async authenticate(req) {
      cleanup();
      const hash = sessionHash(req), session = sessions.get(hash);
      return session ? { ...session, user: { ...user }, preferences: {}, hash } : null;
    },
    async logout(session) { sessions.delete(session?.hash); return setCookie('', 0); },
    async close() { sessions.clear(); },
  };
}

export async function createAuth({ env, store: suppliedStore, google: suppliedGoogle } = {}) {
  const mode = env.AUTH_MODE || 'google';
  if (!['google', 'local', 'development'].includes(mode)) throw new Error('AUTH_MODE must be google, local, or development.');
  const enabled = mode === 'google';
  const origin = publicOrigin(env.APP_BASE_URL);
  if (mode === 'development') {
    if (env.NODE_ENV !== 'development') throw new Error('Developer sign-in requires NODE_ENV=development.');
    if ((origin && !isLoopback(new URL(origin).hostname)) || (env.HOST && !['localhost', '127.0.0.1', '::1'].includes(env.HOST))) {
      throw new Error('Developer sign-in is only available on localhost.');
    }
    return developmentAuth(origin);
  }
  if (!enabled && origin && !isLoopback(new URL(origin).hostname)) throw new Error('Local mode is only available on localhost.');
  const secure = origin?.startsWith('https:') || false;
  const sessionCookie = secure ? '__Host-osprey_session' : 'osprey_session';
  const loginCookie = secure ? '__Host-osprey_oauth' : 'osprey_oauth';
  const allowAny = env.AUTH_ALLOW_ANY_GOOGLE_ACCOUNT === 'true';
  const domains = list(env.AUTH_ALLOWED_DOMAINS);
  const emails = list(env.AUTH_ALLOWED_EMAILS);
  const admins = list(env.AUTH_ADMIN_EMAILS);
  const ttl = 8 * 60 * 60;
  const setCookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const allowedUser = user => allowAny || emails.includes(user.email.toLowerCase()) || (user.domain && domains.includes(user.domain.toLowerCase()));
  const presentUser = user => ({ id: user.id, email: user.email, name: user.name, role: admins.includes(user.email.toLowerCase()) ? 'admin' : 'member' });
  let store = suppliedStore;
  if (enabled && !store && env.DATABASE_URL) store = createPostgresStore(env.DATABASE_URL);
  if (store) {
    try { await store.init(); }
    catch { await store.close(); throw new Error('Could not initialize the authentication database.'); }
  }
  const configured = enabled && Boolean(origin && store && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && (allowAny || domains.length || emails.length));
  const redirectUri = origin ? origin + '/api/auth/google/callback' : null;
  const client = new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri, transporterOptions: { timeout: 15_000, retry: false } });
  const google = suppliedGoogle || {
    authorizationURL({ state, nonce, verifier }) {
      return client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], access_type: 'online', prompt: 'select_account',
        state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    },
    async verifyCode({ code, verifier }) {
      const { tokens } = await client.getToken({ code, codeVerifier: verifier, redirect_uri: redirectUri });
      if (!tokens.id_token) throw authError('failed', 'Google did not provide an ID token.');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
      return ticket.getPayload();
    },
  };
  const timer = store ? setInterval(() => store.cleanup().catch(() => {}), 15 * 60 * 1000) : null;
  timer?.unref();
  return {
    enabled, configured, origin, redirectUri, store,
    async begin() {
      if (!configured) throw authError('setup', 'Google sign-in is not configured.');
      const token = randomToken(), state = randomToken(), nonce = randomToken(), verifier = randomToken();
      await store.beginLogin({ hash: hashToken(token), stateHash: hashToken(state), nonce, verifier, expiresAt: new Date(Date.now() + 600_000) });
      return { location: google.authorizationURL({ state, nonce, verifier }), cookie: setCookie(loginCookie, token, 600) };
    },
    async complete(req, url) {
      const token = cookie(req, loginCookie), state = url.searchParams.get('state');
      if (!configured || !token || !state || state.length > 200 || url.searchParams.getAll('state').length !== 1) throw authError('expired', 'Login expired.');
      const transaction = await store.consumeLogin(hashToken(token), hashToken(state));
      if (!transaction) throw authError('expired', 'Login expired.');
      if (url.searchParams.has('error')) throw authError('cancelled', 'Login cancelled.');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) throw authError('failed', 'Missing authorization code.');
      const profile = await google.verifyCode({ code, verifier: transaction.verifier });
      if (!profile || typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255 || profile.email_verified !== true ||
          typeof profile.email !== 'string' || profile.email.length > 320 || !sameToken(profile.nonce, transaction.nonce)) throw authError('failed', 'Google identity could not be verified.');
      const identity = { sub: profile.sub, email: profile.email.toLowerCase(), name: String(profile.name || profile.email).slice(0, 200), domain: typeof profile.hd === 'string' ? profile.hd.toLowerCase() : null };
      if (!allowedUser(identity)) throw authError('denied', 'This account is not approved.');
      const user = await store.upsertUser(identity);
      // Rotate any existing login; never accept a browser-supplied user id.
      const previous = cookie(req, sessionCookie);
      if (previous) await store.deleteSession(hashToken(previous));
      const session = randomToken();
      await store.createSession({ hash: hashToken(session), userId: user.id, csrfToken: randomToken(), expiresAt: new Date(Date.now() + ttl * 1000) });
      return { cookies: [setCookie(sessionCookie, session, ttl), setCookie(loginCookie, '', 0)] };
    },
    clearLoginCookie: () => setCookie(loginCookie, '', 0),
    async authenticate(req) {
      if (!enabled || !configured) return null;
      const token = cookie(req, sessionCookie);
      if (!token) return null;
      const hash = hashToken(token), session = await store.getSession(hash);
      if (!session || !allowedUser(session.user)) return null;
      return { ...session, user: presentUser(session.user), hash };
    },
    async logout(session) {
      if (session?.hash) await store.deleteSession(session.hash);
      return setCookie(sessionCookie, '', 0);
    },
    async close() { clearInterval(timer); await store?.close(); },
  };
}
