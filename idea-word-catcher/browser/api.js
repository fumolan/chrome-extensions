// 与 IDEA 插件 WordCatcherHttpService 对接的公共 API 封装。
// 端口必须与插件端 WordCatcherHttpService.PORT 一致。

export const API_BASE = "http://127.0.0.1:18091";

// 与 IDE 端 CaptureWordAction.WORD_PATTERN 一致：英文单词，允许内部连字符 / 撇号
export const WORD_RE = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;

// 与 IDE 工具窗「补全词典」判定一致：origin 不要求
export function needsEnrich(entry) {
  const blank = (v) => !v || !v.trim();
  return blank(entry.translation) || blank(entry.posMeaning) ||
    blank(entry.phonetic) || blank(entry.example) || blank(entry.root);
}

async function request(path, options = {}, timeoutMs = 0) {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(API_BASE + path, { ...options, signal: controller.signal });
    if (!response.ok) {
      let message = "HTTP " + response.status;
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
      } catch (_) { /* 忽略非 JSON 响应体 */ }
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 探测 IDEA 插件服务是否在运行（短超时）。失败抛异常。 */
export function fetchHealth() {
  return request("/api/health", {}, 2000);
}

export function fetchWords() {
  return request("/api/words");
}

/** 记入生词本，返回 {word, count}；count 为累计次数。 */
export function addWord(word, context, source) {
  return request("/api/words", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, context: context || "", source: source || "" }),
  });
}

/** 强制补全词典，返回 {word, updated}。可能阻塞较久（多源词典逐个尝试）。 */
export function enrichWord(word) {
  return request("/api/words/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word }),
  });
}

export function deleteWord(word) {
  return request("/api/words?word=" + encodeURIComponent(word), { method: "DELETE" });
}

/** 用与 IDE 工具窗相同的系统 TTS 朗读（SpeakWord，离线可用）。失败抛异常。 */
export function speakViaPlugin(word) {
  // 同步朗读需等 PowerShell 启动 + 朗读完成（约 2~8 秒），超时放宽到 15 秒
  return request("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word }),
  }, 15000);
}
