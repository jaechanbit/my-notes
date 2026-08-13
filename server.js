const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

require('dotenv').config({ quiet: true });

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';
const dataDirectory = path.join(__dirname, 'data');
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error('SESSION_SECRET 환경변수를 설정해 주세요.');
}

fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(path.join(dataDirectory, 'notes.db'));
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT,
    updated_at TEXT
  )
`);

const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    throw new Error('첫 실행에는 ADMIN_USERNAME과 ADMIN_PASSWORD 환경변수를 설정해 주세요.');
  }
  if (adminUsername.length > 100) {
    throw new Error('ADMIN_USERNAME은 100자 이하로 설정해 주세요.');
  }
  if (adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD는 8자 이상으로 설정해 주세요.');
  }

  const passwordHash = bcrypt.hashSync(adminPassword, 12);
  database
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(adminUsername, passwordHash, new Date().toISOString());
  console.log(`초기 관리자 계정 '${adminUsername}'을 생성했습니다.`);
}

// 기존 데이터베이스에는 필요한 컬럼을 기본값과 함께 안전하게 추가한다.
const noteColumns = database.prepare('PRAGMA table_info(notes)').all();
if (!noteColumns.some(({ name }) => name === 'favorite')) {
  database.exec('ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}
if (!noteColumns.some(({ name }) => name === 'tags')) {
  database.exec("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(session({
  name: 'my-notes.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));

function requireApiLogin(req, res, next) {
  if (req.session.userId) return next();
  return res.status(401).json({ message: '로그인이 필요합니다.' });
}

function requirePageLogin(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css')));
app.get('/login.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.js')));

app.post('/api/auth/login', (req, res, next) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = username
    ? database.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username)
    : null;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  return req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.userId = Number(user.id);
    req.session.username = user.username;
    return req.session.save((saveError) => {
      if (saveError) return next(saveError);
      return res.json({ username: user.username });
    });
  });
});

app.use('/api', requireApiLogin);

app.get('/api/auth/session', (req, res) => {
  res.json({ username: req.session.username });
});

app.post('/api/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('my-notes.sid');
    return res.status(204).end();
  });
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateNote(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';

  if (!title || !content) {
    return { error: '제목과 내용을 모두 입력해 주세요.' };
  }

  if (body?.tags !== undefined && !Array.isArray(body.tags)) {
    return { error: '태그 형식이 올바르지 않습니다.' };
  }

  const tags = [];
  for (const value of body?.tags || []) {
    if (typeof value !== 'string') return { error: '태그 형식이 올바르지 않습니다.' };
    const tag = value.trim();
    if (!tag) continue;
    if (tag.length > 30) return { error: '태그는 각각 30자 이하로 입력해 주세요.' };
    if (!tags.some((item) => item.toLocaleLowerCase('ko') === tag.toLocaleLowerCase('ko'))) {
      tags.push(tag);
    }
  }
  if (tags.length > 20) return { error: '태그는 최대 20개까지 입력할 수 있습니다.' };

  return { title, content, tags };
}

function formatNote(row) {
  if (!row) return row;
  try {
    const tags = JSON.parse(row.tags || '[]');
    return { ...row, tags: Array.isArray(tags) ? tags : [] };
  } catch {
    return { ...row, tags: [] };
  }
}

app.get('/api/notes', (req, res) => {
  const sortOrders = {
    newest: 'COALESCE(updated_at, created_at) DESC, id DESC',
    oldest: 'COALESCE(updated_at, created_at) ASC, id ASC',
    favorite: 'favorite DESC, COALESCE(updated_at, created_at) DESC, id DESC',
    'title-asc': 'title COLLATE NOCASE ASC, id ASC',
    'title-desc': 'title COLLATE NOCASE DESC, id DESC',
  };
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
  if (!Object.hasOwn(sortOrders, sort)) {
    return res.status(400).json({ message: '올바른 정렬 기준이 아닙니다.' });
  }

  const notes = database
    .prepare(`SELECT * FROM notes ORDER BY ${sortOrders[sort]}`)
    .all();
  res.json(notes.map(formatNote));
});

app.get('/api/notes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '올바른 메모 ID가 아닙니다.' });

  const note = database.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note) return res.status(404).json({ message: '메모를 찾을 수 없습니다.' });

  res.json(formatNote(note));
});

app.post('/api/notes', (req, res) => {
  const note = validateNote(req.body);
  if (note.error) return res.status(400).json({ message: note.error });

  const now = new Date().toISOString();
  const result = database
    .prepare('INSERT INTO notes (title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(note.title, note.content, JSON.stringify(note.tags), now, now);
  const created = database.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(formatNote(created));
});

app.put('/api/notes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '올바른 메모 ID가 아닙니다.' });

  const note = validateNote(req.body);
  if (note.error) return res.status(400).json({ message: note.error });

  const result = database
    .prepare('UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?')
    .run(note.title, note.content, JSON.stringify(note.tags), new Date().toISOString(), id);
  if (result.changes === 0) return res.status(404).json({ message: '메모를 찾을 수 없습니다.' });

  res.json(formatNote(database.prepare('SELECT * FROM notes WHERE id = ?').get(id)));
});

app.patch('/api/notes/:id/favorite', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '올바른 메모 ID가 아닙니다.' });
  if (req.body?.favorite !== true && req.body?.favorite !== false) {
    return res.status(400).json({ message: '즐겨찾기 상태가 올바르지 않습니다.' });
  }

  const result = database
    .prepare('UPDATE notes SET favorite = ? WHERE id = ?')
    .run(req.body.favorite ? 1 : 0, id);
  if (result.changes === 0) return res.status(404).json({ message: '메모를 찾을 수 없습니다.' });

  res.json(formatNote(database.prepare('SELECT * FROM notes WHERE id = ?').get(id)));
});

app.delete('/api/notes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '올바른 메모 ID가 아닙니다.' });

  const result = database.prepare('DELETE FROM notes WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ message: '메모를 찾을 수 없습니다.' });

  res.status(204).end();
});

app.use('/api', (req, res) => {
  res.status(404).json({ message: '요청한 API를 찾을 수 없습니다.' });
});

app.use(requirePageLogin);
app.use(express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ message: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`내 메모 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
