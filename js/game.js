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
  const sliderKeys = ['earHeight', 'earGap', 'earWidth', 'tailHeight', 'feetAmp', 'feetFreq', 'feetPhase'];
  for (const key of sliderKeys) {
    document.getElementById(`label-${key}`).textContent = LANG.sliders[key];
  }
}

function applySliderRanges() {
  for (const [key, range] of Object.entries(CFG.sliders)) {
    const el = document.getElementById(`sl-${key}`);
    el.min = range.min;
    el.max = range.max;
    el.step = range.step;
  }
}

// ============================================================
// 正解の画像（手描きイラスト）
// ============================================================
const headImg = new Image();
const tailImg = new Image();
let imagesLoaded = false;

let catPath = null;

function loadImages() {
  return new Promise((resolve) => {
    let loaded = 0;
    const onLoad = () => { if (++loaded === 2) resolve(); };
    headImg.src = 'img/head.png';
    tailImg.src = 'img/tail.png';
    headImg.onload = onLoad;
    tailImg.onload = onLoad;
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
}

// ============================================================
// 上の線のy座標を計算
// ============================================================
function getTopY(xRatio, params, W, H) {
  if (!catPath) return CFG.cat.noseY * H;
  const answer = CFG.answerParams;
  const base = splineY(catPath.topLine, xRatio) * H;
  const deltaEars = getEarContribution(xRatio, params, W) - getEarContribution(xRatio, answer, W);
  const deltaTail = getTailContribution(xRatio, params, W, H) - getTailContribution(xRatio, answer, W, H);
  return base - deltaEars - deltaTail;
}

// ============================================================
// 下の線のy座標を計算
// ============================================================
function getBottomY(xRatio, params, W, H) {
  if (!catPath) return CFG.cat.noseY * H;
  const answer = CFG.answerParams;
  const base = splineY(catPath.bottomLine, xRatio) * H;
  const deltaFeet = getFeetContribution(xRatio, params, W, H) - getFeetContribution(xRatio, answer, W, H);
  return base + deltaFeet;
}

// ============================================================
// ねこを描画
// ============================================================
function drawCat(ctx, params, color, lineWidth, alpha) {
  const CAT = CFG.cat;
  const SB = CFG.strokeBounds;
  const SC = CFG.strokeColors;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const SJ = CFG.strokeJunctions;

  // ストローク1: 顔（earZoneStartX → faceBottomEndX を3次ベジェ曲線1本で描画）
  ctx.strokeStyle = SC.face;
  ctx.beginPath();
  {
    const x0 = SB.earZoneStartX * W;
    const y0 = SJ.earZoneStart_topY * H;
    const x3 = SB.faceBottomEndX * W;
    const y3 = SJ.faceBottomEnd_bottomY * H;
    const cp1x = x0 - 52;
    const cp1y = y0 + 40;
    const cp2x = x3 - 110;
    const cp2y = y3 - 10;
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
  }
  ctx.stroke();

  // ストローク2: 耳（earZoneStartX～earZoneEndX の上の線を1ストロークで描画）
  ctx.strokeStyle = SC.ears;
  ctx.beginPath();
  for (let px = Math.floor(SB.earZoneStartX * W); px <= Math.ceil(SB.earZoneEndX * W); px++) {
    const xr = px / W;
    let y;
    if (px === Math.floor(SB.earZoneStartX * W))  y = SJ.earZoneStart_topY * H;
    else if (px === Math.ceil(SB.earZoneEndX * W)) y = SJ.earZoneEnd_topY * H;
    else                                            y = getTopY(xr, params, W, H);
    if (px === Math.floor(SB.earZoneStartX * W)) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // ストローク3: 背中
  ctx.strokeStyle = SC.back;
  ctx.beginPath();
  {
    const x0 = SB.earZoneEndX * W;
    const y0 = SJ.earZoneEnd_topY * H;
    const x1 = SB.tailTopStartX * W;
    const y1 = SJ.tailTopStart_topY * H;
    const cpx = (x0 + x1) / 2;
    const cpy = Math.min(y0, y1) - 5;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cpx, cpy, x1, y1);
  }
  ctx.stroke();

  // ストローク4: しっぽ（上の線 → 先端 → 下の線）
  ctx.strokeStyle = SC.tail;
  ctx.beginPath();
  for (let px = Math.floor(SB.tailTopStartX * W); px <= Math.ceil(SB.tailEndX * W); px++) {
    const xr = px / W;
    let y;
    if (px === Math.floor(SB.tailTopStartX * W))  y = SJ.tailTopStart_topY * H;
    else if (px === Math.ceil(SB.tailEndX * W))    y = SJ.tailTipY * H;
    else                                            y = getTopY(xr, params, W, H);
    if (px === Math.floor(SB.tailTopStartX * W)) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // ストローク5: お尻
  ctx.strokeStyle = SC.butt;
  ctx.beginPath();
  {
    // 下の線: tailEnd → feetEnd
    const x0 = SB.tailEndX * W;
    const y0 = SJ.tailTipY * H;
    const x1 = SB.feetEndX * W;
    const y1 = getBottomY(SB.feetEndX, params, W, H);
    const cpx = (x0 + x1) / 2 - 5;
    const cpy = Math.min(y0, y1) + 10;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cpx, cpy, x1, y1);
  }
  ctx.stroke();

  // ストローク6: 足
  ctx.strokeStyle = SC.feet;
  ctx.beginPath();
  for (let px = Math.floor(SB.feetStartX * W); px <= Math.ceil(SB.feetEndX * W); px++) {
    const xr = px / W;
    let y;
    y = getBottomY(xr, params, W, H);
    if (px === Math.floor(SB.feetStartX * W)) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // ストローク7: 足と顔をつなぐライン
  ctx.strokeStyle = SC.connector;
  ctx.beginPath();
  {
    const x0 = SB.faceBottomEndX * W;
    const y0 = SJ.faceBottomEnd_bottomY * H;
    const x1 = SB.feetStartX * W;
    const y1 = getBottomY(SB.feetStartX, params, W, H);
    const cpx = (x0 + x1) / 2;
    const cpy = Math.max(y0, y1) - 10;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cpx, cpy, x1, y1);
  }
  ctx.stroke();

  // 目
  ctx.fillStyle = color;
  const eyeW = W * CFG.drawing.eyeWidthRatio;
  const eyeH = H * CFG.drawing.eyeHeightRatio;
  const eyeY = CAT.eyeY * H;

  ctx.beginPath();
  ctx.ellipse(CAT.eye1X * W, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(CAT.eye2X * W, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ============================================================
// 正解画像の描画
// ============================================================
function drawTargetImage(ctx, alpha) {
  if (!imagesLoaded) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
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
  const SB = CFG.strokeBounds;
  const ear1X = (CAT.earCenterX - params.earGap / W) * W;
  const ear2X = (CAT.earCenterX + params.earGap / W) * W;
  const x = xRatio * W;
  const ear1 = params.earHeight * Math.exp(-((x - ear1X) ** 2) / (2 * params.earWidth ** 2));
  const ear2 = params.earHeight * Math.exp(-((x - ear2X) ** 2) / (2 * params.earWidth ** 2));
  const span = CAT.tailX - CAT.noseX;
  const t = (xRatio - CAT.noseX) / span;
  const earStartT = (SB.earZoneStartX - CAT.noseX) / span;
  const earEndT = (SB.earZoneEndX - CAT.noseX) / span;
  const fadeWidth = CFG.bottomLine.fadeWidth;
  const envLeft = Math.min(1, Math.max(0, (t - earStartT) / fadeWidth));
  const envRight = Math.min(1, Math.max(0, (earEndT - t) / fadeWidth));
  return (ear1 + ear2) * envLeft * envRight;
}

function getTailContribution(xRatio, params, W, H) {
  const CAT = CFG.cat;
  const t = (xRatio - CAT.noseX) / (CAT.tailX - CAT.noseX);
  if (t < 0 || t > 1) return 0;
  const tailStart = (CFG.strokeBounds.tailTopStartX - CAT.noseX) / (CAT.tailX - CAT.noseX);
  const tailT = Math.max(0, (t - tailStart) / (1 - tailStart));
  const smoothTail = tailT * tailT * (3 - 2 * tailT);
  return params.tailHeight * smoothTail;
}


function getFeetContribution(xRatio, params, W, H) {
  const CAT = CFG.cat;
  const BL = CFG.bottomLine;
  const SB = CFG.strokeBounds;
  const span = CAT.tailX - CAT.noseX;
  const t = (xRatio - CAT.noseX) / span;
  if (t < 0 || t > 1) return 0;
  const feetStartT = (SB.feetStartX - CAT.noseX) / span - BL.fadeWidth;
  const feetEndT = (SB.feetEndX - CAT.noseX) / span + BL.fadeWidth;
  const feetEnvLeft = Math.min(1, Math.max(0, (t - feetStartT) / BL.fadeWidth));
  const feetEnvRight = Math.min(1, Math.max(0, (feetEndT - t) / BL.fadeWidth));
  const feetEnv = feetEnvLeft * feetEnvRight;
  const wave = params.feetAmp * Math.sin(params.feetFreq * Math.PI * 2 * t + params.feetPhase);
  return feetEnv * wave;
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
const sliderKeys = ['earHeight', 'earGap', 'earWidth', 'tailHeight', 'feetAmp', 'feetFreq', 'feetPhase'];

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
  drawJunctionPoints(ctx, canvas.width, canvas.height);
}

function drawJunctionPoints(ctx, W, H) {
  const SB = CFG.strokeBounds;
  const SJ = CFG.strokeJunctions;
  const CAT = CFG.cat;
  const R = 4;
  const points = [
    { x: SB.earZoneStartX,   y: SJ.earZoneStart_topY,      label: 'earZoneStart_top' },
    { x: SB.earZoneEndX,     y: SJ.earZoneEnd_topY,         label: 'earZoneEnd_top' },
    { x: SB.tailTopStartX,   y: SJ.tailTopStart_topY,       label: 'tailTopStart_top' },
    { x: SB.tailEndX,        y: SJ.tailTipY,            label: 'tailTip' },
    { x: CAT.noseX,          y: SJ.noseY,               label: 'nose' },
    { x: SB.faceBottomEndX,  y: SJ.faceBottomEnd_bottomY,   label: 'faceBottomEnd_bottom' },
    { x: SB.feetStartX,      y: SJ.feetStart_bottomY,       label: 'feetStart_bottom' },
    { x: SB.feetEndX,        y: SJ.feetEnd_bottomY,         label: 'feetEnd_bottom' },
  ];
  ctx.save();
  ctx.font = '10px monospace';
  for (const p of points) {
    const px = p.x * W;
    const py = p.y * H;
    ctx.fillStyle = 'rgba(255, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.arc(px, py, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 0, 0, 0.85)';
    ctx.fillText(p.label, px + R + 2, py + 4);
  }
  ctx.restore();
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height);
  drawTargetImage(ctx, CFG.drawing.targetAlphaResult);
  drawCat(ctx, player, CFG.drawing.playerColor, CFG.drawing.playerLineWidth, 1.0);
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
  const SB = CFG.strokeBounds;
  const SC = CFG.scoring;
  let totalError = 0;
  let count = 0;

  // スライダー影響がある3ストロークの範囲（端点を除いた中間ピクセルのみ）
  const scoredStrokes = [
    // 耳（上の線）: earZoneStartX ～ earZoneEndX
    { startX: SB.earZoneStartX, endX: SB.earZoneEndX, getY: (xr) => getTopY(xr, player, W, H), refY: (xr) => splineY(catPath.topLine, xr) * H },
    // しっぽ（上の線）: tailTopStartX ～ tailEndX
    { startX: SB.tailTopStartX, endX: SB.tailEndX, getY: (xr) => getTopY(xr, player, W, H), refY: (xr) => splineY(catPath.topLine, xr) * H },
    // 足（下の線）: feetStartX ～ feetEndX
    { startX: SB.feetStartX, endX: SB.feetEndX, getY: (xr) => getBottomY(xr, player, W, H), refY: (xr) => splineY(catPath.bottomLine, xr) * H },
  ];

  for (const stroke of scoredStrokes) {
    const sPx = Math.floor(stroke.startX * W);
    const ePx = Math.ceil(stroke.endX * W);

    for (let px = sPx; px <= ePx; px += SC.sampleStep) {
      if (px <= sPx || px >= ePx) continue;

      const xr = px / W;
      const playerY = stroke.getY(xr);
      const refY = stroke.refY(xr);

      totalError += (refY - playerY) ** 2;
      count++;
    }
  }

  if (count === 0) return 0;
  const rmse = Math.sqrt(totalError / count);
  const score = Math.max(0, Math.round(SC.maxScore * Math.max(0, 1 - rmse / SC.maxRmse)));
  return score;
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
  // TODO: 開発中は直接ゲーム画面へ（あとで戻す）
  // showScreen('title');
  // renderTitle();
  startGame();
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
