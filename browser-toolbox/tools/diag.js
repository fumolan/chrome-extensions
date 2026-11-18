// 页面自诊断（须在所有页面脚本之前加载）：版本水印 + 全局错误横幅
// 作用：① 顶部显示 manifest 版本，一眼确认页面是不是当前版本
//      ② 任何脚本错误 / 异步错误直接显示成页内红色横幅，不用开 DevTools 就能报障
// MV3 CSP 禁止内联脚本，所以必须是独立文件
(function () {
  function showErr(text) {
    var b = document.getElementById('jsErrBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'jsErrBanner';
      var wrap = document.querySelector('.wrap');
      if (wrap && wrap.firstChild) wrap.insertBefore(b, wrap.firstChild);
      else document.body.appendChild(b);
    }
    b.textContent += (b.textContent ? '\n' : '') + text;
  }

  window.addEventListener('error', function (e) {
    if (e.target && e.target.tagName && e.target.tagName !== 'SCRIPT' && e.target.src) {
      showErr('[资源加载失败] ' + e.target.src.split('/').slice(-2).join('/'));
      return;
    }
    showErr('[脚本错误] ' + e.message + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    showErr('[异步错误] ' + ((r && (r.stack || r.message)) || String(r)));
  });

  document.addEventListener('DOMContentLoaded', function () {
    var tag = document.getElementById('verTag');
    if (!tag) return;
    try {
      tag.textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (err) {
      // 扩展重载后旧页面的 chrome.runtime 已失效
      tag.textContent = '⚠ 本页已失效（扩展重载过）：请关闭后从工具箱重新打开';
      tag.style.color = 'var(--danger)';
    }
  });
})();
