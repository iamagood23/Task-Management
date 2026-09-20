/*
 * Task Management Application - backend
 * Zero external dependencies. Pure Node.js (http, fs, crypto).
 *
 *   REST API  ->  /api/*
 *   Static    ->  ./public
 *   Realtime  ->  /api/events   (Server-Sent Events)
 *
 * Start:  node server.js      (optional: PORT=4000 node server.js)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PID_FILE = path.join(ROOT, '.server.pid');

/* --------------------------------------------------------------------------- *
 *  Storage - a single JSON file, written atomically.
 * --------------------------------------------------------------------------- */

let db = { users: [], tasks: [], activity: [], settings: {}, _secret: null };

function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_) {
    db = { users: [], tasks: [], activity: [], settings: {}, _secret: null };
  }
  db.users = Array.isArray(db.users) ? db.users : [];
  db.tasks = Array.isArray(db.tasks) ? db.tasks : [];
  db.activity = Array.isArray(db.activity) ? db.activity : [];
  db.settings = db.settings && typeof db.settings === 'object' ? db.settings : {};
  // Forward-compat: make sure every task carries the richer fields.
  db.tasks = db.tasks.map(migrateTask);
  if (!db._secret) {
    db._secret = crypto.randomBytes(48).toString('hex');
    saveDB();
  }
}

function migrateTask(t) {
  return {
    tags: [],
    checklist: [],
    attachments: [],
    notes: '',
    startDate: null,
    estimateMinutes: null,
    recurring: 'none',
    archived: false,
    completedAt: t && t.status === 'done' ? t.completedAt || t.updatedAt || null : t ? t.completedAt || null : null,
    ...t,
  };
}

function saveDB() {
  const tmp = DATA_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* --------------------------------------------------------------------------- *
 *  Auth helpers - scrypt password hashing + HMAC signed tokens.
 * --------------------------------------------------------------------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

const sign = (data) => b64url(crypto.createHmac('sha256', db._secret).update(data).digest());

function createToken(userId) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + 7 * 24 * 3600 * 1000 }));
  return payload + '.' + sign(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    if (!data.exp || data.exp < Date.now()) return null;
    return data.uid;
  } catch (_) {
    return null;
  }
}

function userFromRequest(req) {
  let token = null;
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
  if (!token && req.query) token = req.query.token; // EventSource can't set headers
  const uid = verifyToken(token);
  if (!uid) return null;
  return db.users.find((u) => u.id === uid) || null;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt };
}

/* --------------------------------------------------------------------------- *
 *  Realtime - Server-Sent Events, one channel per user.
 * --------------------------------------------------------------------------- */

const sseClients = new Map(); // userId -> Set<res>

function sseAdd(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
}

function sseRemove(userId, res) {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(userId);
}

function broadcast(userId, event, data) {
  const set = sseClients.get(userId);
  if (!set) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(frame);
    } catch (_) {
      /* ignore broken pipe */
    }
  }
}

/* --------------------------------------------------------------------------- *
 *  HTTP plumbing
 * --------------------------------------------------------------------------- */

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve(null); // signals malformed JSON
      }
    });
    req.on('error', () => resolve(null));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) return send(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(idx);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

/* --------------------------------------------------------------------------- *
 *  Validation
 * --------------------------------------------------------------------------- */

const STATUSES = ['todo', 'in-progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const RECURRING = ['none', 'daily', 'weekly', 'monthly'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v, max) {
  return String(v == null ? '' : v).slice(0, max);
}

function cleanChecklist(v) {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 100).map((it) => ({
    id: str(it && it.id, 40) || crypto.randomUUID(),
    text: str(it && it.text, 300).trim(),
    done: !!(it && it.done),
  })).filter((it) => it.text);
}

function cleanAttachments(v) {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 30).map((it) => ({
    id: str(it && it.id, 40) || crypto.randomUUID(),
    label: str(it && it.label, 200).trim(),
    url: str(it && it.url, 2000).trim(),
  })).filter((it) => it.label || it.url);
}

function cleanTags(v) {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set();
  const out = [];
  for (const raw of v) {
    const tag = str(raw, 40).trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
    if (out.length >= 20) break;
  }
  return out;
}

function cleanTaskInput(body, existing) {
  const t = existing ? { ...existing } : {};
  if ('title' in body) t.title = str(body.title, 200).trim();
  if ('description' in body) t.description = str(body.description, 8000).trim();
  if ('notes' in body) t.notes = str(body.notes, 8000);
  if ('status' in body && STATUSES.includes(body.status)) t.status = body.status;
  if ('priority' in body && PRIORITIES.includes(body.priority)) t.priority = body.priority;
  if ('recurring' in body && RECURRING.includes(body.recurring)) t.recurring = body.recurring;
  if ('dueDate' in body) t.dueDate = body.dueDate ? str(body.dueDate, 10) : null;
  if ('startDate' in body) t.startDate = body.startDate ? str(body.startDate, 10) : null;
  if ('estimateMinutes' in body) {
    const n = Number(body.estimateMinutes);
    t.estimateMinutes = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100000) : null;
  }
  if ('archived' in body) t.archived = !!body.archived;
  const tags = cleanTags(body.tags);
  if (tags) t.tags = tags;
  const checklist = cleanChecklist(body.checklist);
  if (checklist) t.checklist = checklist;
  const attachments = cleanAttachments(body.attachments);
  if (attachments) t.attachments = attachments;
  return t;
}

/* --------------------------------------------------------------------------- *
 *  Activity feed - capped ring buffer per user.
 * --------------------------------------------------------------------------- */

const ACTIVITY_CAP = 400;

function logActivity(userId, type, task, meta) {
  const entry = {
    id: crypto.randomUUID(),
    userId,
    type,
    taskId: task ? task.id : null,
    taskTitle: task ? task.title : '',
    meta: meta || {},
    at: new Date().toISOString(),
  };
  db.activity.push(entry);
  // keep only the most recent ACTIVITY_CAP per user
  const mine = db.activity.filter((a) => a.userId === userId);
  if (mine.length > ACTIVITY_CAP) {
    const drop = new Set(mine.slice(0, mine.length - ACTIVITY_CAP).map((a) => a.id));
    db.activity = db.activity.filter((a) => !drop.has(a.id));
  }
  broadcast(userId, 'activity:new', entry);
  return entry;
}

/* --------------------------------------------------------------------------- *
 *  API routes
 * --------------------------------------------------------------------------- */

async function handleApi(req, res, pathname) {
  const method = req.method;

  /* ---- auth ---- */
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: 'Invalid JSON' });
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name) return send(res, 400, { error: 'Name is required' });
    if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'A valid email is required' });
    if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
    if (db.users.some((u) => u.email === email)) return send(res, 409, { error: 'That email is already registered' });

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDB();
    return send(res, 201, { token: createToken(user.id), user: publicUser(user) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: 'Invalid JSON' });
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return send(res, 401, { error: 'Invalid email or password' });
    }
    return send(res, 200, { token: createToken(user.id), user: publicUser(user) });
  }

  /* ---- everything below needs a valid token ---- */
  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Authentication required' });

  if (pathname === '/api/me' && method === 'GET') {
    return send(res, 200, { user: publicUser(user) });
  }
  if (pathname === '/api/me' && (method === 'PUT' || method === 'PATCH')) {
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: 'Invalid JSON' });
    const idx = db.users.findIndex((u) => u.id === user.id);
    if ('name' in body) {
      const name = str(body.name, 80).trim();
      if (!name) return send(res, 400, { error: 'Name cannot be empty' });
      db.users[idx].name = name;
    }
    saveDB();
    return send(res, 200, { user: publicUser(db.users[idx]) });
  }

  /* ---- realtime stream ---- */
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');
    res.write('event: ready\ndata: {}\n\n');
    sseAdd(user.id, res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {}
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      sseRemove(user.id, res);
    });
    return;
  }

  /* ---- settings ---- */
  if (pathname === '/api/settings' && method === 'GET') {
    return send(res, 200, { settings: db.settings[user.id] || {} });
  }
  if (pathname === '/api/settings' && (method === 'PUT' || method === 'PATCH')) {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid JSON' });
    const next = { ...(db.settings[user.id] || {}), ...body };
    db.settings[user.id] = next;
    saveDB();
    broadcast(user.id, 'settings:update', next);
    return send(res, 200, { settings: next });
  }

  /* ---- activity feed ---- */
  if (pathname === '/api/activity' && method === 'GET') {
    const limit = Math.min(Number(req.query.limit) || 100, ACTIVITY_CAP);
    const list = db.activity
      .filter((a) => a.userId === user.id)
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
      .slice(0, limit);
    return send(res, 200, { activity: list });
  }

  /* ---- tasks ---- */
  if (pathname === '/api/tasks' && method === 'GET') {
    const list = db.tasks
      .filter((t) => t.userId === user.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return send(res, 200, { tasks: list });
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: 'Invalid JSON' });
    const base = cleanTaskInput(body, null);
    if (!base.title) return send(res, 400, { error: 'Task title is required' });
    const now = new Date().toISOString();
    const status = base.status || 'todo';
    const task = migrateTask({
      id: crypto.randomUUID(),
      userId: user.id,
      title: base.title,
      description: base.description || '',
      notes: base.notes || '',
      status,
      priority: base.priority || 'medium',
      recurring: base.recurring || 'none',
      dueDate: base.dueDate || null,
      startDate: base.startDate || null,
      estimateMinutes: base.estimateMinutes || null,
      tags: base.tags || [],
      checklist: base.checklist || [],
      attachments: base.attachments || [],
      archived: !!base.archived,
      completedAt: status === 'done' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    db.tasks.push(task);
    logActivity(user.id, 'task:created', task);
    if (status === 'done') logActivity(user.id, 'task:completed', task);
    saveDB();
    broadcast(user.id, 'task:create', task);
    return send(res, 201, { task });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([\w-]+)$/);
  if (taskMatch) {
    const id = taskMatch[1];
    const idx = db.tasks.findIndex((t) => t.id === id && t.userId === user.id);
    if (idx === -1) return send(res, 404, { error: 'Task not found' });
    const prev = db.tasks[idx];

    if (method === 'GET') {
      return send(res, 200, { task: prev });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req);
      if (!body) return send(res, 400, { error: 'Invalid JSON' });
      const updated = migrateTask(cleanTaskInput(body, prev));
      if (!updated.title) return send(res, 400, { error: 'Task title is required' });
      updated.updatedAt = new Date().toISOString();

      // completion bookkeeping
      if (updated.status === 'done' && prev.status !== 'done') {
        updated.completedAt = updated.updatedAt;
      } else if (updated.status !== 'done' && prev.status === 'done') {
        updated.completedAt = null;
      }
      db.tasks[idx] = updated;

      // activity: only log meaningful transitions
      if (prev.status !== updated.status) {
        logActivity(user.id, updated.status === 'done' ? 'task:completed' : 'task:moved', updated, {
          from: prev.status, to: updated.status,
        });
      }
      if (prev.priority !== updated.priority) {
        logActivity(user.id, 'task:priority', updated, { from: prev.priority, to: updated.priority });
      }
      if (prev.archived !== updated.archived) {
        logActivity(user.id, updated.archived ? 'task:archived' : 'task:unarchived', updated);
      }
      if (
        prev.title !== updated.title ||
        prev.description !== updated.description ||
        prev.notes !== updated.notes ||
        prev.dueDate !== updated.dueDate ||
        JSON.stringify(prev.tags) !== JSON.stringify(updated.tags) ||
        JSON.stringify(prev.checklist) !== JSON.stringify(updated.checklist)
      ) {
        logActivity(user.id, 'task:edited', updated);
      }

      saveDB();
      broadcast(user.id, 'task:update', updated);
      return send(res, 200, { task: updated });
    }

    if (method === 'DELETE') {
      const [removed] = db.tasks.splice(idx, 1);
      logActivity(user.id, 'task:deleted', removed);
      saveDB();
      broadcast(user.id, 'task:delete', { id: removed.id });
      return send(res, 200, { ok: true, id: removed.id });
    }
  }

  return send(res, 404, { error: 'Unknown endpoint' });
}

/* --------------------------------------------------------------------------- *
 *  Server
 * --------------------------------------------------------------------------- */

loadDB();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(u.searchParams.entries());
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (pathname === '/health') return send(res, 200, { ok: true, users: db.users.length, tasks: db.tasks.length });

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error('API error:', err);
      if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
    });
    return;
  }

  serveStatic(req, res, req.url);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  try {
    fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port: PORT, started: new Date().toISOString() }));
  } catch (_) {
    /* non-fatal */
  }
  console.log('\n  Task Management Application');
  console.log('  ---------------------------------------------');
  console.log(`  App running at:  http://${shown}:${PORT}`);
  console.log(`  Health check:    http://${shown}:${PORT}/health`);
  console.log(`  Data file:       ${DATA_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
});

function cleanup() {
  try {
    const saved = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (saved && saved.pid === process.pid) fs.unlinkSync(PID_FILE);
  } catch (_) {
    /* already gone */
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Another server may be running, or start on another port:\n`);
    console.error(`      PORT=3001 node server.js\n`);
    process.exit(1);
  }
  throw err;
});
