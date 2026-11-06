// 网页生词高亮 —— IDE 端 WordHighlighter 的浏览器版：
// 忽略大小写 + 词边界匹配；浅 / 深色各一种底色；编辑后 300ms 防抖重刷；超大页面跳过。
(() => {
  "use strict";

  const MARK_TAG = "wc-mark";
  const KEY_ENABLED = "highlightEnabled";
  const MAX_TEXT_CHARS = 2000000; // 与 IDE 一致：超过 2M 字符的页面跳过
  const MAX_NODES = 20000;        // 单次最多处理的文本节点数，避免大页面卡顿
  const DEBOUNCE_MS = 300;

  const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);
  let enabled = null;  // null = 设置未加载
  let words = null;    // null = 词表未加载
  let applyTimer = null;

  injectStyle();

  const observer = new MutationObserver(() => {
    if (enabled && words && words.length) scheduleApply();
  });

  Promise.resolve().then(start);

  async function start() {
    const stored = await chrome.storage.local.get(KEY_ENABLED);
    enabled = stored[KEY_ENABLED] !== false; // 默认开
    chrome.runtime.sendMessage({ type: "get-words" }, (resp) => {
      words = (resp && resp.words) || [];
      apply();
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "words-changed") {
      words = message.words || [];
      apply();
    } else if (message.type === "highlight-toggle") {
      enabled = !!message.enabled;
      apply();
    }
  });

  function injectStyle() {
    if (document.getElementById("wc-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "wc-highlight-style";
    // 配色与 IDE 端 JBColor(0xFFE9A8, 0x5C4A1E) 一致
    style.textContent =
      "wc-mark{background:#FFE9A8;color:inherit;border-radius:2px}" +
      "@media (prefers-color-scheme:dark){wc-mark{background:#5C4A1E}}";
    document.documentElement.appendChild(style);
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(apply, DEBOUNCE_MS);
  }

  function apply() {
    if (enabled === null || words === null || !document.body) return;
    // 防自触发：处理期间断开 observer，自己的 DOM 变更不会进入防抖循环
    observer.disconnect();
    try {
      unwrapAll();
      if (enabled && words.length) markAll();
    } finally {
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    }
  }

  function unwrapAll() {
    for (const mark of Array.from(document.querySelectorAll(MARK_TAG))) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  function markAll() {
    if ((document.body.textContent || "").length > MAX_TEXT_CHARS) return;
    const pattern = buildPattern();
    if (!pattern) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const name = parent.nodeName;
        if (name === "SCRIPT" || name === "STYLE" || name === "NOSCRIPT" ||
          name === "TEXTAREA" || name === MARK_TAG.toUpperCase()) return NodeFilter.FILTER_REJECT;
        if (closestEditable(parent)) return NodeFilter.FILTER_REJECT;
        return node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    for (let node = walker.nextNode(); node && nodes.length < MAX_NODES; node = walker.nextNode()) {
      nodes.push(node);
    }
    for (const node of nodes) markNode(node, pattern);
  }

  function buildPattern() {
    const parts = (words || []).filter(Boolean).map(escapeRegExp);
    if (!parts.length) return null;
    try {
      return new RegExp("\\b(?:" + parts.join("|") + ")\\b", "gi");
    } catch (_) {
      return null; // 词表异常时不高亮，不影响页面
    }
  }

  function markNode(textNode, pattern) {
    const text = textNode.data;
    const re = new RegExp(pattern.source, "gi");
    if (!re.test(text)) return;
    re.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let last = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      const mark = document.createElement(MARK_TAG);
      mark.textContent = match[0];
      fragment.appendChild(mark);
      last = match.index + match[0].length;
      if (match[0].length === 0) re.lastIndex++; // 防空匹配死循环
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function closestEditable(element) {
    for (let e = element; e && e.nodeType === Node.ELEMENT_NODE; e = e.parentElement) {
      if (EDITABLE.has(e.nodeName) || e.isContentEditable) return true;
    }
    return false;
  }

  function escapeRegExp(word) {
    return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
})();
