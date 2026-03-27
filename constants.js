// constants.js — Global state & initialization

// ============ ERROR HANDLING ============
window.onerror = function(msg, url, line) {
  console.error(`[PixelRhythm] ${msg} at ${line}`);
  return false;
};
const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log('[PR]', ...args); }

// ============ GLOBALS & DIFFICULTY ============
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
let W, H, dpr;
let audioCtx = null, analyser = null, sourceNode = null, audioBuffer = null, audioStartTime = 0;
let beats = [];
let notes = [];
let notesLeft = [];  // angle-bucketed: dir===0 (angle=PI)
let notesRight = []; // angle-bucketed: dir===1 (angle=0)
let nearestLeftTipDist = Infinity;
let nearestRightTipDist = Infinity;
let particles = [];
let feedbacks = [];
let ripples = [];   // touch ripple effects
let score = 0, combo = 0, maxComboVal = 0;
let perfects = 0, goods = 0, hits = 0, misses = 0;
let gameRunning = false, gameEnded = false, gamePaused = false;
let countdownActive = false, countdownEnd = 0;
let charImg = new Image();
let charLoaded = false;
let charX, charY, charW, charH;
let charBounce = 0;

// Difficulty settings
const DIFF_PRESETS = {
  easy:   { densityMult: 1.4, judgeMult: 1.4, speedMult: 1.0, dualThreshMult: 1.2, dualInjectRate: 0.04, label: 'Easy' },
  normal: { densityMult: 1.7, judgeMult: 1.0, speedMult: 1.0, dualThreshMult: 1.4, dualInjectRate: 0.06, label: 'Normal' },
  hard:   { densityMult: 2.3, judgeMult: 0.65, speedMult: 1.0, dualThreshMult: 1.75, dualInjectRate: 0.12, label: 'Hard' },
  expert: { densityMult: 3.2, judgeMult: 0.45, speedMult: 1.15, dualThreshMult: 2.25, dualInjectRate: 0.20, label: 'Expert' }
};

// Special note limits per difficulty — base values per minute of song duration
// Actual limits = base × ceil(duration / 60), so longer songs get proportionally more
const SPECIAL_LIMITS_BASE = {
  easy:   { maxHolds: 5,  maxDuals: 3 },
  normal: { maxHolds: 10, maxDuals: 6 },
  hard:   { maxHolds: 15, maxDuals: 10 },
  expert: { maxHolds: 20, maxDuals: 15 }
};
function getSpecialLimits(diff, durationSec) {
  const base = SPECIAL_LIMITS_BASE[diff] || SPECIAL_LIMITS_BASE.normal;
  const minutes = Math.max(1, Math.ceil((durationSec || 180) / 60));
  return {
    maxHolds: base.maxHolds * minutes,
    maxDuals: base.maxDuals * minutes
  };
}
let currentDiff = 'normal';
// Legacy time windows kept for chart save/load compatibility
let PERFECT_WINDOW = 45, GOOD_WINDOW = 90, HIT_WINDOW = 150;
let NOTE_TRAVEL_TIME = 2.8;
let DUAL_HOLD_THRESHOLD = 0.12; // seconds (120ms) — dual-press detection window (base)
let dualEffectEnabled = true;
let baseTravelTime = 2.8;

const JUDGE_DIST_BASE = 55;
let JUDGE_DIST = 40;
const ARC_DEG = 60;

// ============ SPATIAL JUDGMENT (tip-based) ============
// Note image draw size = note.size * 2 = 44px; half = 22px
const NOTE_DRAW_SIZE = 44;
const NOTE_HALF_SIZE = NOTE_DRAW_SIZE / 2;
// Tip-based judgment: grade by distance (px) of spoon tip to judgment arc
// Perfect = tip within ±perfectPx, Good = ±goodPx, Hit = ±hitPx
const TIP_JUDGE_PRESETS = {
  easy:   { perfectPx: 18, goodPx: 30, hitPx: 42 },
  normal: { perfectPx: 13, goodPx: 24, hitPx: 36 },
  hard:   { perfectPx: 9,  goodPx: 18, hitPx: 28 },
  expert: { perfectPx: 7,  goodPx: 14, hitPx: 22 }
};
let tipJudge = TIP_JUDGE_PRESETS.normal;

function applyDifficulty() {
  const d = DIFF_PRESETS[currentDiff];
  PERFECT_WINDOW = Math.round(45 * d.judgeMult);
  GOOD_WINDOW = Math.round(90 * d.judgeMult);
  HIT_WINDOW = Math.round(150 * d.judgeMult);
  NOTE_TRAVEL_TIME = baseTravelTime / d.speedMult;
  tipJudge = TIP_JUDGE_PRESETS[currentDiff] || TIP_JUDGE_PRESETS.normal;
  console.log(`[PR] Difficulty: ${currentDiff} | Perfect:±${tipJudge.perfectPx}px Good:±${tipJudge.goodPx}px Hit:±${tipJudge.hitPx}px TT:${NOTE_TRAVEL_TIME.toFixed(2)}s`);
}

// ============ PERFORMANCE CACHES ============
let bgCache = null;
let spoonCache = {};
let starsCache = null;
let starsDirty = true;
let starsTimer = 0;
let frameCount = 0;

// ============ IMAGE LOADING ============
charImg.onload = () => { charLoaded = true; };
charImg.src = 'character.png';

// Note images (left/right)
let noteImgL = new Image(), noteImgR = new Image();
let noteImgLLoaded = false, noteImgRLoaded = false;
noteImgL.onload = () => { noteImgLLoaded = true; };
noteImgR.onload = () => { noteImgRLoaded = true; };
noteImgL.src = 'left.png';
noteImgR.src = 'right.png';

// Background images
let bgImg1 = new Image(), bgImg2 = new Image();
let bgImg1Loaded = false, bgImg2Loaded = false;
bgImg1.onload = () => { bgImg1Loaded = true; bgCache = null; };
bgImg2.onload = () => { bgImg2Loaded = true; bgCache2 = null; };
bgImg1.src = 'background01.jpg';
bgImg2.src = 'background02.jpg';

// Background transition state
let bgPhase = 1;            // 1 = bg1 active, 2 = bg2 active
let bgTransiting = false;
let bgTransStart = 0;
let bgTransDir = 0;         // 1 = going to bg2, -1 = going back to bg1
const BG_TRANS_DUR = 0.6;   // seconds (short dim transition)

// ============ RESIZE & CACHE BUILDERS ============
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Mobile landscape: scale up character to use more screen real estate
  const isLandscapeMobile = H < 450 && W > H;
  const charScale = isLandscapeMobile ? 0.45 : 0.35;
  const maxChar = isLandscapeMobile ? 140 : 160;
  charW = Math.min(W * charScale, maxChar);
  charH = charW * 1.05;
  charX = W / 2;
  charY = isLandscapeMobile ? H * 0.48 : H * 0.45;
  JUDGE_DIST = charW / 2 + JUDGE_DIST_BASE;
  bgCache = null;
  bgCache2 = null;
  spoonCache = {};
  starsCache = null;
  starsDirty = true;
}
function getBgCache() {
  if (bgCache) return bgCache;
  const c = document.createElement('canvas');
  c.width = W * dpr; c.height = H * dpr;
  const bctx = c.getContext('2d');
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Draw gradient as base
  const bg = bctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0f0c29');
  bg.addColorStop(0.5, '#302b63');
  bg.addColorStop(1, '#24243e');
  bctx.fillStyle = bg;
  bctx.fillRect(0, 0, W, H);
  // Draw bg image if loaded, cover-fit with person aligned to charX/charY
  const img = bgImg1Loaded ? bgImg1 : null;
  if (img) drawBgImageCover(bctx, img, W, H);
  bgCache = c;
  return bgCache;
}
// Cache for bg2
let bgCache2 = null;
function getBgCache2() {
  if (bgCache2) return bgCache2;
  if (!bgImg2Loaded) return null;
  const c = document.createElement('canvas');
  c.width = W * dpr; c.height = H * dpr;
  const bctx = c.getContext('2d');
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = bctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0f0c29');
  bg.addColorStop(0.5, '#302b63');
  bg.addColorStop(1, '#24243e');
  bctx.fillStyle = bg;
  bctx.fillRect(0, 0, W, H);
  drawBgImageCover(bctx, bgImg2, W, H);
  bgCache2 = c;
  return bgCache2;
}
// Draw background image with cover-fit, aligning the image center person (~50% x, ~42% y) to charX/charY
function drawBgImageCover(bctx, img, cw, ch) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  // Cover scale
  const scale = Math.max(cw / iw, ch / ih);
  const sw = iw * scale, sh = ih * scale;
  // Image person is at roughly center-x, ~48% from top in the photo
  // Use a higher anchor to shift the image upward so photo person overlaps with charY
  const imgPersonX = 0.50, imgPersonY = 0.55;
  // Offset so image person aligns with charX/charY
  let dx = charX - sw * imgPersonX;
  let dy = charY - sh * imgPersonY;
  // Clamp so we don't show blank edges
  dx = Math.min(0, Math.max(cw - sw, dx));
  dy = Math.min(0, Math.max(ch - sh, dy));
  bctx.drawImage(img, dx, dy, sw, sh);
  // Slight dark overlay for readability
  bctx.fillStyle = 'rgba(15,12,41,0.35)';
  bctx.fillRect(0, 0, cw, ch);
}
function getSpoonSprite(color, size) {
  const key = color + '|' + size;
  if (spoonCache[key]) return spoonCache[key];
  const p = Math.max(2, Math.round(size / 10));
  const totalRows = SPOON_BOWL.length + SPOON_HANDLE.length;
  const maxCols = 7;
  const cw = maxCols * p + 2;
  const ch = totalRows * p + 2;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const sctx = c.getContext('2d');
  sctx.fillStyle = color;
  const ox = Math.floor(cw / 2);
  for (let r = 0; r < SPOON_BOWL.length; r++) {
    const [l, rr] = SPOON_BOWL[r];
    for (let col = l; col <= rr; col++) sctx.fillRect(ox + col * p, r * p, p, p);
  }
  const hy = SPOON_BOWL.length * p;
  for (let r = 0; r < SPOON_HANDLE.length; r++) {
    const [l, rr] = SPOON_HANDLE[r];
    for (let col = l; col <= rr; col++) sctx.fillRect(ox + col * p, hy + r * p, p, p);
  }
  spoonCache[key] = { canvas: c, ox, oy: Math.floor(ch / 2) };
  return spoonCache[key];
}
window.addEventListener('resize', resize);
resize();


// ============ AUDIO UPLOAD & PRESET ============
const audioInput = document.getElementById('audioInput');
const startBtn = document.getElementById('startBtn');
const fileNameEl = document.getElementById('fileName');
const presetSelect = document.getElementById('presetSelect');
const presetStatus = document.getElementById('presetStatus');
const loadChartBtn = document.getElementById('loadChartBtn');
let audioFile = null;
let audioFileName = '';

presetSelect.addEventListener('change', async () => {
  const url = presetSelect.value;
  if (!url) return;
  const songName = presetSelect.options[presetSelect.selectedIndex].text;
  presetSelect.disabled = true;
  presetStatus.textContent = '正在加载「' + songName + '」...';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const contentLength = resp.headers.get('Content-Length');
    let blob;
    if (contentLength && resp.body) {
      // Stream download with progress
      const total = parseInt(contentLength, 10);
      const reader = resp.body.getReader();
      let received = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const pct = Math.min(99, Math.round(received / total * 100));
        const sizeMB = (received / 1048576).toFixed(1);
        const totalMB = (total / 1048576).toFixed(1);
        presetStatus.textContent = '正在加载「' + songName + '」... ' + pct + '% (' + sizeMB + '/' + totalMB + 'MB)';
      }
      blob = new Blob(chunks);
    } else {
      // Fallback: no Content-Length
      blob = await resp.blob();
    }
    const mimeType = url.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg';
    audioFile = new File([blob], url, { type: mimeType });
    audioFileName = url;
    fileNameEl.textContent = '';
    presetStatus.textContent = '「' + songName + '」已加载';
    startBtn.disabled = false;
    presetSelect.disabled = false;
    checkSavedChart();
    preAnalyzeAudio();
  } catch (err) {
    presetStatus.textContent = '加载失败，请尝试本地上传';
    presetSelect.disabled = false;
    startBtn.disabled = true;
    audioFile = null;
    console.error('Preset fetch error:', err);
  }
});

audioInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  audioFile = file;
  audioFileName = file.name;
  fileNameEl.textContent = file.name;
  presetStatus.textContent = '';
  startBtn.disabled = false;
  checkSavedChart();
  preAnalyzeAudio();
});

function createAudioContext() {
  try {
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  } catch(e) {}
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
}

async function decodeAudio(file) {
  const buf = await file.arrayBuffer();
  return audioCtx.decodeAudioData(buf);
}


let preAnalyzing = false;

let updateWorkerProgress = null;

async function preAnalyzeAudio() {
  if (!audioFile || preAnalyzing) return;
  preAnalyzing = true;
  presetStatus.textContent = (presetStatus.textContent || '') + ' (分析中...)';
  updateWorkerProgress = function(pct, label) {
    presetStatus.textContent = presetStatus.textContent.replace(/ \(分析中.*?\)/, '') + ` (分析中 ${pct}% ${label})`;
  };
  try {
    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrBuf = await audioFile.arrayBuffer();
    const blob = new Blob([arrBuf], { type: audioFile.type });
    audioFile = new File([blob], audioFile.name, { type: audioFile.type });
    audioBuffer = await tmpCtx.decodeAudioData(arrBuf);
    tmpCtx.close().catch(() => {});
    applyDifficulty();
    const pcmData = audioBuffer.getChannelData(0).slice();
    const workerResult = await runWorkerDetection(pcmData, audioBuffer.sampleRate, audioBuffer.duration, 'detect');
    let quantized = workerResult.beats;
    beats = quantized.map(b => {
      if (b.type === 'hold') return { type: 'hold', startTime: b.startTime + noteOffsetMs/1000, endTime: b.endTime + noteOffsetMs/1000, dir: b.dir, color: b.color, _mergedCount: b._mergedCount || 2, _spawned: false };
      return { type: 'tap', time: b.time + noteOffsetMs/1000, dir: b.dir, color: b.color, _spawned: false };
    });
    if (workerResult._sections) beats._sections = workerResult._sections;
    if (workerResult._swingInfo) beats._swingInfo = workerResult._swingInfo;
    detectDualNotes(beats, DUAL_HOLD_THRESHOLD * (DIFF_PRESETS[currentDiff] || DIFF_PRESETS.normal).dualThreshMult);
    injectDualNotes(beats, currentDiff);
    enforceSpecialNoteLimits(beats, currentDiff, audioBuffer ? audioBuffer.duration : 180);
    if (audioFileName) saveChart(audioFileName, quantized);
    presetStatus.textContent = presetStatus.textContent.replace(/ \(分析中.*?\)/, '') + ' (谱面已就绪)';
    const dp = document.getElementById('debugPanel');
    if (dp && dp.classList.contains('open')) {
      if (typeof updateDebugStatsExt === 'function') updateDebugStatsExt();
      if (typeof renderWaveformExt === 'function') renderWaveformExt();
    }
  } catch(e) {
    console.warn('Pre-analyze failed:', e);
    presetStatus.textContent = presetStatus.textContent.replace(/ \(分析中.*?\)/, '');
  }
  preAnalyzing = false;
  updateWorkerProgress = null;
}

// ============ BPM QUANTIZATION (post-process, mostly redundant now but kept for loaded charts) ============
function quantizeNotes(notes, offset) {
  // Notes from detectBeats are already grid-snapped; this handles loaded/legacy charts
  if (notes.length < 4) return notes;
  const gaps = [];
  for (let i = 1; i < notes.length; i++) gaps.push(notes[i].time - notes[i - 1].time);
  gaps.sort((a, b) => a - b);
  const medGap = gaps[Math.floor(gaps.length / 2)];
  const gridSize = medGap / 2;
  if (gridSize < 0.05 || gridSize > 2) return notes;
  console.log(`[PR] Quantize: BPM ~${(60 / medGap).toFixed(1)}, grid ${(gridSize * 1000).toFixed(0)}ms`);
  return notes.map(n => {
    const t = n.time + (offset || 0);
    const quantized = Math.round(t / gridSize) * gridSize;
    return { ...n, time: Math.max(0.1, quantized) };
  });
}


// ============ CHART SAVE / LOAD (localStorage) ============
const CHART_STORAGE_KEY = 'pixelRhythm_charts';

function getSavedCharts() {
  try {
    return JSON.parse(localStorage.getItem(CHART_STORAGE_KEY) || '{}');
  } catch(e) { return {}; }
}

function chartKey(name) {
  let key = name;
  if (enableHold) key += '|hold';
  if (mirrorMode) key += '|mirror';
  return key;
}

function saveChart(name, chartData, bpm) {
  try {
    const charts = getSavedCharts();
    charts[chartKey(name)] = {
      notes: chartData.map(n => {
        if (n.type === 'hold') return { type: 'hold', st: +n.startTime.toFixed(3), et: +n.endTime.toFixed(3), d: n.dir, c: n.color, mc: n._mergedCount || 2 };
        return { t: +(n.time).toFixed(3), d: n.dir, c: n.color };
      }),
      bpm: bpm || 0,
      date: new Date().toISOString().slice(0, 10),
      diff: currentDiff
    };
    localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(charts));
    dbg('Chart saved:', name, chartData.length, 'notes');
  } catch(e) { console.warn('Chart save failed:', e); }
}

function loadChart(name) {
  const charts = getSavedCharts();
  const key = chartKey(name);
  if (!charts[key]) return null;
  const c = charts[key];
  return c.notes.map(n => {
    if (n.type === 'hold') return { type: 'hold', startTime: n.st, endTime: n.et, dir: n.d, color: n.c || '#48dbfb', _mergedCount: n.mc || 2 };
    return { type: 'tap', time: n.t, dir: n.d, color: n.c || '#48dbfb' };
  });
}

function checkSavedChart() {
  if (!audioFileName) return;
  const charts = getSavedCharts();
  const btn = document.getElementById('loadChartBtn');
  const key = chartKey(audioFileName);
  if (charts[key]) {
    btn.style.display = 'inline-block';
    btn.textContent = '加载已有谱面 (' + charts[key].date + ')';
  } else {
    btn.style.display = 'none';
  }
}
let useLoadedChart = false;
loadChartBtn.addEventListener('click', () => {
  useLoadedChart = true;
  loadChartBtn.style.display = 'none';
  presetStatus.textContent = '将使用保存的谱面';
});

// Note offset slider (delay adjustment)
let noteOffsetMs = -60;
const offsetSlider = document.getElementById('offsetSlider');
const offsetValEl = document.getElementById('offsetVal');
offsetSlider.addEventListener('input', () => {
  noteOffsetMs = parseInt(offsetSlider.value, 10);
  const sign = noteOffsetMs > 0 ? '+' : '';
  offsetValEl.textContent = sign + noteOffsetMs + 'ms';
});

// Speed slider
const speedSlider = document.getElementById('speedSlider');
const speedValEl = document.getElementById('speedVal');
speedSlider.addEventListener('input', () => {
  baseTravelTime = parseFloat(speedSlider.value);
  speedValEl.textContent = baseTravelTime.toFixed(2) + 's';
  applyDifficulty();
});

// Guide dots toggle
let showGuideDots = false;
let mirrorMode = false;
const guideDotsCheckbox = document.getElementById('guideDots');
guideDotsCheckbox.addEventListener('change', () => {
  showGuideDots = guideDotsCheckbox.checked;
});

// Leniency window (time-based fallback for near-misses)
let leniencyMs = 150;
const leniencySlider = document.getElementById('leniencySlider');
const leniencyValEl = document.getElementById('leniencyVal');
leniencySlider.addEventListener('input', () => {
  leniencyMs = parseInt(leniencySlider.value, 10);
  leniencyValEl.textContent = leniencyMs + 'ms';
});

// Hold note settings
let enableHold = true;
let mergeThreshMs = 350;
let holdMinDuration = 400; // ms, hold notes shorter than this revert to taps
const enableHoldCb = document.getElementById('enableHold');
const mergeThreshSlider = document.getElementById('mergeThreshSlider');
const mergeThreshValEl = document.getElementById('mergeThreshVal');
enableHoldCb.addEventListener('change', () => { enableHold = enableHoldCb.checked; beats = null; checkSavedChart(); });
let holdTailJudge = true;
const holdTailJudgeCb = document.getElementById('holdTailJudge');
holdTailJudgeCb.addEventListener('change', () => { holdTailJudge = holdTailJudgeCb.checked; });
mergeThreshSlider.addEventListener('input', () => {
  mergeThreshMs = parseInt(mergeThreshSlider.value, 10);
  mergeThreshValEl.textContent = mergeThreshMs + 'ms';
});
const holdMinSlider = document.getElementById('holdMinSlider');
const holdMinValEl = document.getElementById('holdMinVal');
holdMinSlider.addEventListener('input', () => {
  holdMinDuration = parseInt(holdMinSlider.value, 10);
  holdMinValEl.textContent = holdMinDuration + 'ms';
});

// Dual-press settings
const dualEffectCb = document.getElementById('dualEffect');
dualEffectCb.addEventListener('change', () => { dualEffectEnabled = dualEffectCb.checked; });

// ============ LOCAL SETTINGS PERSISTENCE (localStorage) ============
const SETTINGS_STORAGE_KEY = 'pixelRhythm_settings';

function saveSettings() {
  try {
    const settings = {
      difficulty: currentDiff,
      speed: baseTravelTime,
      noteOffset: noteOffsetMs,
      mirror: mirrorMode,
      guideDots: showGuideDots,
      leniency: leniencyMs,
      enableHold: enableHold,
      holdTailJudge: holdTailJudge,
      mergeThresh: mergeThreshMs,
      holdMinDuration: holdMinDuration,
      dualEffect: dualEffectEnabled,
      hitVolume: Math.round(hitVolume * 100),
      perfectVolume: Math.round(perfectVolume * 100)
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch(e) { console.warn('Settings save failed:', e); }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);

    // Difficulty
    if (s.difficulty && DIFF_PRESETS[s.difficulty]) {
      currentDiff = s.difficulty;
      document.getElementById('diffSelect').value = currentDiff;
    }
    // Speed
    if (typeof s.speed === 'number' && s.speed >= 1.0 && s.speed <= 5.0) {
      baseTravelTime = s.speed;
      document.getElementById('speedSlider').value = baseTravelTime;
      document.getElementById('speedVal').textContent = baseTravelTime.toFixed(2) + 's';
    }
    // Note offset
    if (typeof s.noteOffset === 'number' && s.noteOffset >= -100 && s.noteOffset <= 100) {
      noteOffsetMs = s.noteOffset;
      document.getElementById('offsetSlider').value = noteOffsetMs;
      const sign = noteOffsetMs > 0 ? '+' : '';
      document.getElementById('offsetVal').textContent = sign + noteOffsetMs + 'ms';
    }
    // Mirror
    if (typeof s.mirror === 'boolean') {
      mirrorMode = s.mirror;
      document.getElementById('mirrorCheck').checked = mirrorMode;
    }
    // Guide dots
    if (typeof s.guideDots === 'boolean') {
      showGuideDots = s.guideDots;
      document.getElementById('guideDots').checked = showGuideDots;
    }
    // Leniency
    if (typeof s.leniency === 'number' && s.leniency >= 0 && s.leniency <= 150) {
      leniencyMs = s.leniency;
      document.getElementById('leniencySlider').value = leniencyMs;
      document.getElementById('leniencyVal').textContent = leniencyMs + 'ms';
    }
    // Enable hold
    if (typeof s.enableHold === 'boolean') {
      enableHold = s.enableHold;
      document.getElementById('enableHold').checked = enableHold;
    }
    // Hold tail judge
    if (typeof s.holdTailJudge === 'boolean') {
      holdTailJudge = s.holdTailJudge;
      document.getElementById('holdTailJudge').checked = holdTailJudge;
    }
    // Merge threshold
    if (typeof s.mergeThresh === 'number' && s.mergeThresh >= 100 && s.mergeThresh <= 400) {
      mergeThreshMs = s.mergeThresh;
      document.getElementById('mergeThreshSlider').value = mergeThreshMs;
      document.getElementById('mergeThreshVal').textContent = mergeThreshMs + 'ms';
    }
    // Hold min duration
    if (typeof s.holdMinDuration === 'number' && s.holdMinDuration >= 200 && s.holdMinDuration <= 800) {
      holdMinDuration = s.holdMinDuration;
      document.getElementById('holdMinSlider').value = holdMinDuration;
      document.getElementById('holdMinVal').textContent = holdMinDuration + 'ms';
    }
    // Dual effect
    if (typeof s.dualEffect === 'boolean') {
      dualEffectEnabled = s.dualEffect;
      document.getElementById('dualEffect').checked = dualEffectEnabled;
    }
    // Hit volume
    if (typeof s.hitVolume === 'number' && s.hitVolume >= 0 && s.hitVolume <= 100) {
      hitVolume = s.hitVolume / 100;
      document.getElementById('hitVolSlider').value = s.hitVolume;
      document.getElementById('hitVolVal').textContent = s.hitVolume + '%';
    }
    // Perfect volume
    if (typeof s.perfectVolume === 'number' && s.perfectVolume >= 0 && s.perfectVolume <= 100) {
      perfectVolume = s.perfectVolume / 100;
      document.getElementById('perfectVolSlider').value = s.perfectVolume;
      document.getElementById('perfectVolVal').textContent = s.perfectVolume + '%';
    }

    applyDifficulty();
    console.log('[PR] Settings loaded from localStorage');
  } catch(e) { console.warn('Settings load failed:', e); }
}

// Hook saveSettings into all setting change events
(function hookSettingsSave() {
  const events = [
    ['diffSelect', 'change'],
    ['speedSlider', 'input'],
    ['offsetSlider', 'input'],
    ['mirrorCheck', 'change'],
    ['guideDots', 'change'],
    ['leniencySlider', 'input'],
    ['enableHold', 'change'],
    ['holdTailJudge', 'change'],
    ['mergeThreshSlider', 'input'],
    ['holdMinSlider', 'input'],
    ['dualEffect', 'change'],
    ['hitVolSlider', 'input'],
    ['perfectVolSlider', 'input']
  ];
  for (const [id, evt] of events) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, saveSettings);
  }
})();

// Hold note touch tracking
const holdTouchMap = new Map(); // touchId → HoldNote

// Hit sound effect
let hitSndBuffer = null;
let hitSndRaw = null;
let hitVolume = 0.5;
const hitVolSlider = document.getElementById('hitVolSlider');
const hitVolValEl = document.getElementById('hitVolVal');
hitVolSlider.addEventListener('input', () => {
  hitVolume = parseInt(hitVolSlider.value, 10) / 100;
  hitVolValEl.textContent = hitVolSlider.value + '%';
});
// Pre-fetch hit sound raw data
(function loadHitSound() {
  const req = new XMLHttpRequest();
  req.open('GET', 'hit1.wav', true);
  req.responseType = 'arraybuffer';
  req.onload = () => { hitSndRaw = req.response; };
  req.send();
})();
// Decode into game audioCtx (call after createAudioContext)
async function decodeHitSound() {
  if (!hitSndRaw || !audioCtx) return;
  try {
    hitSndBuffer = await audioCtx.decodeAudioData(hitSndRaw.slice(0));
  } catch(e) {}
}
let lastHitSoundTime = 0;
function playHitSound() {
  if (!hitSndBuffer || !audioCtx || hitVolume <= 0) return;
  const now = performance.now();
  if (now - lastHitSoundTime < 30) return;
  lastHitSoundTime = now;
  try {
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    src.buffer = hitSndBuffer;
    gain.gain.value = hitVolume;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start(0);
  } catch(e) {}
}
// Perfect hit sound effect (Star Burst)
let perfectSndBuffer = null;
let perfectSndRaw = null;
let perfectVolume = 0.6;
const perfectVolSlider = document.getElementById('perfectVolSlider');
const perfectVolValEl = document.getElementById('perfectVolVal');
perfectVolSlider.addEventListener('input', () => {
  perfectVolume = parseInt(perfectVolSlider.value, 10) / 100;
  perfectVolValEl.textContent = perfectVolSlider.value + '%';
});


// Load saved settings from localStorage (must be after all UI elements & variables are initialized)
loadSettings();

// Decode embedded base64 WAV
(function loadPerfectSound() {
  fetch('perfect_ding.wav')
    .then(r => r.arrayBuffer())
    .then(buf => { perfectSndRaw = buf; })
    .catch(e => console.warn('Perfect sound load failed:', e));
})();
async function decodePerfectSound() {
  if (!perfectSndRaw || !audioCtx) return;
  try {
    perfectSndBuffer = await audioCtx.decodeAudioData(perfectSndRaw.slice(0));
  } catch(e) { console.warn('Perfect sound decode failed:', e); }
}
let lastPerfectSoundTime = 0;
function playPerfectSound() {
  if (!perfectSndBuffer || !audioCtx || perfectVolume <= 0) return;
  const now = performance.now();
  if (now - lastPerfectSoundTime < 30) return;
  lastPerfectSoundTime = now;
  try {
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    src.buffer = perfectSndBuffer;
    gain.gain.value = perfectVolume;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start(0);
  } catch(e) {}
}



// ============ SPOON SHAPE & DRAWING ============
const SPOON_BOWL = [[-1,1],[-2,2],[-3,3],[-3,3],[-3,3],[-2,2],[-1,1]];
const SPOON_HANDLE = [[-1,1],[-1,1],[-1,1],[0,0],[0,0],[0,0],[0,0]];
function drawSinanSpoon(cx, cy, size, angle, color, alpha) {
  const sprite = getSpoonSprite(color, size);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite.canvas, -sprite.ox, -sprite.oy);
  ctx.restore();
}
