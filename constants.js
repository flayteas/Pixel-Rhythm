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
    const blob = await resp.blob();
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
  const b64 = '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';
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  perfectSndRaw = buf;
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
