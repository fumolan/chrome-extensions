// 本地存储适配器：浏览器内置数据库 IndexedDB，无需任何服务器。
// 数据库: rich-notes / 表: notes（字段 id, title, html, text, createdAt, updatedAt）
(function () {
  'use strict';

  const DB_NAME = 'rich-notes';
  const DB_VERSION = 1;
  const STORE = 'notes';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function reqDone(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('事务已中止'));
    });
  }

  window.LocalDB = {
    /** 列出全部笔记（按更新时间倒序），可按标题/正文关键词过滤 */
    async list(query) {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readonly');
      const all = await reqDone(tx.objectStore(STORE).getAll());
      await txDone(tx);
      let notes = all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const q = (query || '').trim().toLowerCase();
      if (q) {
        notes = notes.filter(
          (n) => (n.title || '').toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q)
        );
      }
      return notes;
    },

    async get(id) {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readonly');
      const note = await reqDone(tx.objectStore(STORE).get(id));
      await txDone(tx);
      return note;
    },

    /** 新建或更新（按 id upsert） */
    async save(note) {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(note);
      await txDone(tx);
      return note;
    },

    async remove(id) {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await txDone(tx);
    },
  };
})();
