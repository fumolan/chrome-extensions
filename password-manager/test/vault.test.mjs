// vault.js 加密逻辑单测：正确口令可往返，错误口令必须抛异常
import {
  deriveKey,
  exportKeyB64,
  importKeyB64,
  encryptJSON,
  decryptJSON,
  bufToB64,
  b64ToBuf,
} from '../extension/vault.js';

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok:', msg);
};

const salt = crypto.getRandomValues(new Uint8Array(16));
const sample = [{ id: '1', title: '测试站点', username: 'user@x.com', password: 'p@ssw0rd!' }];

const k1 = await deriveKey('correct-horse-battery', salt, 10000);
const { iv, data } = await encryptJSON(k1, sample);

// b64 往返
const buf = new TextEncoder().encode('你好abc123');
assert(new TextDecoder().decode(b64ToBuf(bufToB64(buf))) === '你好abc123', 'base64 编解码往返');

// 密钥导出/导入后解密
const k2 = await importKeyB64(await exportKeyB64(k1));
const dec = await decryptJSON(k2, iv, data);
assert(JSON.stringify(dec) === JSON.stringify(sample), '加解密往返一致');

// 错误口令派生的密钥解密必须失败（GCM 认证）
const k3 = await deriveKey('wrong-password', salt, 10000);
let rejected = false;
try {
  await decryptJSON(k3, iv, data);
} catch {
  rejected = true;
}
assert(rejected, '错误主密码被拒绝');

// 篡改密文必须失败
const k4 = await importKeyB64(await exportKeyB64(k1));
const bytes = b64ToBuf(data);
bytes[3] ^= 0xff;
let tamperRejected = false;
try {
  await decryptJSON(k4, iv, bufToB64(bytes));
} catch {
  tamperRejected = true;
}
assert(tamperRejected, '篡改密文被拒绝');

console.log('ALL PASS');
