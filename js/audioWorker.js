// audioWorker.js - Web Worker for beat detection & note pipeline
// Runs all CPU-intensive audio analysis off the main thread.

'use strict';

// ============ MESSAGE HANDLER ============
self.onmessage = function(e) {
  const msg = e.data;
  if (msg.type === 'detect') {
    runDetection(msg);
  } else if (msg.type === 'detectWithParams') {
    runDetectionWithParams(msg);
  }
};

function progress(pct, label) {
  self.postMessage({ type: 'progress', pct, label });
}

// ============ MAIN DETECTION (preAnalyzeAudio / startGame) ============
function runDetection(msg) {
  try {
    const { pcmData, sampleRate, duration, diffPresets, currentDiff, enableHold, mergeThreshMs, holdMinDuration, mirrorMode } = msg;
    const d = diffPresets[currentDiff];
    const detected = detectBeats(pcmData, sampleRate, duration, d.densityMult);
    const _sections = detected._sections;
    const _swingInfo = detected._swingInfo;

    progress(95, '后处理管线...');
    const result = runPipeline(detected, { enableHold, mergeThreshMs, holdMinDuration, mirrorMode });

    progress(100, '完成');
    self.postMessage({ type: 'result', beats: result, _sections, _swingInfo });
  } catch(e) {
    self.postMessage({ type: 'error', message: e.message });
  }
}

// ============ DEBUG DETECTION (detectBeatsWithParams) ============
function runDetectionWithParams(msg) {
  try {
    const { pcmData, sampleRate, duration, params, enableHold, mergeThreshMs, holdMinDuration, mirrorMode } = msg;
    const detected = detectBeatsWithParams(pcmData, sampleRate, duration, params);
    const _sections = detected._sections;
    const _swingInfo = detected._swingInfo;

    progress(95, '后处理管线...');
    const result = runPipeline(detected, { enableHold, mergeThreshMs, holdMinDuration, mirrorMode });

    progress(100, '完成');
    self.postMessage({ type: 'result', beats: result, _sections, _swingInfo });
  } catch(e) {
    self.postMessage({ type: 'error', message: e.message });
  }
}

// ============ HELPER: COMB FILTER ============
function combFilter(signal, lag) {
  const out = new Float32Array(signal.length);
  for (let i = lag; i < signal.length; i++) {
    out[i] = signal[i] + signal[i - lag];
  }
  return out;
}

// ============ BPM ESTIMATION ============
function estimateBPM(onsetEnv, hopSec) {
  const minLag = Math.floor(60 / (200 * hopSec));
  const maxLag = Math.floor(60 / (60 * hopSec));
  const n = onsetEnv.length;
  let bestLag = minLag, bestEnergy = -Infinity;
  // Reuse single buffer instead of allocating per lag
  for (let lag = minLag; lag <= Math.min(maxLag, Math.floor(n / 2)); lag++) {
    let energy = 0;
    for (let i = lag; i < n; i++) {
      const v = onsetEnv[i] + onsetEnv[i - lag];
      energy += v * v;
    }
    if (energy > bestEnergy) { bestEnergy = energy; bestLag = lag; }
  }
  const bpm = 60 / (bestLag * hopSec);
  const candidates = [bpm, bpm * 2, bpm / 2].filter(b => b >= 50 && b <= 220);
  candidates.sort((a, b) => {
    const da = Math.min(Math.abs(a - 120), Math.abs(a - 100));
    const db = Math.min(Math.abs(b - 120), Math.abs(b - 100));
    return da - db;
  });
  return candidates[0] || bpm;
}

// ============ DP BEAT TRACKING ============
function dpBeatTrack(onsetEnv, hopSec, initBPM) {
  const n = onsetEnv.length;
  const initPeriod = 60 / (initBPM * hopSec);
  const minPeriod = Math.max(1, Math.floor(initPeriod * 0.8));
  const maxPeriod = Math.ceil(initPeriod * 1.2);
  const score = new Float32Array(n);
  const prev = new Int32Array(n).fill(-1);
  const periods = new Float32Array(n).fill(initPeriod);
  for (let i = 0; i < n; i++) score[i] = onsetEnv[i];
  for (let i = minPeriod; i < n; i++) {
    let bestPrev = -1, bestScore = -Infinity;
    for (let p = minPeriod; p <= maxPeriod && i - p >= 0; p++) {
      const j = i - p;
      const expectedP = periods[j] > 0 ? periods[j] : initPeriod;
      const deviation = Math.abs(p - expectedP) / expectedP;
      const transitionPenalty = deviation * deviation * 100;
      const s = score[j] + onsetEnv[i] * 2 - transitionPenalty;
      if (s > bestScore) { bestScore = s; bestPrev = j; periods[i] = p; }
    }
    if (bestPrev >= 0 && bestScore > score[i]) { score[i] = bestScore; prev[i] = bestPrev; }
  }
  let bestEnd = 0;
  for (let i = Math.max(0, n - maxPeriod); i < n; i++) {
    if (score[i] > score[bestEnd]) bestEnd = i;
  }
  const beatFrames = [];
  let cur = bestEnd;
  while (cur >= 0) { beatFrames.push(cur); cur = prev[cur]; }
  beatFrames.reverse();
  return beatFrames.map(f => f * hopSec);
}

// ============ MEDIAN FILTER ============
function medianFilter(arr, winSize) {
  const half = Math.floor(winSize / 2);
  const out = new Float32Array(arr.length);
  const buf = [];
  for (let i = 0; i < arr.length; i++) {
    buf.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) buf.push(arr[j]);
    buf.sort((a, b) => a - b);
    out[i] = buf[Math.floor(buf.length / 2)];
  }
  return out;
}

// ============ SECTION DETECTION ============
function detectSections(energies, hopSec, duration) {
  const segDur = 4.0;
  const segFrames = Math.floor(segDur / hopSec);
  const segCount = Math.ceil(energies.length / segFrames);
  const segments = [];
  for (let s = 0; s < segCount; s++) {
    const start = s * segFrames;
    const end = Math.min(start + segFrames, energies.length);
    let sum = 0, sumSq = 0, cnt = 0;
    for (let i = start; i < end; i++) { sum += energies[i]; sumSq += energies[i] * energies[i]; cnt++; }
    const mean = cnt > 0 ? sum / cnt : 0;
    const variance = cnt > 0 ? (sumSq / cnt - mean * mean) : 0;
    segments.push({ idx: s, startTime: s * segDur, endTime: Math.min((s + 1) * segDur, duration), mean, variance });
  }
  const globalPeak = Math.max(...segments.map(s => s.mean), 0.0001);
  let hadChorus = false;
  const labels = [];
  for (let i = 0; i < segments.length; i++) {
    const ratio = segments[i].mean / globalPeak;
    if (!hadChorus && ratio < 0.4) labels.push('Intro');
    else if (ratio > 0.7 && segments[i].variance > 0) { labels.push('Chorus'); hadChorus = true; }
    else if (hadChorus && ratio >= 0.4 && ratio <= 0.6) labels.push('Bridge');
    else labels.push('Verse');
  }
  for (let i = 1; i < labels.length - 1; i++) {
    if (labels[i] !== labels[i - 1] && labels[i] !== labels[i + 1]) labels[i] = labels[i - 1];
  }
  const densityMap = { Intro: 0.5, Verse: 0.8, Bridge: 0.7, Chorus: 1.3 };
  const result = [];
  let curType = labels[0], curStart = segments[0].startTime;
  for (let i = 1; i < segments.length; i++) {
    if (labels[i] !== curType) {
      result.push({ start: curStart, end: segments[i].startTime, type: curType, densityCoeff: densityMap[curType] || 1.0 });
      curType = labels[i]; curStart = segments[i].startTime;
    }
  }
  result.push({ start: curStart, end: segments[segments.length - 1].endTime, type: curType, densityCoeff: densityMap[curType] || 1.0 });
  return result;
}

// ============ SWING DETECTION ============
function detectSwing(onsetEnv, hopSec, bpm) {
  const beatPeriodFrames = Math.round(60 / (bpm * hopSec));
  if (beatPeriodFrames < 4) return { isSwing: false, swingRatio: 0.5 };
  const threshold = 0.15;
  const onsetFrames = [];
  for (let i = 1; i < onsetEnv.length - 1; i++) {
    if (onsetEnv[i] > threshold && onsetEnv[i] >= onsetEnv[i - 1] && onsetEnv[i] >= onsetEnv[i + 1]) onsetFrames.push(i);
  }
  if (onsetFrames.length < 8) return { isSwing: false, swingRatio: 0.5 };
  const offbeatPositions = [];
  for (const f of onsetFrames) {
    const posInBeat = (f % beatPeriodFrames) / beatPeriodFrames;
    if (posInBeat > 0.3 && posInBeat < 0.8) offbeatPositions.push(posInBeat);
  }
  if (offbeatPositions.length < 4) return { isSwing: false, swingRatio: 0.5 };
  const avgPos = offbeatPositions.reduce((a, b) => a + b, 0) / offbeatPositions.length;
  return { isSwing: avgPos > 0.58, swingRatio: Math.max(0.5, Math.min(0.75, avgPos)) };
}

// ============ HELPER: getSectionAtTime ============
function getSectionAtTime(sections, t) {
  for (const sec of sections) {
    if (t >= sec.start && t < sec.end) return sec;
  }
  return sections.length > 0 ? sections[sections.length - 1] : null;
}

// ============ DIRECTION ASSIGNMENT ============
function assignNoteDirections(onsets) {
  const result = [];
  let leftCount = 0, rightCount = 0;
  let consecutiveSame = 0, lastDir = -1;
  const CONSEC_CAP = 3;
  const DOMINANCE_RATIO = 1.4;
  for (let i = 0; i < onsets.length; i++) {
    const o = onsets[i];
    const lo = o.lo || 0, mi = o.mi || 0, hi = o.hi || 0;
    const total = lo + mi + hi;
    let dir = -1;
    let noteColor = '#48dbfb';
    if (total > 0) {
      const loRatio = lo / total;
      const hiRatio = hi / total;
      const isLoDominant = lo > mi * DOMINANCE_RATIO && lo > hi * DOMINANCE_RATIO;
      const isHiDominant = hi > mi * DOMINANCE_RATIO && hi > lo * DOMINANCE_RATIO;
      if (isLoDominant) { dir = 0; noteColor = '#ff6b6b'; }
      else if (isHiDominant) { dir = 1; noteColor = '#9b59b6'; }
      else if (loRatio > 0.45) { dir = Math.random() < 0.8 ? 0 : 1; noteColor = '#ff6b6b'; }
      else if (hiRatio > 0.45) { dir = Math.random() < 0.8 ? 1 : 0; noteColor = '#9b59b6'; }
    }
    if (dir === -1) {
      const balance = leftCount - rightCount;
      if (balance > 2) dir = 1;
      else if (balance < -2) dir = 0;
      else dir = (lastDir === 0) ? 1 : (lastDir === 1) ? 0 : (Math.random() < 0.5 ? 0 : 1);
    }
    if (dir === lastDir) {
      consecutiveSame++;
      if (consecutiveSame >= CONSEC_CAP) { dir = 1 - dir; consecutiveSame = 0; }
    } else { consecutiveSame = 0; }
    lastDir = dir;
    if (dir === 0) leftCount++; else rightCount++;
    result.push({ time: o.time, dir, color: noteColor });
  }
  return result;
}

// ============ MULTI-RES SPECTRAL FLUX ============
function computeMultiResFlux(data, sr) {
  // Downsample to ~22050 if needed, halves computation for 44.1k/48k sources
  let pcm = data, sampleRate = sr;
  if (sr > 30000) {
    const factor = Math.round(sr / 22050);
    const newLen = Math.floor(data.length / factor);
    pcm = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) pcm[i] = data[i * factor];
    sampleRate = sr / factor;
  }
  const shortWin = Math.floor(sampleRate * 0.02);
  const longWin = Math.floor(sampleRate * 0.08);
  const hopSize = Math.floor(sampleRate * 0.02);
  const hopSec = hopSize / sampleRate;
  const fftN = 256;
  function computeRMS(winSz) {
    const energies = [];
    for (let i = 0; i + winSz < pcm.length; i += hopSize) {
      let e = 0;
      for (let j = 0; j < winSz; j++) e += pcm[i + j] * pcm[i + j];
      energies.push(Math.sqrt(e / winSz));
    }
    return energies;
  }
  const shortRMS = computeRMS(shortWin);
  const longRMS = computeRMS(longWin);
  const nFrames = Math.min(shortRMS.length, longRMS.length);
  function computeFlux(rmsArr) {
    const flux = new Float32Array(rmsArr.length);
    for (let i = 1; i < rmsArr.length; i++) flux[i] = Math.max(0, rmsArr[i] - rmsArr[i - 1]);
    let maxVal = 0;
    for (let i = 0; i < flux.length; i++) if (flux[i] > maxVal) maxVal = flux[i];
    if (maxVal > 0) for (let i = 0; i < flux.length; i++) flux[i] /= maxVal;
    return flux;
  }
  const shortFlux = computeFlux(shortRMS);
  const longFlux = computeFlux(longRMS);
  const combinedFlux = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) combinedFlux[i] = 0.6 * (shortFlux[i] || 0) + 0.4 * (longFlux[i] || 0);
  const lowE = [], midE = [], hiE = [];
  // Precompute frequency band lookup
  const n = Math.min(fftN, shortWin);
  const bandLo = new Uint8Array(n), bandMi = new Uint8Array(n), bandHi = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const freq = (j < n / 2) ? j * (sampleRate / n) : (n - j) * (sampleRate / n);
    if (freq < 300) bandLo[j] = 1;
    else if (freq < 2000) bandMi[j] = 1;
    else bandHi[j] = 1;
  }
  for (let i = 0; i + shortWin < pcm.length; i += hopSize) {
    let lo = 0, mi = 0, hi = 0;
    for (let j = 0; j < n; j++) {
      const v = pcm[i + j] * pcm[i + j];
      if (bandLo[j]) lo += v;
      else if (bandMi[j]) mi += v;
      else hi += v;
    }
    lowE.push(Math.sqrt(lo / n));
    midE.push(Math.sqrt(mi / n));
    hiE.push(Math.sqrt(hi / n));
  }
  return { combinedFlux, shortRMS, longRMS, lowE, midE, hiE, hopSec, nFrames, hopSize };
}

// ============ DETECT BEATS (main) ============
function detectBeats(data, sr, dur, densityMult) {
  const t0 = performance.now();

  progress(5, '频谱分析...');
  const flux = computeMultiResFlux(data, sr);
  const { combinedFlux, shortRMS, lowE, midE, hiE, hopSec, nFrames } = flux;

  progress(25, 'BPM 检测...');
  const bpm = estimateBPM(combinedFlux, hopSec);
  const beatSec = 60 / bpm;

  progress(35, '节拍追踪...');
  const dpBeats = dpBeatTrack(combinedFlux, hopSec, bpm);

  const sections = detectSections(shortRMS, hopSec, dur);
  const swingInfo = detectSwing(combinedFlux, hopSec, bpm);

  // Local adaptive boost: re-normalize flux per section so quiet intros aren't suppressed
  let globalFluxMax = 0;
  for (let i = 0; i < nFrames; i++) { if (combinedFlux[i] > globalFluxMax) globalFluxMax = combinedFlux[i]; }
  if (globalFluxMax > 0.01) {
    for (const sec of sections) {
      const fStart = Math.max(0, Math.floor(sec.start / hopSec));
      const fEnd = Math.min(nFrames, Math.floor(sec.end / hopSec));
      let secMax = 0;
      for (let i = fStart; i < fEnd; i++) { if (combinedFlux[i] > secMax) secMax = combinedFlux[i]; }
      // If this section's peak is much lower than global, boost it
      if (secMax > 0.005 && secMax < globalFluxMax * 0.35) {
        const target = globalFluxMax * 0.35;
        const boost = Math.min(target / secMax, 2.5);
        for (let i = fStart; i < fEnd; i++) combinedFlux[i] *= boost;
      }
    }
  }

  progress(50, '音符拾取...');
  const medBaseline = medianFilter(combinedFlux, 5);
  const onsetThreshold = 0.15;
  const localWin = Math.max(3, Math.floor(0.05 / hopSec));
  const rawOnsets = [];
  const segFrames = Math.floor(2.0 / hopSec);
  const segEnergies = [];
  for (let i = 0; i < shortRMS.length; i += segFrames) {
    let sum = 0, cnt = 0;
    for (let j = i; j < Math.min(i + segFrames, shortRMS.length); j++) { sum += shortRMS[j]; cnt++; }
    segEnergies.push(sum / cnt);
  }
  const peakSeg = Math.max(...segEnergies);
  const climaxThresh = peakSeg * 0.65;
  function isClimax(fi) {
    const si = Math.floor(fi / segFrames);
    if (si >= segEnergies.length) return false;
    if (segEnergies[si] < climaxThresh) return false;
    const t = fi * hopSec;
    const sec = getSectionAtTime(sections, t);
    return sec ? (sec.type === 'Chorus') : (segEnergies[si] >= climaxThresh);
  }
  function isPeakChorus(fi) {
    const si = Math.floor(fi / segFrames);
    return si < segEnergies.length && segEnergies[si] >= peakSeg * 0.85;
  }
  const globalSilence = shortRMS.reduce((a, b) => a + b, 0) / shortRMS.length * 0.10;
  for (let i = localWin; i < nFrames - localWin; i++) {
    if (shortRMS[i] < globalSilence) continue;
    const t = i * hopSec;
    const sec = getSectionAtTime(sections, t);
    let secThreshMult = 1.0;
    if (sec) { if (sec.type === 'Chorus') secThreshMult = 0.8; else if (sec.type === 'Intro') secThreshMult = 0.65; }
    if (combinedFlux[i] <= medBaseline[i] + onsetThreshold * secThreshMult) continue;
    let peakIdx = i;
    for (let k = Math.max(0, i - 2); k <= Math.min(nFrames - 1, i + 2); k++) {
      if (combinedFlux[k] > combinedFlux[peakIdx]) peakIdx = k;
    }
    if (peakIdx !== i) continue;
    if (i > 0 && combinedFlux[i] < combinedFlux[i - 1]) continue;
    if (i < nFrames - 1 && combinedFlux[i] < combinedFlux[i + 1]) continue;
    if (t < 0.3 || t > dur - 0.3) continue;
    rawOnsets.push({ time: t, energy: shortRMS[i] || 0, strength: combinedFlux[i], climax: isClimax(i), fi: i, lo: lowE[i] || 0, mi: midE[i] || 0, hi: hiE[i] || 0 });
  }

  progress(65, '节拍对齐...');
  let gridSize = beatSec / 4;
  const halfBeat = beatSec / 2;
  let swingGrid = null;
  if (swingInfo.isSwing) {
    const sr2 = swingInfo.swingRatio;
    swingGrid = [0, sr2 / 2, sr2, sr2 + (1 - sr2) / 2];
  }
  const snapped = [];
  const usedGridSlots = new Set();
  rawOnsets.sort((a, b) => b.strength - a.strength);
  for (const o of rawOnsets) {
    let nearestDP = Infinity;
    for (const bt of dpBeats) { const diff = Math.abs(o.time - bt); if (diff < nearestDP) nearestDP = diff; }
    let snappedTime, snapKey;
    if (swingGrid) {
      const beatIdx = Math.floor(o.time / beatSec);
      const beatStart = beatIdx * beatSec;
      let bestSnapDist = Infinity, bestSnapTime = o.time;
      for (const gp of swingGrid) { const c = beatStart + gp * beatSec; const d2 = Math.abs(o.time - c); if (d2 < bestSnapDist) { bestSnapDist = d2; bestSnapTime = c; } }
      for (const gp of swingGrid) { const c = (beatIdx + 1) * beatSec + gp * beatSec; const d2 = Math.abs(o.time - c); if (d2 < bestSnapDist) { bestSnapDist = d2; bestSnapTime = c; } }
      snappedTime = bestSnapTime;
      snapKey = Math.round(snappedTime * 1000);
      if (bestSnapDist > gridSize * 0.6) continue;
    } else {
      const gridIdx = Math.round(o.time / gridSize);
      snappedTime = gridIdx * gridSize;
      snapKey = gridIdx;
      if (Math.abs(o.time - snappedTime) > gridSize * 0.6) continue;
    }
    if (usedGridSlots.has(snapKey)) continue;
    if (snappedTime < 0.3 || snappedTime > dur - 0.3) continue;
    const dpBonus = nearestDP < beatSec * 0.25 ? 1.5 : 1.0;
    usedGridSlots.add(snapKey);
    snapped.push({ ...o, time: snappedTime, originalTime: o.time, dpBonus });
  }
  snapped.sort((a, b) => a.time - b.time);

  progress(75, '密度控制...');
  const baseTargetN = Math.min(Math.floor(dur * 2.5 * densityMult), Math.floor(200 * densityMult));
  for (const o of snapped) { const sec = getSectionAtTime(sections, o.time); o._secCoeff = sec ? sec.densityCoeff : 1.0; }
  let selected = snapped;
  if (selected.length > baseTargetN) {
    selected.sort((a, b) => (b.strength * b.dpBonus * b._secCoeff) - (a.strength * a.dpBonus * a._secCoeff));
    selected = selected.slice(0, baseTargetN);
    selected.sort((a, b) => a.time - b.time);
  }

  const filtered = [];
  let prevTime = -1, burstCount = 0, lastBurstEnd = -1;
  for (const o of selected) {
    const gap = prevTime < 0 ? Infinity : o.time - prevTime;
    const sec = getSectionAtTime(sections, o.time);
    const inChorus = sec && sec.type === 'Chorus';
    const peakCh = o.climax && isPeakChorus(o.fi);
    const maxBurstN = peakCh ? 8 : 5;
    const climaxMinGap = inChorus ? 0.15 : 0.2;
    if (o.climax) {
      if (lastBurstEnd > 0 && burstCount === 0 && o.time - lastBurstEnd < beatSec - 0.001) continue;
      if (gap >= climaxMinGap - 0.001) {
        if (gap < halfBeat && burstCount >= maxBurstN) {
          if (gap >= halfBeat - 0.001) { filtered.push(o); prevTime = o.time; lastBurstEnd = o.time; burstCount = 0; }
        } else {
          filtered.push(o); prevTime = o.time;
          if (gap < halfBeat) burstCount++; else { if (burstCount > 0) lastBurstEnd = prevTime; burstCount = 0; }
        }
      }
    } else {
      if (gap >= halfBeat - 0.001) { filtered.push(o); prevTime = o.time; if (burstCount > 0) lastBurstEnd = prevTime; burstCount = 0; }
    }
  }

  progress(85, '填充间隙...');
  const filled = [];
  // Fill gap before first note (intro gap)
  if (filtered.length > 0 && filtered[0].time > beatSec * 2.5) {
    const firstTime = filtered[0].time;
    const sec = getSectionAtTime(sections, firstTime / 2);
    const secType = sec ? sec.type : 'Intro';
    const fillStep = (secType === 'Intro' || secType === 'Bridge') ? beatSec * 2 : beatSec;
    const startFill = Math.max(beatSec, fillStep);
    for (let gt = startFill; gt < firstTime - fillStep * 0.4; gt += fillStep) {
      filled.push({ time: gt, energy: filtered[0].energy * 0.3, strength: 0.1, climax: false, fi: 0, lo: filtered[0].lo * 0.3, mi: filtered[0].mi * 0.3, hi: filtered[0].hi * 0.3, synthetic: true, dpBonus: 1.0 });
    }
  }
  for (let i = 0; i < filtered.length; i++) {
    filled.push(filtered[i]);
    if (i < filtered.length - 1) {
      const gap = filtered[i + 1].time - filtered[i].time;
      if (gap > beatSec * 2.5) {
        const midTime = (filtered[i].time + filtered[i + 1].time) / 2;
        const sec = getSectionAtTime(sections, midTime);
        const secType = sec ? sec.type : 'Verse';
        let fillStep;
        const si = Math.floor((midTime / hopSec) / segFrames);
        const isPeak = si < segEnergies.length && segEnergies[si] >= peakSeg * 0.85;
        if (isPeak && secType === 'Chorus') fillStep = beatSec / 4;
        else if (secType === 'Chorus') fillStep = beatSec / 2;
        else if (secType === 'Intro' || secType === 'Bridge') fillStep = beatSec * 2;
        else fillStep = beatSec;
        for (let gt = filtered[i].time + fillStep; gt < filtered[i + 1].time - fillStep * 0.4; gt += fillStep) {
          if (gt - filtered[i].time < fillStep * 0.8) continue;
          filled.push({ time: gt, energy: (filtered[i].energy + filtered[i + 1].energy) * 0.4, strength: 0.1, climax: false, fi: 0, lo: filtered[i].lo * 0.5, mi: filtered[i].mi * 0.5, hi: filtered[i].hi * 0.5, synthetic: true, dpBonus: 1.0 });
        }
      }
    }
  }
  filled.sort((a, b) => a.time - b.time);

  progress(90, '方向分配...');
  const result = assignNoteDirections(filled);
  result._sections = sections;
  result._swingInfo = swingInfo;
  result._bpm = bpm;

  if (result.length < 5) {
    const fb = [];
    for (let t = beatSec; t < dur - 0.5; t += beatSec) fb.push({ time: t, dir: fb.length % 2, color: '#48dbfb' });
    fb._bpm = bpm;
    return fb;
  }
  return result;
}

// ============ POST-PROCESSING PIPELINE ============
function quantizeNotes(notes, offset) {
  if (notes.length < 4) return notes;
  const gaps = [];
  for (let i = 1; i < notes.length; i++) gaps.push(notes[i].time - notes[i - 1].time);
  gaps.sort((a, b) => a - b);
  const medGap = gaps[Math.floor(gaps.length / 2)];
  const gridSize = medGap / 2;
  if (gridSize < 0.05 || gridSize > 2) return notes;
  return notes.map(n => {
    const t = n.time + (offset || 0);
    const quantized = Math.round(t / gridSize) * gridSize;
    return { ...n, time: Math.max(0.1, quantized) };
  });
}

function unifyDenseDirections(notes, threshold, enableHold, mergeThreshMs) {
  if (!enableHold) return notes;
  const thresh = threshold || (mergeThreshMs / 1000);
  const result = notes.map(n => ({ ...n }));
  let i = 0, unified = 0;
  let globalL = 0, globalR = 0;
  for (const n of result) { if (n.dir === 0) globalL++; else globalR++; }
  while (i < result.length) {
    let j = i + 1;
    while (j < result.length && (result[j].time - result[j - 1].time) <= thresh) j++;
    const runLen = j - i;
    if (runLen >= 3) {
      let lCount = 0, rCount = 0;
      for (let k = i; k < j; k++) { if (result[k].dir === 0) lCount++; else rCount++; }
      let targetDir;
      if (globalL < globalR) targetDir = 0;
      else if (globalR < globalL) targetDir = 1;
      else targetDir = lCount >= rCount ? 0 : 1;
      for (let k = i; k < j; k++) {
        if (result[k].dir !== targetDir) {
          if (result[k].dir === 0) { globalL--; globalR++; } else { globalR--; globalL++; }
          result[k].dir = targetDir; unified++;
        }
      }
    }
    i = j;
  }
  return result;
}

function mergeDenseNotes(result, mergeThreshold, enableHold, mergeThreshMs, holdMinDuration) {
  if (!enableHold) return result;
  const thresh = mergeThreshold || (mergeThreshMs / 1000);
  const merged = [];
  let i = 0;
  while (i < result.length) {
    const start = result[i];
    let j = i + 1;
    while (j < result.length && result[j].dir === start.dir && (result[j].time - result[j-1].time) <= thresh) j++;
    const runLen = j - i;
    if (runLen >= 3) {
      const endNote = result[j - 1];
      let bestColor = start.color, bestEnergy = 0;
      for (let k = i; k < j; k++) {
        const e = (result[k].lo || 0) + (result[k].mi || 0) + (result[k].hi || 0);
        if (e > bestEnergy) { bestEnergy = e; bestColor = result[k].color; }
      }
      merged.push({ type: 'hold', startTime: start.time, endTime: endNote.time, dir: start.dir, color: bestColor || start.color, _mergedCount: runLen, _spawned: false, _holding: false, _startJudged: false, _endJudged: false });
    } else {
      for (let k = i; k < j; k++) merged.push({ type: 'tap', time: result[k].time, dir: result[k].dir, color: result[k].color });
    }
    i = j;
  }
  const minDur = holdMinDuration / 1000;
  const final = [];
  for (const n of merged) {
    if (n.type === 'hold' && (n.endTime - n.startTime) < minDur) {
      final.push({ type: 'tap', time: n.startTime, dir: n.dir, color: n.color });
      final.push({ type: 'tap', time: n.endTime, dir: n.dir, color: n.color });
    } else { final.push(n); }
  }
  final.sort((a, b) => (a.type === 'hold' ? a.startTime : a.time) - (b.type === 'hold' ? b.startTime : b.time));
  return final;
}

function expandHoldBoundaries(notes, enableHold, mergeThreshMs) {
  if (!enableHold) return notes;
  const expandThresh = mergeThreshMs / 1000;
  let changed = true, iterations = 0;
  while (changed && iterations < 3) {
    changed = false; iterations++;
    for (let i = 0; i < notes.length; i++) {
      const h = notes[i];
      if (h.type !== 'hold' || h._absorbed) continue;
      for (let j = i - 1; j >= 0; j--) {
        const n = notes[j];
        if (n.type !== 'tap' || n.dir !== h.dir) continue;
        if (n._absorbed) continue;
        const gap = h.startTime - n.time;
        if (gap < 0 || gap > expandThresh) break;
        h.startTime = n.time; n._absorbed = true; changed = true;
      }
      for (let j = i + 1; j < notes.length; j++) {
        const n = notes[j];
        if (n.type !== 'tap' || n.dir !== h.dir) continue;
        if (n._absorbed) continue;
        const gap = n.time - h.endTime;
        if (gap < 0 || gap > expandThresh) break;
        h.endTime = n.time; n._absorbed = true; changed = true;
      }
    }
  }
  return notes.filter(n => !n._absorbed);
}

function mergeAdjacentHolds(notes, enableHold) {
  if (!enableHold) return notes;
  const gapThresh = 0.3;
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const cur = notes[i];
    if (cur.type !== 'hold') { out.push(cur); continue; }
    let merged = { ...cur };
    let j = i + 1;
    while (j < notes.length) {
      const nxt = notes[j];
      if (nxt.type === 'hold' && nxt.dir === merged.dir && (nxt.startTime - merged.endTime) <= gapThresh) {
        merged.endTime = Math.max(merged.endTime, nxt.endTime); j++;
      } else if (nxt.type === 'tap') { j++; }
      else break;
    }
    out.push(merged);
    for (let k = i + 1; k < j; k++) {
      if (notes[k].type !== 'hold' || notes[k].dir !== merged.dir) out.push(notes[k]);
    }
    i = j - 1;
  }
  out.sort((a, b) => (a.type === 'hold' ? a.startTime : a.time) - (b.type === 'hold' ? b.startTime : b.time));
  return out;
}

// ============ INJECT OPPOSITE-SIDE TAPS DURING HOLDS ============
// Reduced density: only inject on strong beats to maintain rhythm without overwhelming.
function injectOppositeNotes(notes, enableHold, beatSec, preMergeGrid) {
  if (!enableHold || !beatSec || beatSec <= 0) return notes;
  const sortKey = n => n.type === 'hold' ? n.startTime : n.time;
  const holds = notes.filter(n => n.type === 'hold');
  if (holds.length === 0) return notes;

  // Use pre-merge grid (original onset times before notes were absorbed into holds)
  const grid = (preMergeGrid && preMergeGrid.length > 0)
    ? preMergeGrid
    : notes.filter(n => n.type === 'tap').map(n => n.time).sort((a, b) => a - b);

  const injected = [];
  const margin = beatSec * 0.5; // wider margin from hold start/end
  const minSpan = 0.4;
  // Minimum spacing between injected opposite notes: one full beat
  const minInjectedGap = beatSec * 0.9;
  // Snap tolerance: candidate must be within this distance of a beat grid line
  const snapTolerance = beatSec * 0.2;

  for (const h of holds) {
    const span = h.endTime - h.startTime;
    if (span < minSpan) continue;
    const oppDir = 1 - h.dir;
    const rangeStart = h.startTime + margin;
    const rangeEnd = h.endTime - margin;
    if (rangeStart >= rangeEnd) continue;

    // Check if opposite-side taps already exist in this interval
    const hasOpp = notes.some(n =>
      n.type === 'tap' && n.dir === oppDir &&
      n.time >= rangeStart && n.time <= rangeEnd
    );
    if (hasOpp) continue;

    // Build beat grid lines within the hold range
    const beatGridTimes = [];
    const firstBeat = Math.ceil(rangeStart / beatSec) * beatSec;
    for (let bt = firstBeat; bt <= rangeEnd; bt += beatSec) {
      if (bt >= rangeStart) beatGridTimes.push(bt);
    }

    // Find candidates: grid points that are close to a beat grid line
    const candidates = [];
    for (const t of grid) {
      if (t < rangeStart) continue;
      if (t > rangeEnd) break;
      // Check if this candidate snaps to a beat grid line
      let onBeat = false;
      for (const bt of beatGridTimes) {
        if (Math.abs(t - bt) <= snapTolerance) { onBeat = true; break; }
      }
      if (onBeat) candidates.push(t);
    }

    // Fallback: if no grid-snapped candidates, place notes directly on beat lines
    if (candidates.length === 0) {
      for (const bt of beatGridTimes) {
        candidates.push(bt);
      }
    }

    // Cap: at most one note per beat (roughly span / beatSec notes)
    const maxNotes = Math.max(1, Math.floor(span / beatSec));

    const oppColor = oppDir === 0 ? '#ff6b6b' : '#9b59b6';
    const used = new Set();
    let lastInjectedTime = -Infinity;
    let count = 0;
    for (const t of candidates) {
      if (count >= maxNotes) break;
      const key = Math.round(t * 1000);
      if (used.has(key)) continue;
      // Enforce minimum gap between injected notes
      if (t - lastInjectedTime < minInjectedGap) continue;
      // Collision check with existing opposite-side taps
      const tooClose = notes.some(n =>
        n.type === 'tap' && n.dir === oppDir && Math.abs(n.time - t) < 0.1
      );
      if (tooClose) continue;
      const tooCloseInjected = injected.some(n => Math.abs(n.time - t) < minInjectedGap);
      if (tooCloseInjected) continue;
      used.add(key);
      injected.push({ type: 'tap', time: t, dir: oppDir, color: oppColor });
      lastInjectedTime = t;
      count++;
    }
  }
  if (injected.length > 0) {
    const all = [...notes, ...injected];
    all.sort((a, b) => sortKey(a) - sortKey(b));
    return all;
  }
  return notes;
}

function applyMirror(notes, mirrorMode) {
  if (!mirrorMode) return notes;
  for (const n of notes) n.dir = 1 - n.dir;
  return notes;
}

// ============ FULL PIPELINE ============
function runPipeline(detected, opts) {
  const beatSec = detected._bpm ? 60 / detected._bpm : 0;
  let result = quantizeNotes(detected, 0);
  // Snapshot all tap times BEFORE merge/absorb — these are the real onset grid
  const preMergeGrid = result.filter(n => n.type === 'tap').map(n => n.time).sort((a, b) => a - b);
  result = unifyDenseDirections(result, opts.mergeThreshMs / 1000, opts.enableHold, opts.mergeThreshMs);
  result = mergeDenseNotes(result, opts.mergeThreshMs / 1000, opts.enableHold, opts.mergeThreshMs, opts.holdMinDuration);
  result = expandHoldBoundaries(result, opts.enableHold, opts.mergeThreshMs);
  result = mergeAdjacentHolds(result, opts.enableHold);
  result = injectOppositeNotes(result, opts.enableHold, beatSec, preMergeGrid);
  result = applyMirror(result, opts.mirrorMode);
  return result;
}

// ============ DETECT BEATS WITH PARAMS (debug) ============
function detectBeatsWithParams(data, sr, dur, params) {
  progress(5, '频谱分析 (调试)...');
  const fluxData = computeMultiResFlux(data, sr);
  const { combinedFlux, shortRMS, lowE, midE, hiE, hopSec, nFrames } = fluxData;

  progress(25, 'BPM 检测...');
  const bpm = estimateBPM(combinedFlux, hopSec);
  const beatSec = 60 / bpm;
  let gridSize = beatSec / 4;
  const halfBeat = beatSec / 2;

  progress(35, '节拍追踪...');
  const dpBeats = dpBeatTrack(combinedFlux, hopSec, bpm);
  const sections = detectSections(shortRMS, hopSec, dur);
  const swingInfo = detectSwing(combinedFlux, hopSec, bpm);

  // Local adaptive boost for quiet sections
  let globalFluxMax2 = 0;
  for (let i = 0; i < nFrames; i++) { if (combinedFlux[i] > globalFluxMax2) globalFluxMax2 = combinedFlux[i]; }
  if (globalFluxMax2 > 0.01) {
    for (const sec of sections) {
      const fStart = Math.max(0, Math.floor(sec.start / hopSec));
      const fEnd = Math.min(nFrames, Math.floor(sec.end / hopSec));
      let secMax = 0;
      for (let i = fStart; i < fEnd; i++) { if (combinedFlux[i] > secMax) secMax = combinedFlux[i]; }
      if (secMax > 0.005 && secMax < globalFluxMax2 * 0.35) {
        const target = globalFluxMax2 * 0.35;
        const boost = Math.min(target / secMax, 2.5);
        for (let i = fStart; i < fEnd; i++) combinedFlux[i] *= boost;
      }
    }
  }

  progress(50, '音符拾取 (调试参数)...');
  const medBaseline = medianFilter(combinedFlux, 5);
  const globalSilence = shortRMS.reduce((a, b) => a + b, 0) / shortRMS.length * 0.10;
  const segFrames = Math.floor(2.0 / hopSec);
  const segEnergies = [];
  for (let i = 0; i < shortRMS.length; i += segFrames) {
    let sum = 0, cnt = 0;
    for (let j = i; j < Math.min(i + segFrames, shortRMS.length); j++) { sum += shortRMS[j]; cnt++; }
    segEnergies.push(sum / cnt);
  }
  const peakSeg = Math.max(...segEnergies);
  const climaxThresh = peakSeg * 0.65;
  function isClimax(fi) {
    const si = Math.floor(fi / segFrames);
    if (si >= segEnergies.length || segEnergies[si] < climaxThresh) return false;
    const t = fi * hopSec;
    const sec = getSectionAtTime(sections, t);
    return sec ? (sec.type === 'Chorus') : (segEnergies[si] >= climaxThresh);
  }
  function isPeakChorus(fi) {
    const si = Math.floor(fi / segFrames);
    return si < segEnergies.length && segEnergies[si] >= peakSeg * 0.85;
  }
  const localWin = Math.max(3, Math.floor(0.05 / hopSec));
  const rawOnsets = [];
  const baseThresh = 0.15 / 1.5 * params.onsetThreshold;
  for (let i = localWin; i < nFrames - localWin; i++) {
    if (shortRMS[i] < globalSilence) continue;
    const t = i * hopSec;
    const sec = getSectionAtTime(sections, t);
    let secThreshMult = 1.0;
    if (sec) { if (sec.type === 'Chorus') secThreshMult = 0.8; else if (sec.type === 'Intro') secThreshMult = 0.65; }
    const clx = isClimax(i);
    const thresh = clx ? (baseThresh * 0.8 * secThreshMult) : (baseThresh * secThreshMult);
    if (combinedFlux[i] <= medBaseline[i] + thresh) continue;
    let peakIdx = i;
    for (let k = Math.max(0, i - 2); k <= Math.min(nFrames - 1, i + 2); k++) { if (combinedFlux[k] > combinedFlux[peakIdx]) peakIdx = k; }
    if (peakIdx !== i) continue;
    if (i > 0 && combinedFlux[i] < combinedFlux[i - 1]) continue;
    if (i < nFrames - 1 && combinedFlux[i] < combinedFlux[i + 1]) continue;
    if (t < 0.3 || t > dur - 0.3) continue;
    rawOnsets.push({ time: t, energy: shortRMS[i] || 0, strength: combinedFlux[i], climax: clx, fi: i, lo: lowE[i] || 0, mi: midE[i] || 0, hi: hiE[i] || 0 });
  }

  progress(65, '节拍对齐...');
  let swingGrid = null;
  if (swingInfo.isSwing) { const sr2 = swingInfo.swingRatio; swingGrid = [0, sr2 / 2, sr2, sr2 + (1 - sr2) / 2]; }
  const snapped = [];
  const usedGridSlots = new Set();
  rawOnsets.sort((a, b) => b.strength - a.strength);
  for (const o of rawOnsets) {
    let nearestDP = Infinity;
    for (const bt of dpBeats) { const diff = Math.abs(o.time - bt); if (diff < nearestDP) nearestDP = diff; }
    let snappedTime, snapKey;
    if (swingGrid) {
      const beatIdx = Math.floor(o.time / beatSec);
      let bestSnapDist = Infinity, bestSnapTime = o.time;
      for (const gp of swingGrid) { const c = beatIdx * beatSec + gp * beatSec; const d2 = Math.abs(o.time - c); if (d2 < bestSnapDist) { bestSnapDist = d2; bestSnapTime = c; } }
      for (const gp of swingGrid) { const c = (beatIdx + 1) * beatSec + gp * beatSec; const d2 = Math.abs(o.time - c); if (d2 < bestSnapDist) { bestSnapDist = d2; bestSnapTime = c; } }
      snappedTime = bestSnapTime; snapKey = Math.round(snappedTime * 1000);
      if (bestSnapDist > gridSize * 0.6) continue;
    } else {
      const gridIdx = Math.round(o.time / gridSize);
      snappedTime = gridIdx * gridSize; snapKey = gridIdx;
      if (Math.abs(o.time - snappedTime) > gridSize * 0.6) continue;
    }
    if (usedGridSlots.has(snapKey)) continue;
    if (snappedTime < 0.3 || snappedTime > dur - 0.3) continue;
    usedGridSlots.add(snapKey);
    snapped.push({ ...o, time: snappedTime, originalTime: o.time, dpBonus: nearestDP < beatSec * 0.25 ? 1.5 : 1.0 });
  }
  snapped.sort((a, b) => a.time - b.time);

  progress(75, '密度控制...');
  const densityMult = params.densityMult;
  const baseTargetN = Math.min(Math.floor(dur * 2.5 * densityMult), Math.floor(200 * densityMult));
  for (const o of snapped) { const sec = getSectionAtTime(sections, o.time); o._secCoeff = sec ? sec.densityCoeff : 1.0; }
  let selected = snapped;
  if (selected.length > baseTargetN) {
    selected.sort((a, b) => (b.strength * b.dpBonus * b._secCoeff) - (a.strength * a.dpBonus * a._secCoeff));
    selected = selected.slice(0, baseTargetN);
    selected.sort((a, b) => a.time - b.time);
  }

  const minGapSec = params.minGap / 1000;
  const burstGapSec = params.burstGap / 1000;
  const maxBurstN = params.maxBurst;
  const filtered = [];
  let prevTime = -1, burstCount = 0, lastBurstEnd = -1;
  for (const o of selected) {
    const gap = prevTime < 0 ? Infinity : o.time - prevTime;
    const sec = getSectionAtTime(sections, o.time);
    const inChorus = sec && sec.type === 'Chorus';
    const peakCh = o.climax && isPeakChorus(o.fi);
    const effectiveMaxBurst = peakCh ? 8 : maxBurstN;
    const effectiveBurstGap = inChorus ? Math.min(burstGapSec, 0.15) : burstGapSec;
    if (o.climax) {
      if (lastBurstEnd > 0 && burstCount === 0 && o.time - lastBurstEnd < beatSec - 0.001) continue;
      if (gap >= effectiveBurstGap - 0.001) {
        if (gap < halfBeat && burstCount >= effectiveMaxBurst) {
          if (gap >= halfBeat - 0.001) { filtered.push(o); prevTime = o.time; lastBurstEnd = o.time; burstCount = 0; }
        } else {
          filtered.push(o); prevTime = o.time;
          if (gap < halfBeat) burstCount++; else { if (burstCount > 0) lastBurstEnd = prevTime; burstCount = 0; }
        }
      }
    } else {
      if (gap >= minGapSec - 0.001) { filtered.push(o); prevTime = o.time; if (burstCount > 0) lastBurstEnd = prevTime; burstCount = 0; }
    }
  }

  progress(85, '填充间隙...');
  const filled = [];
  // Fill gap before first note (intro gap)
  if (filtered.length > 0 && filtered[0].time > beatSec * 2.5) {
    const firstTime = filtered[0].time;
    const sec = getSectionAtTime(sections, firstTime / 2);
    const secType = sec ? sec.type : 'Intro';
    const fillStep = (secType === 'Intro' || secType === 'Bridge') ? beatSec * 2 : beatSec;
    const startFill = Math.max(beatSec, fillStep);
    for (let gt = startFill; gt < firstTime - fillStep * 0.4; gt += fillStep) {
      filled.push({ time: gt, energy: filtered[0].energy * 0.3, strength: 0.1, climax: false, fi: 0, lo: filtered[0].lo * 0.3, mi: filtered[0].mi * 0.3, hi: filtered[0].hi * 0.3, synthetic: true, dpBonus: 1.0 });
    }
  }
  for (let i = 0; i < filtered.length; i++) {
    filled.push(filtered[i]);
    if (i < filtered.length - 1) {
      const gap = filtered[i + 1].time - filtered[i].time;
      if (gap > beatSec * 2.5) {
        const midTime = (filtered[i].time + filtered[i + 1].time) / 2;
        const sec = getSectionAtTime(sections, midTime);
        const secType = sec ? sec.type : 'Verse';
        let fillStep;
        const si = Math.floor((midTime / hopSec) / segFrames);
        const isPeak = si < segEnergies.length && segEnergies[si] >= peakSeg * 0.85;
        if (isPeak && secType === 'Chorus') fillStep = beatSec / 4;
        else if (secType === 'Chorus') fillStep = beatSec / 2;
        else if (secType === 'Intro' || secType === 'Bridge') fillStep = beatSec * 2;
        else fillStep = beatSec;
        for (let gt = filtered[i].time + fillStep; gt < filtered[i + 1].time - fillStep * 0.4; gt += fillStep) {
          if (gt - filtered[i].time < fillStep * 0.8) continue;
          filled.push({ time: gt, energy: (filtered[i].energy + filtered[i + 1].energy) * 0.4, strength: 0.1, climax: false, fi: 0, lo: filtered[i].lo * 0.5, mi: filtered[i].mi * 0.5, hi: filtered[i].hi * 0.5, synthetic: true, dpBonus: 1.0 });
        }
      }
    }
  }
  filled.sort((a, b) => a.time - b.time);

  progress(90, '方向分配...');
  const result = assignNoteDirections(filled);
  result._sections = sections;
  result._swingInfo = swingInfo;
  result._bpm = bpm;
  if (result.length < 5) {
    const fb = [];
    for (let t = beatSec; t < dur - 0.5; t += beatSec) fb.push({ time: t, dir: fb.length % 2, color: '#48dbfb' });
    fb._bpm = bpm;
    return fb;
  }
  return result;
}
