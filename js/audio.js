// audio.js — Audio analysis & Worker bridge

// ============ WORKER MANAGEMENT ============
let audioWorker = null;

function getAudioWorker() {
  if (!audioWorker) {
    audioWorker = new Worker('audioWorker.js');
  }
  return audioWorker;
}

function runWorkerDetection(pcmData, sampleRate, duration, msgType, extraFields) {
  return new Promise((resolve, reject) => {
    const worker = getAudioWorker();
    const msg = {
      type: msgType,
      pcmData: pcmData,
      sampleRate: sampleRate,
      duration: duration,
      diffPresets: DIFF_PRESETS,
      currentDiff: currentDiff,
      enableHold: enableHold,
      mergeThreshMs: mergeThreshMs,
      holdMinDuration: holdMinDuration,
      mirrorMode: mirrorMode,
      ...extraFields
    };
    function onMsg(e) {
      const data = e.data;
      if (data.type === 'progress') {
        // Update loading text if available
        if (typeof updateWorkerProgress === 'function') updateWorkerProgress(data.pct, data.label);
      } else if (data.type === 'result') {
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
        resolve(data);
      } else if (data.type === 'error') {
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
        reject(new Error(data.message));
      }
    }
    function onErr(e) {
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      reject(new Error(e.message || 'Worker error'));
    }
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
    worker.postMessage(msg, [pcmData.buffer]);
  });
}

// ============ BEAT DETECTION (multi-resolution spectral flux + comb filter BPM + DP beat tracking) ============

// --- Comb filter to enhance periodicity at a given lag ---
function combFilter(signal, lag) {
  const out = new Float32Array(signal.length);
  for (let i = lag; i < signal.length; i++) {
    out[i] = signal[i] + signal[i - lag];
  }
  return out;
}

// --- BPM estimation via comb filtering ---
function estimateBPM(onsetEnv, hopSec) {
  const minLag = Math.floor(60 / (200 * hopSec)); // 200 BPM
  const maxLag = Math.floor(60 / (60 * hopSec));  // 60 BPM
  const n = onsetEnv.length;
  let bestLag = minLag, bestEnergy = -Infinity;

  for (let lag = minLag; lag <= Math.min(maxLag, Math.floor(n / 2)); lag++) {
    const filtered = combFilter(onsetEnv, lag);
    let energy = 0;
    for (let i = 0; i < filtered.length; i++) energy += filtered[i] * filtered[i];
    if (energy > bestEnergy) { bestEnergy = energy; bestLag = lag; }
  }

  const bpm = 60 / (bestLag * hopSec);
  // Check half/double BPM, prefer 80-160 range
  const candidates = [bpm, bpm * 2, bpm / 2].filter(b => b >= 50 && b <= 220);
  candidates.sort((a, b) => {
    const da = Math.min(Math.abs(a - 120), Math.abs(a - 100));
    const db = Math.min(Math.abs(b - 120), Math.abs(b - 100));
    return da - db;
  });
  return candidates[0] || bpm;
}

// --- Dynamic programming beat tracking ---
function dpBeatTrack(onsetEnv, hopSec, initBPM) {
  const n = onsetEnv.length;
  const initPeriod = 60 / (initBPM * hopSec); // in frames
  const minPeriod = Math.max(1, Math.floor(initPeriod * 0.8));
  const maxPeriod = Math.ceil(initPeriod * 1.2);

  const score = new Float32Array(n);
  const prev = new Int32Array(n).fill(-1);
  const periods = new Float32Array(n).fill(initPeriod);

  for (let i = 0; i < n; i++) {
    score[i] = onsetEnv[i];
  }

  // DP: for each frame i, look back minPeriod..maxPeriod frames
  for (let i = minPeriod; i < n; i++) {
    let bestPrev = -1, bestScore = -Infinity;
    for (let p = minPeriod; p <= maxPeriod && i - p >= 0; p++) {
      const j = i - p;
      const expectedP = periods[j] > 0 ? periods[j] : initPeriod;
      const deviation = Math.abs(p - expectedP) / expectedP;
      const transitionPenalty = deviation * deviation * 100;
      const s = score[j] + onsetEnv[i] * 2 - transitionPenalty;
      if (s > bestScore) {
        bestScore = s;
        bestPrev = j;
        periods[i] = p;
      }
    }
    if (bestPrev >= 0 && bestScore > score[i]) {
      score[i] = bestScore;
      prev[i] = bestPrev;
    }
  }

  // Backtrace from best ending beat
  let bestEnd = 0;
  for (let i = Math.max(0, n - maxPeriod); i < n; i++) {
    if (score[i] > score[bestEnd]) bestEnd = i;
  }

  const beatFrames = [];
  let cur = bestEnd;
  while (cur >= 0) {
    beatFrames.push(cur);
    cur = prev[cur];
  }
  beatFrames.reverse();

  return beatFrames.map(f => f * hopSec);
}

// --- Median filter for onset smoothing ---
function medianFilter(arr, winSize) {
  const half = Math.floor(winSize / 2);
  const out = new Float32Array(arr.length);
  const buf = [];
  for (let i = 0; i < arr.length; i++) {
    buf.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      buf.push(arr[j]);
    }
    buf.sort((a, b) => a - b);
    out[i] = buf[Math.floor(buf.length / 2)];
  }
  return out;
}

// --- Automatic section detection (Intro/Verse/Chorus/Bridge) ---
function detectSections(energies, hopSec, duration) {
  const segDur = 4.0; // ~4 second segments
  const segFrames = Math.floor(segDur / hopSec);
  const segCount = Math.ceil(energies.length / segFrames);
  const segments = [];
  for (let s = 0; s < segCount; s++) {
    const start = s * segFrames;
    const end = Math.min(start + segFrames, energies.length);
    let sum = 0, sumSq = 0, hiSum = 0, loMidSum = 0, cnt = 0;
    for (let i = start; i < end; i++) {
      sum += energies[i];
      sumSq += energies[i] * energies[i];
      cnt++;
    }
    const mean = cnt > 0 ? sum / cnt : 0;
    const variance = cnt > 0 ? (sumSq / cnt - mean * mean) : 0;
    // Spectral centroid proxy not available from energies alone, use variance as proxy
    segments.push({
      idx: s,
      startTime: s * segDur,
      endTime: Math.min((s + 1) * segDur, duration),
      mean: mean,
      variance: variance
    });
  }

  const globalPeak = Math.max(...segments.map(s => s.mean), 0.0001);

  // State machine labeling
  let hadChorus = false;
  const labels = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const ratio = seg.mean / globalPeak;
    if (!hadChorus && ratio < 0.4) {
      labels.push('Intro');
    } else if (ratio > 0.7 && seg.variance > 0) {
      labels.push('Chorus');
      hadChorus = true;
    } else if (hadChorus && ratio >= 0.4 && ratio <= 0.6) {
      labels.push('Bridge');
    } else {
      labels.push('Verse');
    }
  }

  // Smooth: merge isolated single-segment sections into neighbors
  for (let i = 1; i < labels.length - 1; i++) {
    if (labels[i] !== labels[i - 1] && labels[i] !== labels[i + 1]) {
      labels[i] = labels[i - 1];
    }
  }

  // Build result array, merging consecutive same-type segments
  const densityMap = { Intro: 0.5, Verse: 0.8, Bridge: 0.7, Chorus: 1.3 };
  const result = [];
  let curType = labels[0];
  let curStart = segments[0].startTime;
  for (let i = 1; i < segments.length; i++) {
    if (labels[i] !== curType) {
      result.push({
        start: curStart,
        end: segments[i].startTime,
        type: curType,
        densityCoeff: densityMap[curType] || 1.0
      });
      curType = labels[i];
      curStart = segments[i].startTime;
    }
  }
  result.push({
    start: curStart,
    end: segments[segments.length - 1].endTime,
    type: curType,
    densityCoeff: densityMap[curType] || 1.0
  });

  return result;
}

// --- Swing detection ---
function detectSwing(onsetEnv, hopSec, bpm) {
  const beatPeriodFrames = Math.round(60 / (bpm * hopSec));
  const halfBeatFrames = Math.round(beatPeriodFrames / 2);
  if (beatPeriodFrames < 4) return { isSwing: false, swingRatio: 0.5 };

  // Find strong onset frames
  const threshold = 0.15;
  const onsetFrames = [];
  for (let i = 1; i < onsetEnv.length - 1; i++) {
    if (onsetEnv[i] > threshold && onsetEnv[i] >= onsetEnv[i - 1] && onsetEnv[i] >= onsetEnv[i + 1]) {
      onsetFrames.push(i);
    }
  }

  if (onsetFrames.length < 8) return { isSwing: false, swingRatio: 0.5 };

  // For each onset, compute its position within the beat (0..1)
  // Estimate beat grid from frame 0
  const offbeatPositions = [];
  for (const f of onsetFrames) {
    const posInBeat = (f % beatPeriodFrames) / beatPeriodFrames;
    // We care about offbeats: positions roughly in the 0.3-0.8 range of the beat
    if (posInBeat > 0.3 && posInBeat < 0.8) {
      offbeatPositions.push(posInBeat);
    }
  }

  if (offbeatPositions.length < 4) return { isSwing: false, swingRatio: 0.5 };

  // Average offbeat position: 0.5 = straight, >0.58 = swing
  const avgPos = offbeatPositions.reduce((a, b) => a + b, 0) / offbeatPositions.length;
  const isSwing = avgPos > 0.58;
  // Map avgPos to swing ratio for half-beat subdivision
  // In straight: 8th notes at 0 and 0.5 of beat -> ratio = 0.5
  // In swing: 8th notes at 0 and ~0.67 -> ratio = avgPos * ~1.34 mapped to half-beat
  const swingRatio = Math.max(0.5, Math.min(0.75, avgPos));

  return { isSwing, swingRatio };
}

// Helper: find section for a given time
function getSectionAtTime(sections, t) {
  for (const sec of sections) {
    if (t >= sec.start && t < sec.end) return sec;
  }
  return sections.length > 0 ? sections[sections.length - 1] : null;
}

// --- Note direction assignment: frequency-band + energy + balance ---
// Low freq (drums/bass, <300Hz) -> prefer left (dir=0)
// High freq (melody/vocals, >2000Hz) -> prefer right (dir=1)
// Mid freq or neutral -> random + alternating, maintaining L/R balance
function assignNoteDirections(onsets) {
  const result = [];
  let leftCount = 0, rightCount = 0;
  let consecutiveSame = 0, lastDir = -1;
  const CONSEC_CAP = 3; // max consecutive same direction
  const DOMINANCE_RATIO = 1.4; // band must be 1.4x others to be "dominant"

  for (let i = 0; i < onsets.length; i++) {
    const o = onsets[i];
    const lo = o.lo || 0, mi = o.mi || 0, hi = o.hi || 0;
    const total = lo + mi + hi;

    let dir = -1; // undecided
    let noteColor = '#48dbfb'; // default cyan (mid)

    if (total > 0) {
      const loRatio = lo / total;
      const hiRatio = hi / total;
      const isLoDominant = lo > mi * DOMINANCE_RATIO && lo > hi * DOMINANCE_RATIO;
      const isHiDominant = hi > mi * DOMINANCE_RATIO && hi > lo * DOMINANCE_RATIO;

      if (isLoDominant) {
        // Drums/bass -> left
        dir = 0;
        noteColor = '#ff6b6b'; // red
      } else if (isHiDominant) {
        // Melody/vocals -> right
        dir = 1;
        noteColor = '#9b59b6'; // purple
      } else if (loRatio > 0.45) {
        // Leaning low -> soft left preference (80%)
        dir = Math.random() < 0.8 ? 0 : 1;
        noteColor = '#ff6b6b';
      } else if (hiRatio > 0.45) {
        // Leaning high -> soft right preference (80%)
        dir = Math.random() < 0.8 ? 1 : 0;
        noteColor = '#9b59b6';
      }
    }

    // Neutral / mid-dominant: use balance-aware alternation
    if (dir === -1) {
      const balance = leftCount - rightCount;
      if (balance > 2) {
        // Too many lefts, push right
        dir = 1;
      } else if (balance < -2) {
        // Too many rights, push left
        dir = 0;
      } else {
        // Alternate with some randomness
        dir = (lastDir === 0) ? 1 : (lastDir === 1) ? 0 : (Math.random() < 0.5 ? 0 : 1);
      }
    }

    // Anti-repetition: cap consecutive same direction
    if (dir === lastDir) {
      consecutiveSame++;
      if (consecutiveSame >= CONSEC_CAP) {
        dir = 1 - dir;
        consecutiveSame = 0;
      }
    } else {
      consecutiveSame = 0;
    }

    lastDir = dir;
    if (dir === 0) leftCount++; else rightCount++;

    result.push({ time: o.time, dir, color: noteColor });
  }

  console.log(`[PR] Direction assignment: L=${leftCount} R=${rightCount} (${(leftCount/(leftCount+rightCount)*100).toFixed(1)}% left)`);
  return result;
}

// --- Multi-resolution spectral flux computation ---
function computeMultiResFlux(data, sr) {
  const shortWin = Math.floor(sr * 0.02); // 20ms
  const longWin = Math.floor(sr * 0.08);  // 80ms
  const hopSize = Math.floor(sr * 0.01);  // 10ms hop
  const hopSec = hopSize / sr;
  const fftN = 256;

  // Compute RMS for a given window size
  function computeRMS(winSz) {
    const energies = [];
    for (let i = 0; i + winSz < data.length; i += hopSize) {
      let e = 0;
      for (let j = 0; j < winSz; j++) e += data[i + j] * data[i + j];
      energies.push(Math.sqrt(e / winSz));
    }
    return energies;
  }

  const shortRMS = computeRMS(shortWin);
  const longRMS = computeRMS(longWin);
  const nFrames = Math.min(shortRMS.length, longRMS.length);

  // Half-wave rectified difference (spectral flux)
  function computeFlux(rmsArr) {
    const flux = new Float32Array(rmsArr.length);
    for (let i = 1; i < rmsArr.length; i++) {
      flux[i] = Math.max(0, rmsArr[i] - rmsArr[i - 1]);
    }
    // Normalize to 0-1
    let maxVal = 0;
    for (let i = 0; i < flux.length; i++) if (flux[i] > maxVal) maxVal = flux[i];
    if (maxVal > 0) for (let i = 0; i < flux.length; i++) flux[i] /= maxVal;
    return flux;
  }

  const shortFlux = computeFlux(shortRMS);
  const longFlux = computeFlux(longRMS);

  // Fuse: 0.6 * short + 0.4 * long
  const combinedFlux = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    combinedFlux[i] = 0.6 * (shortFlux[i] || 0) + 0.4 * (longFlux[i] || 0);
  }

  // Multi-band energy using short window
  const lowE = [], midE = [], hiE = [];
  for (let i = 0; i + shortWin < data.length; i += hopSize) {
    let lo = 0, mi = 0, hi = 0;
    const n = Math.min(fftN, shortWin);
    for (let j = 0; j < n; j++) {
      const v = data[i + j] * data[i + j];
      const freq = (j < n / 2) ? j * (sr / n) : (n - j) * (sr / n);
      if (freq < 300) lo += v;
      else if (freq < 2000) mi += v;
      else hi += v;
    }
    lowE.push(Math.sqrt(lo / n));
    midE.push(Math.sqrt(mi / n));
    hiE.push(Math.sqrt(hi / n));
  }

  return { combinedFlux, shortRMS, longRMS, lowE, midE, hiE, hopSec, nFrames, hopSize };
}

function detectBeats(buffer) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const dur = buffer.duration;
  const d = DIFF_PRESETS[currentDiff];
  const t0 = performance.now();

  // --- Step 1: Multi-resolution spectral flux ---
  const flux = computeMultiResFlux(data, sr);
  const { combinedFlux, shortRMS, lowE, midE, hiE, hopSec, nFrames } = flux;

  console.log(`[PR] Multi-res flux computed: ${nFrames} frames, hopSec=${hopSec.toFixed(4)}`);

  // --- Step 2: Comb-filtered BPM estimation ---
  const bpm = estimateBPM(combinedFlux, hopSec);
  const beatSec = 60 / bpm;
  console.log(`[PR] BPM detected: ${bpm.toFixed(1)} | beat interval: ${(beatSec * 1000).toFixed(0)}ms`);

  // --- Step 3: DP beat tracking ---
  const dpBeats = dpBeatTrack(combinedFlux, hopSec, bpm);
  console.log(`[PR] DP beat tracking: ${dpBeats.length} beats`);

  // --- Section detection ---
  const sections = detectSections(shortRMS, hopSec, dur);
  const secSummary = sections.map(s => `${s.type}(${s.start.toFixed(1)}-${s.end.toFixed(1)}s)`).join(' ');
  console.log(`[PR] Sections: ${secSummary}`);

  // --- Swing detection ---
  const swingInfo = detectSwing(combinedFlux, hopSec, bpm);
  if (swingInfo.isSwing) {
    console.log(`[PR] Swing: detected ratio=${swingInfo.swingRatio.toFixed(2)} (swing 8ths enabled)`);
  } else {
    console.log(`[PR] Swing: straight (ratio=${swingInfo.swingRatio.toFixed(2)})`);
  }

  // --- Step 4: Median filter + adaptive threshold onset picking ---
  const medBaseline = medianFilter(combinedFlux, 5);
  const onsetThreshold = 0.15;
  const localWin = Math.max(3, Math.floor(0.05 / hopSec));
  const rawOnsets = [];

  // Climax detection
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
    // Also check section data
    const t = fi * hopSec;
    const sec = getSectionAtTime(sections, t);
    return sec ? (sec.type === 'Chorus') : (segEnergies[si] >= climaxThresh);
  }
  function isPeakChorus(fi) {
    const si = Math.floor(fi / segFrames);
    return si < segEnergies.length && segEnergies[si] >= peakSeg * 0.85;
  }

  // Global silence threshold
  const globalSilence = shortRMS.reduce((a, b) => a + b, 0) / shortRMS.length * 0.10;

  for (let i = localWin; i < nFrames - localWin; i++) {
    if (shortRMS[i] < globalSilence) continue;
    // Section-aware threshold: lower in chorus, higher in intro
    const t = i * hopSec;
    const sec = getSectionAtTime(sections, t);
    let secThreshMult = 1.0;
    if (sec) {
      if (sec.type === 'Chorus') secThreshMult = 0.8;
      else if (sec.type === 'Intro') secThreshMult = 1.2;
    }
    // Must be above median baseline by threshold
    if (combinedFlux[i] <= medBaseline[i] + onsetThreshold * secThreshMult) continue;
    // Local peak check: search +/-2 frames for actual maximum (peak refinement)
    let peakIdx = i;
    for (let k = Math.max(0, i - 2); k <= Math.min(nFrames - 1, i + 2); k++) {
      if (combinedFlux[k] > combinedFlux[peakIdx]) peakIdx = k;
    }
    if (peakIdx !== i) continue; // not the local peak

    // Also check it's a local max in 3-frame window
    if (i > 0 && combinedFlux[i] < combinedFlux[i - 1]) continue;
    if (i < nFrames - 1 && combinedFlux[i] < combinedFlux[i + 1]) continue;

    if (t < 0.3 || t > dur - 0.3) continue;
    const clx = isClimax(i);
    rawOnsets.push({
      time: t, energy: shortRMS[i] || 0, strength: combinedFlux[i],
      climax: clx, fi: i,
      lo: lowE[i] || 0, mi: midE[i] || 0, hi: hiE[i] || 0
    });
  }

  // --- Step 5: Snap onsets to DP beat grid (with swing-adjusted grid) ---
  let gridSize = beatSec / 4;
  const halfBeat = beatSec / 2;

  // Build swing-adjusted grid positions within a beat if swing detected
  let swingGrid = null;
  if (swingInfo.isSwing) {
    const sr2 = swingInfo.swingRatio;
    // 1/16 grid within one beat: [0, sr/2, sr, sr + (1-sr)/2]
    swingGrid = [0, sr2 / 2, sr2, sr2 + (1 - sr2) / 2];
  }

  const snapped = [];
  const usedGridSlots = new Set();
  rawOnsets.sort((a, b) => b.strength - a.strength);

  for (const o of rawOnsets) {
    // Find nearest DP beat within tolerance
    let nearestDP = Infinity;
    for (const bt of dpBeats) {
      const diff = Math.abs(o.time - bt);
      if (diff < nearestDP) nearestDP = diff;
    }
    let snappedTime, snapKey;
    if (swingGrid) {
      // Snap to swing grid
      const beatIdx = Math.floor(o.time / beatSec);
      const beatStart = beatIdx * beatSec;
      const posInBeat = o.time - beatStart;
      let bestSnapDist = Infinity, bestSnapTime = o.time;
      for (const gp of swingGrid) {
        const candidate = beatStart + gp * beatSec;
        const dist = Math.abs(o.time - candidate);
        if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapTime = candidate; }
      }
      // Also check next beat's grid positions
      for (const gp of swingGrid) {
        const candidate = (beatIdx + 1) * beatSec + gp * beatSec;
        const dist = Math.abs(o.time - candidate);
        if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapTime = candidate; }
      }
      snappedTime = bestSnapTime;
      snapKey = Math.round(snappedTime * 1000); // use ms as key for swing grid
      if (bestSnapDist > gridSize * 0.6) continue;
    } else {
      // Snap to uniform 1/16th grid
      const gridIdx = Math.round(o.time / gridSize);
      snappedTime = gridIdx * gridSize;
      snapKey = gridIdx;
      if (Math.abs(o.time - snappedTime) > gridSize * 0.6) continue;
    }
    if (usedGridSlots.has(snapKey)) continue;
    if (snappedTime < 0.3 || snappedTime > dur - 0.3) continue;
    // Boost priority for onsets near DP beats
    const dpBonus = nearestDP < beatSec * 0.25 ? 1.5 : 1.0;
    usedGridSlots.add(snapKey);
    snapped.push({ ...o, time: snappedTime, originalTime: o.time, dpBonus });
  }
  snapped.sort((a, b) => a.time - b.time);

  // --- Step 6: Density control (section-aware) ---
  const baseTargetN = Math.min(Math.floor(dur * 2.5 * d.densityMult), Math.floor(200 * d.densityMult));
  // Weight each note by its section's densityCoeff
  for (const o of snapped) {
    const sec = getSectionAtTime(sections, o.time);
    o._secCoeff = sec ? sec.densityCoeff : 1.0;
  }
  let selected = snapped;
  if (selected.length > baseTargetN) {
    selected.sort((a, b) => (b.strength * b.dpBonus * b._secCoeff) - (a.strength * a.dpBonus * a._secCoeff));
    selected = selected.slice(0, baseTargetN);
    selected.sort((a, b) => a.time - b.time);
  }

  // --- Step 7: Min gap enforcement with climax bursts (section-aware) ---
  const filtered = [];
  let prevTime = -1;
  let burstCount = 0;
  let lastBurstEnd = -1;
  for (const o of selected) {
    const gap = prevTime < 0 ? Infinity : o.time - prevTime;
    const sec = getSectionAtTime(sections, o.time);
    const inChorus = sec && sec.type === 'Chorus';
    const peakCh = o.climax && isPeakChorus(o.fi);
    const maxBurstN = peakCh ? 8 : 5;
    const climaxMinGap = inChorus ? 0.15 : 0.2;

    if (o.climax) {
      // After a burst sequence, require at least one full beat gap before next burst
      if (lastBurstEnd > 0 && burstCount === 0 && o.time - lastBurstEnd < beatSec - 0.001) continue;
      if (gap >= climaxMinGap - 0.001) {
        if (gap < halfBeat && burstCount >= maxBurstN) {
          if (gap >= halfBeat - 0.001) {
            filtered.push(o);
            prevTime = o.time;
            lastBurstEnd = o.time;
            burstCount = 0;
          }
        } else {
          filtered.push(o);
          prevTime = o.time;
          if (gap < halfBeat) burstCount++;
          else { if (burstCount > 0) lastBurstEnd = prevTime; burstCount = 0; }
        }
      }
    } else {
      if (gap >= halfBeat - 0.001) {
        filtered.push(o);
        prevTime = o.time;
        if (burstCount > 0) lastBurstEnd = prevTime;
        burstCount = 0;
      }
    }
  }

  // --- Step 8: Gap filling (section-aware subdivision) ---
  const maxGapBeats = 2.5;
  const filled = [];
  for (let i = 0; i < filtered.length; i++) {
    filled.push(filtered[i]);
    if (i < filtered.length - 1) {
      const gap = filtered[i + 1].time - filtered[i].time;
      if (gap > beatSec * maxGapBeats) {
        const midTime = (filtered[i].time + filtered[i + 1].time) / 2;
        const sec = getSectionAtTime(sections, midTime);
        const secType = sec ? sec.type : 'Verse';
        // Determine fill interval based on section
        let fillStep;
        const si = Math.floor((midTime / hopSec) / segFrames);
        const isPeak = si < segEnergies.length && segEnergies[si] >= peakSeg * 0.85;
        if (isPeak && secType === 'Chorus') {
          fillStep = beatSec / 4; // 1/16 notes (every quarter-beat)
        } else if (secType === 'Chorus') {
          fillStep = beatSec / 2; // 1/8 notes (every half-beat)
        } else if (secType === 'Intro' || secType === 'Bridge') {
          fillStep = beatSec * 2; // 1/2 notes (every 2 beats)
        } else {
          fillStep = beatSec; // 1/4 notes (every beat) - Verse default
        }
        for (let gt = filtered[i].time + fillStep; gt < filtered[i + 1].time - fillStep * 0.4; gt += fillStep) {
          if (gt - filtered[i].time < fillStep * 0.8) continue;
          filled.push({
            time: gt, energy: (filtered[i].energy + filtered[i + 1].energy) * 0.4,
            strength: 0.1, climax: false, fi: 0,
            lo: filtered[i].lo * 0.5, mi: filtered[i].mi * 0.5, hi: filtered[i].hi * 0.5,
            synthetic: true, dpBonus: 1.0
          });
        }
      }
    }
  }
  filled.sort((a, b) => a.time - b.time);

  // --- Step 9: Direction assignment (frequency-based + balance) ---
  const result = assignNoteDirections(filled);

  // Store sections and swing info on result for debug panel
  result._sections = sections;
  result._swingInfo = swingInfo;

  // Fallback
  if (result.length < 5) {
    const fb = [];
    for (let t = beatSec; t < dur - 0.5; t += beatSec) {
      fb.push({ time: t, dir: fb.length % 2, color: '#48dbfb' });
    }
    console.log(`[PR] Fallback: generated ${fb.length} notes on beat grid`);
    return fb;
  }

  const elapsed = (performance.now() - t0).toFixed(0);
  console.log(`[PR] Beat detection done in ${elapsed}ms: ${result.length} notes, BPM=${bpm.toFixed(1)}, grid=${(gridSize * 1000).toFixed(0)}ms`);

  if (result.length > 0) {
    const preview = result.slice(0, 20).map(n =>
      `${n.time.toFixed(3)}s(${n.dir === 0 ? 'L' : 'R'})`
    ).join(' ');
    console.log(`[PR] First beats: ${preview}${result.length > 20 ? ' ...' : ''}`);
  }

  return result;
}

// ============ POST-PROCESSING PIPELINE ============

// ============ UNIFY DENSE RUN DIRECTIONS (pre-merge) ============
// When notes are densely packed but alternate L/R, unify their direction
// so that mergeDenseNotes can form hold notes from them.
function unifyDenseDirections(notes, threshold) {
  if (!enableHold) return notes;
  const thresh = threshold || (mergeThreshMs / 1000);
  const result = notes.map(n => ({ ...n })); // shallow clone
  let i = 0;
  let unified = 0;
  let globalL = 0, globalR = 0;
  for (const n of result) { if (n.dir === 0) globalL++; else globalR++; }
  while (i < result.length) {
    let j = i + 1;
    while (j < result.length && (result[j].time - result[j - 1].time) <= thresh) j++;
    const runLen = j - i;
    if (runLen >= 3) {
      let lCount = 0, rCount = 0;
      for (let k = i; k < j; k++) {
        if (result[k].dir === 0) lCount++; else rCount++;
      }
      let targetDir;
      if (globalL < globalR) targetDir = 0;
      else if (globalR < globalL) targetDir = 1;
      else targetDir = lCount >= rCount ? 0 : 1;
      for (let k = i; k < j; k++) {
        if (result[k].dir !== targetDir) {
          if (result[k].dir === 0) { globalL--; globalR++; }
          else { globalR--; globalL++; }
          result[k].dir = targetDir;
          unified++;
        }
      }
    }
    i = j;
  }
  if (unified > 0) {
    console.log(`[PR] unifyDenseDirections: unified ${unified} notes (L=${globalL} R=${globalR})`);
  }
  return result;
}

// ============ MIRROR (flip L/R) ============
function applyMirror(notes) {
  if (!mirrorMode) return notes;
  for (const n of notes) n.dir = 1 - n.dir;
  console.log('[PR] Mirror mode: flipped all note directions');
  return notes;
}

// ============ DENSE NOTE MERGING -> HOLD NOTES ============
function mergeDenseNotes(result, mergeThreshold) {
  if (!enableHold) return result;
  const thresh = mergeThreshold || (mergeThreshMs / 1000);
  const merged = [];
  let i = 0;
  while (i < result.length) {
    const start = result[i];
    // Look for consecutive same-side notes within threshold
    let j = i + 1;
    while (j < result.length && result[j].dir === start.dir && (result[j].time - result[j-1].time) <= thresh) {
      j++;
    }
    const runLen = j - i;
    if (runLen >= 3) {
      // Merge into a hold note
      const endNote = result[j - 1];
      // Find highest energy note for color
      let bestColor = start.color;
      let bestEnergy = 0;
      for (let k = i; k < j; k++) {
        const e = (result[k].lo || 0) + (result[k].mi || 0) + (result[k].hi || 0);
        if (e > bestEnergy) { bestEnergy = e; bestColor = result[k].color; }
      }
      merged.push({
        type: 'hold',
        startTime: start.time,
        endTime: endNote.time,
        dir: start.dir,
        color: bestColor || start.color,
        _mergedCount: runLen,
        _spawned: false,
        _holding: false,
        _startJudged: false,
        _endJudged: false
      });
    } else {
      // Keep as individual tap notes
      for (let k = i; k < j; k++) {
        merged.push({ type: 'tap', time: result[k].time, dir: result[k].dir, color: result[k].color });
      }
    }
    i = j;
  }
  // Revert short hold notes back to tap notes
  const minDur = holdMinDuration / 1000;
  const final = [];
  for (const n of merged) {
    if (n.type === 'hold' && (n.endTime - n.startTime) < minDur) {
      // Split back into individual taps: start and end as two taps
      final.push({ type: 'tap', time: n.startTime, dir: n.dir, color: n.color });
      final.push({ type: 'tap', time: n.endTime, dir: n.dir, color: n.color });
    } else {
      final.push(n);
    }
  }
  final.sort((a, b) => (a.type === 'hold' ? a.startTime : a.time) - (b.type === 'hold' ? b.startTime : b.time));
  console.log(`[PR] mergeDenseNotes: ${result.length} notes -> ${final.length} (${final.filter(n=>n.type==='hold').length} holds, minDur=${holdMinDuration}ms)`);
  return final;
}

// ============ EXPAND HOLD BOUNDARIES (absorb nearby taps) ============
function expandHoldBoundaries(notes) {
  if (!enableHold) return notes;
  const expandThresh = mergeThreshMs / 1000;   // reuse merge threshold (e.g. 0.2s)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 3) {
    changed = false;
    iterations++;
    for (let i = 0; i < notes.length; i++) {
      const h = notes[i];
      if (h.type !== 'hold' || h._absorbed) continue;
      // --- absorb earlier same-side taps into hold start ---
      for (let j = i - 1; j >= 0; j--) {
        const n = notes[j];
        if (n.type !== 'tap' || n.dir !== h.dir) continue;
        if (n._absorbed) continue;
        const gap = h.startTime - n.time;
        if (gap < 0 || gap > expandThresh) break;
        h.startTime = n.time;
        n._absorbed = true;
        changed = true;
      }
      // --- absorb later same-side taps into hold end ---
      for (let j = i + 1; j < notes.length; j++) {
        const n = notes[j];
        if (n.type !== 'tap' || n.dir !== h.dir) continue;
        if (n._absorbed) continue;
        const gap = n.time - h.endTime;
        if (gap < 0 || gap > expandThresh) break;
        h.endTime = n.time;
        n._absorbed = true;
        changed = true;
      }
    }
  }
  const result = notes.filter(n => !n._absorbed);
  const absorbed = notes.length - result.length;
  if (absorbed > 0) {
    console.log(`[PR] expandHoldBoundaries: absorbed ${absorbed} taps into holds (${iterations} iterations)`);
  }
  return result;
}

// ============ MERGE ADJACENT HOLDS ============
function mergeAdjacentHolds(notes) {
  if (!enableHold) return notes;
  const gapThresh = 0.3; // seconds -- max gap to merge two same-side holds
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const cur = notes[i];
    if (cur.type !== 'hold') { out.push(cur); continue; }
    // Try to absorb subsequent same-side holds within gap
    let merged = { ...cur };
    let j = i + 1;
    while (j < notes.length) {
      const nxt = notes[j];
      if (nxt.type === 'hold' && nxt.dir === merged.dir && (nxt.startTime - merged.endTime) <= gapThresh) {
        merged.endTime = Math.max(merged.endTime, nxt.endTime);
        j++;
      } else if (nxt.type === 'tap') {
        // skip interleaved taps from the other side; break on same-side tap beyond gap
        j++;
      } else {
        break;
      }
    }
    out.push(merged);
    // skip all notes that were consumed (holds merged + taps already pushed)
    // re-push any non-hold notes that were skipped
    for (let k = i + 1; k < j; k++) {
      if (notes[k].type !== 'hold' || notes[k].dir !== merged.dir) {
        out.push(notes[k]);
      }
    }
    i = j - 1;
  }
  const holdsBefore = notes.filter(n => n.type === 'hold').length;
  const holdsAfter = out.filter(n => n.type === 'hold').length;
  if (holdsBefore !== holdsAfter) {
    console.log(`[PR] mergeAdjacentHolds: ${holdsBefore} holds -> ${holdsAfter} (gap <= ${gapThresh}s)`);
  }
  out.sort((a, b) => (a.type === 'hold' ? a.startTime : a.time) - (b.type === 'hold' ? b.startTime : b.time));
  return out;
}

// ============ INJECT OPPOSITE-SIDE TAPS DURING HOLDS ============
// Reduced density: only inject on strong beats to maintain rhythm without overwhelming.
// After holds are formed, scan for holds with no opposite-side notes
// during their interval and inject beat-aligned taps on the other side.
function injectOppositeNotes(notes, beatSecParam, preMergeGrid) {
  if (!enableHold || !beatSecParam || beatSecParam <= 0) return notes;
  const sortKey = n => n.type === 'hold' ? n.startTime : n.time;
  const holds = notes.filter(n => n.type === 'hold');
  if (holds.length === 0) return notes;

  // Use pre-merge grid (original onset times before notes were absorbed into holds)
  const grid = (preMergeGrid && preMergeGrid.length > 0)
    ? preMergeGrid
    : notes.filter(n => n.type === 'tap').map(n => n.time).sort((a, b) => a - b);

  const injected = [];
  const margin = beatSecParam * 0.5; // wider margin from hold start/end
  const minSpan = 0.4;
  // Minimum spacing between injected opposite notes: one full beat
  const minInjectedGap = beatSecParam * 0.9;
  // Snap tolerance: candidate must be within this distance of a beat grid line
  const snapTolerance = beatSecParam * 0.2;

  for (const h of holds) {
    const span = h.endTime - h.startTime;
    if (span < minSpan) continue;
    const oppDir = 1 - h.dir;
    const rangeStart = h.startTime + margin;
    const rangeEnd = h.endTime - margin;
    if (rangeStart >= rangeEnd) continue;

    const hasOpp = notes.some(n =>
      n.type === 'tap' && n.dir === oppDir &&
      n.time >= rangeStart && n.time <= rangeEnd
    );
    if (hasOpp) continue;

    // Build beat grid lines within the hold range
    const beatGridTimes = [];
    const firstBeat = Math.ceil(rangeStart / beatSecParam) * beatSecParam;
    for (let bt = firstBeat; bt <= rangeEnd; bt += beatSecParam) {
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
    const maxNotes = Math.max(1, Math.floor(span / beatSecParam));

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
    console.log(`[PR] injectOppositeNotes: injected ${injected.length} opposite-side taps during holds (beat-snapped, reduced density)`);
    return all;
  }
  return notes;
}
