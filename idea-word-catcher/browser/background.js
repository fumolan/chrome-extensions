// 后台：右键菜单 / Alt+Shift+W 取词、badge 反馈、生词表缓存与广播。
// 所有写操作都走 IDEA 插件的本地 HTTP 服务（127.0.0.1:18091），数据与 IDE 完全同源。

import { WORD_RE, addWord, fetchWords } from "./api.js";

const MENU_ID = "word-catcher-capture";
const COLOR_OK = "#2e7d32";      // 记词成功
const COLOR_INVALID = "#c62828"; // 不是英文单词
const COLOR_OFFLINE = "#ef6c00"; // IDEA 插件服务未连接

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "记入生词本“%s”",
      contexts: ["selection"],
    });
  });
  preloadWords();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab && tab.id != null) {
    captureFromTab(tab);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture-word") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab && tab.id != null) captureFromTab(tab);
    });
  }
});

// ---------- 取词 ----------

// 在页面里执行的函数（会被序列化注入，必须自包含）
function pageSelectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const raw = sel.toString().trim();
  if (!raw) return null;
  const norm = raw.replace(/\s+/g, " ");

  function sentenceAround(text, start, end) {
    const stops = ".?!;。？！";
    let s = start;
    while (s > 0 && start - s < 120 && !stops.includes(text[s - 1])) s--;
    let e = end;
    while (e < text.length && e - end < 160) {
      e++;
      if (stops.includes(text[e - 1])) break;
    }
    return text.slice(s, e).trim();
  }

  // 上下文取选区所在句子，对应 IDE 里“光标所在行”的语义
  let context = "";
  try {
    const node = sel.anchorNode;
    const text = node ? (node.nodeType === Node.TEXT_NODE ? node.data : node.textContent) : "";
    const flat = text.replace(/\s+/g, " ").trim();
    const idx = flat.indexOf(norm);
    if (idx >= 0) context = sentenceAround(flat, idx, idx + norm.length);
    if (!context) context = flat.slice(0, 200);
  } catch (_) { /* 上下文取不到不影响记词 */ }
  return { word: norm, context: context.trim() };
}

async function captureFromTab(tab) {
  let info = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: pageSelectionInfo,
    });
    info = (results || []).map((r) => r.result).find((r) => r && r.word) || null;
  } catch (_) {
    // chrome:// 等无法注入的页面
  }
  if (!info) {
    flashBadge("?", COLOR_INVALID, "请先选中一个英文单词");
    return;
  }
  const word = info.word;
  if (!WORD_RE.test(word)) {
    flashBadge("×", COLOR_INVALID, "“" + word + "” 不是英文单词");
    return;
  }
  const source = pageSource(tab);
  try {
    const result = await addWord(word, info.context, source);
    flashBadge("✓" + result.count, COLOR_OK,
      result.count > 1 ? "已记录 " + word + "，第 " + result.count + " 次遇到" : "已记录 " + word);
    refreshWords(true);
  } catch (e) {
    flashBadge("!", COLOR_OFFLINE, "记词失败：" + e.message + "（IDEA 是否在运行？）");
  }
}

function pageSource(tab) {
  let host = "";
  try {
    host = new URL(tab.url || "").hostname;
  } catch (_) { /* 非 http(s) 页面 */ }
  const title = (tab.title || "").trim();
  let source = title && host ? title + " · " + host : (title || host || "");
  return source.length > 100 ? source.slice(0, 100) + "…" : source;
}

// ---------- badge ----------

function flashBadge(text, color, tooltip) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  try { chrome.action.setBadgeTextColor({ color: "#ffffff" }); } catch (_) { /* 旧版无此 API */ }
  if (tooltip) chrome.action.setTitle({ title: "Word Catcher 生词本 — " + tooltip });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Word Catcher 生词本" });
  }, 2500);
}

// ---------- 生词表缓存与广播 ----------

async function preloadWords() {
  const cached = await chrome.storage.session.get("words");
  if (!cached.words) refreshWords(false);
}

// 生词本可能在 IDE 侧被修改，这里总是拉取最新（localhost 请求很快），
// 失败（IDEA 未运行）时才回退到缓存，避免把已知的词表清空。
async function refreshWords(broadcast) {
  try {
    const entries = await fetchWords();
    const words = entries.map((e) => e.word);
    await chrome.storage.session.set({ words });
    if (broadcast) broadcastToTabs({ type: "words-changed", words });
    return words;
  } catch (_) {
    const cached = await chrome.storage.session.get("words");
    return cached.words || null;
  }
}

// 切换标签页时同步一次：IDE 里新记的词回到浏览器就能看到高亮
chrome.tabs.onActivated.addListener(() => {
  refreshWords(false);
});

function broadcastToTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) chrome.tabs.sendMessage(tab.id, message).catch(() => { /* 无内容脚本的页面 */ });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "capture") {
    // 对指定标签页（可选 tabId）或当前活动标签页执行一次取词，
    // 与右键菜单 / Alt+Shift+W 同一条链路，供扩展页触发
    const target = message.tabId != null
      ? chrome.tabs.get(message.tabId)
      : chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab);
    Promise.resolve(target).then((tab) => {
      if (tab && tab.id != null) {
        return captureFromTab(tab).then(() => sendResponse({ done: true }));
      }
      sendResponse({ done: false, error: "tab not found" });
    }).catch(() => sendResponse({ done: false, error: "tab lookup failed" }));
    return true;
  }
  if (message.type === "get-words") {
    refreshWords(false).then((words) => sendResponse({ words: words || [] }));
    return true;
  }
  if (message.type === "refresh-words") {
    refreshWords(true).then((words) => sendResponse({ words: words || [] }));
    return true;
  }
  if (message.type === "highlight-toggled") {
    broadcastToTabs({ type: "highlight-toggle", enabled: !!message.enabled });
  }
});
