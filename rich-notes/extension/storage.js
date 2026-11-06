// 存储适配层：根据设置切换「本地 IndexedDB」或「远程 REST 服务器（SQLite）」。
// 两种模式对外提供完全一致的接口：list / save / remove。
(function () {
  'use strict';

  const SETTINGS_KEY = 'rich-notes-settings';
  const hasChromeStorage =
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  async function getSettings() {
    if (hasChromeStorage) {
      const result = await chrome.storage.local.get(SETTINGS_KEY);
      return result[SETTINGS_KEY] || {};
    }
    // 以普通网页方式打开时的兜底（开发调试用）
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  }

  async function setSettings(settings) {
    if (hasChromeStorage) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    } else {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }

  function remoteAdapter(baseUrl) {
    async function request(path, options) {
      let res;
      try {
        res = await fetch(baseUrl + path, options);
      } catch (e) {
        throw new Error('无法连接服务器 ' + baseUrl + '（' + e.message + '）');
      }
      if (!res.ok) throw new Error('服务器返回 HTTP ' + res.status);
      return res.json();
    }
    return {
      async list(q) {
        const data = await request('/api/notes' + (q ? '?q=' + encodeURIComponent(q) : ''));
        return data.notes || [];
      },
      async save(note) {
        return request('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note),
        });
      },
      async remove(id) {
        return request('/api/notes/' + encodeURIComponent(id), { method: 'DELETE' });
      },
    };
  }

  async function currentAdapter() {
    const s = await getSettings();
    if (s.mode === 'remote' && s.serverUrl) {
      return remoteAdapter(String(s.serverUrl).trim().replace(/\/+$/, ''));
    }
    return window.LocalDB;
  }

  window.NoteStore = {
    getSettings,
    setSettings,
    currentAdapter,
    async list(q) {
      return (await currentAdapter()).list(q);
    },
    async save(note) {
      return (await currentAdapter()).save(note);
    },
    async remove(id) {
      return (await currentAdapter()).remove(id);
    },
  };
})();
