// ============================================================
// 設定・ラベルの読み込み
// ============================================================
let CFG = {};
let LANG = {};

async function loadConfig() {
  const res = await fetch('config/settings.json');
  CFG = await res.json();
}

async function loadLang() {
  const browserLang = navigator.language.slice(0, 2);
  const langCode = browserLang === 'ja' ? 'ja' : 'en';
  document.documentElement.lang = langCode;
  const res = await fetch(`i18n/${langCode}.json`);
  LANG = await res.json();
}

function applyLabels() {
  document.getElementById('title-heading').textContent = LANG.title;
  document.getElementById('title-subtitle').textContent = LANG.subtitle;
  document.getElementById('start-btn').textContent = LANG.startButton;
  document.getElementById('game-heading').textContent = LANG.title;
  document.getElementById('finish-btn').textContent = LANG.finishButton;
  document.getElementById('result-heading').textContent = LANG.resultHeader;
  document.getElementById('retry-btn').textContent = LANG.retryButton;
  document.title = LANG.title;

  // スライダーラベル
  const sliderKeys = ['earHeight', 'earWidth', 'earGap', 'tailHeight', 'tailCurl', 'feetAmp', 'feetFreq', 'feetPhase', 'bodyHeight'];
  for (const key of sliderKeys) {
    document.getElementById(`label-${key}`).textContent = LANG.sliders[key];
  }
}

function applySliderRanges() {
  const hidden = CFG.hiddenSliders || [];
  for (const [key, range] of Object.entries(CFG.sliders)) {
    const el = document.getElementById(`sl-${key}`);
    el.min = range.min;
    el.max = range.max;
    el.step = range.step;
    // 非表示スライダーはDOM要素ごと隠す
    if (hidden.includes(key)) {
      el.closest('.slider-group').style.display = 'none';
    }
  }
}

// ============================================================
// 正解の画像（手描きイラスト）
// ============================================================
const headImg = new Image();
const tailImg = new Image();
const eyeImg = new Image();
let imagesLoaded = false;

let catPath = null;

function loadImages() {
  return new Promise((resolve) => {
    let loaded = 0;
    const onLoad = () => { if (++loaded === 3) resolve(); };
    headImg.src = 'img/head.png';
    tailImg.src = 'img/tail.png';
    eyeImg.src = 'img/eye.png';
    headImg.onload = onLoad;
    tailImg.onload = onLoad;
    eyeImg.onload = onLoad;
  });
}

// ============================================================
// 静的パスの読み込みとスプライン補間
// ============================================================
async function loadCatPath() {
  const res = await fetch('config/cat-path.json');
  catPath = await res.json();
}

function getScaledTanY(points, i) {
  const p = points[i];
  if (p.tx !== undefined && p.ty !== undefined) return p.ty;
  const prev = points[Math.max(0, i - 1)];
  const next = points[Math.min(points.length - 1, i + 1)];
  return (next.y - prev.y) / 2;
}

function splineY(points, xRatio) {
  if (!points || points.length < 2) return null;
  if (xRatio <= points[0].x) return points[0].y;
  if (xRatio >= points[points.length - 1].x) return points[points.length - 1].y;
  let seg = 0;
  for (let i = 0; i < points.length - 1; i++) {
    if (xRatio >= points[i].x && xRatio <= points[i + 1].x) { seg = i; break; }
  }
  const p0 = points[seg], p1 = points[seg + 1];
  const segLen = p1.x - p0.x;
  if (segLen === 0) return p0.y;
  const t = (xRatio - p0.x) / segLen;
  const tanY0 = getScaledTanY(points, seg);
  const tanY1 = getScaledTanY(points, seg + 1);
  const t2 = t * t, t3 = t2 * t;
  return (2*t3 - 3*t2 + 1) * p0.y + (t3 - 2*t2 + t) * tanY0
       + (-2*t3 + 3*t2) * p1.y + (t3 - t2) * tanY1;
}


// プレイヤーパラメータ
const player = {};

function resetPlayer() {
  Object.assign(player, CFG.playerDefaults);
  // 非表示スライダーは正解値で固定
  for (const key of (CFG.hiddenSliders || [])) {
    player[key] = CFG.answerParams[key];
  }
}

// 端点付近でスライダーdeltaをフェードアウト（始点・終点を固定）
function endpointFade(xRatio, points) {
  const startX = points[0].x;
  const endX = points[points.length - 1].x;
  const margin = 0.01;
  const fadeIn = Math.min(1, Math.max(0, (xRatio - startX) / margin));
  const fadeOut = Math.min(1, Math.max(0, (endX - xRatio) / margin));
  return Math.min(fadeIn, fadeOut);
}

// ============================================================
// 上の線のy座標を計算
// ============================================================
function getTopY(xRatio, params, W, H) {
  if (!catPath) return CFG.cat.noseY * H;
  const answer = CFG.answerParams;
  const base = splineY(catPath.topLine, xRatio) * H;
  const deltaEars = getEarContribution(xRatio, params, W) - getEarContribution(xRatio, answer, W);
  const deltaTail = getTailContribution(xRatio, params) - getTailContribution(xRatio, answer, W, H);
  const deltaBody = params.bodyHeight - answer.bodyHeight;
  const fade = endpointFade(xRatio, catPath.topLine);
  return base - (deltaEars + deltaTail) * fade - deltaBody;
}

// ============================================================
// 下の線のy座標を計算
// ============================================================
function getBottomY(xRatio, params, W, H) {
  if (!catPath) return CFG.cat.noseY * H;
  const answer = CFG.answerParams;
  const base = splineY(catPath.bottomLine, xRatio) * H;
  const deltaFeet = getFeetContribution(xRatio, params) - getFeetContribution(xRatio, answer, W, H);
  const deltaBody = params.bodyHeight - answer.bodyHeight;
  const fade = endpointFade(xRatio, catPath.bottomLine);
  return base + deltaFeet * fade - deltaBody;
}

// ============================================================
// 手書き風ノイズ
// ============================================================
// sin-hash → -1〜1 の擬似乱数（同じ入力には同じ値）
function hash11(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// 滑らかな補間ノイズ（value noise）
function smoothNoise(x, scale) {
  const sx = x / scale;
  const i = Math.floor(sx);
  const f = sx - i;
  const t = f * f * (3 - 2 * f); // smoothstep
  return hash11(i) * (1 - t) + hash11(i + 1) * t;
}

function handDrawnNoise(px, lineId) {
  const seed = lineId * 10000;
  // 長波長のゆるい揺れ + 短波長の細かいざらつき
  return smoothNoise(px + seed, 80) * 2.0
       + smoothNoise(px + seed, 30) * 1.5
       + smoothNoise(px + seed, 10) * 1.1;
}

// ============================================================
// 手書き風の線を描画（y方向うねり + 線幅ばらつき）
// ============================================================
function drawNoisyLine(ctx, linePoints, W, getY, lineId, baseLineWidth) {
  const step = 5;
  const startPx = Math.floor(linePoints[0].x * W);
  const endPx = Math.ceil(linePoints[linePoints.length - 1].x * W);

  // ポイントを間引きで生成（y方向うねり付き）
  const pts = [];
  for (let px = startPx; px <= endPx; px += step) {
    const xr = px / W;
    const fade = endpointFade(xr, linePoints);
    const y = getY(xr) + handDrawnNoise(px, lineId) * fade;
    const w = baseLineWidth + handDrawnNoise(px, lineId + 5) * fade * 1.1;
    pts.push({ x: px, y, w });
  }
  if (pts[pts.length - 1].x !== endPx) {
    const xr = endPx / W;
    const fade = endpointFade(xr, linePoints);
    const y = getY(xr) + handDrawnNoise(endPx, lineId) * fade;
    const w = baseLineWidth + handDrawnNoise(endPx, lineId + 2) * fade * 2.0;
    pts.push({ x: endPx, y, w });
  }

  // セグメントごとに線幅を変えて描画
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(10, (pts[i].w + pts[i + 1].w) / 2);
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    ctx.stroke();
  }
}

// ============================================================
// ねこを描画
// ============================================================
function drawCat(ctx, params, color, lineWidth, alpha, logicalW, logicalH) {
  if (!catPath) return;
  const W = logicalW ?? ctx.canvas.width;
  const H = logicalH ?? ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;

  // 上の線
  drawNoisyLine(ctx, catPath.topLine, W, (xr) => getTopY(xr, params, W, H), 0, lineWidth);

  // 下の線
  drawNoisyLine(ctx, catPath.bottomLine, W, (xr) => getBottomY(xr, params, W, H), 1, lineWidth);

  // 目（eye.png を head.png と同じ領域に重ねて描画）
  if (imagesLoaded) {
    ctx.drawImage(eyeImg, 0, 0, W / 2, H);
  }

  ctx.restore();
}

// ============================================================
// 正解画像の描画
// ============================================================
function drawTargetImage(ctx, alpha, logicalW, logicalH) {
  if (!imagesLoaded) return;
  const W = logicalW ?? ctx.canvas.width;
  const H = logicalH ?? ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(headImg, 0, 0, W / 2, H);
  ctx.drawImage(tailImg, W / 2, 0, W / 2, H);
  ctx.restore();
}


// ============================================================
// ベースラインLUT（元画像から固定パスを抽出）
// ============================================================
function getEarContribution(xRatio, params, W) {
  const CAT = CFG.cat;
  const Z = catPath.zones.ear;
  const ear1X = (CAT.earCenterX - params.earGap / W) * W;
  const ear2X = (CAT.earCenterX + params.earGap / W) * W;
  const x = xRatio * W;
  const ear1 = params.earHeight * Math.exp(-((x - ear1X) ** 2) / (2 * params.earWidth ** 2));
  const ear2 = params.earHeight * Math.exp(-((x - ear2X) ** 2) / (2 * params.earWidth ** 2));
  const span = CAT.tailX - CAT.noseX;
  const t = (xRatio - CAT.noseX) / span;
  const earStartT = (Z.startX - CAT.noseX) / span;
  const earEndT = (Z.endX - CAT.noseX) / span;
  const fadeWidth = catPath.fadeWidth;
  const envLeft = Math.min(1, Math.max(0, (t - earStartT) / fadeWidth));
  const envRight = Math.min(1, Math.max(0, (earEndT - t) / fadeWidth));
  return (ear1 + ear2) * envLeft * envRight;
}

function getTailContribution(xRatio, params) {
  const CAT = CFG.cat;
  const t = (xRatio - CAT.noseX) / (CAT.tailX - CAT.noseX);
  if (t < 0 || t > 1) return 0;
  const tailStart = (catPath.zones.tail.startX - CAT.noseX) / (CAT.tailX - CAT.noseX);
  const tailT = Math.max(0, (t - tailStart) / (1 - tailStart));
  const curvedT = Math.pow(tailT, params.tailCurl);
  const smoothTail = curvedT * curvedT * (3 - 2 * curvedT);
  return params.tailHeight * smoothTail;
}


function getFeetContribution(xRatio, params) {
  const CAT = CFG.cat;
  const Z = catPath.zones.feet;
  const fw = catPath.fadeWidth;
  const span = CAT.tailX - CAT.noseX;
  const t = (xRatio - CAT.noseX) / span;
  if (t < 0 || t > 1) return 0;
  const feetStartT = (Z.startX - CAT.noseX) / span - fw;
  const feetEndT = (Z.endX - CAT.noseX) / span + fw;
  const feetEnvLeft = Math.min(1, Math.max(0, (t - feetStartT) / fw));
  const feetEnvRight = Math.min(1, Math.max(0, (feetEndT - t) / fw));
  const feetEnv = feetEnvLeft * feetEnvRight;
  const wave = params.feetAmp * Math.sin(params.feetFreq * Math.PI * 2 * t + params.feetPhase);
  return feetEnv * wave;
}


// ============================================================
// 数式表示
// ============================================================
function buildFormulaDisplay() {
  const el = document.getElementById('formula-display');
  const S = LANG.sliders;
  const L = LANG.formulaLabels;
  const hidden = CFG.hiddenSliders || [];

  // 非表示スライダーに関連する数式行を除外
  const formulaKeyMap = {
    ear:    ['earHeight', 'earGap', 'earWidth'],
    tail:   ['tailHeight', 'tailCurl'],
    feet:   ['feetAmp', 'feetFreq', 'feetPhase'],
    offset: ['bodyHeight'],
  };

  // 非表示パラメータはアイコンの代わりに固定値を表示
  const v = (key) => hidden.includes(key) ? CFG.answerParams[key] : S[key];

  const allFormulas = [
    { id: 'ear',    label: L.ear,    text: `${v('earHeight')}·exp(−(x−${v('earGap')})²/(2·${v('earWidth')}²)) + ${v('earHeight')}·exp(−(x+${v('earGap')})²/(2·${v('earWidth')}²))` },
    { id: 'tail',   label: L.tail,   text: `${v('tailHeight')}·t^${v('tailCurl')}²(3 − 2t^${v('tailCurl')})` },
    { id: 'feet',   label: L.feet,   text: `${v('feetAmp')}·sin(${v('feetFreq')}·2π·t + ${v('feetPhase')})` },
    { id: 'offset', label: L.offset, text: `y += ${v('bodyHeight')}` },
  ];

  // 数式行の全パラメータが非表示なら行ごと除外
  const formulas = allFormulas.filter(f => {
    const keys = formulaKeyMap[f.id];
    return !keys.every(k => hidden.includes(k));
  });

  el.innerHTML = formulas.map(f =>
    `<div class="formula-row"><span class="formula-label">${f.label}:</span>${f.text}</div>`
  ).join('');
}

// ============================================================
// ゲーム状態
// ============================================================
let gameState = 'title';
let timeLeft = 0;
let timerInterval = null;

// ============================================================
// スライダー ↔ プレイヤーパラメータの同期
// ============================================================
const sliderKeys = ['earHeight', 'earWidth', 'earGap', 'tailHeight', 'tailCurl', 'feetAmp', 'feetFreq', 'feetPhase', 'bodyHeight'];

function syncSlidersFromPlayer() {
  for (const key of sliderKeys) {
    document.getElementById(`sl-${key}`).value = player[key];
  }
}

function syncPlayerFromSliders() {
  for (const key of sliderKeys) {
    player[key] = parseFloat(document.getElementById(`sl-${key}`).value);
  }
}

function setupSliderEvents() {
  for (const key of sliderKeys) {
    document.getElementById(`sl-${key}`).addEventListener('input', () => {
      syncPlayerFromSliders();
      if (gameState === 'playing') renderGame();
    });
  }
}

// ============================================================
// 描画
// ============================================================
function renderGame() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid(ctx, canvas.width, canvas.height);
  drawTargetImage(ctx, CFG.drawing.targetAlphaGame);
  drawCat(ctx, player, CFG.drawing.playerColor, CFG.drawing.playerLineWidth, 1.0);
}

function renderTitle() {
  const canvas = document.getElementById('title-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTargetImage(ctx, CFG.drawing.targetAlphaTitle);
}

function renderResult() {
  const canvas = document.getElementById('result-canvas');
  const ctx = canvas.getContext('2d');
  const W = CFG.canvas.width;
  const H = CFG.canvas.height;

  // プレイヤー波形のy範囲を事前サンプリング
  let yMin = 0, yMax = H;
  if (catPath) {
    const lines = [
      { path: catPath.topLine,    getY: (xr) => getTopY(xr, player, W, H) },
      { path: catPath.bottomLine, getY: (xr) => getBottomY(xr, player, W, H) },
    ];
    for (const line of lines) {
      const startPx = Math.floor(line.path[0].x * W);
      const endPx   = Math.ceil(line.path[line.path.length - 1].x * W);
      for (let px = startPx; px <= endPx; px += 4) {
        const y = line.getY(px / W);
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  const margin = 16;
  const padTop    = Math.ceil(Math.max(0, -yMin) + margin);
  const padBottom = Math.ceil(Math.max(0, yMax - H) + margin);

  canvas.width  = W;
  canvas.height = H + padTop + padBottom;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(0, padTop);
  drawTargetImage(ctx, CFG.drawing.targetAlphaResult, W, H);
  drawCat(ctx, player, CFG.drawing.playerColor, CFG.drawing.playerLineWidth, 1.0, W, H);
  ctx.restore();
}

function drawGrid(ctx, W, H) {
  const spacing = CFG.drawing.gridSpacing;
  ctx.save();
  ctx.strokeStyle = CFG.drawing.gridColor;
  ctx.lineWidth = CFG.drawing.gridLineWidth;
  for (let x = 0; x <= W; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}

// ============================================================
// スコア計算
// ============================================================
function calculateScore() {
  if (!catPath) return 0;

  const W = CFG.canvas.width;
  const H = CFG.canvas.height;
  const SC = CFG.scoring;
  let totalError = 0;
  let count = 0;

  // 上下の線それぞれ全範囲で採点
  // （endpointFadeによりスライダー効果がない区間は自動的に誤差0）
  const lines = [
    { path: catPath.topLine,    getY: (xr) => getTopY(xr, player, W, H) },
    { path: catPath.bottomLine, getY: (xr) => getBottomY(xr, player, W, H) },
  ];

  for (const line of lines) {
    const startPx = Math.floor(line.path[0].x * W);
    const endPx = Math.ceil(line.path[line.path.length - 1].x * W);

    for (let px = startPx; px <= endPx; px += SC.sampleStep) {
      const xr = px / W;
      const playerY = line.getY(xr);
      const refY = splineY(line.path, xr) * H;
      totalError += (refY - playerY) ** 2;
      count++;
    }
  }

  if (count === 0) return 0;
  const rmse = Math.sqrt(totalError / count);
  return Math.max(0, Math.round(SC.maxScore * Math.max(0, 1 - rmse / SC.maxRmse)));
}

function getScoreComment(score) {
  for (const entry of LANG.scoreComments) {
    if (score >= entry.min) return entry.text;
  }
  return '';
}

// ============================================================
// 画面遷移
// ============================================================
function showScreen(name) {
  document.getElementById('title-screen').style.display = name === 'title' ? 'block' : 'none';
  document.getElementById('game-screen').style.display = name === 'game' ? 'block' : 'none';
  document.getElementById('result-screen').style.display = name === 'result' ? 'block' : 'none';
}

function startGame() {
  gameState = 'playing';
  timeLeft = CFG.timer.duration;

  resetPlayer();
  syncSlidersFromPlayer();
  showScreen('game');
  buildFormulaDisplay();
  renderGame();
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    timeLeft -= CFG.timer.intervalMs / 1000;
    if (timeLeft <= 0) {
      timeLeft = 0;
      finishGame();
    }
    updateTimerDisplay();
  }, CFG.timer.intervalMs);
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  el.textContent = LANG.timerFormat.replace('{time}', timeLeft.toFixed(1));
  el.classList.toggle('warning', timeLeft <= CFG.timer.warningThreshold);
}

function finishGame() {
  if (gameState !== 'playing') return;
  gameState = 'result';
  clearInterval(timerInterval);

  const score = calculateScore();
  document.getElementById('score-value').innerHTML = `${score}<span>${LANG.scoreUnit}</span>`;
  document.getElementById('score-comment').textContent = getScoreComment(score);

  showScreen('result');
  renderResult();
}

function backToTitle() {
  gameState = 'title';
  showScreen('title');
  renderTitle();
}

// ============================================================
// 初期化
// ============================================================
async function init() {
  await Promise.all([loadConfig(), loadLang(), loadImages(), loadCatPath()]);
  imagesLoaded = true;

  applyLabels();
  applySliderRanges();
  setupSliderEvents();
  showScreen('title');
  renderTitle();
}

// デバッグ用: answerParamsのフィッティング
// ブラウザコンソールから debugFit() で起動
// debugSetAnswer({earHeight: 90, earGap: 30, ...}) でパラメータ変更
window.debugFit = function () {
  const canvas = document.getElementById('game-canvas') || document.getElementById('title-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // 元画像を描画
  drawTargetImage(ctx, 0.3);

  // 現在のanswerParamsで曲線を描画（赤）
  drawCat(ctx, CFG.answerParams, 'red', 2, 0.8);

  console.log('現在の answerParams:', JSON.stringify(CFG.answerParams));
  console.log('debugSetAnswer({key: value, ...}) でパラメータを変更してください');
};

window.debugSetAnswer = function (overrides) {
  Object.assign(CFG.answerParams, overrides);
  window.debugFit();
};

init();
