// Single-user sync endpoint for "three", backed by Neon Postgres.
//
// Env vars (set in Vercel):
//   APP_PASSCODE   your private passcode, sent by the app as a Bearer token
//   DATABASE_URL   Neon connection string (the Neon integration adds this;
//                  POSTGRES_URL is also accepted)
//
// GET  /api/data  -> { data: { habits, marks, updated } | null }
// PUT  /api/data  -> body { data: { habits, marks, updated } }
//                    200 { ok: true } when saved
//                    409 { data } when the server already holds a newer version

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const MAX_BYTES = 500 * 1024;
let tableReady = false;

function sameSecret(given, expected) {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function validate(d) {
  if (!d || typeof d !== 'object') return 'data missing';
  if (!Array.isArray(d.habits) || d.habits.length > 3) return 'habits must be an array of at most 3';
  if (!d.marks || typeof d.marks !== 'object' || Array.isArray(d.marks)) return 'marks must be an object';
  if (typeof d.updated !== 'number' || !isFinite(d.updated) || d.updated < 0) return 'updated must be a number';
  if (JSON.stringify({ habits: d.habits, marks: d.marks }).length > MAX_BYTES) return 'payload too large';
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return res.status(500).json({ error: 'APP_PASSCODE is not set on the server' });

  if (!sameSecret(bearer(req), passcode)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return res.status(401).json({ error: 'unauthorized' });
  }

  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return res.status(500).json({ error: 'DATABASE_URL is not set on the server' });

  try {
    const sql = neon(url);

    if (!tableReady) {
      await sql`CREATE TABLE IF NOT EXISTS three_state (
        id integer PRIMARY KEY,
        data jsonb NOT NULL,
        updated_ms bigint NOT NULL
      )`;
      tableReady = true;
    }

    const readCurrent = async () => {
      const rows = await sql`SELECT data, updated_ms FROM three_state WHERE id = 1`;
      if (!rows.length) return null;
      return Object.assign({}, rows[0].data, { updated: Number(rows[0].updated_ms) });
    };

    if (req.method === 'GET') {
      return res.status(200).json({ data: await readCurrent() });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    const d = body && body.data;
    const problem = validate(d);
    if (problem) return res.status(400).json({ error: problem });

    const payload = JSON.stringify({ habits: d.habits, marks: d.marks });
    const updated = String(Math.floor(d.updated));

    // Only overwrite when the incoming version is at least as new as the stored one.
    const rows = await sql`
      INSERT INTO three_state (id, data, updated_ms)
      VALUES (1, ${payload}::jsonb, ${updated}::bigint)
      ON CONFLICT (id) DO UPDATE
        SET data = EXCLUDED.data, updated_ms = EXCLUDED.updated_ms
        WHERE three_state.updated_ms <= EXCLUDED.updated_ms
      RETURNING updated_ms`;

    if (!rows.length) return res.status(409).json({ data: await readCurrent() });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('three sync error', err && err.message);
    return res.status(500).json({ error: 'database error' });
  }
};
