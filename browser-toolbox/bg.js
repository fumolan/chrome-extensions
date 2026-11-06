// 右键选中文本 → 打开对应工具页并带入文本（storage.session 先 set 再开页）
const MENUS = {
  'toolbox-jwt-menu': {
    title: '工具箱：解析选中的 JWT',
    storageKey: 'jwtSelection',
    path: 'tools/jwt-decoder/index.html'
  },
  'toolbox-json-menu': {
    title: '工具箱：格式化选中的 JSON',
    storageKey: 'jsonSelection',
    path: 'tools/json-formatter/index.html'
  }
};

chrome.runtime.onInstalled.addListener(() => {
  for (const [id, t] of Object.entries(MENUS)) {
    chrome.contextMenus.create({ id, title: t.title, contexts: ['selection'] });
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const t = MENUS[info.menuItemId];
  if (!t) return;
  await chrome.storage.session.set({ [t.storageKey]: info.selectionText || '' });
  chrome.tabs.create({ url: chrome.runtime.getURL(t.path) });
});
