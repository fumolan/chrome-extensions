// 共享加密/存储模块：popup 与 background 均以 ES module 引入
// 密码库格式（chrome.storage.local['vault']）：
//   { v: 1, salt: b64, iter: number, iv: b64, data: b64 }
//   data = AES-256-GCM(JSON.stringify(entries))，错误主密码解密时 GCM 校验失败抛异常

export const ITER_DEFAULT = 600000;
export const VAULT_KEY = 'vault';
export const SESSION_KEY = 'sk'; // 解锁后的原始密钥（base64），仅存 session（内存，浏览器关闭即清）

export function bufToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  }
  return btoa(s);
}

export function b64ToBuf(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function deriveKey(password, salt, iterations = ITER_DEFAULT) {
  const pm = new TextEncoder().encode(password);
  return crypto.subtle
    .importKey('raw', pm, 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        true, // extractable：解锁期间放 session 用
        ['encrypt', 'decrypt']
      )
    );
}

export async function exportKeyB64(key) {
  return bufToB64(await crypto.subtle.exportKey('raw', key));
}

export async function importKeyB64(b64) {
  return crypto.subtle.importKey('raw', b64ToBuf(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = bufToB64(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)))
  );
  return { iv: bufToB64(iv), data };
}

export async function decryptJSON(key, ivB64, dataB64) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(ivB64) }, key, b64ToBuf(dataB64));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---- chrome.storage 封装 ----

export async function loadVault() {
  const r = await chrome.storage.local.get(VAULT_KEY);
  return r[VAULT_KEY] || null;
}

export function saveVault(meta) {
  return chrome.storage.local.set({ [VAULT_KEY]: meta });
}

export async function getSessionKey() {
  const r = await chrome.storage.session.get(SESSION_KEY);
  return r[SESSION_KEY] || null;
}

export function setSessionKey(b64) {
  return chrome.storage.session.set({ [SESSION_KEY]: b64 });
}

export function clearSessionKey() {
  return chrome.storage.session.remove(SESSION_KEY);
}

// 记录最近活动时间，供 background 自动锁定判断
export function touch() {
  return chrome.storage.session.set({ lastActive: Date.now() });
}
