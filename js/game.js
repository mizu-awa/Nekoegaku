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

let refTopY = null;
let refBottomY = null;
let refTopBaseline = null;
let refBottomBaseline = null;

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

// プレイヤーパラメータ
const player = {};

function resetPlayer() {
  Object.assign(player, CFG.playerDefaults);
}

// ============================================================
// 上の線のy座標を計算
// ============================================================
function getTopY(xRatio, params, W, H) {
  const CAT = CFG.cat;
  const t = (xRatio - CAT.noseX) / (CAT.tailX - CAT.noseX);
  if (t < 0 || t > 1) return CAT.noseY * H;

  // LUTベースライン（元画像から抽出した固定パス）
  const baseline = interpolateBaseline(refTopBaseline, xRatio);
  if (baseline !== null) {
    const ears = getEarContribution(xRatio, params, W);
    const tail = getTailContribution(xRatio, params, W, H);
    return baseline - ears - tail;
  }

  // フォールバック: 数式ベースライン
  const backY = CAT.backY * H;
  const noseY = CAT.noseY * H;
  const faceT = Math.max(0, 1 - t * CFG.topLine.faceDecayRate);
  const faceY = faceT * (noseY - backY);

  const ears = getEarContribution(xRatio, params, W);
  const tail = getTailContribution(xRatio, params, W, H);

  return backY + faceY - ears - tail;
}

// ============================================================
// 下の線のy座標を計算
// ============================================================
function getBottomY(xRatio, params, W, H) {
  const CAT = CFG.cat;
  const BL = CFG.bottomLine;
  const t = (xRatio - CAT.noseX) / (CAT.tailX - CAT.noseX);
  if (t < 0 || t > 1) return CAT.noseY * H;

  // LUTベースライン（元画像から抽出した固定パス）
  const baseline = interpolateBaseline(refBottomBaseline, xRatio);
  if (baseline !== null) {
    const feet = getFeetContribution(xRatio, params, W, H);
    return baseline + feet;
  }

  // フォールバック: 数式ベースライン
  const noseY = CAT.noseY * H;
  const backY = CAT.backY * H;
  const bottomBaseY = CAT.bottomY * H;

  const buttT = (CAT.buttX - CAT.noseX) / (CAT.tailX - CAT.noseX);

  let baseY;
  if (t < BL.faceEndT) {
    baseY = noseY + (bottomBaseY - noseY) * (t / BL.faceEndT);
  } else {
    baseY = bottomBaseY;
  }

  if (t > BL.buttRiseStart && t <= buttT) {
    const bt = (t - BL.buttRiseStart) / (buttT - BL.buttRiseStart);
    const smooth = bt * bt * (3 - 2 * bt);
    baseY = bottomBaseY + (backY - bottomBaseY) * smooth;
  } else if (t > buttT) {
    baseY = backY;
  }

  const feet = getFeetContribution(xRatio, params, W, H);
  return baseY + feet;
}

// ============================================================
// ねこを描画
// ============================================================
function drawCat(ctx, params, color, lineWidth, alpha) {
  const CAT = CFG.cat;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 上の線
  ctx.beginPath();
  for (let px = Math.floor(CAT.noseX * W); px <= Math.ceil(CAT.tailX * W); px++) {
    const xr = px / W;
    const y = getTopY(xr, params, W, H);
    if (px === Math.floor(CAT.noseX * W)) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // 下の線 + しっぽの下辺
  ctx.beginPath();
  for (let px = Math.floor(CAT.noseX * W); px <= Math.ceil(CAT.buttX * W); px++) {
    const xr = px / W;
    const y = getBottomY(xr, params, W, H);
    if (px === Math.floor(CAT.noseX * W)) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  // buttX → tailX: しっぽの先端に向かって滑らかに上昇
  {
    const buttPx = Math.round(CAT.buttX * W);
    const tailPx = Math.ceil(CAT.tailX * W);
    const startY = getBottomY(CAT.buttX, params, W, H);
    const endY = getTopY(CAT.tailX, params, W, H);
    for (let px = buttPx + 1; px <= tailPx; px++) {
      const progress = (px - buttPx) / (tailPx - buttPx);
      const smooth = progress * progress * (3 - 2 * progress);
      const y = startY + (endY - startY) * smooth;
      ctx.lineTo(px, y);
    }
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
// 画像から輪郭を抽出（スコア計算用）
// ============================================================
function extractContours() {
  const W = CFG.canvas.width;
  const H = CFG.canvas.height;
  const CAT = CFG.cat;
  const SC = CFG.scoring;

  const offscreen = document.createElement('canvas');
  offscreen.width = W;
  offscreen.height = H;
  const octx = offscreen.getContext('2d');
  drawTargetImage(octx, 1.0);

  const imageData = octx.getImageData(0, 0, W, H);
  const pixels = imageData.data;

  const startPx = Math.floor(CAT.noseX * W);
  const endPx = Math.ceil(CAT.tailX * W);
  const sampleCount = Math.floor((endPx - startPx) / SC.sampleStep) + 1;

  refTopY = new Float64Array(sampleCount);
  refBottomY = new Float64Array(sampleCount);

  let idx = 0;
  for (let px = startPx; px <= endPx; px += SC.sampleStep) {
    let topFound = -1;
    let bottomFound = -1;

    for (let y = 0; y < H; y++) {
      if (pixels[(y * W + px) * 4 + 3] > SC.alphaThreshold) {
        topFound = y;
        break;
      }
    }

    for (let y = H - 1; y >= 0; y--) {
      if (pixels[(y * W + px) * 4 + 3] > SC.alphaThreshold) {
        bottomFound = y;
        break;
      }
    }

    if (topFound === -1) topFound = idx > 0 ? refTopY[idx - 1] : CAT.backY * H;
    if (bottomFound === -1) bottomFound = idx > 0 ? refBottomY[idx - 1] : CAT.bottomY * H;

    refTopY[idx] = topFound;
    refBottomY[idx] = bottomFound;
    idx++;
  }

  smoothContour(refTopY, SC.smoothingRadius);
  smoothContour(refBottomY, SC.smoothingRadius);
}

function smoothContour(arr, radius) {
  const copy = new Float64Array(arr);
  for (let i = radius; i < arr.length - radius; i++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += copy[i + j];
    arr[i] = sum / (radius * 2 + 1);
  }
}

// ============================================================
// ベースラインLUT（元画像から固定パスを抽出）
// ============================================================
function getEarContribution(xRatio, params, W) {
  const CAT = CFG.cat;
  const ear1X = (CAT.earCenterX - params.earGap / W) * W;
  const ear2X = (CAT.earCenterX + params.earGap / W) * W;
  const x = xRatio * W;
  const ear1 = params.earHeight * Math.exp(-((x - ear1X) ** 2) / (2 * params.earWidth ** 2));
  const ear2 = params.earHeight * Math.exp(-((x - ear2X) ** 2) / (2 * params.earWidth ** 2));
  return ear1 + ear2;
}

function getTailContribution(xRatio, params, W, H) {
  const CAT = CFG.cat;
  const t = (xRatio - CAT.noseX) / (CAT.tailX - CAT.noseX);
  if (t < 0 || t > 1) return 0;
  const tailStart = CFG.topLine.tailStart;
  const tailT = Math.max(0, (t - tailStart) / (1 - tailStart));
  const smoothTail = tailT * tailT * (3 - 2 * tailT);
  return params.tailHeight * smoothTail;
}

function getFeetContribution(xRatio, params, W, H) {
  const CAT = CFG.cat;
  const BL = CFG.bottomLine;
  const t = (xRatio - CAT.noseX) / (CAT.tailX - CAT.noseX);
  if (t < 0 || t > 1) return 0;
  const feetEnvLeft = Math.min(1, Math.max(0, (t - BL.feetStartT) / BL.feetFadeWidth));
  const feetEnvRight = Math.min(1, Math.max(0, (BL.feetEndT - t) / BL.feetFadeWidth));
  const feetEnv = feetEnvLeft * feetEnvRight;
  const wave = params.feetAmp * Math.sin(params.feetFreq * Math.PI * 2 * t + params.feetPhase);
  return feetEnv * wave;
}

function buildBaselineLUT() {
  if (!refTopY || !refBottomY) return;

  const W = CFG.canvas.width;
  const H = CFG.canvas.height;
  const CAT = CFG.cat;
  const SC = CFG.scoring;
  const answer = CFG.answerParams;

  const startPx = Math.floor(CAT.noseX * W);
  const endPx = Math.ceil(CAT.tailX * W);
  const sampleCount = Math.floor((endPx - startPx) / SC.sampleStep) + 1;

  refTopBaseline = new Float64Array(sampleCount);
  refBottomBaseline = new Float64Array(sampleCount);

  let idx = 0;
  for (let px = startPx; px <= endPx; px += SC.sampleStep) {
    const xr = px / W;
    // 上線: baseline = refTopY + ears + tail (可変部分を足し戻す)
    refTopBaseline[idx] = refTopY[idx]
      + getEarContribution(xr, answer, W)
      + getTailContribution(xr, answer, W, H);
    // 下線: baseline = refBottomY - feet (可変部分を引き戻す)
    refBottomBaseline[idx] = refBottomY[idx]
      - getFeetContribution(xr, answer, W, H);
    idx++;
  }
}

function interpolateBaseline(lut, xRatio) {
  if (!lut) return null;
  const W = CFG.canvas.width;
  const startPx = Math.floor(CFG.cat.noseX * W);
  const px = xRatio * W;
  const idx = (px - startPx) / CFG.scoring.sampleStep;
  const i0 = Math.max(0, Math.floor(idx));
  const i1 = Math.min(i0 + 1, lut.length - 1);
  const frac = idx - Math.floor(idx);
  return lut[i0] * (1 - frac) + lut[i1] * frac;
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
  if (!refTopY || !refBottomY) return 0;

  const W = CFG.canvas.width;
  const H = CFG.canvas.height;
  const CAT = CFG.cat;
  const SC = CFG.scoring;
  let totalError = 0;
  let count = 0;

  const startPx = Math.floor(CAT.noseX * W);
  const endPx = Math.ceil(CAT.tailX * W);

  let idx = 0;
  for (let px = startPx; px <= endPx; px += SC.sampleStep) {
    const xr = px / W;
    const pTop = getTopY(xr, player, W, H);
    const pBot = getBottomY(xr, player, W, H);

    const tTop = refTopY[idx];
    const tBot = refBottomY[idx];
    idx++;

    totalError += (tTop - pTop) ** 2;
    totalError += (tBot - pBot) ** 2;
    count += 2;
  }

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
  await Promise.all([loadConfig(), loadLang(), loadImages()]);
  imagesLoaded = true;

  // 初期パラメータ設定
  Object.assign(player, CFG.playerInitial);

  applyLabels();
  applySliderRanges();
  setupSliderEvents();
  extractContours();
  buildBaselineLUT();
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
  buildBaselineLUT();
  window.debugFit();
};

// 自動フィッティング: answerParamsを最適化
window.autoFit = function () {
  if (!refTopY || !refBottomY) { console.error('extractContours未実行'); return; }

  const W = CFG.canvas.width;
  const H = CFG.canvas.height;
  const CAT = CFG.cat;
  const SC = CFG.scoring;
  const startPx = Math.floor(CAT.noseX * W);
  const endPx = Math.ceil(CAT.tailX * W);

  // 現在の数式ベースラインとの誤差を計算
  function calcError(params) {
    let err = 0;
    let count = 0;
    let idx = 0;
    for (let px = startPx; px <= endPx; px += SC.sampleStep) {
      const xr = px / W;
      const t = (xr - CAT.noseX) / (CAT.tailX - CAT.noseX);
      if (t < 0 || t > 1) { idx++; continue; }

      // 上線: refTopY = baseline - ears - tail を期待
      const ears = getEarContribution(xr, params, W);
      const tail = getTailContribution(xr, params, W, H);
      const feet = getFeetContribution(xr, params, W, H);

      // 上線の誤差（LUTなしの直接比較）
      // getTopY(数式) = backY + faceY - ears - tail
      // 理想: refTopY[idx] = getTopY(answerParams)
      // ここでは数式ベースラインは使わず、refTopYとの差を最小化
      const backY_val = CAT.backY * H;
      const noseY_val = CAT.noseY * H;
      const faceT = Math.max(0, 1 - t * CFG.topLine.faceDecayRate);
      const faceY = faceT * (noseY_val - backY_val);
      const mathTop = backY_val + faceY - ears - tail;

      // ※自動フィッティングではLUTを使わず、直接refTopYとparamsでの曲線を比較
      // refTopY = 画像の正解 → paramsでの曲線がこれに近いほど良い
      err += (refTopY[idx] - mathTop) ** 2;

      // 下線
      const BL = CFG.bottomLine;
      const buttT = (CAT.buttX - CAT.noseX) / (CAT.tailX - CAT.noseX);
      let baseY;
      if (t < BL.faceEndT) {
        baseY = noseY_val + (CAT.bottomY * H - noseY_val) * (t / BL.faceEndT);
      } else {
        baseY = CAT.bottomY * H;
      }
      if (t > BL.buttRiseStart && t <= buttT) {
        const bt = (t - BL.buttRiseStart) / (buttT - BL.buttRiseStart);
        const smooth = bt * bt * (3 - 2 * bt);
        baseY = CAT.bottomY * H + (backY_val - CAT.bottomY * H) * smooth;
      } else if (t > buttT) {
        baseY = backY_val;
      }
      const mathBot = baseY + feet;
      err += (refBottomY[idx] - mathBot) ** 2;

      count += 2;
      idx++;
    }
    return Math.sqrt(err / count);
  }

  // グリッドサーチ + 局所最適化
  let best = { ...CFG.answerParams };
  let bestErr = calcError(best);
  console.log('初期誤差:', bestErr.toFixed(2));

  // 各パラメータの探索範囲
  const ranges = {
    earHeight: [30, 150, 5],
    earGap:    [5, 60, 3],
    earWidth:  [8, 50, 3],
    tailHeight:[20, 150, 5],
    feetAmp:   [10, 70, 3],
    feetFreq:  [2.0, 8.0, 0.2],
    feetPhase: [-3.14, 3.14, 0.15]
  };

  // 3ラウンドの反復最適化
  for (let round = 0; round < 3; round++) {
    for (const [key, [min, max, step]] of Object.entries(ranges)) {
      let localBest = best[key];
      let localBestErr = bestErr;
      const s = step / (round + 1); // ラウンドごとにステップを細かく
      for (let v = min; v <= max; v += s) {
        const trial = { ...best, [key]: v };
        const e = calcError(trial);
        if (e < localBestErr) {
          localBestErr = e;
          localBest = v;
        }
      }
      best[key] = localBest;
      bestErr = localBestErr;
    }
    console.log(`ラウンド${round + 1} 誤差: ${bestErr.toFixed(2)}`);
  }

  // 小数点を丸める
  for (const key of Object.keys(ranges)) {
    best[key] = Math.round(best[key] * 100) / 100;
  }

  console.log('最適化結果 answerParams:', JSON.stringify(best, null, 2));
  console.log('最終誤差:', calcError(best).toFixed(2));
  console.log('適用するには: debugSetAnswer(' + JSON.stringify(best) + ')');
  return best;
};

init();
