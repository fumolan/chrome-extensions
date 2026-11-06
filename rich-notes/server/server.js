// rich-notes 数据库服务器 — 纯 Node.js。
// 配置来源：同目录 .env 文件（优先）或环境变量。
//   DB_DRIVER    sqlite(默认) | postgres | mysql
//   DB_FILE      SQLite 数据库文件路径（默认 ./notes.db）
//   DATABASE_URL postgres://user:pass@host:5432/库名  或  mysql://user:pass@host:3306/库名
//   PORT         监听端口（默认 3001）
// 说明：
//   - postgres / mysql 需先 npm install 安装驱动（pg / mysql2）
//   - 目标数据库不存在时会自动创建（库名仅限字母数字下划线），无需手工建库
'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

// 加载同目录 .env（文件不存在时忽略；已设置的环境变量优先级更高）
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch (e) {
  console.error('读取 .env 文件失败：' + e.message);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3001);
const DRIVER = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
const DATABASE_URL = process.env.DATABASE_URL || '';

// 从 DATABASE_URL 里取库名（仅字母数字下划线时才允许自动建库）
function dbNameFromUrl() {
  try {
    return decodeURIComponent(new URL(DATABASE_URL).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

/* ---------- 建表语句（各方言差异：MySQL 的 TEXT 列不允许默认值） ---------- */

const DDL = {
  sqlite:
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      note_group TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at INTEGER NOT NULL DEFAULT 0,
      attachments TEXT NOT NULL DEFAULT '[]'
    )`,
  postgres:
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      note_group TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at BIGINT NOT NULL DEFAULT 0,
      attachments TEXT NOT NULL DEFAULT '[]'
    )`,
  mysql:
    `CREATE TABLE IF NOT EXISTS notes (
      id VARCHAR(64) PRIMARY KEY,
      title MEDIUMTEXT NOT NULL,
      html LONGTEXT NOT NULL,
      text MEDIUMTEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      project VARCHAR(255) NOT NULL DEFAULT '',
      note_group VARCHAR(255) NOT NULL DEFAULT '',
      pinned TINYINT NOT NULL DEFAULT 0,
      pinned_at BIGINT NOT NULL DEFAULT 0,
      attachments LONGTEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

// 旧库迁移用的新列定义（v1.0/v1.1/v1.2 逐版本引入）。注意：值只含类型，列名由 ALTER 语句拼接
const MIGRATION_COLS = {
  project: { sqlite: "TEXT NOT NULL DEFAULT ''", postgres: "TEXT NOT NULL DEFAULT ''", mysql: "VARCHAR(255) NOT NULL DEFAULT ''" },
  note_group: { sqlite: "TEXT NOT NULL DEFAULT ''", postgres: "TEXT NOT NULL DEFAULT ''", mysql: "VARCHAR(255) NOT NULL DEFAULT ''" },
  pinned: { sqlite: 'INTEGER NOT NULL DEFAULT 0', postgres: 'INTEGER NOT NULL DEFAULT 0', mysql: 'TINYINT NOT NULL DEFAULT 0' },
  pinned_at: { sqlite: 'INTEGER NOT NULL DEFAULT 0', postgres: 'BIGINT NOT NULL DEFAULT 0', mysql: 'BIGINT NOT NULL DEFAULT 0' },
  attachments: { sqlite: "TEXT NOT NULL DEFAULT '[]'", postgres: "TEXT NOT NULL DEFAULT '[]'", mysql: 'LONGTEXT' },
};

/* ---------- 数据库适配层：统一暴露 async 的 all / get / run / exec ---------- */
// 查询一律用 ? 占位符（postgres 适配器自动转换为 $n）
// run 返回 { changes }（DELETE/UPDATE 用于判断是否命中）

function requireDriver(name, hint) {
  try {
    return require(name);
  } catch {
    throw new Error('未安装 ' + hint + ' 驱动。请在 server 目录先执行: npm install');
  }
}

async function openSqlite() {
  const { DatabaseSync } = requireDriver('node:sqlite', 'sqlite（请使用 Node.js >= 22.5）');
  const file = process.env.DB_FILE || path.join(__dirname, 'notes.db');
  const db = new DatabaseSync(file);
  return {
    driver: 'sqlite',
    async all(sql, params) { return db.prepare(sql).all(...(params || [])); },
    async get(sql, params) { return db.prepare(sql).get(...(params || [])); },
    async run(sql, params) { return db.prepare(sql).run(...(params || [])); },
    async exec(sql) { db.exec(sql); },
    close() { db.close(); },
    info: file,
  };
}

async function openPostgres() {
  const { Client } = requireDriver('pg', 'PostgreSQL（pg）');
  if (!DATABASE_URL) {
    throw new Error('使用 postgres 需要 DATABASE_URL，例如：postgres://user:pass@localhost:5432/rich_notes');
  }
  // 目标库不存在时自动创建（连 postgres 维护库执行 CREATE DATABASE）
  const dbName = dbNameFromUrl();
  if (dbName && dbName !== 'postgres' && /^[A-Za-z0-9_]+$/.test(dbName)) {
    const adminUrl = new URL(DATABASE_URL);
    adminUrl.pathname = '/postgres';
    const admin = new Client({ connectionString: adminUrl.toString() });
    try {
      await admin.connect();
      try {
        await admin.query('CREATE DATABASE "' + dbName + '"');
        console.log('已自动创建 PostgreSQL 数据库: ' + dbName);
      } catch (e) {
        if (e.code !== '42P04') throw e; // 42P04 = 库已存在
      }
    } finally {
      await admin.end().catch(() => {});
    }
  }
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (e) {
    throw new Error('PostgreSQL 连接失败：' + e.message);
  }
  // 连接被服务端断开（如容器重启）时不抛未处理的 error 事件导致原始堆栈崩溃
  client.on('error', (e) => {
    console.error('PostgreSQL 连接异常断开：' + e.message);
    console.error('请检查数据库是否在运行，然后重启本服务。');
    process.exit(1);
  });
  // ? → $n 转换。注意：计数器必须在每次调用内重置，否则跨请求累加导致参数编号错乱
  const conv = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => '$' + (++i));
  };
  return {
    driver: 'postgres',
    async all(sql, params) { return (await client.query(conv(sql), params || [])).rows; },
    async get(sql, params) { return (await client.query(conv(sql), params || [])).rows[0]; },
    async run(sql, params) {
      const r = await client.query(conv(sql), params || []);
      return { changes: r.rowCount };
    },
    async exec(sql) { await client.query(sql); },
    close() { return client.end(); },
    info: DATABASE_URL.replace(/\/\/[^@]*@/, '//***@'),
  };
}

async function openMysql() {
  const mysql = requireDriver('mysql2/promise', 'MySQL（mysql2）');
  if (!DATABASE_URL) {
    throw new Error('使用 mysql 需要 DATABASE_URL，例如：mysql://user:pass@localhost:3306/rich_notes');
  }
  // 目标库不存在时自动创建（不带库名先连一次）
  const dbName = dbNameFromUrl();
  if (dbName && /^[A-Za-z0-9_]+$/.test(dbName)) {
    const adminUri = new URL(DATABASE_URL);
    adminUri.pathname = '';
    let admin;
    try {
      admin = await mysql.createConnection(adminUri.toString());
      await admin.query('CREATE DATABASE IF NOT EXISTS `' + dbName + '` CHARACTER SET utf8mb4');
      console.log('MySQL 数据库已就绪（不存在时自动创建）: ' + dbName);
    } finally {
      if (admin) await admin.end().catch(() => {});
    }
  }
  let conn;
  try {
    conn = await mysql.createConnection(DATABASE_URL);
  } catch (e) {
    throw new Error('MySQL 连接失败：' + e.message);
  }
  return {
    driver: 'mysql',
    async all(sql, params) { const [rows] = await conn.execute(sql, params || []); return rows; },
    async get(sql, params) { const [rows] = await conn.execute(sql, params || []); return rows[0]; },
    async run(sql, params) {
      const [r] = await conn.execute(sql, params || []);
      return { changes: r.affectedRows };
    },
    async exec(sql) { await conn.query(sql); },
    close() { return conn.end(); },
    info: DATABASE_URL.replace(/\/\/[^@]*@/, '//***@'),
  };
}

/* ---------- upsert（MySQL 用 ON DUPLICATE KEY，其余用 ON CONFLICT） ---------- */

function upsertSql(driver) {
  const cols = 'id, title, html, text, created_at, updated_at, project, note_group, pinned, pinned_at, attachments';
  const ph = Array.from({ length: 11 }, (_, i) => (driver === 'postgres' ? '$' + (i + 1) : '?')).join(', ');
  if (driver === 'mysql') {
    return 'INSERT INTO notes (' + cols + ') VALUES (' + ph + ') ON DUPLICATE KEY UPDATE ' +
      'title=VALUES(title), html=VALUES(html), text=VALUES(text), updated_at=VALUES(updated_at), ' +
      'project=VALUES(project), note_group=VALUES(note_group), pinned=VALUES(pinned), ' +
      'pinned_at=VALUES(pinned_at), attachments=VALUES(attachments)';
  }
  return 'INSERT INTO notes (' + cols + ') VALUES (' + ph + ') ON CONFLICT(id) DO UPDATE SET ' +
    'title=excluded.title, html=excluded.html, text=excluded.text, updated_at=excluded.updated_at, ' +
    'project=excluded.project, note_group=excluded.note_group, pinned=excluded.pinned, ' +
    'pinned_at=excluded.pinned_at, attachments=excluded.attachments';
}

async function migrate(db) {
  if (db.driver === 'sqlite') {
    const cols = (await db.all('PRAGMA table_info(notes)')).map((c) => c.name);
    for (const [col, def] of Object.entries(MIGRATION_COLS)) {
      if (!cols.includes(col)) await db.exec('ALTER TABLE notes ADD COLUMN ' + col + ' ' + def.sqlite);
    }
  } else if (db.driver === 'postgres') {
    for (const [col, def] of Object.entries(MIGRATION_COLS)) {
      await db.exec('ALTER TABLE notes ADD COLUMN IF NOT EXISTS ' + col + ' ' + def.postgres);
    }
  } else {
    for (const [col, def] of Object.entries(MIGRATION_COLS)) {
      const rows = await db.all(
        'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['notes', col]);
      if (!rows[0] || Number(rows[0].c) === 0) {
        await db.exec('ALTER TABLE notes ADD COLUMN ' + col + ' ' + def.mysql);
      }
    }
  }
}

/* ---------- 工具 ---------- */

function parseJsonArray(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// 时间戳统一 Number()（postgres 的 BIGINT 会以字符串返回）
const rowToNote = (r) => ({
  id: r.id,
  title: r.title,
  html: r.html,
  text: r.text,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  project: r.project || '',
  group: r.note_group || '',
  pinned: !!Number(r.pinned),
  pinnedAt: Number(r.pinned_at) || 0,
  attachments: parseJsonArray(r.attachments),
});

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, limitBytes) {
  const limit = limitBytes || 100 * 1024 * 1024; // 附件以 base64 内嵌，放宽到 100MB
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体超过大小限制'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('请求体不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------- 启动 ---------- */

async function main() {
  let db;
  if (DRIVER === 'postgres') db = await openPostgres();
  else if (DRIVER === 'mysql') db = await openMysql();
  else if (DRIVER === 'sqlite') db = await openSqlite();
  else {
    console.error('不支持的 DB_DRIVER：' + DRIVER + '（可选 sqlite / postgres / mysql）');
    process.exit(1);
  }

  await db.exec(DDL[db.driver]);
  await migrate(db);
  const UPSERT = upsertSql(db.driver);
  // MySQL 的字符串字面量中反斜杠是转义符，ESCAPE 子句需要写成 '\\'；SQLite/PG 用 '\'
  const LIKE_ESCAPE = db.driver === 'mysql' ? "ESCAPE '\\\\'" : "ESCAPE '\\'";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    try {
      if (req.method === 'GET' && p === '/api/health') {
        return sendJson(res, 200, { ok: true, service: 'rich-notes-server', driver: db.driver, time: Date.now() });
      }

      // 列表 / 搜索
      if (req.method === 'GET' && p === '/api/notes') {
        const q = (url.searchParams.get('q') || '').trim();
        let rows;
        if (q) {
          const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
          rows = await db.all(
            'SELECT * FROM notes WHERE title LIKE ? ' + LIKE_ESCAPE +
            ' OR text LIKE ? ' + LIKE_ESCAPE + ' ORDER BY updated_at DESC',
            [like, like]);
        } else {
          rows = await db.all('SELECT * FROM notes ORDER BY updated_at DESC');
        }
        return sendJson(res, 200, { notes: rows.map(rowToNote) });
      }

      // 保存（upsert：带 id 更新，不带 id 新建）
      if (req.method === 'POST' && p === '/api/notes') {
        const b = await readBody(req);
        const id = (typeof b.id === 'string' && b.id) ? b.id : randomUUID();
        const now = Date.now();
        await db.run(UPSERT, [
          id,
          String(b.title || ''),
          String(b.html || ''),
          String(b.text || ''),
          Number(b.createdAt) || now,
          Number(b.updatedAt) || now,
          String(b.project || ''),
          String(b.group || ''),
          b.pinned ? 1 : 0,
          Number(b.pinnedAt) || 0,
          JSON.stringify(Array.isArray(b.attachments) ? b.attachments : []),
        ]);
        const row = await db.get('SELECT * FROM notes WHERE id = ?', [id]);
        return sendJson(res, 201, rowToNote(row));
      }

      // 单条：查询 / 更新 / 删除
      const m = p.match(/^\/api\/notes\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          const row = await db.get('SELECT * FROM notes WHERE id = ?', [id]);
          return row ? sendJson(res, 200, rowToNote(row)) : sendJson(res, 404, { error: '笔记不存在' });
        }
        if (req.method === 'PUT') {
          const b = await readBody(req);
          const info = await db.run(
            'UPDATE notes SET title = ?, html = ?, text = ?, updated_at = ?, project = ?, note_group = ?, pinned = ?, pinned_at = ?, attachments = ? WHERE id = ?',
            [String(b.title || ''), String(b.html || ''), String(b.text || ''),
             Number(b.updatedAt) || Date.now(),
             String(b.project || ''), String(b.group || ''),
             b.pinned ? 1 : 0, Number(b.pinnedAt) || 0,
             JSON.stringify(Array.isArray(b.attachments) ? b.attachments : []), id]);
          if (!info.changes) return sendJson(res, 404, { error: '笔记不存在' });
          const row = await db.get('SELECT * FROM notes WHERE id = ?', [id]);
          return sendJson(res, 200, rowToNote(row));
        }
        if (req.method === 'DELETE') {
          const info = await db.run('DELETE FROM notes WHERE id = ?', [id]);
          return info.changes
            ? sendJson(res, 200, { ok: true })
            : sendJson(res, 404, { error: '笔记不存在' });
        }
      }

      sendJson(res, 404, { error: '接口不存在' });
    } catch (e) {
      sendJson(res, 400, { error: e.message || '服务器内部错误' });
    }
  });

  server.listen(PORT, () => {
    console.log('rich-notes 数据库服务器已启动: http://localhost:' + PORT);
    console.log('数据库驱动: ' + db.driver + '  (' + db.info + ')');
    console.log('按 Ctrl+C 停止');
  });
}

main().catch((e) => {
  console.error('启动失败：' + (e.message || e));
  process.exit(1);
});
