// 微积分计算器：迷你符号引擎（解析/求导/化简/渲染）+ 数值积分/极限/泰勒 + 函数图像
// 纯本地计算，无第三方库，无网络请求
const $ = (id) => document.getElementById(id);
const EPS = 1e-9;
const DRAFT_KEY = 'calcDraft';
const STEPS_CAP = 24;

// 公式模板：点按钮生成一条公式，然后在输入框里直接改
const TPLS = [
  ['幂函数', 'x ^ 2'],
  ['三次曲线', 'x ^ 3 - 3 * x'],
  ['三角函数', 'sin(x)'],
  ['三角乘积', 'sin(x) * cos(x)'],
  ['sin(x)/x', 'sin(x) / x'],
  ['有理函数', '1 / (1 + x ^ 2)'],
  ['对数', 'ln(x)'],
  ['高斯钟形', 'exp(-x ^ 2 / 4)'],
  ['综合示例', 'x ^ 2 * sin(x) + ln(x)'],
];

// 在输入框光标处插入文本（纯函数，回放可测）
function insertAtCursor(value, start, end, text) {
  if (start == null || end == null || start > value.length) {
    return { value: value + text, caret: value.length + text.length };
  }
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length };
}


const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, ln: Math.log, log10: x => Math.log(x) / Math.LN10,
  log: Math.log, sqrt: Math.sqrt, abs: Math.abs,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
};
const FUNC_NAMES = Object.keys(FUNCS).sort().join('、');

function fmtNum(x) {
  if (Math.abs(x) < 1e-10) return '0';
  return String(parseFloat(x.toPrecision(10)));
}
function fmtShort(x) {
  if (Math.abs(x) < 1e-10) return '0';
  return String(parseFloat(x.toPrecision(6)));
}

/* ---------- 解析器（支持隐式乘法、** 幂、pi/e） ---------- */

function parseExpr(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_0-9]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j; continue;
    }
    if (c === '*' && src[i + 1] === '*') { tokens.push({ t: '^' }); i += 2; continue; }
    if ('+-*/^(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`无法识别的字符“${c}”`);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  function parseSum() {
    let l = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[pos++].t;
      l = { t: 'bin', op, l, r: parseTerm() };
    }
    return l;
  }
  function parseTerm() {
    let l = parseUnary();
    for (;;) {
      const p = peek();
      if (p && (p.t === '*' || p.t === '/')) {
        const op = tokens[pos++].t;
        l = { t: 'bin', op, l, r: parseUnary() };
        continue;
      }
      // 隐式乘法：数/变量/右括号 紧跟 变量/函数/数/左括号
      if (p && (p.t === 'num' || p.t === 'id' || p.t === '(')) {
        l = { t: 'bin', op: '*', l, r: parseUnary() };
        continue;
      }
      break;
    }
    return l;
  }
  function parseUnary() {
    const p = peek();
    if (p && p.t === '-') { pos++; return { t: 'neg', e: parseUnary() }; }
    if (p && p.t === '+') { pos++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    const base = parseAtom();
    const p = peek();
    if (p && p.t === '^') {
      pos++;
      return { t: 'bin', op: '^', l: base, r: parseUnary() }; // 右结合
    }
    return base;
  }
  function parseAtom() {
    const p = tokens[pos++];
    if (!p) throw new Error('表达式意外结束');
    if (p.t === 'num') return { t: 'num', v: p.v };
    if (p.t === 'id') {
      const name = p.v.toLowerCase();
      if (FUNCS[name] && peek() && peek().t === '(') {
        pos++;
        const arg = parseSum();
        const close = tokens[pos++];
        if (!close || close.t !== ')') throw new Error(`函数 ${name} 缺少右括号`);
        return { t: 'fn', name, arg };
      }
      if (name === 'pi') return { t: 'num', v: Math.PI };
      if (name === 'e') return { t: 'num', v: Math.E };
      if (name.length === 1) return { t: 'var' };
      throw new Error(`无法识别的名字“${p.v}”：变量只支持 x；可用函数：${FUNC_NAMES}`);
    }
    if (p.t === '(') {
      const e = parseSum();
      const close = tokens[pos++];
      if (!close || close.t !== ')') throw new Error('缺少右括号');
      return e;
    }
    throw new Error(`意外的符号“${p.t}”`);
  }

  const ast = parseSum();
  if (pos < tokens.length) throw new Error('表达式末尾有多余内容（括号不匹配或运算符缺失）');
  return simplify(ast);
}

/* ---------- 化简 ---------- */

const isNum = (n, v) => n && n.t === 'num' && (v === undefined || n.v === v);

function simplify(n) {
  if (!n || typeof n !== 'object') return n;
  if (n.t === 'neg') {
    const e = simplify(n.e);
    if (e.t === 'num') return { t: 'num', v: -e.v };
    if (e.t === 'neg') return e.e;
    return { t: 'neg', e };
  }
  if (n.t === 'bin') {
    const l = simplify(n.l), r = simplify(n.r);
    if (l.t === 'num' && r.t === 'num') {
      const v = { '+': l.v + r.v, '-': l.v - r.v, '*': l.v * r.v, '/': l.v / r.v, '^': Math.pow(l.v, r.v) }[n.op];
      if (Number.isFinite(v)) return { t: 'num', v };
    }
    switch (n.op) {
      case '+': if (isNum(l, 0)) return r; if (isNum(r, 0)) return l; break;
      case '-': if (isNum(r, 0)) return l; if (isNum(l, 0)) return simplify({ t: 'neg', e: r }); break;
      case '*': if (isNum(l, 0) || isNum(r, 0)) return { t: 'num', v: 0 };
        if (isNum(l, 1)) return r; if (isNum(r, 1)) return l; break;
      case '/': if (isNum(r, 1)) return l; if (isNum(l, 0)) return { t: 'num', v: 0 }; break;
      case '^': if (isNum(r, 1)) return l; if (isNum(r, 0)) return { t: 'num', v: 1 }; break;
    }
    return { t: 'bin', op: n.op, l, r };
  }
  if (n.t === 'fn') return { t: 'fn', name: n.name, arg: simplify(n.arg) };
  return n;
}

/* ---------- 符号求导 ---------- */

function diff(n) {
  switch (n.t) {
    case 'num': return { t: 'num', v: 0 };
    case 'var': return { t: 'num', v: 1 };
    case 'neg': return { t: 'neg', e: diff(n.e) };
    case 'bin': {
      if (n.op === '+' || n.op === '-') return { t: 'bin', op: n.op, l: diff(n.l), r: diff(n.r) };
      if (n.op === '*') return {
        t: 'bin', op: '+',
        l: { t: 'bin', op: '*', l: diff(n.l), r: n.r },
        r: { t: 'bin', op: '*', l: n.l, r: diff(n.r) },
      };
      if (n.op === '/') return {
        t: 'bin', op: '/',
        l: { t: 'bin', op: '-', l: { t: 'bin', op: '*', l: diff(n.l), r: n.r }, r: { t: 'bin', op: '*', l: n.l, r: diff(n.r) } },
        r: { t: 'bin', op: '^', l: n.r, r: { t: 'num', v: 2 } },
      };
      if (n.op === '^') {
        if (n.r.t !== 'num') throw new Error('暂不支持指数也含 x 的幂（f(x)^g(x)）的符号求导');
        const c = n.r.v;
        return {
          t: 'bin', op: '*',
          l: { t: 'num', v: c },
          r: { t: 'bin', op: '*', l: { t: 'bin', op: '^', l: n.l, r: { t: 'num', v: c - 1 } }, r: diff(n.l) },
        };
      }
      break;
    }
    case 'fn': {
      const g = n.arg;
      const chain = outer => ({ t: 'bin', op: '*', l: outer, r: diff(g) });
      const mk = {
        sin: () => chain({ t: 'fn', name: 'cos', arg: g }),
        cos: () => chain({ t: 'neg', e: { t: 'fn', name: 'sin', arg: g } }),
        tan: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '^', l: { t: 'fn', name: 'cos', arg: g }, r: { t: 'num', v: 2 } } }),
        exp: () => chain({ t: 'fn', name: 'exp', arg: g }),
        ln: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: g }),
        log10: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '*', l: g, r: { t: 'num', v: Math.LN10 } } }),
        sqrt: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '*', l: { t: 'num', v: 2 }, r: { t: 'fn', name: 'sqrt', arg: g } } }),
        abs: () => chain({ t: 'bin', op: '/', l: { t: 'fn', name: 'sign', arg: g }, r: { t: 'fn', name: 'abs', arg: g } }),
        sinh: () => chain({ t: 'fn', name: 'cosh', arg: g }),
        cosh: () => chain({ t: 'fn', name: 'sinh', arg: g }),
        tanh: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '^', l: { t: 'fn', name: 'cosh', arg: g }, r: { t: 'num', v: 2 } } }),
        asin: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'fn', name: 'sqrt', arg: { t: 'bin', op: '-', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '^', l: g, r: { t: 'num', v: 2 } } } } }),
        acos: () => chain({ t: 'neg', e: { t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'fn', name: 'sqrt', arg: { t: 'bin', op: '-', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '^', l: g, r: { t: 'num', v: 2 } } } } } }),
        atan: () => chain({ t: 'bin', op: '/', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '+', l: { t: 'num', v: 1 }, r: { t: 'bin', op: '^', l: g, r: { t: 'num', v: 2 } } } }),
      };
      if (mk[n.name]) return mk[n.name]();
      break;
    }
  }
  throw new Error(`无法对 ${n.t} 求导`);
}

/* ---------- 渲染 ---------- */

function toStr(n, parentPrec = 0) {
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const wrap = (s, prec) => (prec < parentPrec ? '(' + s + ')' : s);
  switch (n.t) {
    case 'num': return fmtNum(n.v);
    case 'var': return 'x';
    case 'neg': return wrap('-' + toStr(n.e, 2.5), 2.5);
    case 'fn': return n.name + '(' + toStr(n.arg, 0) + ')';
    case 'bin': {
      const p = PREC[n.op];
      if (n.op === '^') return wrap(toStr(n.l, p + 0.5) + ' ^ ' + toStr(n.r, p), p);
      if (n.op === '*') return wrap(toStr(n.l, p) + ' * ' + toStr(n.r, p + 0.5), p);
      if (n.op === '/') return wrap(toStr(n.l, p + 0.5) + ' / ' + toStr(n.r, p + 0.5), p);
      return wrap(toStr(n.l, p) + ' ' + n.op + ' ' + toStr(n.r, p + 0.5), p);
    }
  }
  return '?';
}

function evalAt(n, x) {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': return x;
    case 'neg': return -evalAt(n.e, x);
    case 'bin': {
      const l = evalAt(n.l, x), r = evalAt(n.r, x);
      switch (n.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
        case '^': return Math.pow(l, r);
      }
      break;
    }
    case 'fn': return FUNCS[n.name](evalAt(n.arg, x));
  }
  return NaN;
}

/* ---------- 数值方法 ---------- */

function simpsonN(f, a, b, n) {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}

function integrateAdaptive(f, a, b) {
  const table = [];
  let prev = simpsonN(f, a, b, 16);
  table.push([16, prev, null]);
  let n = 32;
  let anyNaN = !Number.isFinite(prev);
  while (n <= 4096) {
    const cur = simpsonN(f, a, b, n);
    const delta = Number.isFinite(cur) && Number.isFinite(prev) ? Math.abs(cur - prev) : NaN;
    table.push([n, cur, delta]);
    if (Number.isFinite(cur) && Number.isFinite(prev) && delta < 1e-7 * Math.max(1, Math.abs(cur))) return { value: cur, table };
    anyNaN = anyNaN || !Number.isFinite(cur);
    prev = Number.isFinite(cur) ? cur : prev;
    n *= 2;
  }
  if (anyNaN || !Number.isFinite(prev)) throw new Error('积分区间内函数存在无定义点或积分不收敛，无法计算');
  return { value: prev, table };
}

function limitCalc(f, a) {
  const rows = [];
  for (const h of [0.1, 0.05, 0.01, 0.005, 0.001, 0.0005, 0.0001]) {
    rows.push([h, f(a + h), f(a - h)]);
  }
  const last = rows[rows.length - 1];
  const L = last[1], R = last[2];
  let verdict, value = null;
  if (!Number.isFinite(L) || !Number.isFinite(R)) {
    verdict = '在逼近过程中出现无定义/发散，极限可能不存在（或需要先化简表达式）';
  } else if (Math.abs(L - R) < 1e-4 * Math.max(1, Math.abs(L))) {
    value = (L + R) / 2;
    verdict = '左右两侧收敛于同一值 → 极限存在';
  } else if (Math.abs(L) > 1e6 && Math.abs(R) > 1e6 && Math.sign(L) === Math.sign(R)) {
    value = L > 0 ? Infinity : -Infinity;
    verdict = `两侧同号发散 → 极限为 ${L > 0 ? '+∞' : '−∞'}（无界）`;
  } else {
    verdict = '左右极限不相等 → 极限不存在（跳跃间断点）';
  }
  return { rows, value, verdict };
}

function taylorCoeffs(ast, x0, order) {
  const coeffs = [];
  let cur = ast, fact = 1;
  for (let k = 0; k <= order; k++) {
    if (k > 0) fact *= k;
    const v = evalAt(cur, x0);
    coeffs.push(Number.isFinite(v) ? v / fact : NaN);
    cur = simplify(diff(cur));
  }
  return coeffs;
}

function taylorPoly(coeffs, x0) {
  const parts = [];
  coeffs.forEach((c, k) => {
    if (!Number.isFinite(c) || Math.abs(c) < 1e-12) return;
    const mag = fmtShort(Math.abs(c));
    const basis = x0 === 0
      ? (k === 0 ? '' : 'x' + (k > 1 ? '^' + k : ''))
      : '(x' + (x0 > 0 ? ' − ' + fmtShort(x0) : ' + ' + fmtShort(-x0)) + ')' + (k > 1 ? '^' + k : '');
    parts.push({ neg: c < 0, text: mag + (basis ? '·' + basis : k === 0 ? fmtShort(Math.abs(c)) : '') });
  });
  if (!parts.length) return '0';
  let out = '';
  parts.forEach((p, i) => {
    out += i === 0 ? (p.neg ? '−' : '') : (p.neg ? ' − ' : ' + ');
    out += p.text;
  });
  return out;
}

/* ---------- 状态与页面 ---------- */

let curOp = 'd1';
let curAst = null;   // 解析后的 AST（绘制/计算共用）
let lastResult = null;

const OP_HINT = {
  d1: '符号求导：输出化简后的 f′(x) 与法则说明',
  d2: '在一阶导数基础上再求一次',
  integral: '数值积分：复合辛普森法则，自动加倍细分直到收敛',
  limit: '双侧数值逼近：需要填写 x₀',
  taylor: '泰勒多项式：需要填写展开点 x₀ 与阶数 n',
};

function renderSteps(steps) {
  const list = $('stepsList');
  const moreWrap = $('stepsMore');
  const moreList = $('stepsMoreList');
  list.innerHTML = '';
  moreList.innerHTML = '';
  moreWrap.hidden = steps.length <= STEPS_CAP;
  $('stepsMeta').textContent = steps.length ? `共 ${steps.length} 条` : '—';
  steps.slice(0, STEPS_CAP).forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    list.appendChild(li);
  });
  if (steps.length > STEPS_CAP) {
    steps.slice(STEPS_CAP).forEach(t => {
      const li = document.createElement('li');
      li.textContent = t;
      moreList.appendChild(li);
    });
  }
}

function topDesc(n) {
  if (n.t === 'num') return { desc: '常数', rule: '常数导数为 0' };
  if (n.t === 'var') return { desc: '自变量 x', rule: '(x)′ = 1' };
  if (n.t === 'neg') return { desc: '取负', rule: '(−u)′ = −u′' };
  if (n.t === 'fn') return { desc: `复合函数（外层 ${n.name}）`, rule: '链式法则 (f(g))′ = f′(g)·g′', detail: `内层 g = ${toStr(n.arg)}` };
  const nameMap = { '+': '和', '-': '差', '*': '乘积', '/': '商', '^': '幂' };
  const ruleMap = {
    '+': '(u ± v)′ = u′ ± v′', '-': '(u ± v)′ = u′ ± v′',
    '*': '(u·v)′ = u′·v + u·v′', '/': '(u/v)′ = (u′v − u·v′)/v²',
    '^': n.r.t === 'num' ? '幂法则 (uᶜ)′ = c·uᶜ⁻¹·u′' : '一般幂（指数含变量）暂不支持',
  };
  return { desc: nameMap[n.op] + '（顶层）', rule: ruleMap[n.op], detail: `u = ${toStr(n.l)}，v = ${toStr(n.r)}` };
}

function buildSteps(op, ast) {
  const s = [];
  s.push(`解析：f(x) = ${toStr(ast)}`);
  const stepsFor = (expr, label) => {
    const top = topDesc(expr);
    s.push(`${label}：顶层是${top.desc} → 应用法则：${top.rule}`);
    if (top.detail) s.push('其中 ' + top.detail);
  };
  let cur = ast;
  for (let k = 1; k <= (op === 'd2' ? 2 : 1); k++) {
    const label = k === 1 ? '第 1 次求导' : '第 2 次求导（对一阶导数再求导）';
    stepsFor(cur, label);
    const d = simplify(diff(cur));
    s.push(`化简得：${k === 1 ? "f′(x)" : "f″(x)"} = ${toStr(d)}`);
    cur = d;
  }
  return { steps: s, result: cur };
}

function integralSteps(f, a, b) {
  const { value, table } = integrateAdaptive(f, a, b);
  const s = ['方法：复合辛普森法则——把区间等分 n 段，每两段用抛物线逼近，逐次加倍 n 直到结果收敛（|差| < 1e-7）'];
  s.push('收敛过程：');
  for (const [n, v, d] of table) {
    s.push(`  n = ${n} → ∫ ≈ ${fmtNum(v)}${d != null ? `（与上次差 ${fmtNum(d)}）` : ''}`);
  }
  s.push(`收敛 → ∫[${fmtNum(a)}, ${fmtNum(b)}] f(x) dx ≈ ${fmtNum(value)}`);
  return { steps: s, value };
}

function limitSteps(f, a) {
  const { rows, value, verdict } = limitCalc(f, a);
  const s = ['方法：双侧数值逼近——取 x = a ± h（h 逐步减半），观察 f(x) 的走势'];
  for (const [h, p, m] of rows) {
    const fmt = v => (Number.isFinite(v) ? fmtNum(v) : (v > 0 ? '+∞' : v < 0 ? '−∞' : 'NaN'));
    s.push(`  h = ${h}：f(a+h) = ${fmt(p)}，f(a−h) = ${fmt(m)}`);
  }
  s.push('结论：' + verdict);
  return { steps: s, value, verdict };
}

function taylorSteps(ast, x0, order) {
  const coeffs = taylorCoeffs(ast, x0, order);
  const s = ['公式：Tₙ(x) = Σ f⁽ᵏ⁾(x₀)/k! · (x − x₀)ᵏ，逐阶求导并除以 k!：'];
  let fact = 1;
  for (let k = 0; k <= order; k++) {
    if (k > 0) fact *= k;
    const v = evalAt(simplify(diffN(ast, k)), x0);
    s.push(`  f⁽${k}⁾(x₀) = ${fmtNum(v)} → 系数 /${k}! = ${fmtNum(coeffs[k])}`);
  }
  s.push(`T${order}(x) = ${taylorPoly(coeffs, x0)}${order < 8 ? '  + O((x−x₀)^' + (order + 1) + ')' : ''}`);
  return { steps: s, coeffs };
}

// diffN：对 AST 求 k 阶导数（逐次）
function diffN(ast, k) {
  let cur = ast;
  for (let i = 0; i < k; i++) cur = simplify(diff(cur));
  return cur;
}

/* ---------- 绘图 ---------- */

function drawPlot() {
  const cv = $('plot');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(document.documentElement);
  const C = {
    bg: css.getPropertyValue('--bg').trim() || '#fff',
    line: css.getPropertyValue('--line').trim() || '#ddd',
    fg: css.getPropertyValue('--fg').trim() || '#222',
    accent: css.getPropertyValue('--accent').trim() || '#0969da',
  };
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  let xa = parseFloat($('xmin').value), xb = parseFloat($('xmax').value);
  if (!Number.isFinite(xa) || !Number.isFinite(xb) || xb <= xa) { xa = -10; xb = 10; }
  const f = x => curAst ? evalAt(curAst, x) : NaN;

  // 采样
  const N = 400;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const x = xa + (xb - xa) * i / N;
    pts.push([x, f(x)]);
  }
  // y 范围：用有限值排序后的 2%/98% 分位数，避免尖峰压扁图像
  const fin = pts.map(p => p[1]).filter(Number.isFinite).sort((p, q) => p - q);
  let ylo = -1, yhi = 1;
  if (fin.length) {
    ylo = fin[Math.floor(fin.length * 0.02)];
    yhi = fin[Math.floor(fin.length * 0.98)];
    if (yhi - ylo < 1e-9) { yhi = ylo + 1; ylo -= 1; }
    const pad = (yhi - ylo) * 0.12;
    ylo -= pad; yhi += pad;
  }
  const X = x => (x - xa) / (xb - xa) * W;
  const Y = y => H - (y - ylo) / (yhi - ylo) * H;
  const inY = y => Number.isFinite(y) && y >= ylo - (yhi - ylo) && y <= yhi + (yhi - ylo);

  // 网格
  ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(W * i / 6, 0); ctx.lineTo(W * i / 6, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * i / 6); ctx.lineTo(W, H * i / 6); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 坐标轴
  ctx.strokeStyle = C.fg; ctx.lineWidth = 1.2;
  if (ylo < 0 && yhi > 0) { ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke(); }
  if (xa < 0 && xb > 0) { ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), H); ctx.stroke(); }

  // 定积分阴影（选了定积分且区间有效）
  if (curOp === 'integral' && curAst) {
    const a = parseFloat($('aVal').value), b = parseFloat($('bVal').value);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      ctx.fillStyle = C.accent; ctx.globalAlpha = 0.15;
      ctx.beginPath();
      const x0 = Math.max(a, xa), x1 = Math.min(b, xb);
      if (x1 > x0) {
        ctx.moveTo(X(x0), Y(0));
        for (let i = 0; i <= 200; i++) {
          const x = x0 + (x1 - x0) * i / 200;
          let y = f(x);
          if (!Number.isFinite(y)) y = 0;
          ctx.lineTo(X(x), Y(y));
        }
        ctx.lineTo(X(x1), Y(0));
        ctx.closePath(); ctx.fill();
        // 区间边界竖线
        ctx.globalAlpha = 0.6; ctx.strokeStyle = C.accent; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(X(a), 0); ctx.lineTo(X(a), H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(b), 0); ctx.lineTo(X(b), H); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
  }

  // 曲线（NaN/大幅跳跃处断开）
  ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
  ctx.beginPath();
  let pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(y) || y < ylo - (yhi - ylo) * 2 || y > yhi + (yhi - ylo) * 2) { pen = false; continue; }
    const px = X(x), py = Y(y);
    if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
  }
  ctx.stroke();

  $('plotMeta').textContent = `范围 x ∈ [${fmtShort(xa)}, ${fmtShort(xb)}]，y ∈ [${fmtShort(ylo)}, ${fmtShort(yhi)}]（y 已按分位数自适应）`;
}

/* ---------- 计算 ---------- */

let draftTimer;
function scheduleSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
}

async function saveDraft() {
  await chrome.storage.local.set({
    [DRAFT_KEY]: {
      fx: $('fx').value, op: curOp,
      a: $('aVal').value, b: $('bVal').value, x0: $('x0Val').value,
      order: $('orderVal').value, xmin: $('xmin').value, xmax: $('xmax').value,
      at: Date.now(),
    },
  });
  $('draftTag').textContent = '草稿已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

async function loadDraft() {
  const got = await chrome.storage.local.get(DRAFT_KEY);
  const d = got[DRAFT_KEY];
  if (!d || typeof d !== 'object') return;
  if (typeof d.fx === 'string') $('fx').value = d.fx;
  if (d.op && ['d1', 'd2', 'integral', 'limit', 'taylor'].includes(d.op)) curOp = d.op;
  if (d.a != null) $('aVal').value = d.a;
  if (d.b != null) $('bVal').value = d.b;
  if (d.x0 != null) $('x0Val').value = d.x0;
  if (d.order) $('orderVal').value = d.order;
  if (d.xmin != null) $('xmin').value = d.xmin;
  if (d.xmax != null) $('xmax').value = d.xmax;
}

function compute() {
  const src = $('fx').value.trim();
  const box = $('outBox');
  $('formulaLine').textContent = src ? `f(x) = ${src}` : '在上方输入 f(x)';
  try {
    curAst = parseExpr(src);
    $('parsePreview').textContent = '解析为  f(x) = ' + toStr(curAst);
    $('parsePreview').classList.remove('err');
  } catch (e) {
    curAst = null;
    box.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'calc-err';
    d.textContent = '表达式解析失败：' + e.message;
    $('parsePreview').textContent = '解析失败：' + e.message;
    $('parsePreview').classList.add('err');
    box.appendChild(d);
    renderSteps([]);
    drawPlot();
    return;
  }

  try {
    const op = curOp;
    let formula = '', steps = [], resultNode = null, scalar = null;
    if (op === 'd1' || op === 'd2') {
      const built = buildSteps(op === 'd2' ? 'd2' : 'd1', curAst);
      steps = built.steps;
      resultNode = built.result;
      formula = (op === 'd1' ? "f′(x) = " : "f″(x) = ") + toStr(resultNode);
      box.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'expr-out';
      d.textContent = toStr(resultNode);
      box.appendChild(d);
      $('outMeta').textContent = '符号结果（化简后）';
    } else if (op === 'integral') {
      const a = parseFloat($('aVal').value), b = parseFloat($('bVal').value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('请填写积分区间 a 和 b（数字）');
      const f = x => evalAt(curAst, x);
      if (!Number.isFinite(f(a)) || !Number.isFinite(f(b))) throw new Error(`f(x) 在区间端点无定义（f(${fmtNum(a)}) = ${f(a)}）`);
      const r = integralSteps(f, a, b);
      steps = r.steps;
      scalar = r.value;
      formula = `∫[${fmtNum(a)}, ${fmtNum(b)}] f(x) dx ≈ ${fmtNum(scalar)}`;
      box.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'scalar-out';
      d.textContent = fmtNum(scalar);
      box.appendChild(d);
      $('outMeta').textContent = '数值结果（辛普森法）';
    } else if (op === 'limit') {
      const a = parseFloat($('x0Val').value);
      if (!Number.isFinite(a)) throw new Error('请填写趋于点 x₀（数字）');
      const f = x => evalAt(curAst, x);
      const r = limitSteps(f, a);
      steps = r.steps;
      formula = `lim(x→${fmtNum(a)}) f(x)：` + r.verdict;
      box.innerHTML = '';
      const d = document.createElement('div');
      d.className = r.value != null && Number.isFinite(r.value) ? 'scalar-out' : 'calc-err';
      d.textContent = r.value != null && Number.isFinite(r.value) ? fmtNum(r.value) : '极限不存在';
      box.appendChild(d);
      $('outMeta').textContent = '数值判定';
    } else if (op === 'taylor') {
      const x0 = parseFloat($('x0Val').value);
      const order = parseInt($('orderVal').value, 10);
      if (!Number.isFinite(x0)) throw new Error('请填写展开点 x₀（数字）');
      const r = taylorSteps(curAst, x0, order);
      steps = r.steps;
      formula = `T${order}(x) = ` + taylorPoly(r.coeffs, x0);
      box.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'expr-out';
      d.textContent = taylorPoly(r.coeffs, x0);
      box.appendChild(d);
      $('outMeta').textContent = `${order} 阶泰勒多项式（展开点 x₀ = ${fmtNum(x0)}）`;
    }
    renderSteps(steps);
  } catch (e) {
    box.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'calc-err';
    d.textContent = e.message;
    box.appendChild(d);
    renderSteps([]);
  }
  drawPlot();
}

/* ---------- ② 操作按钮与参数行 ---------- */

function updateOpUI() {
  document.querySelectorAll('#opSeg button').forEach(b => b.classList.toggle('active', b.dataset.op === curOp));
  $('abRow').hidden = curOp !== 'integral';
  $('x0Row').hidden = !(curOp === 'limit' || curOp === 'taylor');
  $('orderRow').hidden = curOp !== 'taylor';
  $('opHint').textContent = OP_HINT[curOp];
}

function setOp(op) {
  curOp = op;
  updateOpUI();
  scheduleSave();
  compute();
}
document.querySelectorAll('#opSeg button').forEach(b => {
  b.addEventListener('click', () => setOp(b.dataset.op));
});
['aVal', 'bVal', 'x0Val', 'orderVal', 'xmin', 'xmax'].forEach(id => {
  $(id).addEventListener('input', () => { scheduleSave(); compute(); });
});
$('fx').addEventListener('input', () => { scheduleSave(); compute(); });

/* ---------- 初始化 ---------- */

// 模板按钮接线
for (const [label, expr] of TPLS) {
  const b = document.createElement('button');
  b.className = 'tpl-chip';
  b.textContent = expr;
  b.title = label;
  b.onclick = () => { $('fx').value = expr; compute(); $('fx').focus(); };
  $('tplRow').appendChild(b);
}
// 插入按钮：光标处插入
document.querySelectorAll('.ins-btn').forEach(b => {
  b.addEventListener('click', () => {
    const inp = $('fx');
    const r = insertAtCursor(inp.value, inp.selectionStart, inp.selectionEnd, b.dataset.ins);
    inp.value = r.value;
    inp.setSelectionRange(r.caret, r.caret);
    inp.focus();
    compute();
  });
});

(async () => {
  try {
    await loadDraft();
  } catch (e) { /* 草稿读取失败按默认 */ }
  if (!$('fx').value.trim()) $('fx').value = 'x ^ 2 * sin(x) + ln(x)'; // 首次打开预填示例公式

  updateOpUI();
  compute();
  drawPlot();
})();
