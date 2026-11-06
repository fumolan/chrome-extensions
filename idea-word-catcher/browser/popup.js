// 弹窗：生词列表 + 详情 + 朗读 / 删除 / 补全词典 / 复制 / 导出 CSV / 高亮开关 / 卡片入口。

import { fetchHealth, fetchWords, enrichWord, deleteWord, needsEnrich, speakViaPlugin } from "./api.js";
import { fillVoiceSelect, setPreferredVoiceName, speakWithBrowser } from "./voice.js";

const KEY_ENABLED = "highlightEnabled";

const els = {
  dot: document.getElementById("statusDot"),
  status: document.getElementById("statusText"),
  count: document.getElementById("wordCount"),
  refresh: document.getElementById("refreshBtn"),
  offline: document.getElementById("offlineBanner"),
  highlight: document.getElementById("highlightBtn"),
  flashcards: document.getElementById("flashcardsBtn"),
  enrich: document.getElementById("enrichBtn"),
  copy: document.getElementById("copyBtn"),
  csv: document.getElementById("csvBtn"),
  sort: document.getElementById("sortBtn"),
  voice: document.getElementById("voiceSel"),
  list: document.getElementById("list"),
  toast: document.getElementById("toast"),
};

let words = [];
let sortByCount = false;
let expandedWord = null;
let enriching = false;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  // 音色下拉框：浏览器朗读（IDEA 未连接时的备用朗读路径）使用
  fillVoiceSelect(els.voice).catch(() => { /* 列表加载失败保持禁用 */ });
  els.voice.addEventListener("change", () => setPreferredVoiceName(els.voice.value));
  els.refresh.addEventListener("click", load);
  els.sort.addEventListener("click", () => {
    sortByCount = !sortByCount;
    els.sort.textContent = sortByCount ? "次数 ↓" : "次数 ↕";
    render();
  });
  els.flashcards.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("flashcards.html") });
  });
  els.copy.addEventListener("click", copyAll);
  els.csv.addEventListener("click", exportCsv);
  els.enrich.addEventListener("click", enrichMissing);
  els.highlight.addEventListener("click", toggleHighlight);
  await load();
  await refreshHighlightButton();
}

async function load() {
  try {
    await fetchHealth();
    setOnline(true);
    words = await fetchWords();
    // 同步后台缓存并广播，网页高亮随弹窗打开一起刷新
    chrome.runtime.sendMessage({ type: "refresh-words" });
  } catch (_) {
    setOnline(false);
    words = [];
  }
  render();
}

function setOnline(ok) {
  els.dot.className = "dot " + (ok ? "ok" : "err");
  els.status.textContent = ok ? "生词本" : "未连接";
  els.offline.classList.toggle("hidden", ok);
  for (const btn of [els.enrich, els.copy, els.csv, els.highlight]) btn.disabled = !ok;
}

// ---------- 列表渲染 ----------

function sortedWords() {
  const list = [...words];
  if (sortByCount) list.sort((a, b) => b.count - a.count);
  return list; // 默认按存储顺序（最近记录的在前面）
}

function render() {
  els.count.textContent = words.length ? words.length + " 个生词" : "";
  els.list.textContent = "";
  if (!words.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "生词本还是空的：在网页里选中单词，右键「记入生词本」或按 Alt+Shift+W。";
    els.list.appendChild(empty);
    return;
  }
  for (const entry of sortedWords()) {
    els.list.appendChild(renderRow(entry));
  }
}

function renderRow(entry) {
  const row = document.createElement("div");
  row.className = "row" + (equalWord(expandedWord, entry.word) ? " expanded" : "");

  const main = document.createElement("div");
  main.className = "row-main";

  const word = document.createElement("span");
  word.className = "word";
  word.textContent = entry.word;

  const meaning = document.createElement("span");
  meaning.className = "meaning";
  meaning.textContent = entry.posMeaning || entry.translation || "";

  const count = document.createElement("span");
  count.className = "count";
  count.textContent = "×" + entry.count;

  main.append(word, meaning, count);
  main.addEventListener("click", () => {
    expandedWord = equalWord(expandedWord, entry.word) ? null : entry.word;
    render();
  });
  row.appendChild(main);

  if (equalWord(expandedWord, entry.word)) row.appendChild(renderDetail(entry));
  return row;
}

function renderDetail(entry) {
  const detail = document.createElement("div");
  detail.className = "detail";
  const dl = document.createElement("dl");
  const rows = [
    ["音标", entry.phonetic],
    ["词性释义", entry.posMeaning],
    ["翻译", entry.translation],
    ["词根", entry.root],
    ["例句", entry.example],
    ["词源", entry.origin],
    ["上下文", entry.context],
    ["来源", entry.sourceFile],
    ["记录", entry.count + " 次 · 最近 " + formatTime(entry.lastCaptured)],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  detail.appendChild(dl);

  const actions = document.createElement("div");
  actions.className = "actions";

  const speakBtn = document.createElement("button");
  speakBtn.textContent = "🔊 朗读";
  speakBtn.addEventListener("click", () => speak(entry.word));

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "danger";
  deleteBtn.textContent = "删除";
  deleteBtn.addEventListener("click", () => removeWord(entry.word));

  actions.append(speakBtn, deleteBtn);
  detail.appendChild(actions);
  return detail;
}

// ---------- 操作 ----------

async function removeWord(word) {
  try {
    await deleteWord(word);
    toast("已删除 " + word);
    if (equalWord(expandedWord, word)) expandedWord = null;
    words = await fetchWords();
    render();
    chrome.runtime.sendMessage({ type: "refresh-words" });
  } catch (e) {
    toast("删除失败：" + e.message, true);
  }
}

async function enrichMissing() {
  if (enriching) return;
  const missing = words.filter(needsEnrich);
  if (!missing.length) {
    toast("没有需要补全的生词");
    return;
  }
  enriching = true;
  els.enrich.disabled = true;
  let updated = 0;
  try {
    for (let i = 0; i < missing.length; i++) {
      els.enrich.textContent = "补全 " + (i + 1) + "/" + missing.length;
      try {
        const result = await enrichWord(missing[i].word);
        if (result.updated) updated++;
      } catch (_) { /* 单词失败继续下一个 */ }
      await sleep(300); // 与 IDE 批量补全的间隔一致
    }
    words = await fetchWords();
    render();
    toast("词典补全完成：" + updated + "/" + missing.length + " 个单词获取到新信息");
  } finally {
    enriching = false;
    els.enrich.disabled = false;
    els.enrich.textContent = "补全词典";
  }
}

async function copyAll() {
  if (!words.length) return;
  try {
    await navigator.clipboard.writeText(words.map((e) => e.word).join("\n"));
    toast("已复制 " + words.length + " 个单词");
  } catch (e) {
    toast("复制失败：" + e.message, true);
  }
}

// 与 IDE 端 WordCatcherPanel.writeCsv 完全同格式：UTF-8 BOM、同列、同引号规则
function exportCsv() {
  if (!words.length) return;
  const header = ["单词", "音标", "词性释义", "翻译", "词根拆解", "例句", "次数", "首次记录", "最近记录", "来源文件", "上下文"];
  const lines = [header.join(",")];
  for (const e of words) {
    lines.push([
      e.word, e.phonetic || "", e.posMeaning || "", e.translation || "", e.root || "",
      e.example || "", String(e.count), formatTime(e.firstCaptured), formatTime(e.lastCaptured),
      e.sourceFile || "", e.context || "",
    ].map(csvField).join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "wordbook-" + localDate() + ".csv";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("已导出 " + words.length + " 条");
}

function csvField(value) {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

// ---------- 高亮开关 ----------

async function refreshHighlightButton() {
  const stored = await chrome.storage.local.get(KEY_ENABLED);
  els.highlight.classList.toggle("on", stored[KEY_ENABLED] !== false);
}

async function toggleHighlight() {
  const stored = await chrome.storage.local.get(KEY_ENABLED);
  const enabled = stored[KEY_ENABLED] === false; // 当前是关 → 打开（默认开）
  await chrome.storage.local.set({ [KEY_ENABLED]: enabled });
  els.highlight.classList.toggle("on", enabled);
  chrome.runtime.sendMessage({ type: "highlight-toggled", enabled });
  toast(enabled ? "网页生词高亮已开启" : "网页生词高亮已关闭");
}

// ---------- 朗读 ----------

// 优先用与 IDE 相同的系统 TTS（走插件服务，离线可用、同一声音）；
// IDEA 未运行或朗读失败时退回浏览器语音合成（音色可在工具栏下拉框选择）。
async function speak(word) {
  try {
    await speakViaPlugin(word);
    return;
  } catch (_) { /* IDEA 未运行或朗读失败，退回浏览器语音 */ }
  try {
    await speakWithBrowser(word);
  } catch (e) {
    toast("无法朗读：" + e.message, true);
  }
}

function equalWord(a, b) {
  return a != null && b != null && a.toLowerCase() === b.toLowerCase();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// 与 IDE 一致：yyyy-MM-dd HH:mm（本机时区）
function formatTime(millis) {
  if (!millis) return "";
  const d = new Date(millis);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function localDate() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = isError ? "error" : "info";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.className = "hidden";
  }, 2200);
}
