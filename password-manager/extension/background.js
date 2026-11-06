// 后台 Service Worker：仅负责空闲自动锁定（5 分钟无活动清除 session 密钥）

const AUTOLOCK_MS = 5 * 60 * 1000;
const SESSION_KEY = 'sk';

chrome.alarms.create('autolock', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'autolock') return;
  const r = await chrome.storage.session.get([SESSION_KEY, 'lastActive']);
  if (r[SESSION_KEY] && (!r.lastActive || Date.now() - r.lastActive > AUTOLOCK_MS)) {
    await chrome.storage.session.remove(SESSION_KEY);
  }
});
