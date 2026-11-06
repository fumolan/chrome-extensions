// md.js — 富文本 HTML → Markdown 转换器（零依赖）。
// 覆盖编辑器可产生的元素：标题/段落/加粗/斜体/删除线/行内代码/链接/图片/
// 有序无序列表（含嵌套）/引用/代码块/分隔线；颜色高亮等无对应语法的样式会被忽略。
(function () {
  'use strict';

  const ESCAPES = { '\\': '\\\\', '`': '\\`', '*': '\\*', '_': '\\_', '[': '\\[', ']': '\\]' };
  const esc = (s) => s.replace(/[\\`*_\[\]]/g, (c) => ESCAPES[c]);

  function textOf(s) {
    return esc(s.replace(/\u00a0/g, ' '));
  }

  /* ---------- 行内元素 ---------- */

  function convertInline(node) {
    let out = '';
    for (const child of node.childNodes) out += convertInlineNode(child);
    return out;
  }

  function convertInlineNode(n) {
    if (n.nodeType === Node.TEXT_NODE) return textOf(n.nodeValue);
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    switch (n.tagName) {
      case 'BR': return '  \n'; // Markdown 硬换行
      case 'B': case 'STRONG': {
        const t = convertInline(n).trim();
        return t ? '**' + t + '**' : '';
      }
      case 'I': case 'EM': {
        const t = convertInline(n).trim();
        return t ? '*' + t + '*' : '';
      }
      case 'U': // Markdown 无下划线语法，保留纯文字
        return convertInline(n);
      case 'S': case 'STRIKE': case 'DEL': {
        const t = convertInline(n).trim();
        return t ? '~~' + t + '~~' : '';
      }
      case 'CODE': {
        const t = n.textContent.replace(/\u00a0/g, ' ');
        return t ? '`' + t + '`' : '';
      }
      case 'A': {
        const href = n.getAttribute('href') || '';
        const text = convertInline(n).trim() || href;
        return href ? '[' + text + '](' + href + ')' : text;
      }
      case 'IMG': {
        const src = n.getAttribute('src') || '';
        const alt = (n.getAttribute('alt') || '图片').replace(/[\[\]]/g, '');
        return src ? '![' + alt + '](' + src + ')' : '';
      }
      default: // span / font 等：丢弃样式，保留内容
        return convertInline(n);
    }
  }

  /* ---------- 块级元素 ---------- */

  function convertBlocks(node, indent) {
    let out = '';
    for (const child of node.childNodes) out += convertBlock(child, indent);
    return out;
  }

  function convertBlock(n, indent) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = textOf(n.nodeValue).trim();
      return t ? t + '\n\n' : '';
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = n.tagName;
    const pad = ' '.repeat(indent);

    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const text = convertInline(n).trim();
        return text ? '#'.repeat(Number(tag[1])) + ' ' + text + '\n\n' : '';
      }
      case 'P': {
        const text = convertInline(n).trim();
        return text ? text + '\n\n' : '';
      }
      case 'HR':
        return '---\n\n';
      case 'BLOCKQUOTE': {
        const inner = convertBlocks(n, indent).trimEnd();
        if (!inner.trim()) return '';
        return inner.split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      }
      case 'PRE': {
        const code = n.textContent.replace(/\u00a0/g, ' ').replace(/\n+$/, '');
        return code ? '```\n' + code + '\n```\n\n' : '';
      }
      case 'UL': case 'OL': {
        let out = '';
        let i = 1;
        const childIndent = indent + (tag === 'OL' ? 4 : 2);
        for (const li of n.children) {
          if (li.tagName !== 'LI') continue;
          const marker = tag === 'OL' ? i++ + '. ' : '- ';
          let inlinePart = '';
          let nestedPart = '';
          for (const c of li.childNodes) {
            if (c.nodeType === Node.ELEMENT_NODE && (c.tagName === 'UL' || c.tagName === 'OL')) {
              nestedPart += convertBlock(c, childIndent);
            } else {
              inlinePart += convertInlineNode(c);
            }
          }
          inlinePart = inlinePart.replace(/\s+$/g, '').trim();
          if (!inlinePart && !nestedPart) continue;
          out += pad + marker + inlinePart + '\n' + nestedPart;
        }
        return out ? out + '\n' : '';
      }
      case 'DIV': case 'SECTION': case 'ARTICLE': {
        // 通用容器：有块级子元素则按块展开，否则当段落处理（浏览器常用 div 当段落）
        const hasBlockChild = Array.from(n.children).some((c) =>
          /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR)$/.test(c.tagName));
        if (hasBlockChild) return convertBlocks(n, indent);
        const text = convertInline(n).trim();
        return text ? text + '\n\n' : '';
      }
      default: {
        const text = convertInline(n).trim();
        return text ? text + '\n\n' : '';
      }
    }
  }

  /**
   * 把编辑器内容转换为 Markdown 文本。
   * @param {HTMLElement} editorEl 富文本编辑器（内容不会被修改）
   * @param {string} title 笔记标题（作为一级标题）
   */
  function toMarkdown(editorEl, title) {
    const clone = editorEl.cloneNode(true);
    const body = convertBlocks(clone, 0).replace(/\n{3,}/g, '\n\n').trim();
    const heading = title ? '# ' + title.replace(/^#+\s*/, '') + '\n\n' : '';
    return heading + body + '\n';
  }

  window.RichNotesExport = { toMarkdown };
})();
