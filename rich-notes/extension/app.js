// app.js — 富文本笔记主界面逻辑
// 侧栏为两栏布局（参考有道云笔记）：左栏导航树「🕘 最新 / 📌 置顶 / 📁 我的项目 → 📂 分组」，
// 右栏为当前范围的笔记列表（顶部搜索 + 底部「总共 N 项」统计）
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const DEFAULT_PROJECT = '默认项目';
  const DEFAULT_GROUP = '默认分组';
  const COLLAPSED_KEY = 'rich-notes-collapsed';
  const SCOPE_KEY = 'rich-notes-scope';

  // 应用版本：扩展模式下以 manifest.json 的 version 为单一来源；
  // 普通网页方式打开（无 chrome.runtime）时用此兜底值，需与 manifest.json 保持一致
  const APP_VERSION =
    (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
      ? chrome.runtime.getManifest().version
      : '1.6.3';

  const editor = $('#editor');
  const listEl = $('#noteList');
  const navEl = $('#navTree');
  const sidebarWrap = $('#sidebarWrap');
  const listFooter = $('#listFooter');
  const searchInput = $('#searchInput');
  const statusText = $('#statusText');
  const wordCount = $('#wordCount');
  const toastEl = $('#toast');

  let currentNote = null; // 当前打开的笔记；null 表示尚未保存的新笔记
  let newNoteDefaultTitle = null; // 新笔记注入的默认标题（保存/打开旧笔记后清空；用于拦截「仅默认标题、零正文」的空笔记）
  let dirty = false;
  let toastTimer = null;

  let allNotes = []; // 全量笔记缓存（分组渲染、项目/分组下拉选项共用）
  // 当前编辑中笔记的归属与置顶状态（保存时写入笔记）
  let meta = { project: DEFAULT_PROJECT, group: DEFAULT_GROUP, pinned: false };
  // 侧栏折叠状态（持久化到 localStorage）
  let collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  // 当前导航范围：latest | pinned | p:项目 | g:项目/分组（持久化到 localStorage）
  let scope = localStorage.getItem(SCOPE_KEY) || 'latest';
  // 当前笔记的附件列表（随笔记一起保存）
  let attachments = [];

  const MAX_IMG_SIZE = 4 * 1024 * 1024;    // 插入正文的图片上限
  const MAX_ATTACH_SIZE = 10 * 1024 * 1024; // 单个附件上限

  /* ---------- 通用 ---------- */

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, 2200);
  }

  function fmtTime(ts) {
    return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function setDirty(v) {
    dirty = v;
    if (v) statusText.textContent = '● 未保存';
    statusText.classList.toggle('unsaved', v);
  }

  function updateWordCount() {
    const len = editor.textContent.replace(/\s+/g, ' ').trim().length;
    wordCount.textContent = len ? len + ' 字' : '';
  }

  function projOf(n) { return n.project || DEFAULT_PROJECT; }
  function groupOf(n) { return n.group || DEFAULT_GROUP; }

  function sortNames(names, first) {
    return names.sort((a, b) => {
      if (a === first) return -1;
      if (b === first) return 1;
      return a.localeCompare(b, 'zh');
    });
  }

  /* ---------- 侧栏：左栏导航树 + 右栏笔记列表（参考有道云笔记两栏布局） ---------- */

  async function refreshList() {
    try {
      allNotes = await NoteStore.list('');
    } catch (e) {
      toast('加载笔记失败：' + e.message, true);
      allNotes = [];
    }
    validScope();
    localStorage.setItem(SCOPE_KEY, scope);
    renderNav();
    filterAndRender();
  }

  // 校验持久化的范围仍存在（项目/分组被删后回退到上级或「最新」）
  function validScope() {
    const hasProject = (p) => allNotes.some((n) => projOf(n) === p);
    const hasGroup = (p, g) => allNotes.some((n) => projOf(n) === p && groupOf(n) === g);
    if (scope.startsWith('g:')) {
      const i = scope.indexOf('/', 2);
      const p = scope.slice(2, i);
      const g = scope.slice(i + 1);
      if (hasGroup(p, g)) return;
      scope = hasProject(p) ? 'p:' + p : 'latest';
    } else if (scope.startsWith('p:') && !hasProject(scope.slice(2))) {
      scope = 'latest';
    }
  }

  function selectScope(key) {
    scope = key;
    localStorage.setItem(SCOPE_KEY, key);
    renderNav();
    renderList();
  }

  function toggleCollapsed(key) {
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    renderNav();
  }

  // 搜索过滤在本地完成（全量数据已在 allNotes），输入即时生效
  function filterAndRender() {
    renderList();
    refreshMetaOptions();
  }

  // 当前导航范围下的笔记（置顶优先，其余按更新时间倒序）
  function scopedNotes() {
    let notes;
    if (scope === 'pinned') {
      notes = allNotes.filter((n) => n.pinned);
    } else if (scope.startsWith('p:')) {
      const p = scope.slice(2);
      notes = allNotes.filter((n) => projOf(n) === p);
    } else if (scope.startsWith('g:')) {
      const i = scope.indexOf('/', 2);
      notes = allNotes.filter((n) =>
        projOf(n) === scope.slice(2, i) && groupOf(n) === scope.slice(i + 1));
    } else {
      notes = allNotes; // 最新
    }
    return notes.slice().sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  // 右栏笔记列表：当前范围 + 搜索过滤（平铺展示，悬停可置顶）
  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    let notes = scopedNotes();
    if (q) {
      notes = notes.filter((n) =>
        (n.title || '').toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q));
    }
    listFooter.textContent = '总共 ' + notes.length + ' 项';
    listEl.innerHTML = '';
    if (!notes.length) {
      listEl.innerHTML = '<div class="empty">暂无笔记</div>';
      return;
    }
    for (const n of notes) listEl.appendChild(noteItemEl(n));
  }

  function fmtDate(ts) {
    return ts ? new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
  }

  // 列表时间后的归属提示：范围已具体到分组时省略，默认项目/分组不提示
  function locSuffix(n) {
    if (scope.startsWith('g:')) return '';
    const p = projOf(n);
    const g = groupOf(n);
    if (p === DEFAULT_PROJECT && g === DEFAULT_GROUP) return '';
    return scope.startsWith('p:') ? ' · ' + g : ' · ' + p + ' / ' + g;
  }

  function noteItemEl(n) {
    const item = document.createElement('div');
    item.className = 'note-item' + (currentNote && currentNote.id === n.id ? ' active' : '');
    const t = document.createElement('div');
    t.className = 'note-title';
    const attachMark = n.attachments && n.attachments.length ? ' 📎' + n.attachments.length : '';
    t.textContent = (n.title || '(无标题)') + attachMark;
    const s = document.createElement('div');
    s.className = 'note-snippet';
    s.textContent = (n.text || '').slice(0, 50) || '(空)';
    const d = document.createElement('div');
    d.className = 'note-time';
    d.textContent = fmtDate(n.updatedAt) + locSuffix(n);
    d.title = fmtTime(n.updatedAt);
    // 列表项上的置顶按钮（悬停显示，已置顶常显）
    const pin = document.createElement('button');
    pin.className = 'item-pin' + (n.pinned ? ' on' : '');
    pin.title = n.pinned ? '取消置顶' : '置顶';
    pin.textContent = '📌';
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePinFor(n);
    });
    item.append(pin, t, s, d);
    item.addEventListener('click', () => openNote(n));
    return item;
  }

  // 从列表项直接置顶/取消置顶（立即保存生效）
  async function togglePinFor(n) {
    const wasPinned = !!n.pinned;
    const now = Date.now();
    n.pinned = !wasPinned;
    n.pinnedAt = n.pinned ? (n.pinnedAt || now) : 0;
    try {
      await NoteStore.save(n);
      // 若该笔记正被编辑，同步编辑器中的置顶按钮状态
      if (currentNote && currentNote.id === n.id) {
        currentNote = n;
        meta.pinned = !!n.pinned;
        syncPinButton();
      }
      toast(n.pinned ? '已置顶：' + (n.title || '(无标题)') : '已取消置顶');
      refreshList();
    } catch (e) {
      n.pinned = wasPinned; // 失败回滚
      n.pinnedAt = wasPinned ? (n.pinnedAt || now) : 0;
      toast('置顶操作失败：' + e.message, true);
    }
  }

  // 删除项目/分组（连同其中全部笔记；默认项目/默认分组为结构容器，不可删除）
  async function deleteSection(kindLabel, name, notes) {
    if (name === DEFAULT_PROJECT || name === DEFAULT_GROUP) {
      toast('「' + name + '」不可删除，可删除其中的具体笔记', true);
      return;
    }
    if (!confirm('确定删除' + kindLabel + '「' + name + '」及其中的 ' + notes.length + ' 条笔记？\n此操作不可恢复！')) return;
    let ok = 0;
    let fail = 0;
    for (const n of notes) {
      try {
        await NoteStore.remove(n.id);
        ok++;
      } catch (e) {
        fail++;
      }
    }
    // 当前打开的笔记若在被删范围内，清空编辑器
    if (currentNote && notes.some((n) => n.id === currentNote.id)) {
      currentNote = null;
      editor.innerHTML = '';
      meta = { project: DEFAULT_PROJECT, group: DEFAULT_GROUP, pinned: false };
      attachments = [];
      renderAttachments();
      refreshMetaOptions();
      syncPinButton();
      setDirty(false);
      statusText.textContent = '';
      updateWordCount();
    }
    toast('已删除' + kindLabel + '「' + name + '」：' + ok + ' 条笔记' + (fail ? '，失败 ' + fail + ' 条' : ''), fail > 0);
    refreshList();
  }

  /* ---------- 左栏导航树（最新 / 置顶 / 我的项目 → 分组） ---------- */

  function navItemEl(key, icon, label, count, opts) {
    opts = opts || {};
    const item = document.createElement('div');
    item.className = 'nav-item' + (opts.child ? ' child' : '') + (scope === key ? ' active' : '');
    const ch = document.createElement('span');
    ch.className = 'chevron' + (opts.expandable ? '' : ' ghost') + (collapsed.has(key) ? ' collapsed' : '');
    ch.textContent = '▾';
    if (opts.expandable) {
      ch.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapsed(key);
      });
    }
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = icon;
    const t = document.createElement('span');
    t.className = 'label';
    t.textContent = label;
    t.title = opts.tip || label;
    const c = document.createElement('span');
    c.className = 'nav-count';
    c.textContent = count;
    item.append(ch, ico, t, c);
    // 删除按钮（悬停显示；点击删除项目/分组及其笔记）
    if (opts.del) {
      const del = document.createElement('button');
      del.className = 'nav-del';
      del.title = '删除' + opts.kindLabel + '（含其中笔记）';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.del();
      });
      item.appendChild(del);
    }
    item.addEventListener('click', () => selectScope(key));
    return item;
  }

  function renderNav() {
    navEl.innerHTML = '';
    // 图标栏上的范围快捷按钮高亮
    document.querySelectorAll('.rail-scope').forEach((b) =>
      b.classList.toggle('active', b.dataset.scope === scope));
    navEl.appendChild(navItemEl('latest', '🕘', '最新', allNotes.length));
    navEl.appendChild(navItemEl('pinned', '📌', '置顶', allNotes.filter((n) => n.pinned).length));

    // 「我的项目」分区：项目 → 分组 两级
    const projects = new Map();
    for (const n of allNotes) {
      const p = projOf(n);
      if (!projects.has(p)) projects.set(p, []);
      projects.get(p).push(n);
    }
    const sec = document.createElement('div');
    sec.className = 'nav-sec-header' + (collapsed.has('sec:projects') ? ' collapsed' : '');
    const ch = document.createElement('span');
    ch.className = 'chevron';
    ch.textContent = '▾';
    const st = document.createElement('span');
    st.className = 'label';
    st.textContent = '📁 我的项目';
    const sc = document.createElement('span');
    sc.className = 'nav-count';
    sc.textContent = projects.size;
    sec.append(ch, st, sc);
    sec.addEventListener('click', () => toggleCollapsed('sec:projects'));
    navEl.appendChild(sec);

    if (collapsed.has('sec:projects')) return;
    for (const pName of sortNames([...projects.keys()], DEFAULT_PROJECT)) {
      navEl.appendChild(projectBranchEl(pName, projects.get(pName)));
    }
  }

  function projectBranchEl(pName, pNotes) {
    const pKey = 'p:' + pName;
    const groups = new Map();
    for (const n of pNotes) {
      const g = groupOf(n);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    }
    const branch = document.createElement('div');
    branch.className = 'nav-branch';
    branch.appendChild(navItemEl(pKey, '📁', pName, pNotes.length, {
      expandable: true,
      kindLabel: '项目',
      del: () => deleteSection('项目', pName, pNotes.slice()),
    }));
    if (!collapsed.has(pKey)) {
      for (const gName of sortNames([...groups.keys()], DEFAULT_GROUP)) {
        const gKey = 'g:' + pName + '/' + gName;
        const gNotes = groups.get(gName);
        branch.appendChild(navItemEl(gKey, '📂', gName, gNotes.length, {
          child: true,
          kindLabel: '分组',
          tip: pName + ' / ' + gName,
          del: () => deleteSection('分组', pName + ' / ' + gName, gNotes.slice()),
        }));
      }
    }
    return branch;
  }

  function confirmIfDirty() {
    return !dirty || confirm('当前笔记尚未保存，继续操作将丢失修改，是否继续？');
  }

  /* ---------- 附件（粘贴 / 拖放 / 上传 / 下载 / 删除） ---------- */

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsDataURL(file);
    });
  }

  function fileIcon(type) {
    type = type || '';
    if (type.startsWith('image/')) return '🖼';
    if (type === 'application/pdf') return '📕';
    if (type.includes('zip') || type.includes('compressed') || type.includes('rar') || type.includes('7z')) return '🗜';
    if (type.startsWith('audio/')) return '🎵';
    if (type.startsWith('video/')) return '🎬';
    if (type.startsWith('text/')) return '📝';
    return '📄';
  }

  function renderAttachments() {
    $('#attachBar').hidden = attachments.length === 0;
    $('#attachCount').textContent = attachments.length ? '(' + attachments.length + ')' : '';
    const list = $('#attachList');
    list.innerHTML = '';
    for (const att of attachments) {
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      const icon = document.createElement('span');
      icon.textContent = fileIcon(att.type);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = att.name;
      name.title = '点击下载：' + att.name;
      name.addEventListener('click', () => downloadAttachment(att));
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = fmtSize(att.size || 0);
      const dl = document.createElement('button');
      dl.title = '下载';
      dl.textContent = '⬇';
      dl.addEventListener('click', () => downloadAttachment(att));
      const del = document.createElement('button');
      del.className = 'del';
      del.title = '移除附件';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        attachments = attachments.filter((a) => a.id !== att.id);
        renderAttachments();
        setDirty(true);
      });
      chip.append(icon, name, size, dl, del);
      list.appendChild(chip);
    }
  }

  async function addAttachment(file) {
    if (file.size > MAX_ATTACH_SIZE) {
      toast('「' + file.name + '」超过 10MB 限制，已跳过', true);
      return;
    }
    try {
      const data = await readAsDataURL(file);
      attachments.push({
        id: crypto.randomUUID(),
        name: file.name || '未命名文件',
        size: file.size,
        type: file.type || '',
        data,
        createdAt: Date.now(),
      });
      renderAttachments();
      setDirty(true);
      toast('已添加附件：' + (file.name || '未命名文件'));
    } catch (e) {
      toast('附件添加失败：' + e.message, true);
    }
  }

  // 统一入口：图片插入正文，其他文件加入附件列表
  async function handleIncomingFiles(files) {
    for (const f of files) {
      if (f.type && f.type.startsWith('image/')) {
        if (f.size > MAX_IMG_SIZE) {
          toast('图片「' + f.name + '」超过 4MB，已跳过', true);
          continue;
        }
        try {
          const data = await readAsDataURL(f);
          editor.focus();
          document.execCommand('insertImage', false, data);
          setDirty(true);
        } catch (e) {
          toast('图片插入失败：' + e.message, true);
        }
      } else {
        await addAttachment(f);
      }
    }
  }

  function downloadAttachment(att) {
    const a = document.createElement('a');
    a.href = att.data;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('开始下载：' + att.name);
  }

  // 粘贴：图片入正文、文件入附件；纯文本/富文本粘贴保持浏览器默认行为
  editor.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    handleIncomingFiles(files);
  });

  // 拖放文件进编辑器：同粘贴逻辑
  editor.addEventListener('dragover', (e) => e.preventDefault());
  editor.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    handleIncomingFiles([...files]);
  });

  $('#btnAttach').addEventListener('click', () => $('#attachInput').click());
  $('#attachInput').addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    handleIncomingFiles(files);
  });

  /* ---------- 项目 / 分组 / 置顶 ---------- */

  function distinctProjects() {
    const set = new Set([DEFAULT_PROJECT]);
    for (const n of allNotes) set.add(projOf(n));
    return sortNames([...set], DEFAULT_PROJECT);
  }

  function distinctGroups(project) {
    const set = new Set([DEFAULT_GROUP]);
    for (const n of allNotes) if (projOf(n) === project) set.add(groupOf(n));
    return sortNames([...set], DEFAULT_GROUP);
  }

  function fillSelect(sel, names, current, kind) {
    const def = kind === '项目' ? DEFAULT_PROJECT : DEFAULT_GROUP;
    const value = (current || '').trim() || def;
    if (!names.includes(value)) names = sortNames([...names, value], def);
    sel.innerHTML = '';
    for (const name of names) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }
    const add = document.createElement('option');
    add.value = '__new__';
    add.textContent = '➕ 新建' + kind + '…';
    sel.appendChild(add);
    sel.value = value;
  }

  function refreshMetaOptions() {
    fillSelect($('#projectSelect'), distinctProjects(), meta.project, '项目');
    fillSelect($('#groupSelect'), distinctGroups(meta.project), meta.group, '分组');
  }

  function syncPinButton() {
    const btn = $('#btnPin');
    btn.classList.toggle('on', !!meta.pinned);
    btn.textContent = '📌';
    btn.title = meta.pinned ? '取消置顶' : '置顶到列表最上方';
  }

  $('#projectSelect').addEventListener('change', (e) => {
    if (e.target.value === '__new__') {
      const name = (prompt('请输入新项目名称：') || '').trim();
      if (name) {
        meta.project = name;
        meta.group = DEFAULT_GROUP; // 新项目从默认分组开始
      }
    } else {
      meta.project = e.target.value;
      // 当前分组在新项目下不存在时回到默认分组
      if (!distinctGroups(meta.project).includes(meta.group)) meta.group = DEFAULT_GROUP;
    }
    refreshMetaOptions();
    setDirty(true);
  });

  $('#groupSelect').addEventListener('change', (e) => {
    if (e.target.value === '__new__') {
      const name = (prompt('请在「' + meta.project + '」下输入新分组名称：') || '').trim();
      if (name) meta.group = name;
    } else {
      meta.group = e.target.value;
    }
    refreshMetaOptions();
    setDirty(true);
  });

  $('#btnPin').addEventListener('click', async () => {
    meta.pinned = !meta.pinned;
    syncPinButton();
    if (currentNote) {
      await saveNote(); // 已保存的笔记立即置顶生效
    } else {
      setDirty(true);
      toast('置顶将在保存笔记时生效');
    }
  });

  /* ---------- 打开 / 新建 / 保存 / 删除 ---------- */

  // 标题与正文首行合一（类 macOS 备忘录）：标题行是正文第一个块（.doc-title），
  // 保存时取首行文字作标题；列表/表格/代码块开头不参与取标题
  function firstBlockText() {
    const fb = editor.firstElementChild;
    if (!fb || /^(UL|OL|TABLE)$/i.test(fb.tagName)) return '';
    return (fb.textContent || '').trim();
  }

  // 打开笔记时调用：首行文字与标题一致就地标样式，否则把标题注入为首行
  function setTitleLine(title) {
    const t = (title || '').trim();
    const fb = editor.firstElementChild;
    if (t && fb && (fb.textContent || '').trim() === t) {
      fb.classList.add('doc-title');
      return;
    }
    const old = editor.querySelector(':scope > .doc-title');
    if (old) old.remove();
    if (!t) return;
    const div = document.createElement('div');
    div.className = 'doc-title';
    div.textContent = t;
    editor.insertBefore(div, editor.firstChild);
  }

  // 新笔记默认标题（类有道云笔记）：「11月3日 14:30」，保证新建笔记不落空标题
  function defaultNoteTitle() {
    const d = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 光标落标题行末尾：可直接续写标题，回车 / ↓ 进入正文
  function focusTitleLineEnd() {
    editor.focus();
    const t = editor.querySelector(':scope > .doc-title');
    if (!t) return;
    const range = document.createRange();
    range.selectNodeContents(t);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // 导出用：剥离标题行后的正文 HTML（避免导出文件里标题出现两次）
  function bodyHtmlWithoutTitle() {
    const clone = editor.cloneNode(true);
    const t = clone.querySelector(':scope > .doc-title');
    if (t) t.remove();
    return clone.innerHTML;
  }

  function openNote(n) {
    if (currentNote && currentNote.id === n.id) return;
    if (!confirmIfDirty()) return;
    currentNote = n;
    newNoteDefaultTitle = null;
    editor.innerHTML = n.html || '';
    setTitleLine(n.title);
    meta = { project: projOf(n), group: groupOf(n), pinned: !!n.pinned };
    refreshMetaOptions();
    syncPinButton();
    attachments = Array.isArray(n.attachments) ? n.attachments.map((a) => Object.assign({}, a)) : [];
    renderAttachments();
    setDirty(false);
    statusText.textContent = '创建于 ' + fmtTime(n.createdAt);
    updateWordCount();
    filterAndRender();
  }

  function newNote() {
    if (!confirmIfDirty()) return;
    currentNote = null;
    editor.innerHTML = '';
    // 默认标题（「11月3日 14:30」）注入为首行，新建笔记不再无标题
    newNoteDefaultTitle = defaultNoteTitle();
    setTitleLine(newNoteDefaultTitle);
    // 新笔记继承当前所在的项目/分组，便于连续记录；置顶状态重置
    meta = { project: meta.project || DEFAULT_PROJECT, group: meta.group || DEFAULT_GROUP, pinned: false };
    refreshMetaOptions();
    syncPinButton();
    attachments = [];
    renderAttachments();
    setDirty(false);
    statusText.textContent = '新笔记（未保存）';
    updateWordCount();
    filterAndRender();
    focusTitleLineEnd(); // 光标落标题行末尾：可续写标题，回车进入正文
  }

  async function saveNote() {
    const title = firstBlockText(); // 正文首行即标题
    const text = editor.textContent.trim();
    // 剥离标题行后的正文（新笔记仅有未改动的默认标题、零正文时视为空笔记）
    const bodyClone = editor.cloneNode(true);
    const titleLine = bodyClone.querySelector(':scope > .doc-title');
    if (titleLine) titleLine.remove();
    const bodyText = bodyClone.textContent.trim();
    if (!title && !bodyText) {
      toast('标题和内容不能都为空', true);
      return;
    }
    if (newNoteDefaultTitle && title === newNoteDefaultTitle && !bodyText) {
      toast('笔记内容为空，未保存', true);
      return;
    }
    const now = Date.now();
    const note = {
      id: currentNote ? currentNote.id : crypto.randomUUID(),
      title,
      html: editor.innerHTML,
      text,
      project: (meta.project || '').trim() || DEFAULT_PROJECT,
      group: (meta.group || '').trim() || DEFAULT_GROUP,
      pinned: !!meta.pinned,
      pinnedAt: meta.pinned ? ((currentNote && currentNote.pinnedAt) || now) : 0,
      attachments: attachments.map((a) => Object.assign({}, a)),
      createdAt: currentNote && currentNote.createdAt ? currentNote.createdAt : now,
      updatedAt: now,
    };
    try {
      const saved = await NoteStore.save(note);
      currentNote = saved || note;
      newNoteDefaultTitle = null;
      meta = { project: projOf(currentNote), group: groupOf(currentNote), pinned: !!currentNote.pinned };
      attachments = Array.isArray(currentNote.attachments)
        ? currentNote.attachments.map((a) => Object.assign({}, a))
        : attachments;
      refreshMetaOptions();
      syncPinButton();
      renderAttachments();
      setDirty(false);
      statusText.textContent = '已保存 · ' + fmtTime(currentNote.updatedAt);
      toast('已保存');
      refreshList();
    } catch (e) {
      toast('保存失败：' + e.message, true);
    }
  }

  async function deleteNote() {
    if (!currentNote) {
      toast('当前没有已保存的笔记', true);
      return;
    }
    const label = '「' + (currentNote.title || '(无标题)') + '」（' + projOf(currentNote) + ' / ' + groupOf(currentNote) + '）';
    if (!confirm('确定删除 ' + label + '？此操作不可恢复。')) return;
    try {
      await NoteStore.remove(currentNote.id);
      toast('已删除');
      currentNote = null;
      editor.innerHTML = '';
      meta = { project: DEFAULT_PROJECT, group: DEFAULT_GROUP, pinned: false };
      refreshMetaOptions();
      syncPinButton();
      attachments = [];
      renderAttachments();
      setDirty(false);
      statusText.textContent = '';
      updateWordCount();
      refreshList();
    } catch (e) {
      toast('删除失败：' + e.message, true);
    }
  }

  /* ---------- 导出（HTML / Markdown / PDF） ---------- */

  // 构建可独立打开/打印的笔记 HTML 文档（导出文件与 PDF 打印共用）
  function buildNoteDocument(title) {
    const safeTitle = escapeHtml(title);
    let attachHtml = '';
    if (attachments.length) {
      attachHtml = '<hr><p><strong>📎 附件（' + attachments.length + '）</strong></p><ul>' +
        attachments.map((a) =>
          '<li>' + fileIcon(a.type) + ' <a href="' + a.data + '" download="' + escapeHtml(a.name) + '">' +
          escapeHtml(a.name) + '</a>（' + fmtSize(a.size || 0) + '）</li>'
        ).join('') + '</ul>';
    }
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>' + safeTitle + '</title>' +
      '<style>' +
      '@page { margin: 16mm; }' +
      'body{max-width:820px;margin:0 auto;padding:0 8px;font-family:system-ui,"Microsoft YaHei","Segoe UI",sans-serif;line-height:1.75;color:#24292f}' +
      'h1{font-size:1.9em;border-bottom:2px solid #ede7ff;padding-bottom:8px;margin:1em 0 .6em}' +
      'h2{font-size:1.5em;margin:1em 0 .5em}h3{font-size:1.25em;margin:1em 0 .5em}' +
      'blockquote{border-left:4px solid #7c4dff;background:#f6f2ff;margin:1em 0;padding:.5em 1em;color:#4b5563}' +
      'pre{background:#263238;color:#eceff1;padding:14px;border-radius:8px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px}' +
      'code{font-family:Consolas,"Courier New",monospace;background:#f0f1f5;border-radius:4px;padding:1px 5px}' +
      'pre code{background:transparent;padding:0}' +
      'img{max-width:100%;page-break-inside:avoid}' +
      'a{color:#7c4dff}hr{border:none;border-top:1px solid #dfe3ea;margin:1.6em 0}' +
      '</style></head><body>' +
      '<h1>' + safeTitle + '</h1>' + bodyHtmlWithoutTitle() + attachHtml + '</body></html>';
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportHtml() {
    const title = firstBlockText() || '未命名笔记';
    downloadBlob(new Blob([buildNoteDocument(title)], { type: 'text/html;charset=utf-8' }), title + '.html');
    toast('已导出 HTML 文件');
  }

  function exportMarkdown() {
    const title = firstBlockText() || '未命名笔记';
    // 剥离标题行后导出正文（toMarkdown 会自行拼 # 标题，避免重复）
    const clone = editor.cloneNode(true);
    const t = clone.querySelector(':scope > .doc-title');
    if (t) t.remove();
    let md = RichNotesExport.toMarkdown(clone, title);
    for (const a of attachments) {
      const safeName = String(a.name || '附件').replace(/[()<>]/g, ' ');
      md += '\n📎 附件：[' + safeName + '](<' + a.data + '>)（' + fmtSize(a.size || 0) + '）\n';
    }
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), title + '.md');
    toast('已导出 Markdown 文件');
  }

  function exportPdf() {
    const title = firstBlockText() || '未命名笔记';
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
    document.body.appendChild(iframe);
    let started = false;
    const startPrint = async () => {
      if (started) return;
      started = true;
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      // 等待图片加载（base64 也会异步解码），最多等 3 秒/张
      await Promise.all(Array.from(doc.images).map((img) =>
        img.complete ? Promise.resolve() : new Promise((res) => {
          img.onload = img.onerror = () => res();
          setTimeout(res, 3000);
        })));
      win.addEventListener('afterprint', () => iframe.remove());
      toast('已打开打印窗口，请在目标中选择「另存为 PDF」');
      win.focus();
      win.print();
      setTimeout(() => iframe.remove(), 10 * 60 * 1000); // 兜底清理
    };
    iframe.onload = startPrint;
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(buildNoteDocument(title));
    doc.close();
    setTimeout(startPrint, 600); // onload 未触发时的兜底
  }

  /* ---------- 富文本工具栏 ---------- */

  $('#toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    editor.focus();
    const cmd = btn.dataset.cmd;
    if (cmd === 'createLink') {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        toast('请先选中要加链接的文字', true);
        return;
      }
      const url = prompt('请输入链接地址：', 'https://');
      if (url && url !== 'https://') {
        document.execCommand('createLink', false, url);
        setDirty(true);
      }
      return;
    }
    document.execCommand(cmd, false, null);
    setDirty(true);
    updateWordCount();
  });

  $('#blockSelect').addEventListener('change', (e) => {
    editor.focus();
    document.execCommand('formatBlock', false, '<' + e.target.value + '>');
    setDirty(true);
    updateWordCount();
    e.target.value = 'p'; // 作为“动作触发器”使用，执行后复位
  });

  $('#foreColor').addEventListener('input', (e) => {
    editor.focus();
    document.execCommand('foreColor', false, e.target.value);
    setDirty(true);
  });

  $('#hiliteColor').addEventListener('input', (e) => {
    editor.focus();
    document.execCommand('hiliteColor', false, e.target.value);
    setDirty(true);
  });

  $('#btnImage').addEventListener('click', () => $('#imageInput').click());
  $('#imageInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast('图片过大（超过 4MB），建议压缩后再插入', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      editor.focus();
      document.execCommand('insertImage', false, reader.result);
      setDirty(true);
    };
    reader.onerror = () => toast('图片读取失败', true);
    reader.readAsDataURL(file);
  });

  /* ---------- 编辑器事件 ---------- */

  editor.addEventListener('input', () => { setDirty(true); updateWordCount(); });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNote();
    }
    // Ctrl+Shift+F 聚焦侧栏搜索框（一栏模式下先切到两栏）
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (layout === '1') setLayout('2');
      searchInput.focus();
      searchInput.select();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  searchInput.addEventListener('input', filterAndRender);

  /* ---------- 存储设置 ---------- */

  async function updateStorageBadge() {
    const s = await NoteStore.getSettings();
    const where = (s.mode === 'remote' && s.serverUrl) ? '服务器：' + s.serverUrl : '本地数据库 (IndexedDB)';
    $('#btnSettings').title = '存储设置（' + where + '）';
  }

  function updateServerRow() {
    const isRemote = document.querySelector('input[name="mode"]:checked').value === 'remote';
    $('#serverRow').style.opacity = isRemote ? '1' : '.45';
    $('#serverUrl').disabled = !isRemote;
    $('#btnTestServer').disabled = !isRemote;
  }

  $('#btnSettings').addEventListener('click', async () => {
    const s = await NoteStore.getSettings();
    const dlg = $('#settingsDialog');
    const mode = s.mode === 'remote' ? 'remote' : 'local';
    dlg.querySelector('input[name="mode"][value="' + mode + '"]').checked = true;
    $('#serverUrl').value = s.serverUrl || 'http://localhost:3001';
    updateServerRow();
    dlg.showModal();
  });

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', updateServerRow));

  $('#btnTestServer').addEventListener('click', async () => {
    const url = $('#serverUrl').value.trim().replace(/\/+$/, '');
    if (!url) { toast('请填写服务器地址', true); return; }
    try {
      const res = await fetch(url + '/api/health');
      const data = await res.json();
      if (data.ok) toast('连接成功 ✓');
      else toast('服务器响应异常', true);
    } catch (e) {
      toast('无法连接：' + e.message, true);
    }
  });

  // 一键迁移：把本地 IndexedDB 的全部笔记上传到服务器（同 ID 覆盖）
  $('#btnMigrate').addEventListener('click', async () => {
    const url = $('#serverUrl').value.trim().replace(/\/+$/, '');
    if (!url) { toast('请先填写服务器地址', true); return; }

    let local;
    try {
      local = await window.LocalDB.list('');
    } catch (e) {
      toast('读取本地笔记失败：' + e.message, true);
      return;
    }
    if (!local.length) { toast('本地没有笔记可上传'); return; }
    if (!confirm('将把本地 ' + local.length + ' 条笔记上传到服务器 ' + url +
        '，服务器上同 ID 的笔记会被本地版本覆盖，是否继续？')) return;

    const btn = $('#btnMigrate');
    btn.disabled = true;
    btn.textContent = '上传中…';
    let ok = 0;
    let fail = 0;
    for (const n of local) {
      try {
        const res = await fetch(url + '/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n),
        });
        if (res.ok) ok++;
        else fail++;
      } catch (e) {
        fail++;
      }
    }
    btn.disabled = false;
    btn.textContent = '⬆ 上传本地笔记到服务器';
    toast('上传完成：成功 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''), fail > 0);
    // 若当前已处于服务器模式且地址一致，刷新列表立即可见
    const s = await NoteStore.getSettings();
    if (s.mode === 'remote' && String(s.serverUrl || '').replace(/\/+$/, '') === url) refreshList();
  });

  // 显式按钮处理，不依赖 dialog 的 close 事件（兼容性更稳）
  $('#btnApplySettings').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const serverUrl = $('#serverUrl').value.trim().replace(/\/+$/, '');
    await NoteStore.setSettings({ mode, serverUrl });
    await updateStorageBadge();
    $('#settingsDialog').close();
    refreshList();
    toast('设置已保存');
  });

  $('#btnCancelSettings').addEventListener('click', () => $('#settingsDialog').close());

  /* ---------- 导出下拉菜单 ---------- */

  $('#btnExport').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#exportMenu').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-wrap')) $('#exportMenu').classList.remove('open');
  });
  $('#exportMenu').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-format]');
    if (!btn) return;
    $('#exportMenu').classList.remove('open');
    const fmt = btn.dataset.format;
    if (fmt === 'md') exportMarkdown();
    else if (fmt === 'pdf') exportPdf();
    else exportHtml();
  });

  /* ---------- 初始化 ---------- */

  $('#btnNewSide').addEventListener('click', newNote);
  $('#btnSave').addEventListener('click', saveNote);
  $('#btnDelete').addEventListener('click', deleteNote);

  /* ---------- 视图布局（最左图标栏底部三按钮：1 栏 / 2 栏 / 3 栏，参考有道云笔记） ---------- */
  // 3 栏：目录 + 列表 + 编辑器；2 栏：列表 + 编辑器；1 栏：仅编辑器。图标栏常驻。
  const LAYOUT_KEY = 'rich-notes-layout';
  let layout = localStorage.getItem(LAYOUT_KEY) || '3';
  if (!['1', '2', '3'].includes(layout)) layout = '3';

  function applyLayout() {
    $('#mainPane').dataset.layout = layout;
    localStorage.setItem(LAYOUT_KEY, layout);
    document.querySelectorAll('.layout-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.layout === layout));
    $('#railNav').classList.toggle('active', layout === '3');
  }

  function setLayout(v) {
    layout = v;
    applyLayout();
  }

  document.querySelectorAll('.layout-btn').forEach((b) =>
    b.addEventListener('click', () => setLayout(b.dataset.layout)));
  // 📁 图标：在「目录+列表」与「仅列表」之间切换
  $('#railNav').addEventListener('click', () => setLayout(layout === '3' ? '2' : '3'));
  $('#railNew').addEventListener('click', newNote);
  // 图标栏上的范围快捷键：切到对应范围；当前是 1 栏时自动升到 2 栏让列表可见
  document.querySelectorAll('.rail-scope').forEach((b) =>
    b.addEventListener('click', () => {
      selectScope(b.dataset.scope);
      if (layout === '1') setLayout('2');
    }));

  statusText.textContent = '新笔记（未保存）';
  $('#dlgVersion').textContent = 'v' + APP_VERSION;
  applyLayout();
  refreshMetaOptions();
  syncPinButton();
  renderAttachments();
  updateStorageBadge();
  refreshList();
  updateWordCount();
})();
