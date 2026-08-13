const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = 3001;
const HOST = '0.0.0.0';
const dataDirectory = path.join(__dirname, 'data');

fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(path.join(dataDirectory, 'notes.db'));
database.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  )
`);

// 기존 데이터베이스에는 favorite 컬럼만 안전하게 추가한다.
const noteColumns = database.prepare('PRAGMA table_info(notes)').all();
if (!noteColumns.some(({ name }) => name === 'favorite')) {
  database.exec('ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}

app.use(express.json({ limit: '1mb' }));

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

  return { title, content };
}

app.get('/api/notes', (req, res) => {
  const notes = database
    .prepare('SELECT * FROM notes ORDER BY favorite DESC, updated_at DESC, id DESC')
    .all();
  res.json(notes);
});

app.get('/api/notes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '올바른 메모 ID가 아닙니다.' });

  const note = database.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note) return res.status(404).json({ message: '메모를 찾을 수 없습니다.' });

  res.json(note);
});

app.post('/api/notes', (req, res) => {
  const note = validateNote(req.body);
  if (note.error) return res.status(400).json({ message: note.error });

  const now = new Date().toISOString();
  const result = database
    .prepare('INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(note.title, note.content, now, now);
  const created = database.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/notes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '올바른 메모 ID가 아닙니다.' });

  const note = validateNote(req.body);
  if (note.error) return res.status(400).json({ message: note.error });

  const result = database
    .prepare('UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(note.title, note.content, new Date().toISOString(), id);
  if (result.changes === 0) return res.status(404).json({ message: '메모를 찾을 수 없습니다.' });

  res.json(database.prepare('SELECT * FROM notes WHERE id = ?').get(id));
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

  res.json(database.prepare('SELECT * FROM notes WHERE id = ?').get(id));
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
