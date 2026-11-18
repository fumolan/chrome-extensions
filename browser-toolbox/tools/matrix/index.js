// 矩阵计算器：三段式流程（①输入 → ②选运算 → ③公式/结果/计算过程），纯本地 + 草稿自动保存
const $ = (id) => document.getElementById(id);
const CAP = 8;        // 维度上限
const EPS = 1e-9;
const DRAFT_KEY = 'matrixCalcDraft';
const STEPS_CAP = 24; // 计算过程直接显示的步数上限，其余折叠

const M = {
  A: { r: 2, c: 2, v: [['1', '0'], ['0', '1']] },
  B: { r: 2, c: 2, v: [['0', '0'], ['0', '0']] },
};
let curOp = 'mul';

/* ---------- 纯计算（无 DOM，回放测试直接调用） ---------- */

function parseMat(m) {
  return m.v.map(row => row.map(x => {
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : 0;
  }));
}

function matTranspose(a) {
  return a[0].map((_, c) => a.map(row => row[c]));
}

function matAdd(a, b, sign = 1) {
  return a.map((row, i) => row.map((x, j) => x + sign * b[i][j]));
}

function matMul(a, b) {
  return a.map(row => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
}

function matScalar(a, k) {
  return a.map(row => row.map(x => x * k));
}

function matTrace(a) {
  return a.reduce((s, row, i) => s + row[i], 0);
}

// 高斯消元（部分主元），返回行列式；对角近似为 0 → 0
function matDet(a) {
  const n = a.length;
  const m = a.map(row => [...row]);
  let det = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < EPS) return 0;
    if (piv !== col) { [m[piv], m[col]] = [m[col], m[piv]]; det = -det; }
    det *= m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c2 = col; c2 < n; c2++) m[r][c2] -= f * m[col][c2];
    }
  }
  return det;
}

// 行阶梯主元个数
function matRank(a) {
  const m = a.map(row => [...row]);
  const rows = m.length, cols = m[0].length;
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col++) {
    let piv = -1;
    for (let r = rank; r < rows; r++) {
      if (Math.abs(m[r][col]) > EPS) { piv = r; break; }
    }
    if (piv < 0) continue;
    [m[piv], m[rank]] = [m[rank], m[piv]];
    for (let r = rank + 1; r < rows; r++) {
      const f = m[r][col] / m[rank][col];
      for (let c2 = col; c2 < cols; c2++) m[r][c2] -= f * m[rank][c2];
    }
    rank++;
  }
  return rank;
}

// Gauss-Jordan 求逆；奇异矩阵抛错
function matInv(a) {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < EPS) throw new Error('A 是奇异矩阵（行列式≈0），不存在逆矩阵');
    [m[piv], m[col]] = [m[col], m[piv]];
    const p = m[col][col];
    for (let c2 = 0; c2 < 2 * n; c2++) m[col][c2] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c2 = 0; c2 < 2 * n; c2++) m[r][c2] -= f * m[col][c2];
    }
  }
  return m.map(row => row.slice(n));
}

function fmtNum(x) {
  if (Math.abs(x) < 1e-10) return '0';
  return String(parseFloat(x.toPrecision(10)));
}

/* ---------- 计算过程（逐步文字化） ---------- */

const IDX = (i, j) => `[${i + 1}][${j + 1}]`;

function mulSteps(a, b) {
  const c = matMul(a, b), s = [];
  for (let i = 0; i < c.length; i++) for (let j = 0; j < c[0].length; j++) {
    const symbolic = a[i].map((_, kk) => `A${IDX(i, kk)}·B${IDX(kk, j)}`).join(' + ');
    const numeric = a[i].map((x, kk) => `${fmtNum(x)}×${fmtNum(b[kk][j])}`).join(' + ');
    s.push(`C${IDX(i, j)} = ${symbolic} = ${numeric} = ${fmtNum(c[i][j])}`);
  }
  return s;
}

function addSubSteps(a, b, sign) {
  const sym = sign > 0 ? '+' : '−';
  const c = matAdd(a, b, sign), s = [];
  for (let i = 0; i < c.length; i++) for (let j = 0; j < c[0].length; j++) {
    s.push(`C${IDX(i, j)} = A${IDX(i, j)} ${sym} B${IDX(i, j)} = ${fmtNum(a[i][j])} ${sym} ${fmtNum(b[i][j])} = ${fmtNum(c[i][j])}`);
  }
  return s;
}

function transposeSteps(a) {
  const t = matTranspose(a), s = [];
  for (let i = 0; i < t.length; i++) for (let j = 0; j < t[0].length; j++) {
    s.push(`Aᵀ${IDX(i, j)} = A${IDX(j, i)} = ${fmtNum(a[j][i])}`);
  }
  return s;
}

function scalarSteps(a, k) {
  const c = matScalar(a, k), s = [];
  for (let i = 0; i < c.length; i++) for (let j = 0; j < c[0].length; j++) {
    s.push(`C${IDX(i, j)} = ${fmtNum(k)} × A${IDX(i, j)} = ${fmtNum(k)} × ${fmtNum(a[i][j])} = ${fmtNum(c[i][j])}`);
  }
  return s;
}

// 系数显示用 6 位有效数字，矩阵快照用 10 位（验证更精确）
function fmtShort(x) {
  if (Math.abs(x) < 1e-10) return '0';
  return String(parseFloat(x.toPrecision(6)));
}

// 把数字矩阵渲染成对齐的文本行；pivotRows: Map(行号 → 主元序号) 会在行尾加标记
function dumpMatrix(m, pivotRows) {
  const cells = m.map(row => row.map(x => fmtNum(x)));
  const width = Math.max(1, ...cells.flat().map(c => c.length));
  const out = [];
  for (let i = 0; i < m.length; i++) {
    let line = `R${i + 1}: ` + cells[i].map(c => c.padStart(width)).join('  ');
    if (pivotRows && pivotRows.has(i)) line += `   ← 主元${pivotRows.get(i)}`;
    out.push(line);
  }
  return out.join('\n');
}

function detSteps(a) {
  const s = [], n = a.length;
  const m = a.map(row => [...row]);
  let swaps = 0, det = 1;
  const pivots = new Map();
  s.push('第 0 步：起点（原始矩阵 A）\n' + dumpMatrix(m));
  s.push('目标：用行变换把下三角部分消成 0，变成上三角；det = 主对角线乘积 × (−1)^行交换次数');
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < EPS) {
      s.push(`第 ${col + 1} 步：消第 ${col + 1} 列时主元为 0 → det = 0\n` + dumpMatrix(m, pivots));
      return { steps: s, value: 0 };
    }
    if (piv !== col) {
      [m[piv], m[col]] = [m[col], m[piv]];
      swaps++;
      det = -det;
      s.push(`行交换：R${piv + 1} ↔ R${col + 1}（把绝对值最大的元素换到主元位，每交换一次 det 变号）`);
    }
    const p = m[col][col];
    det *= p;
    pivots.set(col, pivots.size + 1);
    const targets = [];
    for (let r = col + 1; r < n; r++) targets.push(`R${r + 1} 的 ${fmtNum(m[r][col])}`);
    let step = `第 ${col + 1} 步：消第 ${col + 1} 列（主元 = R${col + 1} 的 ${fmtNum(p)}）\n目标：把 ${targets.join('、') || '（下方已无行）'} 都变成 0`;
    for (let r = col + 1; r < n; r++) {
      const oldCoef = m[r][col];
      const f = oldCoef / p;
      const calcs = [];
      for (let c2 = col; c2 < n; c2++) {
        const before = m[r][c2];
        const after = before - f * m[col][c2];
        calcs.push(`${fmtNum(before)} − (${fmtShort(f)})×${fmtNum(m[col][c2])} = ${fmtNum(after)}`);
        m[r][c2] = after;
      }
      step += `\nR${r + 1} 的系数 = ${fmtNum(oldCoef)} ÷ ${fmtNum(p)} = ${fmtShort(f)}，逐个元素算：\n  ` + calcs.join('\n  ')
        + `\n→ 新 R${r + 1} = [${m[r].slice(col).map(fmtNum).join(', ')}]`;
    }
    step += `\n第 ${col + 1} 步结束后的矩阵：\n` + dumpMatrix(m, pivots);
    s.push(step);
  }
  s.push(`第 ${n + 1} 步：数主元\n上三角主对角线：${Array.from(pivots.values()).map(no => `主元${no}`).join('、')}，det = ${fmtNum(det)}（共 ${swaps} 次行交换）`);
  return { steps: s, value: det };
}

function rankSteps(a) {
  const s = [], n = a.length, colsN = a[0].length;
  const m = a.map(row => [...row]);
  let rank = 0;
  const pivots = new Map();
  s.push('第 0 步：起点（原始矩阵 A）\n' + dumpMatrix(m));
  s.push('整个过程就是同一个动作反复做：用主元行，把下面行的某一列消成 0');
  for (let col = 0; col < colsN && rank < n; col++) {
    let piv = -1;
    for (let r = rank; r < n; r++) {
      if (Math.abs(m[r][col]) > EPS) { piv = r; break; }
    }
    if (piv < 0) continue;
    let step = `第 ${rank + 1} 步：消第 ${col + 1} 列（主元 = R${piv + 1} 的 ${fmtNum(m[piv][col])}）`;
    if (piv !== rank) {
      [m[piv], m[rank]] = [m[rank], m[piv]];
      step += `\n行交换：R${piv + 1} ↔ R${rank + 1}（把非零元素换到主元行）`;
    }
    rank++;
    pivots.set(rank - 1, rank);
    const pivotRow = m[rank - 1];
    const targets = [];
    for (let r = rank; r < n; r++) targets.push(`R${r + 1} 的 ${fmtNum(m[r][col])}`);
    step += `\n目标：把 ${targets.join('、') || '（下方已无行）'} 都变成 0`;
    for (let r = rank; r < n; r++) {
      if (Math.abs(m[r][col]) < EPS) {
        step += `\nR${r + 1} 的 ${fmtNum(m[r][col])} 已是 0，不用消`;
        continue;
      }
      const f = m[r][col] / pivotRow[col];
      const calcs = [];
      for (let c2 = col; c2 < colsN; c2++) {
        const before = m[r][c2];
        const after = before - f * pivotRow[c2];
        calcs.push(`${fmtNum(before)} − (${fmtShort(f)})×${fmtNum(pivotRow[c2])} = ${fmtNum(after)}`);
        m[r][c2] = after;
      }
      step += `\nR${r + 1} 的系数 = ${fmtNum(m[r][col])} ÷ ${fmtNum(pivotRow[col])} = ${fmtShort(f)}，逐个元素算：\n  ` + calcs.join('\n  ')
        + `\n→ 新 R${r + 1} = [${m[r].map(fmtNum).join(', ')}]`;
    }
    step += `\n第 ${rank} 步结束后的矩阵：\n` + dumpMatrix(m, pivots);
    s.push(step);
  }
  s.push(`第 ${rank + 1} 步：数主元\n阶梯上每行第一个非零元素就是主元，共 ${rank} 个 → 秩(A) = ${rank}`);
  s.push(`为什么这就是秩：行变换不改变行之间的线性关系；如果消出全零行，说明那一行是其他行的线性组合（冗余信息）；非零主元行数 = 相互独立的行数 = 秩。`);
  return { steps: s, value: rank };
}

function traceSteps(a) {
  const terms = a.map((row, i) => `a${i + 1}${i + 1} = ${fmtNum(row[i])}`).join('，');
  return [`tr(A) = 对角线元素之和（${terms}）= ${fmtNum(matTrace(a))}`];
}

function invSteps(a) {
  const s = [], n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const pivots = new Map();
  // 增广矩阵分两段显示：A | I
  const dumpAug = () => {
    const left = m.map(row => row.slice(0, n));
    const right = m.map(row => row.slice(n));
    const cells = [left, right].map(part => part.map(row => row.map(x => fmtNum(x))));
    const wL = Math.max(1, ...cells[0].flat().map(c => c.length));
    const wR = Math.max(1, ...cells[1].flat().map(c => c.length));
    const out = [];
    for (let i = 0; i < n; i++) {
      let line = `R${i + 1}: ` + cells[0][i].map(c => c.padStart(wL)).join('  ') + ' │ ' + cells[1][i].map(c => c.padStart(wR)).join('  ');
      if (pivots.has(i)) line += `   ← 主元${pivots.get(i)}`;
      out.push(line);
    }
    return out.join('\n');
  };
  s.push('第 0 步：起点（增广矩阵 [A | I]，左边是 A，右边是单位阵）\n' + dumpAug());
  s.push('目标：用 Gauss-Jordan 消元把左半部分变成单位阵 I，此时右半部分就是 A⁻¹');
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < EPS) {
      s.push(`第 ${col + 1} 步：消第 ${col + 1} 列时主元为 0 → A 奇异，不存在逆矩阵\n` + dumpAug());
      return { steps: s, error: 'A 是奇异矩阵（行列式≈0），不存在逆矩阵' };
    }
    let step = `第 ${col + 1} 步：处理第 ${col + 1} 列`;
    if (piv !== col) {
      [m[piv], m[col]] = [m[col], m[piv]];
      step += `\n行交换：R${piv + 1} ↔ R${col + 1}（把绝对值最大的元素换到主元位）`;
    }
    const p = m[col][col];
    pivots.set(col, pivots.size + 1);
    const normCalcs = [];
    for (let c2 = 0; c2 < 2 * n; c2++) {
      const before = m[col][c2];
      m[col][c2] = before / p;
      if (Math.abs(before / p) > 1e-10) normCalcs.push(`${fmtNum(before)} ÷ ${fmtNum(p)} = ${fmtNum(m[col][c2])}`);
    }
    step += `\n归一化：R${col + 1} 整行 ÷ ${fmtNum(p)}（让主元变 1）：\n  ` + normCalcs.join('\n  ');
    const elim = [];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (Math.abs(f) < EPS) { elim.push(`R${r + 1} 的 ${fmtNum(f)} 已是 0，不用消`); continue; }
      const calcs = [];
      for (let c2 = 0; c2 < 2 * n; c2++) {
        const before = m[r][c2];
        const after = before - f * m[col][c2];
        if (Math.abs(after) > 1e-10 || Math.abs(before) > 1e-10) calcs.push(`${fmtNum(before)} − (${fmtShort(f)})×${fmtNum(m[col][c2])} = ${fmtNum(after)}`);
        m[r][c2] = after;
      }
      elim.push(`R${r + 1} 的系数 = ${fmtShort(f)}：\n  ` + calcs.join('\n  '));
    }
    step += '\n消去其余行（保持主元为 1）：\n  ' + elim.join('\n  ');
    step += `\n第 ${col + 1} 步结束后的增广矩阵：\n` + dumpAug();
    s.push(step);
  }
  s.push('消元完成：左半部分已是单位阵 I，右半部分 = A⁻¹\n' + dumpAug());
  return { steps: s };
}

// 统一入口：返回当前运算的步骤数组
function buildSteps(op, a, b, k) {
  switch (op) {
    case 'mul': return mulSteps(a, b);
    case 'add': return addSubSteps(a, b, 1);
    case 'sub': return addSubSteps(a, b, -1);
    case 'transpose': return transposeSteps(a);
    case 'scalar': return scalarSteps(a, k);
    case 'trace': return traceSteps(a);
    case 'det': return detSteps(a).steps;
    case 'inv': return invSteps(a).steps;
    case 'rank': return rankSteps(a).steps;
    default: return [];
  }
}

/* ---------- 状态与网格 ---------- */

function ensureSize(m) {
  const v = [];
  for (let i = 0; i < m.r; i++) {
    const row = [];
    for (let j = 0; j < m.c; j++) row.push((m.v[i] && m.v[i][j] != null) ? String(m.v[i][j]) : '0');
    v.push(row);
  }
  m.v = v;
}

function buildGrid(which) {
  const m = M[which];
  ensureSize(m);
  const grid = $('grid-' + which);
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${m.c}, 64px)`;
  $(which + '-r').textContent = m.r;
  $(which + '-c').textContent = m.c;
  for (let i = 0; i < m.r; i++) {
    for (let j = 0; j < m.c; j++) {
      const inp = document.createElement('input');
      inp.value = m.v[i][j];
      inp.dataset.m = which;
      inp.addEventListener('input', () => {
        m.v[i][j] = inp.value;
        scheduleSave();
        compute();
      });
      inp.addEventListener('paste', onCellPaste);
      grid.appendChild(inp);
    }
  }
}

function onCellPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!/[\t\n]/.test(text.trim())) return;
  e.preventDefault();
  const which = e.target.dataset.m;
  const rows = text.trim().split(/\r?\n/).map(l => l.trim().split(/[\t,;\s]+/).filter(s => s !== ''));
  const r = Math.min(rows.length, CAP);
  const c = Math.min(Math.max(...rows.map(x => x.length)), CAP);
  M[which].r = r;
  M[which].c = c;
  M[which].v = Array.from({ length: r }, (_, i) =>
    Array.from({ length: c }, (_, j) => rows[i][j] != null ? rows[i][j] : '0'));
  buildGrid(which);
  scheduleSave();
  compute();
}

document.querySelectorAll('.stepper button').forEach(b => {
  b.addEventListener('click', () => {
    const m = M[b.dataset.m];
    const k = b.dataset.k;
    m[k] = Math.min(CAP, Math.max(1, m[k] + Number(b.dataset.d)));
    buildGrid(b.dataset.m);
    scheduleSave();
    compute();
  });
});

document.querySelectorAll('.presets button').forEach(b => {
  b.addEventListener('click', () => {
    const m = M[b.dataset.m];
    if (b.dataset.preset === 'eye') {
      m.r = m.c = Math.min(m.r, m.c);
      ensureSize(m);
      for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) m.v[i][j] = i === j ? '1' : '0';
    } else if (b.dataset.preset === 'random') {
      // -9~9 的随机整数（计算过程可读），保证不全零
      const ri = () => Math.floor(Math.random() * 19) - 9;
      for (let tries = 0; tries < 20; tries++) {
        ensureSize(m);
        for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) m.v[i][j] = String(ri());
        if (parseMat(m).some(row => row.some(x => x !== 0))) break;
      }
    } else {
      ensureSize(m);
      for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) m.v[i][j] = '0';
    }
    buildGrid(b.dataset.m);
    scheduleSave();
    compute();
  });
});

/* ---------- 运算定义 ---------- */

function sameShape(a, b, name, fn) {
  if (a.length !== b.length || a[0].length !== b[0].length) {
    throw new Error(`维度不匹配：A 是 ${a.length}×${a[0].length}，B 是 ${b.length}×${b[0].length}，${name} 要求同形状`);
  }
  return fn();
}

function requireSquare(a, name) {
  if (a.length !== a[0].length) throw new Error(`${name} 要求 A 为方阵，当前是 ${a.length}×${a[0].length}`);
}

const OPS = {
  mul: {
    label: 'A × B', hint: '要求 A 的列数 = B 的行数',
    calc: (a, b) => {
      if (a[0].length !== b.length) throw new Error(`维度不匹配：A 是 ${a.length}×${a[0].length}，B 是 ${b.length}×${b[0].length}；A×B 要求 A 的列数 = B 的行数`);
      return matMul(a, b);
    },
    formula: (a, b, k, r) => `A(${a.length}×${a[0].length}) × B(${b.length}×${b[0].length}) = C(${r.length}×${r[0].length})`,
  },
  add: {
    label: 'A + B', hint: '要求 A 与 B 同形状',
    calc: (a, b) => sameShape(a, b, 'A + B', () => matAdd(a, b)),
    formula: (a, b, k, r) => `A(${a.length}×${a[0].length}) + B(${b.length}×${b[0].length}) = C(${r.length}×${r[0].length})`,
  },
  sub: {
    label: 'A − B', hint: '要求 A 与 B 同形状',
    calc: (a, b) => sameShape(a, b, 'A − B', () => matAdd(a, b, -1)),
    formula: (a, b, k, r) => `A(${a.length}×${a[0].length}) − B(${b.length}×${b[0].length}) = C(${r.length}×${r[0].length})`,
  },
  transpose: {
    label: 'Aᵀ', hint: '任意形状；行变列、列变行',
    calc: a => matTranspose(a),
    formula: (a, b, k, r) => `Aᵀ(${a.length}×${a[0].length} → ${r.length}×${r[0].length})`,
  },
  det: {
    label: 'det(A)', hint: '要求 A 为方阵；行列式是一个数',
    calc: a => { requireSquare(a, 'det(A)'); return matDet(a); },
    scalar: true,
    formula: (a, b, k, r) => `det(A)（${a.length}×${a.length} 方阵）= ${fmtNum(r)}`,
  },
  inv: {
    label: 'A⁻¹', hint: '要求 A 为方阵且非奇异（det≠0）',
    calc: a => { requireSquare(a, 'A⁻¹'); return matInv(a); },
    formula: (a, b, k, r) => `A⁻¹（${a.length}×${a.length} 方阵的逆）= A·A⁻¹ = I`,
  },
  trace: {
    label: 'tr(A)', hint: '要求 A 为方阵；对角线元素之和',
    calc: a => { requireSquare(a, 'tr(A)'); return matTrace(a); },
    scalar: true,
    formula: (a, b, k, r) => `tr(A)（${a.length}×${a.length}）= 对角线元素之和 = ${fmtNum(r)}`,
  },
  rank: {
    label: 'rank(A)', hint: '任意形状；线性无关的行/列数',
    calc: a => matRank(a),
    scalar: true,
    formula: (a, b, k, r) => `rank(A)（${a.length}×${a[0].length}）= ${r}`,
  },
  scalar: {
    label: 'k·A', hint: 'k 乘以 A 的每个元素',
    calc: (a, b, k) => matScalar(a, k),
    formula: (a, b, k, r) => `${fmtNum(k)} × A(${a.length}×${a[0].length}) = C(${r.length}×${r[0].length})`,
  },
};

/* ---------- 结果渲染 ---------- */

let lastResult = null;

function setFormula(text) {
  $('formulaLine').textContent = text;
}

function renderSteps(steps) {
  const list = $('stepsList');
  const moreWrap = $('stepsMore');
  const moreList = $('stepsMoreList');
  list.innerHTML = '';
  moreList.innerHTML = '';
  moreWrap.hidden = steps.length <= STEPS_CAP;
  $('stepsMeta').textContent = steps.length ? `共 ${steps.length} 步` : '—';
  if (!steps.length) return;
  const direct = steps.slice(0, STEPS_CAP);
  for (const t of direct) {
    const li = document.createElement('li');
    li.textContent = t;
    list.appendChild(li);
  }
  if (steps.length > STEPS_CAP) {
    for (const t of steps.slice(STEPS_CAP)) {
      const li = document.createElement('li');
      li.textContent = t;
      moreList.appendChild(li);
    }
  }
}

function compute() {
  const op = curOp;
  const box = $('outBox');
  const def = OPS[op];
  $('opHint').textContent = def.hint;
  $('scalarRow').hidden = op !== 'scalar';
  const a = parseMat(M.A);
  const b = parseMat(M.B);
  const k = parseFloat($('scalarK').value) || 0;
  try {
    const r = def.calc(a, b, k);
    lastResult = Array.isArray(r) ? { matrix: r } : { scalar: r };
    setFormula(def.formula(a, b, k, r));
    $('outMeta').textContent = Array.isArray(r) ? `结果 ${r.length}×${r[0].length}` : '标量结果';
    box.innerHTML = '';
    if (Array.isArray(r)) {
      const grid = document.createElement('div');
      grid.className = 'result-grid';
      grid.style.gridTemplateColumns = `repeat(${r[0].length}, minmax(72px, auto))`;
      for (const row of r) for (const x of row) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = fmtNum(x);
        grid.appendChild(cell);
      }
      box.appendChild(grid);
    } else {
      const d = document.createElement('div');
      d.className = 'scalar-out';
      d.textContent = fmtNum(r);
      box.appendChild(d);
    }
    renderSteps(buildSteps(op, a, b, k));
  } catch (e) {
    lastResult = null;
    box.innerHTML = '';
    setFormula(def.label + ' —— 无法计算');
    const d = document.createElement('div');
    d.className = 'mat-err';
    d.textContent = e.message;
    box.appendChild(d);
    renderSteps([]);
  }
}

/* ---------- ② 运算按钮 ---------- */

function setOp(op) {
  curOp = op;
  document.querySelectorAll('#opSeg button').forEach(b => b.classList.toggle('active', b.dataset.op === op));
  $('scalarRow').hidden = op !== 'scalar';
  scheduleSave();
  compute();
}
document.querySelectorAll('#opSeg button').forEach(b => {
  b.addEventListener('click', () => setOp(b.dataset.op));
});
$('scalarK').addEventListener('input', () => { scheduleSave(); compute(); });

/* ---------- 复制 ---------- */

function resultText(sep) {
  if (!lastResult) return null;
  if (lastResult.scalar != null) return String(lastResult.scalar);
  return lastResult.matrix.map(row => row.map(fmtNum).join(sep)).join('\n');
}

$('copyTsvBtn').onclick = async function () {
  const t = resultText('\t');
  if (t == null) { showNoResult(); return; }
  await navigator.clipboard.writeText(t);
  flash(this, '已复制 ✓');
};

$('copyTxtBtn').onclick = async function () {
  const t = resultText('  ');
  if (t == null) { showNoResult(); return; }
  await navigator.clipboard.writeText(t);
  flash(this, '已复制 ✓');
};

function showNoResult() {
  const d = document.createElement('div');
  d.className = 'mat-err';
  d.textContent = '还没有可复制的结果：先完成一次成功计算';
  $('outBox').appendChild(d);
}
function flash(btn, text) {
  btn.textContent = text;
  setTimeout(() => (btn.textContent = btn.id === 'copyTsvBtn' ? '复制 TSV' : '复制文本'), 1200);
}

/* ---------- 草稿查看面板（点顶栏「草稿已保存」开合） ---------- */

function renderDraftInfo(info) {
  const box = $('draftInfo');
  if (!info || !info.A || !info.B) {
    box.textContent = '还没有保存过草稿：改动任意数字 / 运算后会自动保存。';
    return;
  }
  const fmtMat = (m) => {
    if (!m || !Array.isArray(m.v)) return '（无）';
    const rows = m.v.map(row => '    ' + row.map(x => (x == null || x === '' ? '0' : x)).join('  '));
    return `（${m.r}×${m.c}）\n${rows.join('\n')}`;
  };
  box.textContent =
    `保存时间：${info.at ? new Date(info.at).toLocaleString('zh-CN', { hour12: false }) : '—'}\n`
    + `当前运算：${info.op || '—'}${info.k != null ? `（k = ${info.k}）` : ''}\n`
    + `矩阵 A ${fmtMat(info.A)}\n`
    + `矩阵 B ${fmtMat(info.B)}`;
}

async function toggleDraftPanel() {
  const panel = $('draftPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const got = await chrome.storage.local.get(DRAFT_KEY);
    renderDraftInfo(got[DRAFT_KEY]);
  }
}
$('draftTag').addEventListener('click', toggleDraftPanel);
$('draftTag2').addEventListener('click', toggleDraftPanel);

$('copyDraftBtn').onclick = async function () {
  const got = await chrome.storage.local.get(DRAFT_KEY);
  await navigator.clipboard.writeText(JSON.stringify(got[DRAFT_KEY] || {}, null, 2));
  const restore = this.textContent;
  this.textContent = '已复制 ✓';
  setTimeout(() => (this.textContent = restore), 1200);
};

$('clearDraftBtn').onclick = async function () {
  await chrome.storage.local.remove(DRAFT_KEY);
  renderDraftInfo(null);
  const restore = this.textContent;
  this.textContent = '已清除 ✓';
  setTimeout(() => (this.textContent = restore), 1200);
};

/* ---------- 草稿自动保存 ---------- */

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
}

async function saveDraft() {
  await chrome.storage.local.set({
    [DRAFT_KEY]: { A: M.A, B: M.B, op: curOp, k: $('scalarK').value, at: Date.now() },
  });
  const t = '草稿已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  $('draftTag').textContent = t;
  $('draftTag2').textContent = t;
}

async function loadDraft() {
  const got = await chrome.storage.local.get(DRAFT_KEY);
  const d = got[DRAFT_KEY];
  if (d && d.A && d.B) {
    M.A = { r: d.A.r, c: d.A.c, v: d.A.v };
    M.B = { r: d.B.r, c: d.B.c, v: d.B.v };
  }
  if (d && d.op && OPS[d.op]) curOp = d.op;
  if (d && d.k != null) $('scalarK').value = d.k;
}

/* ---------- 初始化 ---------- */

(async () => {
  try {
    await loadDraft();
  } catch (e) { /* 草稿读取失败按默认值 */ }
  buildGrid('A');
  buildGrid('B');
  document.querySelectorAll('#opSeg button').forEach(b => b.classList.toggle('active', b.dataset.op === curOp));
  $('scalarRow').hidden = curOp !== 'scalar';
  compute();
})();
