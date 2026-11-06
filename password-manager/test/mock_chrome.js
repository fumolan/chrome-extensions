// 浏览器预览用 chrome API 模拟（仅测试，不随扩展分发）
(function () {
  function memArea() {
    const store = {};
    return {
      get(keys) {
        const out = {};
        if (keys == null) Object.assign(out, store);
        else if (typeof keys === 'string') {
          if (keys in store) out[keys] = store[keys];
        } else {
          for (const k of keys) if (k in store) out[k] = store[k];
        }
        return Promise.resolve(out);
      },
      set(obj) {
        Object.assign(store, obj);
        return Promise.resolve();
      },
      remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        return Promise.resolve();
      },
    };
  }

  window.chrome = {
    storage: { local: memArea(), session: memArea() },
    tabs: {
      query: async () => [{ id: 1 }],
      create: async ({ url }) => console.log('[mock] tabs.create', url),
    },
    scripting: {
      executeScript: async () => [{ result: 2 }],
    },
    downloads: {
      download: async (o) => console.log('[mock] downloads.download', o.filename),
    },
  };
})();
