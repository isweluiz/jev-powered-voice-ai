import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// No provider credentials or Google access/refresh tokens are stored here.
export function createPostgresStore(connectionString, { schema = 'public' } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema.');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, options: `-c search_path=${schema}` });
  pool.on('error', () => console.error('Cayana database connection interrupted.'));
  return {
    async init() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(718264903)');
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        for (const migration of ['001-auth', '002-agents']) {
          const applied = await client.query('SELECT id FROM schema_migrations WHERE id = $1', [migration]);
          if (!applied.rowCount) {
            await client.query(await readFile(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
            await client.query('INSERT INTO schema_migrations(id) VALUES ($1)', [migration]);
          }
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async beginLogin({ hash, stateHash, nonce, verifier, expiresAt }) {
      await pool.query('INSERT INTO oauth_transactions(token_hash,state_hash,nonce,verifier,expires_at) VALUES ($1,$2,$3,$4,$5)', [hash, stateHash, nonce, verifier, expiresAt]);
    },
    async consumeLogin(hash, stateHash) {
      const { rows } = await pool.query('DELETE FROM oauth_transactions WHERE token_hash=$1 AND state_hash=$2 AND expires_at>now() RETURNING nonce,verifier', [hash, stateHash]);
      return rows[0] || null;
    },
    async upsertUser(profile) {
      const { rows } = await pool.query(`INSERT INTO users(id,google_sub,email,name,google_domain) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,google_domain=EXCLUDED.google_domain,last_login_at=now()
        RETURNING id,email,name,google_domain`, [randomUUID(), profile.sub, profile.email, profile.name, profile.domain]);
      return rows[0];
    },
    async createSession({ hash, userId, csrfToken, expiresAt }) {
      await pool.query('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)', [hash, userId, csrfToken, expiresAt]);
    },
    async getSession(hash) {
      const { rows } = await pool.query(`SELECT s.csrf_token,s.expires_at,u.id,u.email,u.name,u.google_domain,COALESCE(p.preferences,'{}'::jsonb) AS preferences
        FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_preferences p ON p.user_id=u.id
        WHERE s.token_hash=$1 AND s.expires_at>now()`, [hash]);
      const row = rows[0];
      return row ? { user: { id: row.id, email: row.email, name: row.name, domain: row.google_domain }, csrfToken: row.csrf_token,
        expiresAt: new Date(row.expires_at), preferences: row.preferences } : null;
    },
    async deleteSession(hash) { await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash]); },
    async savePreferences(userId, preferences) {
      await pool.query(`INSERT INTO user_preferences(user_id,preferences) VALUES ($1,$2::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET preferences=EXCLUDED.preferences,updated_at=now()`, [userId, JSON.stringify(preferences)]);
    },
    async listAgents(userId) {
      const { rows } = await pool.query('SELECT configuration FROM agents WHERE user_id=$1 ORDER BY updated_at DESC', [userId]);
      return rows.map(row => row.configuration);
    },
    async getAgent(userId, id) {
      const { rows } = await pool.query('SELECT configuration FROM agents WHERE user_id=$1 AND id=$2', [userId, id]);
      return rows[0]?.configuration || null;
    },
    async saveAgent(userId, agent, { create = false, ifAbsent = false } = {}) {
      const { rows } = create
        ? await pool.query(`INSERT INTO agents(id,user_id,configuration) VALUES ($1,$2,$3::jsonb) ${ifAbsent ? 'ON CONFLICT (id) DO NOTHING' : ''} RETURNING configuration`, [agent.id, userId, JSON.stringify(agent)])
        : await pool.query('UPDATE agents SET configuration=$3::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING configuration', [agent.id, userId, JSON.stringify(agent)]);
      return rows[0]?.configuration || null;
    },
    async cleanup() {
      await pool.query('DELETE FROM sessions WHERE expires_at<=now()');
      await pool.query('DELETE FROM oauth_transactions WHERE expires_at<=now()');
    },
    async close() { await pool.end(); },
  };
}
