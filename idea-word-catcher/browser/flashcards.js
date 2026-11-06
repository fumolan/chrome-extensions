// 生词卡片自测 —— IDE 端 FlashcardsDialog 的网页版：
// 随机顺序出卡，正面 单词 + 音标 + 上下文提示，翻卡核对释义 / 词根 / 例句，
// 认识 / 不认识 计数（不落库，与 IDE 一致），结束显示统计。

import { fetchWords, speakViaPlugin } from "./api.js";
import { fillVoiceSelect, setPreferredVoiceName, speakWithBrowser } from "./voice.js";

const els = {
  progress: document.getElementById("progress"),
  banner: document.getElementById("banner"),
  card: document.getElementById("card"),
  word: document.getElementById("cardWord"),
  phonetic: document.getElementById("cardPhonetic"),
  context: document.getElementById("cardContext"),
  meaning: document.getElementById("cardMeaning"),
  root: document.getElementById("cardRoot"),
  example: document.getElementById("cardExample"),
  summary: document.getElementById("summary"),
  speak: document.getElementById("speakBtn"),
  flip: document.getElementById("flipBtn"),
  skip: document.getElementById("skipBtn"),
  know: document.getElementById("knowBtn"),
  unknown: document.getElementById("unknownBtn"),
  restart: document.getElementById("restartBtn"),
  close: document.getElementById("closeBtn"),
  voice: document.getElementById("voiceSel"),
};

let cards = [];
let index = 0;
let flipped = false;
let known = 0;
let unknown = 0;

els.flip.addEventListener("click", () => flip());
els.skip.addEventListener("click", () => next());
els.know.addEventListener("click", () => grade(true));
els.unknown.addEventListener("click", () => grade(false));
els.speak.addEventListener("click", () => {
  if (cards.length && index < cards.length) speak(cards[index].word);
});
els.restart.addEventListener("click", start);
els.close.addEventListener("click", () => window.close());

// 音色下拉框：浏览器朗读（IDEA 未连接时的备用朗读路径）使用
fillVoiceSelect(els.voice).catch(() => { /* 列表加载失败保持禁用 */ });
els.voice.addEventListener("change", () => setPreferredVoiceName(els.voice.value));

// 未翻卡时点认识 / 不认识不计分（与 IDE 一致）
function grade(isKnown) {
  if (!flipped) return;
  if (isKnown) known++; else unknown++;
  next();
}

function flip() {
  if (index >= cards.length) return;
  flipped = true;
  const entry = cards[index];
  const meaning = entry.posMeaning || entry.translation;
  els.meaning.textContent = meaning || "（暂无释义，可在生词本里点「补全词典」）";
  els.root.textContent = entry.root ? "词根：" + entry.root : "";
  els.example.textContent = entry.example ? "例句：" + entry.example : "";
  els.meaning.classList.remove("hidden");
  els.flip.classList.add("hidden");
  els.know.classList.remove("hidden");
  els.unknown.classList.remove("hidden");
}

function next() {
  index++;
  flipped = false;
  if (index < cards.length) {
    showCard();
  } else {
    showSummary();
  }
}

function showCard() {
  const entry = cards[index];
  els.card.classList.remove("hidden");
  els.summary.classList.add("hidden");
  els.word.textContent = entry.word;
  els.phonetic.textContent = entry.phonetic || "";
  els.context.textContent = entry.context ? "“" + entry.context + "”" : "";
  els.meaning.textContent = "（先回忆释义，再点「显示释义」核对）";
  els.meaning.classList.remove("hidden");
  els.root.textContent = "";
  els.example.textContent = "";
  els.flip.classList.remove("hidden");
  els.know.classList.add("hidden");
  els.unknown.classList.add("hidden");
  els.progress.textContent =
    "第 " + (index + 1) + " / " + cards.length + " 张    认识 " + known + " · 不认识 " + unknown;
}

function showSummary() {
  els.card.classList.add("hidden");
  els.summary.classList.remove("hidden");
  els.summary.innerHTML = "";
  const title = document.createElement("div");
  title.className = "summary-title";
  title.textContent = "测验完成！";
  const count = document.createElement("div");
  count.className = "summary-count";
  count.innerHTML =
    '认识 <span class="ok">' + known + '</span> 个，不认识 <span class="bad">' + unknown + "</span> 个";
  els.summary.append(title, count);
  els.progress.textContent = "共 " + cards.length + " 张";
  for (const btn of [els.speak, els.flip, els.skip, els.know, els.unknown]) btn.classList.add("hidden");
  els.restart.classList.remove("hidden");
  els.close.classList.remove("hidden");
}

async function start() {
  els.banner.classList.add("hidden");
  for (const btn of [els.speak, els.flip, els.skip, els.know, els.unknown]) btn.classList.remove("hidden");
  els.restart.classList.add("hidden");
  els.close.classList.add("hidden");
  known = 0;
  unknown = 0;
  index = 0;
  flipped = false;

  let entries;
  try {
    entries = await fetchWords();
  } catch (_) {
    els.banner.textContent = "未连接：请先启动 IDEA（Word Catcher 插件）";
    els.banner.classList.remove("hidden");
    els.card.classList.add("hidden");
    for (const btn of [els.speak, els.flip, els.skip, els.know, els.unknown]) btn.classList.add("hidden");
    els.progress.textContent = "";
    return;
  }
  if (!entries.length) {
    els.banner.textContent = "生词本是空的，先去网页里记几个单词吧。";
    els.banner.classList.remove("hidden");
    els.card.classList.add("hidden");
    for (const btn of [els.speak, els.flip, els.skip, els.know, els.unknown]) btn.classList.add("hidden");
    els.progress.textContent = "";
    return;
  }
  cards = shuffle([...entries]);
  showCard();
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// 朗读：优先与 IDE 相同的系统 TTS（走插件服务）；IDEA 未运行或朗读失败时
// 退回浏览器语音合成（音色可在页头下拉框选择，偏好自动保存）。
async function speak(word) {
  try {
    await speakViaPlugin(word);
    return;
  } catch (_) { /* IDEA 未运行或朗读失败，退回浏览器语音 */ }
  try {
    await speakWithBrowser(word);
  } catch (_) { /* 无可用音色时保持安静，不打断卡片流程 */ }
}

start();
