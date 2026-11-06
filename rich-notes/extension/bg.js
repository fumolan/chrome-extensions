// 点击扩展图标 → 在新标签页打开笔记应用
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
