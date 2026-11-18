// 金融工具：术语学习 / 金融计算 / 常识速查，纯本地，计算输入自动存草稿
const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'financeCalcDraft';

let lastCalcResult = null;
let calcDraftTimer;
const calcValues = {}; // { 计算器key: { 输入key: 原始字符串 } }

const num = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
};

/* ---------- 纯计算（无 DOM，回放测试直接调用） ---------- */

// 复利终值：pv 本金，rate 年化利率（小数），years 年，perYear 每年复利次数
function compoundFV(pv, rate, years, perYear) {
  return pv * Math.pow(1 + rate / perYear, years * perYear);
}

// 定投年金终值：pmt 每月投入，annualRate 年化利率（小数），months 月数
function sipFV(pmt, annualRate, months) {
  const i = annualRate / 12;
  if (Math.abs(i) < 1e-12) return pmt * months;
  return pmt * (Math.pow(1 + i, months) - 1) / i;
}

// 年化换算：totalReturn 总收益（0.5 = 50%），years 年数；compound 复利/单利
function annualizedReturn(totalReturn, years, compound) {
  if (years <= 0) return totalReturn;
  return compound ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn / years;
}

// 等额本息月供
function loanPayment(principal, annualRate, months) {
  const i = annualRate / 12;
  if (Math.abs(i) < 1e-12) return principal / months;
  return principal * i * Math.pow(1 + i, months) / (Math.pow(1 + i, months) - 1);
}

// 等额本金：首月/末月月供与总利息
function equalPrincipalSummary(principal, annualRate, months) {
  const i = annualRate / 12;
  const perMonth = principal / months;
  return {
    firstMonth: perMonth + principal * i,
    lastMonth: perMonth + perMonth * i,
    totalInterest: principal * i * (months + 1) / 2,
  };
}

// 净现值：cfs 为现金流数组（期 0 起，负数为投入）
function npv(rate, cfs) {
  return cfs.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0);
}

// 内部收益率：NPV = 0 的折现率，二分法；无符号变化返回 null
function irr(cfs) {
  const f = (r) => cfs.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
  let lo = -0.9999, hi = 10;
  const flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (flo * fm < 0) hi = mid;
    else { lo = mid; }
  }
  return (lo + hi) / 2;
}

// 夏普比率（百分比口径：收益与波动同为 %）
function sharpe(rp, rf, vol) {
  if (vol === 0) return null;
  return (rp - rf) / vol;
}

// 最大回撤：净值序列 → { mdd, peakIdx, troughIdx }
function maxDrawdown(nav) {
  let peak = nav[0], mdd = 0, peakIdx = 0, mddPeakIdx = 0, mddTroughIdx = 0;
  for (let i = 0; i < nav.length; i++) {
    if (nav[i] > peak) { peak = nav[i]; peakIdx = i; }
    const dd = (peak - nav[i]) / peak;
    if (dd > mdd) { mdd = dd; mddPeakIdx = peakIdx; mddTroughIdx = i; }
  }
  return { mdd, peakIdx: mddPeakIdx, troughIdx: mddTroughIdx };
}

function fmtNum(x) {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 1e-9) return '0';
  return String(parseFloat(x.toPrecision(10)));
}

function pct(x) { return fmtNum(x * 100) + '%'; }

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- 视图页签 ---------- */

function switchView(name) {
  document.querySelectorAll('section.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('.view-tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
}
document.querySelectorAll('.view-tabs button').forEach(b => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

/* ---------- 📖 术语学习 ---------- */

let quizMode = false;
let curCat = '全部';

function renderTerms() {
  const kw = $('termSearch').value.trim().toLowerCase();
  const grid = $('termGrid');
  grid.classList.toggle('quiz', quizMode);
  const list = FIN_TERMS.filter(t => {
    if (curCat !== '全部' && t.cat !== curCat) return false;
    if (!kw) return true;
    const hay = (t.term + ' ' + (t.en || '') + ' ' + t.def + ' ' + (t.formula || '') + ' ' + (t.example || '')).toLowerCase();
    return kw.split(/\s+/).every(w => hay.includes(w));
  });
  $('quizHint').hidden = !quizMode;
  if (!list.length) {
    grid.innerHTML = '<div class="muted">没有匹配的术语，换个关键词试试。</div>';
    return;
  }
  grid.innerHTML = list.map(t => {
    let html = `<div class="term-head"><span class="term-name">${esc(t.term)}</span>`
      + (t.en ? `<span class="term-en">${esc(t.en)}</span>` : '')
      + `<span class="term-cat">${esc(t.cat)}</span></div>`
      + `<div class="term-def">${esc(t.def)}</div>`
      + (t.formula ? `<div class="term-formula">${esc(t.formula)}</div>` : '')
      + (t.example ? `<div class="term-example">例：${esc(t.example)}</div>` : '');
    if (quizMode) html += '<div class="term-reveal-hint muted">点击卡片查看解释</div>';
    return `<div class="term-card">${html}</div>`;
  }).join('');
  if (quizMode) {
    grid.querySelectorAll('.term-card').forEach(card => {
      card.addEventListener('click', () => card.classList.add('revealed'));
    });
  }
}

function buildCatChips() {
  const box = $('catChips');
  const cats = ['全部', ...FIN_CATS];
  box.innerHTML = '';
  cats.forEach(c => {
    const b = document.createElement('button');
    b.textContent = c;
    b.dataset.cat = c;
    if (c === curCat) b.classList.add('active');
    b.onclick = () => {
      curCat = c;
      box.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.cat === curCat));
      renderTerms();
    };
    box.appendChild(b);
  });
}

$('termSearch').addEventListener('input', renderTerms);

(function addQuizToggle() {
  const label = document.createElement('label');
  label.style.marginLeft = 'auto';
  label.innerHTML = '<input type="checkbox" id="quizModeChk"> 抽查模式';
  document.querySelector('#view-terms .card .card-head').appendChild(label);
  $('quizModeChk').addEventListener('change', function () {
    quizMode = this.checked;
    renderTerms();
  });
})();

/* ---------- 🧮 金融计算 ---------- */

const CALCS = {
  compound: {
    name: '复利终值',
    hint: '一笔钱按复利滚 n 年后变成多少',
    inputs: [
      { k: 'pv', l: '本金 PV（元）', d: '10000' },
      { k: 'r', l: '年化利率 r（%）', d: '8' },
      { k: 'n', l: '年限 n（年）', d: '10' },
      { k: 'm', l: '每年复利次数 m', d: '1' },
    ],
    run(v) {
      const fv = compoundFV(num(v.pv), num(v.r) / 100, num(v.n), Math.max(1, num(v.m)));
      const rPer = num(v.r) / 100 / Math.max(1, num(v.m));
      return {
        scalar: fv,
        formula: `FV = PV × (1 + r/m)^(n×m) = ${fmtNum(num(v.pv))} × (1 + ${fmtNum(rPer)})^${fmtNum(num(v.n) * Math.max(1, num(v.m)))}`,
        steps: [
          `公式：FV = PV × (1 + r/m)^(n×m)，本金 ${fmtNum(num(v.pv))} 元按年化 ${pct(num(v.r) / 100)} 滚 ${fmtNum(num(v.n))} 年`,
          `代入：${fmtNum(num(v.pv))} × (1 + ${fmtNum(rPer)})^${fmtNum(num(v.n) * Math.max(1, num(v.m)))}`,
          `FV = ${fmtNum(fv)} 元`,
          `其中利息（超出本金部分）= ${fmtNum(fv - num(v.pv))} 元`,
        ],
      };
    },
  },
  sip: {
    name: '定投终值',
    hint: '每月固定投入一笔钱，n 个月后有多少',
    inputs: [
      { k: 'pmt', l: '每月投入（元）', d: '1000' },
      { k: 'r', l: '年化收益 r（%）', d: '8' },
      { k: 'n', l: '月数', d: '120' },
    ],
    run(v) {
      const fv = sipFV(num(v.pmt), num(v.r) / 100, num(v.n));
      const i = (num(v.r) / 100) / 12;
      const invested = num(v.pmt) * num(v.n);
      return {
        scalar: fv,
        formula: `FV = PMT × ((1 + i)^n − 1) ÷ i，i = ${pct(i)}（月利率）`,
        steps: [
          `月利率 i = 年化 ${pct(num(v.r) / 100)} ÷ 12 = ${pct(i)}`,
          `代入：${fmtNum(num(v.pmt))} × ((1 + ${fmtNum(i)})^${fmtNum(num(v.n))} − 1) ÷ ${fmtNum(i)}`,
          `FV = ${fmtNum(fv)} 元`,
          `本金合计 ${fmtNum(invested)} 元，收益 ${fmtNum(fv - invested)} 元`,
        ],
      };
    },
  },
  annualized: {
    name: '年化换算',
    hint: '持有期总收益 → 年化收益（复利/单利对照）',
    inputs: [
      { k: 'tr', l: '持有期总收益（%，50 = 赚 50%）', d: '50' },
      { k: 'years', l: '持有年数', d: '3' },
    ],
    run(v) {
      const c = annualizedReturn(num(v.tr) / 100, num(v.years), true);
      const s = annualizedReturn(num(v.tr) / 100, num(v.years), false);
      return {
        scalar: c,
        formula: `复利年化 = (1 + 总收益)^(1/n) − 1`,
        steps: [
          `复利年化 = (1 + ${pct(num(v.tr) / 100)})^(1/${fmtNum(num(v.years))}) − 1 = ${pct(c)}`,
          `单利年化 = ${pct(num(v.tr) / 100)} ÷ ${fmtNum(num(v.years))} = ${pct(s)}（仅作对照，复利口径更常用）`,
          `反面验证：按年化 ${pct(c)} 滚 ${fmtNum(num(v.years))} 年恰好回到 ${pct(num(v.tr) / 100)}`,
        ],
      };
    },
  },
  loan: {
    name: '房贷月供对比',
    hint: '等额本息 vs 等额本金：月供与总利息',
    inputs: [
      { k: 'p', l: '贷款本金（元）', d: '1000000' },
      { k: 'r', l: '年利率（%，如 4.2）', d: '4.2' },
      { k: 'n', l: '期数 n（月，30 年 = 360）', d: '360' },
    ],
    run(v) {
      const p = num(v.p), r = num(v.r) / 100, n = Math.max(1, num(v.n));
      const m1 = loanPayment(p, r, n);
      const totalInt1 = m1 * n - p;
      const ep = equalPrincipalSummary(p, r, n);
      return {
        matrix: [
          ['等额本息月供（固定）', fmtNum(m1) + ' 元'],
          ['等额本息总利息', fmtNum(totalInt1) + ' 元'],
          ['等额本金首月', fmtNum(ep.firstMonth) + ' 元'],
          ['等额本金末月', fmtNum(ep.lastMonth) + ' 元'],
          ['等额本金总利息', fmtNum(ep.totalInterest) + ' 元'],
          ['两种方式利息差', fmtNum(totalInt1 - ep.totalInterest) + ' 元'],
        ],
        formula: `等额本息：M = P·i·(1+i)^n ÷ ((1+i)^n − 1)，i = ${pct(r / 12)}（月利率）`,
        steps: [
          `等额本息：每月还款固定。M = ${fmtNum(p)} × ${fmtNum(r / 12)} × (1 + ${fmtNum(r / 12)})^${fmtNum(n)} ÷ ((1 + ${fmtNum(r / 12)})^${fmtNum(n)} − 1) = ${fmtNum(m1)} 元/月`,
          `等额本息总利息 = 月供 × 期数 − 本金 = ${fmtNum(m1)} × ${fmtNum(n)} − ${fmtNum(p)} = ${fmtNum(totalInt1)} 元`,
          `等额本金：每月还固定本金 ${fmtNum(p / n)} 元 + 剩余本金的当月利息，月供逐月递减`,
          `等额本金总利息 = 本金 × 月利率 × (期数 + 1) ÷ 2 = ${fmtNum(ep.totalInterest)} 元（比等额本息少 ${fmtNum(totalInt1 - ep.totalInterest)} 元，但前期压力更大）`,
        ],
      };
    },
  },
  npv: {
    name: '净现值 NPV',
    hint: '未来现金流按折现率折到今天，> 0 才划算',
    inputs: [
      { k: 'rate', l: '折现率（%，如 10）', d: '10' },
      { k: 'cfs', l: '现金流，逗号分隔（第 0 期在前，投入为负）', d: '-100, 50, 50, 50' },
    ],
    run(v) {
      const cfs = String(v.cfs || '').split(/[,，;；\s]+/).map(parseFloat).filter(x => Number.isFinite(x));
      if (!cfs.length) throw new Error('请输入现金流，用逗号或空格分隔');
      const r = num(v.rate) / 100;
      const val = npv(r, cfs);
      const steps = [`第 0 期现金流 ${fmtNum(cfs[0])}（投入，不折现）`];
      cfs.slice(1).forEach((cf, i) => {
        steps.push(`第 ${i + 1} 期 ${fmtNum(cf)} 折现：${fmtNum(cf)} ÷ (1 + ${fmtNum(r)})^${i + 1} = ${fmtNum(cf / Math.pow(1 + r, i + 1))}`);
      });
      steps.push(`NPV = ${fmtNum(val)} ${val > 0 ? '> 0：回报超过折现率，可行' : val < 0 ? '< 0：回报不及折现率，不可行' : '：刚好持平'}`);
      return { scalar: val, formula: `NPV = Σ CFₜ ÷ (1 + ${fmtNum(r)})ᵗ（共 ${cfs.length} 期现金流）`, steps };
    },
  },
  irr: {
    name: '内部收益率 IRR',
    hint: '使 NPV = 0 的折现率 = 资金的真实年化回报',
    inputs: [
      { k: 'cfs', l: '现金流，逗号分隔（第 0 期为投入，负数）', d: '-1000, 500, 500, 500' },
    ],
    run(v) {
      const cfs = String(v.cfs || '').split(/[,，;；\s]+/).map(parseFloat).filter(x => Number.isFinite(x));
      const r = irr(cfs);
      if (r == null) throw new Error('该现金流没有 IRR 解（现金流必须先负后正才有意义）');
      const v0 = npv(r, cfs);
      return {
        scalar: r * 100,
        formula: `IRR 是使 Σ CFₜ ÷ (1 + IRR)ᵗ = 0 的折现率（二分法求解）`,
        steps: [
          `求解条件：NPV(IRR) = 0，即每期现金流按 IRR 折现后，总和恰好等于期初投入`,
          `解得 IRR ≈ ${pct(r)}`,
          `验证：NPV(${pct(r)}) = ${fmtNum(v0)} ≈ 0 ✓`,
          `对照：这是分期回收现金流的"真实年化回报"，可直接与贷款利率、理财收益率比较`,
        ],
      };
    },
  },
  sharpe: {
    name: '夏普比率',
    hint: '每承担 1 单位波动，换来多少超额收益',
    inputs: [
      { k: 'rp', l: '组合年化收益 Rp（%）', d: '8' },
      { k: 'rf', l: '无风险利率 Rf（%）', d: '2' },
      { k: 'vol', l: '年化波动率 σ（%）', d: '10' },
    ],
    run(v) {
      const s = sharpe(num(v.rp), num(v.rf), num(v.vol));
      if (s == null) throw new Error('波动率不能为 0');
      return {
        scalar: s,
        formula: `Sharpe = (Rp − Rf) ÷ σ = (${fmtNum(num(v.rp))}% − ${fmtNum(num(v.rf))}%) ÷ ${fmtNum(num(v.vol))}%`,
        steps: [
          `超额收益 = ${fmtNum(num(v.rp))}% − ${fmtNum(num(v.rf))}% = ${fmtNum(num(v.rp) - num(v.rf))}%`,
          `Sharpe = ${fmtNum(num(v.rp) - num(v.rf))} ÷ ${fmtNum(num(v.vol))} = ${fmtNum(s)}`,
          `经验参考：同为年化口径时 > 1 良好、> 2 优秀；负数说明跑不赢无风险利率`,
        ],
      };
    },
  },
  mdd: {
    name: '最大回撤',
    hint: '净值序列中"从峰值跌到谷底"的最大幅度',
    inputs: [
      { k: 'nav', l: '净值序列，逗号分隔（如 1, 1.2, 0.9, 1.1, 0.8）', d: '1, 1.2, 0.9, 1.1, 0.8' },
    ],
    run(v) {
      const nav = String(v.nav || '').split(/[,，\s]+/).map(parseFloat).filter(x => Number.isFinite(x) && x > 0);
      if (nav.length < 2) throw new Error('至少输入 2 个净值点');
      const { mdd, peakIdx, troughIdx } = maxDrawdown(nav);
      const peak = nav[peakIdx], trough = nav[troughIdx];
      return {
        scalar: mdd * 100,
        formula: `MDD = (峰值 − 谷底) ÷ 峰值`,
        steps: [
          `峰值 ${fmtNum(peak)}（第 ${peakIdx + 1} 个点）→ 谷底 ${fmtNum(trough)}（第 ${troughIdx + 1} 个点）`,
          `MDD = (${fmtNum(peak)} − ${fmtNum(trough)}) ÷ ${fmtNum(peak)} = ${pct(mdd)}`,
          `回撤 ${pct(mdd)} 后，需要再涨 ${pct(peak / trough - 1)} 才能回本——回撤越深回本越难（不对称）`,
        ],
      };
    },
  },
};

let curCalc = 'compound';

function renderCalcInputs() {
  const def = CALCS[curCalc];
  const vals = calcValues[curCalc] || {};
  const box = $('calcInputs');
  box.innerHTML = '';
  def.inputs.forEach(inp => {
    const label = document.createElement('label');
    label.textContent = inp.l;
    const el = document.createElement('input');
    el.dataset.k = inp.k;
    el.value = vals[inp.k] != null ? vals[inp.k] : inp.d;
    el.addEventListener('input', () => {
      (calcValues[curCalc] = calcValues[curCalc] || {})[inp.k] = el.value;
      scheduleSave();
      computeCalc();
    });
    label.appendChild(el);
    box.appendChild(label);
  });
}

function collectCalcValues() {
  const out = {};
  document.querySelectorAll('#calcInputs input').forEach(el => {
    out[el.dataset.k] = el.value;
  });
  return out;
}


function renderCalcSteps(steps) {
  const list = document.getElementById('calcSteps');
  if (!list) return;
  list.innerHTML = '';
  for (const t of steps) {
    const li = document.createElement('li');
    li.textContent = t;
    list.appendChild(li);
  }
}

function computeCalc() {
  const def = CALCS[curCalc];
  const box = $('calcOut');
  try {
    const v = collectCalcValues();
    const r = def.run(v);
    lastCalcResult = r;
    $('formulaLine').textContent = r.formula;
    $('calcMeta').textContent = def.name;
    box.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'result-big';
    d.textContent = r.matrix ? '' : fmtNum(r.scalar);
    box.appendChild(d);
    if (r.matrix) {
      const grid = document.createElement('div');
      grid.style.marginTop = '10px';
      for (const [kk, vv] of r.matrix) {
        const row = document.createElement('div');
        row.className = 'kv';
        row.innerHTML = `<span class="k">${esc(kk)}</span><span class="v">${esc(vv)}</span>`;
        grid.appendChild(row);
      }
      box.appendChild(grid);
    }
    $('calcMeta').textContent = def.name + (r.matrix ? '（对比）' : '');
    renderCalcSteps(r.steps || []);
  } catch (e) {
    lastCalcResult = null;
    box.innerHTML = '';
    $('formulaLine').textContent = def.name + ' —— 无法计算';
    const d = document.createElement('div');
    d.className = 'mat-err';
    d.textContent = e.message;
    box.appendChild(d);
    $('calcMeta').textContent = '';
    renderCalcSteps([]);
  }
}

function buildCalcSeg() {
  const seg = document.getElementById('calcSeg');
  seg.innerHTML = '';
  for (const [k, def] of Object.entries(CALCS)) {
    const b = document.createElement('button');
    b.textContent = def.name;
    b.dataset.calc = k;
    if (k === curCalc) b.classList.add('active');
    b.addEventListener('click', () => setOp(k));
    seg.appendChild(b);
  }
}

document.querySelectorAll('#calcSeg button').forEach(b => {
  b.addEventListener('click', () => setOp(b.dataset.calc));
});

function setOp(k) {
  curCalc = k;
  document.querySelectorAll('#calcSeg button').forEach(x => x.classList.toggle('active', x.dataset.calc === k));
  renderCalcInputs();
  scheduleSave();
  computeCalc();
}

/* ---------- 💡 金融常识 ---------- */

function renderKnowledge() {
  $('knowList').innerHTML = FIN_KNOWLEDGE.map(k =>
    `<div class="know-card"><h3>${esc(k.title)}</h3><p>${esc(k.text)}</p></div>`).join('');
}

/* ---------- 复制结果 ---------- */

$('copyResultBtn').onclick = async function () {
  if (!lastCalcResult) return;
  let t;
  if (lastCalcResult.matrix) t = lastCalcResult.matrix.map(([kk, vv]) => `${kk}\t${vv}`).join('\n');
  else if (lastCalcResult.scalarLabel != null) t = lastCalcResult.scalarLabel;
  else t = String(fmtNum(lastCalcResult.scalar));
  await navigator.clipboard.writeText(t);
  const restore = this.textContent;
  this.textContent = '已复制 ✓';
  setTimeout(() => (this.textContent = restore), 1200);
};

/* ---------- 草稿（输入自动保存，按计算器分别记忆） ---------- */

function scheduleSave() {
  clearTimeout(calcDraftTimer);
  calcDraftTimer = setTimeout(saveDraft, 400);
}

async function saveDraft() {
  await chrome.storage.local.set({
    [DRAFT_KEY]: { calc: curCalc, values: calcValues, at: Date.now() },
  });
  const t = '草稿已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  $('calcDraftTag').textContent = t;
}

async function loadDraft() {
  const got = await chrome.storage.local.get(DRAFT_KEY);
  const d = got[DRAFT_KEY];
  if (d && d.calc && CALCS[d.calc]) {
    curCalc = d.calc;
    if (d.values) Object.assign(calcValues, d.values);
  }
}

/* ---------- 初始化 ---------- */

buildCalcSeg();
renderCalcInputs();
renderKnowledge();
renderTerms();
buildCatChips();
computeCalc();
(async () => {
  try {
    await loadDraft();
    document.querySelectorAll('#calcSeg button').forEach(x => x.classList.toggle('active', x.dataset.calc === curCalc));
    renderCalcInputs();
    computeCalc();
  } catch (e) { /* 草稿读取失败按默认值 */ }
})();
