// 浏览器语音合成公共模块（popup 与 flashcards 共用）：
// 音色列表加载、偏好保存（chrome.storage.local）、自动挑选与朗读。
// 音色来源说明：Chrome 只能看到 Windows 本机语音；Edge 还会额外提供
// 「Natural / 在线」音色（如 en-US Aria，需联网，效果最好）。

const KEY_VOICE = "ttsVoiceName"; // 存的是 voice.name
let speechUtterance = null; // 朗读结束前保持引用，避免被 GC 导致无声

/** 等待浏览器语音列表加载完成（否则 getVoices() 为空，speak 静默无效）。 */
export function ensureVoicesLoaded(timeoutMs = 3000) {
  if (!("speechSynthesis" in window)) return Promise.resolve(false);
  if (speechSynthesis.getVoices().length) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(speechSynthesis.getVoices().length > 0), timeoutMs);
    speechSynthesis.addEventListener("voiceschanged", () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
  });
}

export async function getPreferredVoiceName() {
  const stored = await chrome.storage.local.get(KEY_VOICE);
  return stored[KEY_VOICE] || "";
}

export function setPreferredVoiceName(name) {
  return chrome.storage.local.set({ [KEY_VOICE]: name });
}

// 排序/挑选的打分：英语优先；Natural / 在线音色效果最好，排最前
function score(voice) {
  let s = 0;
  const name = voice.name.toLowerCase();
  if (name.includes("natural") || name.includes("online")) s += 4;
  if (voice.lang === "en-US") s += 2;
  else if (voice.lang && voice.lang.startsWith("en")) s += 1;
  return s;
}

export function sortVoices(voices) {
  return [...voices].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** 按偏好名挑音色；没有偏好或找不到时自动挑最好的英语音色，再退回列表第一个。 */
export function pickVoice(voices, preferredName) {
  if (!voices.length) return null;
  if (preferredName) {
    const preferred = voices.find((v) => v.name === preferredName);
    if (preferred) return preferred;
  }
  return sortVoices(voices)[0];
}

/** 朗读一个单词/短句（浏览器语音合成），失败抛异常。 */
export async function speakWithBrowser(text) {
  if (!("speechSynthesis" in window)) {
    throw new Error("浏览器不支持语音合成");
  }
  const loaded = await ensureVoicesLoaded();
  const voices = speechSynthesis.getVoices();
  if (!voices.length) {
    throw new Error(loaded ? "没有可用的语音音色" : "语音列表加载超时");
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  const voice = pickVoice(voices, await getPreferredVoiceName());
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  speechUtterance = utterance;
  speechSynthesis.speak(utterance);
}

/**
 * 填充音色下拉框：第一项为「自动」，其后按 英文/在线优先 排序的全部音色。
 * 返回当前选中值（保存过的偏好）。
 */
export async function fillVoiceSelect(select) {
  await ensureVoicesLoaded();
  const voices = speechSynthesis.getVoices();
  const preferred = await getPreferredVoiceName();
  select.textContent = "";
  select.appendChild(new Option("自动（英语优先）", ""));
  for (const v of sortVoices(voices)) {
    const tag = v.localService ? "" : " ·在线";
    select.appendChild(new Option(v.name + " · " + v.lang + tag, v.name));
  }
  select.value = voices.some((v) => v.name === preferred) ? preferred : "";
  select.disabled = false;
  return select.value;
}
