// notes.js — Note classes & game judgment
// ============ NOTE CLASS (with per-note color) ============
class Note {
  constructor(beatTime, dir, color) {
    this.init(beatTime, dir, color);
  }
  init(beatTime, dir, color) {
    this.type = 'tap';
    this.beatTime = beatTime;
    this.dir = dir;
    this.alive = true;
    this.judged = false;
    this.spawnDist = Math.max(W * 0.45, H * 0.45, 280);
    this.angle = dir === 0 ? Math.PI : 0;
    this.dx = dir === 0 ? -1 : 1; // pre-cached cos(angle)
    this.dy = 0;                   // pre-cached sin(angle)
    this.color = color || (dir === 0 ? '#48dbfb' : '#ff6b6b');
    this.size = 22;
    this.isDual = false;
    this.yOffset = 0;
    this._dualPairId = 0;
    this._dualFadeStart = 0; // timestamp when partner was judged (for glow fade-out)
    return this;
  }
  getPos(currentTime) {
    const progress = 1 - (this.beatTime - currentTime) / NOTE_TRAVEL_TIME;
    const dist = this.spawnDist * (1 - progress);
    const visualDist = dist + JUDGE_DIST;
    const x = charX + this.dx * visualDist;
    const y = charY + this.dy * visualDist + this.yOffset;
    return { x, y, progress, dist: visualDist };
  }
  draw(currentTime) {
    if (!this.alive) return;
    const { x, y, progress, dist } = this.getPos(currentTime);
    if (progress < -0.1 || progress > 1.3) return;
    const alpha = progress < 0 ? 0.3 : Math.min(1, progress * 1.5);
    // Thin trail line
    if (dist > JUDGE_DIST + 10) {
      ctx.globalAlpha = alpha * 0.2;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(charX + this.dx * (dist + 30), charY + this.dy * (dist + 30) + this.yOffset);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Draw note image (left.png or right.png)
    const noteImg = this.dir === 0 ? noteImgL : noteImgR;
    const imgLoaded = this.dir === 0 ? noteImgLLoaded : noteImgRLoaded;
    if (imgLoaded) {
      const drawSize = this.size * 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(noteImg, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
      ctx.restore();
    } else {
      // Fallback to spoon sprite if image not loaded
      drawSinanSpoon(x, y, this.size, this.angle + Math.PI, this.color, alpha);
    }
    // Dual-press golden glow effect (with fade-out when partner is judged)
    if ((this.isDual || this._dualFadeStart) && dualEffectEnabled) {
      let dualAlpha = 0.35 + 0.15 * Math.sin(performance.now() / 200);
      if (this._dualFadeStart > 0) {
        // Partner was judged — flicker and fade over 300ms
        const fadeElapsed = (performance.now() - this._dualFadeStart) / 300; // 0→1
        if (fadeElapsed >= 1) {
          // Fade complete — remove dual marking
          this.isDual = false;
          this._dualFadeStart = 0;
          this._dualPairId = 0;
        } else {
          // Rapid flicker: sin at high frequency, fading out
          const flicker = Math.sin(performance.now() / 40) * 0.5 + 0.5; // 0~1 fast oscillation
          dualAlpha *= (1 - fadeElapsed) * flicker;
        }
      }
      if (this.isDual || this._dualFadeStart) {
        ctx.save();
        ctx.globalAlpha = alpha * dualAlpha;
        const dualGlowR = this.size * 1.8;
        const dualGrad = ctx.createRadialGradient(x, y, 0, x, y, dualGlowR);
        dualGrad.addColorStop(0, 'rgba(254,202,87,0.7)');
        dualGrad.addColorStop(0.5, 'rgba(254,202,87,0.3)');
        dualGrad.addColorStop(1, 'rgba(254,202,87,0)');
        ctx.fillStyle = dualGrad;
        ctx.beginPath(); ctx.arc(x, y, dualGlowR, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // Approach glow: halo intensifies as note nears judgment arc
    const tipDist = Math.abs(dist - JUDGE_DIST - NOTE_HALF_SIZE);
    if (tipDist < 80) {
      const glowIntensity = 1 - tipDist / 80; // 0→1 as note reaches arc
      const gi2 = glowIntensity * glowIntensity;
      // Outer halo — large and bright
      const haloR = 20 + gi2 * 18;
      const haloGrad = ctx.createRadialGradient(x, y, 0, x, y, haloR);
      const r255 = this.dir === 0 ? 100 : 255;
      const g255 = this.dir === 0 ? 200 : 100;
      const b255 = this.dir === 0 ? 255 : 100;
      haloGrad.addColorStop(0, `rgba(${r255},${g255},${b255},${(0.2 + gi2 * 0.5).toFixed(2)})`);
      haloGrad.addColorStop(0.4, `rgba(${r255},${g255},${b255},${(0.1 + gi2 * 0.3).toFixed(2)})`);
      haloGrad.addColorStop(1, `rgba(${r255},${g255},${b255},0)`);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = `rgba(${r255},${g255},${b255},0.6)`;
      ctx.shadowBlur = gi2 * 16;
      ctx.fillStyle = haloGrad;
      ctx.beginPath(); ctx.arc(x, y, haloR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Warm tint overlay when very close
      if (glowIntensity > 0.4) {
        const tintA = (glowIntensity - 0.4) * 0.6; // max ~0.36
        ctx.globalAlpha = tintA * alpha;
        ctx.fillStyle = 'rgba(255,220,100,1)';
        ctx.beginPath(); ctx.arc(x, y, this.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // Tip marker: red dot at the judgment point on the note
    if (showGuideDots) {
      const hs = this.size;
      const dx = this.dx;
      const dy = this.dy;
      const frontX = x - dx * hs;
      const frontY = y - dy * hs;
      ctx.fillStyle = '#ff3333';
      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath(); ctx.arc(frontX, frontY, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// ============ HOLD NOTE CLASS ============
class HoldNote {
  constructor(startTime, endTime, dir, color, mergedCount) {
    this.init(startTime, endTime, dir, color, mergedCount);
  }
  init(startTime, endTime, dir, color, mergedCount) {
    this.type = 'hold';
    this.startTime = startTime;
    this.endTime = endTime;
    this.beatTime = startTime;
    this.dir = dir;
    this._mergedCount = mergedCount || 2;
    this.alive = true;
    this.judged = false;
    this.spawnDist = Math.max(W * 0.45, H * 0.45, 280);
    this.angle = dir === 0 ? Math.PI : 0;
    this.dx = dir === 0 ? -1 : 1;
    this.dy = 0;
    this.color = color || (dir === 0 ? '#48dbfb' : '#ff6b6b');
    this.size = 22;
    this._holding = false;
    this._startJudged = false;
    this._endJudged = false;
    this._touchId = null;
    this._failTime = 0; // timestamp when fail animation starts
    this.isDual = false;
    this.yOffset = 0;
    this._dualPairId = 0;
    this._dualFadeStart = 0;
    return this;
  }
  // Get position for a given time (same math as Note)
  _getDistForTime(beatTime, currentTime) {
    const progress = 1 - (beatTime - currentTime) / NOTE_TRAVEL_TIME;
    const dist = this.spawnDist * (1 - progress);
    return { dist: dist + JUDGE_DIST, progress };
  }
  getPos(currentTime) {
    return this._getPosForTime(this.startTime, currentTime);
  }
  _getPosForTime(beatTime, currentTime) {
    const { dist, progress } = this._getDistForTime(beatTime, currentTime);
    const x = charX + this.dx * dist;
    const y = charY + this.dy * dist + this.yOffset;
    return { x, y, progress, dist };
  }
  draw(currentTime) {
    // Fail animation: shrink & fade in red
    if (this._failTime > 0) {
      const elapsed = (performance.now() - this._failTime) / 1000;
      if (elapsed > 0.4) return; // animation done
      const t = elapsed / 0.4; // 0→1
      const fadeAlpha = (1 - t) * 0.6;
      const shrink = 1 - t * 0.5;
      const headDist = JUDGE_DIST;
      const hx = charX + this.dx * headDist;
      const hy = charY + this.dy * headDist;
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.translate(hx, hy);
      ctx.scale(shrink, shrink);
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff0000';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (!this.alive && this._endJudged) return;
    const startPos = this._getPosForTime(this.startTime, currentTime);
    const endPos = this._getPosForTime(this.endTime, currentTime);
    if (startPos.progress > 1.5 && endPos.progress > 1.5) return;
    if (startPos.progress < -0.2) return; // head not yet visible

    const alpha = Math.min(1, Math.max(0.2, startPos.progress * 1.5));
    const dx = this.dx;
    const dy = this.dy;

    // Clamp head to judgment arc if start already passed
    let headDist = startPos.dist;
    let tailDist = endPos.dist;
    if (this._startJudged || headDist < JUDGE_DIST) headDist = JUDGE_DIST;
    // Clamp tail to spawn edge so the line doesn't extend infinitely off-screen
    const maxDist = this.spawnDist + JUDGE_DIST + 40;
    if (tailDist > maxDist) tailDist = maxDist;

    const headX = charX + dx * headDist;
    const headY = charY + dy * headDist;
    const tailX = charX + dx * tailDist;
    const tailY = charY + dy * tailDist;

    // Draw hold body (thick line with rounded caps)
    const bodyWidth = this._holding ? 16 : 12;
    ctx.save();
    ctx.globalAlpha = alpha * (this._holding ? 0.85 : 0.7);
    ctx.lineCap = 'round';
    ctx.lineWidth = bodyWidth;

    // Gradient along the hold body
    const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
    const baseColor = this.color;
    const holdColor = this._holding ? '#feca57' : baseColor;
    grad.addColorStop(0, holdColor);
    grad.addColorStop(1, baseColor);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // Inner bright line
    ctx.lineWidth = 4;
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // Holding glow at head
    if (this._holding) {
      ctx.globalAlpha = 0.4 + Math.sin(performance.now() / 150) * 0.2;
      const glowGrad = ctx.createRadialGradient(headX, headY, 0, headX, headY, 18);
      glowGrad.addColorStop(0, 'rgba(254,202,87,0.6)');
      glowGrad.addColorStop(1, 'rgba(254,202,87,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath(); ctx.arc(headX, headY, 18, 0, Math.PI * 2); ctx.fill();
    }

    // Tail marker (circle at end)
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(tailX, tailY, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = alpha * 0.5;
    ctx.beginPath(); ctx.arc(tailX, tailY, 3, 0, Math.PI * 2); ctx.fill();

    // Head marker (note image or circle)
    if (!this._startJudged) {
      const noteImg = this.dir === 0 ? noteImgL : noteImgR;
      const imgLoaded = this.dir === 0 ? noteImgLLoaded : noteImgRLoaded;
      if (imgLoaded) {
        const drawSize = this.size * 2;
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(noteImg, tailX - drawSize/2, tailY - drawSize/2, drawSize, drawSize);
      }
    }

    // Dual-press golden glow on hold head
    if (this.isDual && dualEffectEnabled) {
      const glowTarget = this._startJudged ? headX : tailX;
      const glowTargetY = this._startJudged ? headY : tailY;
      ctx.globalAlpha = alpha * (0.3 + 0.12 * Math.sin(performance.now() / 200));
      const dgr = this.size * 1.8;
      const dgGrad = ctx.createRadialGradient(glowTarget, glowTargetY, 0, glowTarget, glowTargetY, dgr);
      dgGrad.addColorStop(0, 'rgba(254,202,87,0.6)');
      dgGrad.addColorStop(0.5, 'rgba(254,202,87,0.25)');
      dgGrad.addColorStop(1, 'rgba(254,202,87,0)');
      ctx.fillStyle = dgGrad;
      ctx.beginPath(); ctx.arc(glowTarget, glowTargetY, dgr, 0, Math.PI * 2); ctx.fill();
    }

    // End flash when approaching
    if (!this._endJudged && this._holding) {
      const endTipDist = Math.abs(endPos.dist - JUDGE_DIST - NOTE_HALF_SIZE);
      if (endTipDist < 40) {
        const flash = 1 - endTipDist / 40;
        ctx.globalAlpha = flash * 0.6;
        ctx.fillStyle = '#feca57';
        ctx.beginPath(); ctx.arc(headX, headY, 8 + flash * 6, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.restore();
  }
}

// ============ PARTICLES & RIPPLES ============
class Particle {
  constructor(x, y, color) {
    this.init(x, y, color);
  }
  init(x, y, color) {
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
    this.life = 1;
    this.decay = 0.03 + Math.random() * 0.04;
    this.size = 2 + Math.random() * 2;
    this.color = color;
    return this;
  }
  update() { this.x += this.vx; this.y += this.vy; this.life -= this.decay; }
  draw() {
    if (this.life <= 0) return;
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x | 0, this.y | 0, this.size | 0, this.size | 0);
    ctx.globalAlpha = 1;
  }
}
// ============ OBJECT POOLS ============
class ObjectPool {
  constructor(Factory, initialSize) {
    this._Factory = Factory;
    this._pool = [];
    for (let i = 0; i < initialSize; i++) this._pool.push(new Factory(0, 0, ''));
  }
  get(...args) {
    const obj = this._pool.length > 0 ? this._pool.pop() : new this._Factory(0, 0, '');
    obj.init(...args);
    return obj;
  }
  release(obj) { this._pool.push(obj); }
  get size() { return this._pool.length; }
}
const notePool = new ObjectPool(Note, 100);
const holdNotePool = new ObjectPool(HoldNote, 50);
const particlePool = new ObjectPool(Particle, 300);
// ============ GAME LOGIC (getCurrentTime, dual detection, spawn, judgment) ============
// [Feedback, updateUI, Milestones, Stars, Character are in render.js]

function getCurrentTime() {
  if (!audioCtx || !audioStartTime) return 0;
  return audioCtx.currentTime - audioStartTime;
}

// ============ DUAL-PRESS DETECTION ============
function detectDualNotes(beatsArr, threshold) {
  if (!beatsArr || beatsArr.length === 0) return;
  const th = threshold || DUAL_HOLD_THRESHOLD;
  // Reset all dual flags and assign random yOffset to every beat
  for (const b of beatsArr) {
    b.isDual = false;
    b._dualPairId = 0;
    b.yOffset = (Math.random() - 0.5) * 10; // -5 to +5 px
  }
  // Sort by time for efficient scanning
  const sorted = beatsArr.slice().sort((a, b) => {
    const tA = a.type === 'hold' ? a.startTime : a.time;
    const tB = b.type === 'hold' ? b.startTime : b.time;
    return tA - tB;
  });
  const used = new Set();
  let pairId = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i])) continue;
    const a = sorted[i];
    if (a.type === 'hold') continue; // hold notes cannot be part of dual-press
    const tA = a.type === 'hold' ? a.startTime : a.time;
    let bestJ = -1, bestDiff = Infinity;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const tB = b.type === 'hold' ? b.startTime : b.time;
      if (tB - tA > th) break; // past threshold window
      if (used.has(b)) continue;
      if (b.type === 'hold') continue; // hold notes cannot be part of dual-press
      if (a.dir === b.dir) continue; // must be opposite sides
      // Also check: neither note falls within an active hold note's duration
      let duringHold = false;
      for (const s of sorted) {
        if (s.type === 'hold') {
          const hStart = s.startTime;
          const hEnd = s.endTime;
          if ((tA >= hStart - 0.05 && tA <= hEnd + 0.05) || (tB >= hStart - 0.05 && tB <= hEnd + 0.05)) {
            duringHold = true; break;
          }
        }
      }
      if (duringHold) continue;
      const diff = Math.abs(tA - tB);
      if (diff < bestDiff) { bestDiff = diff; bestJ = j; }
    }
    if (bestJ >= 0 && bestDiff <= th) {
      const b = sorted[bestJ];
      const tA2 = a.type === 'hold' ? a.startTime : a.time;
      const tB2 = b.type === 'hold' ? b.startTime : b.time;
      // Align both notes to the same time (average), backup original time first
      const avg = (tA2 + tB2) / 2;
      a._preDualTime = tA2;
      b._preDualTime = tB2;
      if (a.type === 'hold') a.startTime = avg; else a.time = avg;
      if (b.type === 'hold') b.startTime = avg; else b.time = avg;
      a.isDual = true;  b.isDual = true;
      a._dualPairId = pairId; b._dualPairId = pairId;
      a.yOffset = -12; b.yOffset = -12; // shift upward
      used.add(a); used.add(b);
      pairId++;
    }
  }
}

// ============ DUAL-NOTE INJECTION (force more dual-press per difficulty) ============
function injectDualNotes(beatsArr, diff) {
  if (!beatsArr || beatsArr.length < 4) return;
  const d = DIFF_PRESETS[diff] || DIFF_PRESETS.normal;
  const injectRate = d.dualInjectRate || 0;
  if (injectRate <= 0) return;

  // Build a set of time ranges covered by hold notes (no duals during holds)
  const holdRanges = [];
  for (const b of beatsArr) {
    if (b.type === 'hold') {
      holdRanges.push({ start: b.startTime - 0.05, end: b.endTime + 0.05 });
    }
  }
  function isDuringHold(t) {
    for (const hr of holdRanges) {
      if (t >= hr.start && t <= hr.end) return true;
    }
    return false;
  }

  // Count existing duals
  const existingDuals = new Set();
  for (const b of beatsArr) {
    if (b.isDual) existingDuals.add(b);
  }

  // Find single (non-dual) notes sorted by time
  const singles = [];
  for (let i = 0; i < beatsArr.length; i++) {
    if (!beatsArr[i].isDual) singles.push(i);
  }
  if (singles.length < 2) return;

  // Determine how many new duals to inject
  const totalNotes = beatsArr.length;
  const currentDualCount = existingDuals.size;
  const targetDualCount = Math.floor(totalNotes * injectRate);
  let needed = Math.max(0, targetDualCount - currentDualCount);
  if (needed <= 0) return;

  // Candidate single notes: pick tap notes (not hold) that have enough gap from neighbors
  // and are not during a hold note's duration
  const minGap = 0.08; // 80ms minimum gap to next note
  const candidates = [];
  for (const idx of singles) {
    const b = beatsArr[idx];
    if (b.type === 'hold') continue; // never inject duals on hold notes
    const t = b.type === 'hold' ? b.startTime : b.time;
    if (isDuringHold(t)) continue; // skip notes that overlap with a hold's duration
    // Check no other note on the opposite side is too close
    let tooClose = false;
    for (let j = Math.max(0, idx - 3); j <= Math.min(beatsArr.length - 1, idx + 3); j++) {
      if (j === idx) continue;
      const other = beatsArr[j];
      const ot = other.type === 'hold' ? other.startTime : other.time;
      if (Math.abs(ot - t) < minGap && other.dir !== b.dir) {
        tooClose = true; break;
      }
    }
    if (!tooClose) {
      // Expert prioritizes climax/chorus sections; use energy as priority
      candidates.push({ idx, energy: b.energy || b.strength || 0.5, time: t });
    }
  }

  // Distribute candidates evenly across the song timeline
  // Sort by time first, then pick at regular intervals
  candidates.sort((a, b) => a.time - b.time);

  // Inject dual pairs by picking at evenly-spaced intervals from candidates
  let pairId = existingDuals.size + 1;
  let injected = 0;
  const usedTimes = new Set();

  if (needed > 0 && candidates.length > 0) {
    // Calculate step to spread picks evenly across all candidates
    const step = candidates.length / needed;
    const pickIndices = [];
    for (let i = 0; i < needed && i < candidates.length; i++) {
      pickIndices.push(Math.min(Math.floor(i * step + step * 0.5), candidates.length - 1));
    }

    for (const pi of pickIndices) {
      const cand = candidates[pi];
      if (!cand) continue;
      const b = beatsArr[cand.idx];
      if (!b || b.isDual) continue;
      const tKey = Math.round(cand.time * 1000);
      if (usedTimes.has(tKey)) continue;

      // Create a mirrored twin note
      const twin = { ...b };
      twin.dir = b.dir === 0 ? 1 : 0;
      twin.color = b.color || '#48dbfb';
      twin.isDual = true;
      twin._dualPairId = pairId;
      twin.yOffset = -12;
      twin._spawned = false;
      twin._injectedTwin = true; // mark as injected for limit enforcement

      // Hold notes are already excluded from candidates above;
      // double-check: skip if source is a hold note
      if (b.type === 'hold') continue;

      b.isDual = true;
      b._dualPairId = pairId;
      b.yOffset = -12;

      beatsArr.push(twin);
      usedTimes.add(tKey);
      pairId++;
      injected++;
    }
  }

  // Re-sort by time after injection
  beatsArr.sort((a, b) => {
    const tA = a.type === 'hold' ? a.startTime : a.time;
    const tB = b.type === 'hold' ? b.startTime : b.time;
    return tA - tB;
  });

  console.log(`[PR] Dual injection (${diff}): injected ${injected} new dual pairs, total duals: ${existingDuals.size + injected * 2}`);
}

// ============ SPECIAL NOTE LIMITS ENFORCEMENT ============
function enforceSpecialNoteLimits(beatsArr, diff, durationSec) {
  if (!beatsArr || beatsArr.length === 0) return;
  const limits = getSpecialLimits(diff, durationSec);

  // --- 1. Hold note limit ---
  const holds = [];
  for (let i = 0; i < beatsArr.length; i++) {
    if (beatsArr[i].type === 'hold') holds.push(i);
  }
  if (holds.length > limits.maxHolds) {
    // Sort hold indices by duration ascending (shortest first to convert back)
    holds.sort((a, b) => {
      const durA = beatsArr[a].endTime - beatsArr[a].startTime;
      const durB = beatsArr[b].endTime - beatsArr[b].startTime;
      return durA - durB;
    });
    const toConvert = holds.length - limits.maxHolds;
    const convertIndices = new Set(holds.slice(0, toConvert));
    const newBeats = [];
    for (let i = 0; i < beatsArr.length; i++) {
      if (convertIndices.has(i)) {
        const h = beatsArr[i];
        // Replace hold with two tap notes at start and end positions
        newBeats.push({
          type: 'tap', time: h.startTime, dir: h.dir, color: h.color,
          isDual: false, _dualPairId: 0, yOffset: (Math.random() - 0.5) * 10, _spawned: false
        });
        // Only add end tap if it's far enough from start (>= 150ms)
        if (h.endTime - h.startTime >= 0.15) {
          newBeats.push({
            type: 'tap', time: h.endTime, dir: h.dir, color: h.color,
            isDual: false, _dualPairId: 0, yOffset: (Math.random() - 0.5) * 10, _spawned: false
          });
        }
      } else {
        newBeats.push(beatsArr[i]);
      }
    }
    // Replace array contents in-place
    beatsArr.length = 0;
    for (const b of newBeats) beatsArr.push(b);
    // Re-sort by time
    beatsArr.sort((a, b) => {
      const tA = a.type === 'hold' ? a.startTime : a.time;
      const tB = b.type === 'hold' ? b.startTime : b.time;
      return tA - tB;
    });
    console.log(`[PR] Hold limit (${diff}): converted ${toConvert} shortest holds → taps, kept ${limits.maxHolds}`);
  }

  // --- 2. Dual pair limit ---
  const dualPairs = new Map(); // pairId → [noteA, noteB]
  for (const b of beatsArr) {
    if (b.isDual && b._dualPairId > 0) {
      if (!dualPairs.has(b._dualPairId)) dualPairs.set(b._dualPairId, []);
      dualPairs.get(b._dualPairId).push(b);
    }
  }
  const pairCount = dualPairs.size;
  if (pairCount > limits.maxDuals) {
    const pairIds = Array.from(dualPairs.keys());
    // Shuffle to randomly select which pairs to remove
    for (let i = pairIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairIds[i], pairIds[j]] = [pairIds[j], pairIds[i]];
    }
    const toRemove = pairCount - limits.maxDuals;
    const removeIds = new Set(pairIds.slice(0, toRemove));
    const toDelete = []; // indices of injected twin notes to remove entirely
    for (const [pid, pairNotes] of dualPairs) {
      if (removeIds.has(pid)) {
        for (const n of pairNotes) {
          // If this was an injected twin (from injectDualNotes), mark for removal
          if (n._injectedTwin) {
            toDelete.push(n);
          } else {
            // Restore original time if backed up
            if (n._preDualTime != null) {
              if (n.type === 'hold') n.startTime = n._preDualTime;
              else n.time = n._preDualTime;
              delete n._preDualTime;
            }
            n.isDual = false;
            n._dualPairId = 0;
            n.yOffset = (Math.random() - 0.5) * 10;
          }
        }
      }
    }
    // Remove injected twin notes from array
    if (toDelete.length > 0) {
      const deleteSet = new Set(toDelete);
      for (let i = beatsArr.length - 1; i >= 0; i--) {
        if (deleteSet.has(beatsArr[i])) beatsArr.splice(i, 1);
      }
    }
    console.log(`[PR] Dual limit (${diff}): removed ${toRemove} dual pairs, kept ${limits.maxDuals}`);
  }

  // Log final stats
  let finalHolds = 0, finalDualPairs = new Set();
  for (const b of beatsArr) {
    if (b.type === 'hold') finalHolds++;
    if (b.isDual && b._dualPairId > 0) finalDualPairs.add(b._dualPairId);
  }
  console.log(`[PR] Final chart (${diff}): ${beatsArr.length} notes, ${finalHolds} holds, ${finalDualPairs.size} dual pairs | limits: holds≤${limits.maxHolds}, duals≤${limits.maxDuals}`);
}

// Notify dual partner that this note was judged (trigger glow fade-out on partner)
function notifyDualPartnerDead(deadNote) {
  if (!deadNote.isDual || !deadNote._dualPairId) return;
  for (const n of notes) {
    if (n === deadNote) continue;
    if (n._dualPairId === deadNote._dualPairId && n.alive) {
      n._dualFadeStart = performance.now();
    }
  }
}

function spawnNotes() {
  const ct = getCurrentTime();
  for (const bt of beats) {
    if (bt._spawned) continue;
    const spawnTime = bt.type === 'hold' ? bt.startTime : bt.time;
    if (spawnTime - ct < NOTE_TRAVEL_TIME + 0.5) {
      bt._spawned = true;
      let n;
      if (bt.type === 'hold') {
        n = holdNotePool.get(bt.startTime, bt.endTime, bt.dir, bt.color, bt._mergedCount);
      } else {
        n = notePool.get(bt.time, bt.dir, bt.color);
      }
      // Copy dual-press attributes from beat data
      n.isDual = bt.isDual || false;
      n.yOffset = bt.yOffset || 0;
      n._dualPairId = bt._dualPairId || 0;
      notes.push(n);
      (n.dir === 0 ? notesLeft : notesRight).push(n);
    }
  }
}

// Pre-compute per-frame nearest tip distances for each side
function updateNearestTipDists(ct) {
  const r = JUDGE_DIST;
  nearestLeftTipDist = Infinity;
  nearestRightTipDist = Infinity;
  for (const n of notesLeft) {
    if (!n.alive || n.judged) continue;
    const { dist } = n.getPos(ct);
    const tipDist = Math.abs(dist - r - NOTE_HALF_SIZE);
    if (tipDist < nearestLeftTipDist) nearestLeftTipDist = tipDist;
  }
  for (const n of notesRight) {
    if (!n.alive || n.judged) continue;
    const { dist } = n.getPos(ct);
    const tipDist = Math.abs(dist - r - NOTE_HALF_SIZE);
    if (tipDist < nearestRightTipDist) nearestRightTipDist = tipDist;
  }
}

function handleJudge() {
  const ct = getCurrentTime();
  for (const n of notes) {
    if (n.type === 'hold') {
      // Hold note miss: startTime passed without being tapped
      if (!n._startJudged && n.alive) {
        const startPos = n._getPosForTime(n.startTime, ct);
        const tipDist = (startPos.dist - JUDGE_DIST) - NOTE_HALF_SIZE;
        if (tipDist < -tipJudge.hitPx) {
          n.alive = false; n.judged = true;
          n._startJudged = true; n._endJudged = true;
          n._failTime = performance.now();
          misses++; combo = 0;
          const missX = n.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
          feedbacks.push(new Feedback(charX, charY + charH / 2 + 40, 'X', '#ff4444'));
          for (let i = 0; i < 6; i++) particles.push(particlePool.get(missX, charY, '#cc0000'));
          updateUI();
        }
      }
      // Hold note end: auto-miss if endTime passed and not completed
      if (n._startJudged && !n._endJudged && n.alive) {
        if (ct > n.endTime + leniencyMs / 1000) {
          if (!holdTailJudge) {
            // Tail judgment disabled: auto-complete as Perfect
            n._endJudged = true;
            n.alive = false; n.judged = true;
            n._holding = false;
            for (const [tid, hn] of holdTouchMap) { if (hn === n) holdTouchMap.delete(tid); }
            const pts = 300; perfects++; playPerfectSound();
            const earned = Math.floor(pts * (1 + Math.floor(combo / 10) * 0.1));
            score += earned; combo++;
            if (combo > maxComboVal) maxComboVal = combo;
            checkMilestone();
            const { x, y } = n._getPosForTime(n.endTime, ct);
            for (let i = 0; i < 12; i++) particles.push(particlePool.get(x || charX, y || charY, n.color));
            const fbX = n.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
            feedbacks.push(new Feedback(fbX, charY + charH / 2 + 30, 'HOLD END perfect +' + earned, '#feca57'));
            updateUI();
          } else {
            n.alive = false; n.judged = true; n._endJudged = true;
            n._holding = false;
            n._failTime = performance.now();
            // Remove from holdTouchMap
            for (const [tid, hn] of holdTouchMap) { if (hn === n) holdTouchMap.delete(tid); }
            misses++; combo = 0;
            const missX2 = n.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
            feedbacks.push(new Feedback(charX, charY + charH / 2 + 40, 'X 松手!', '#ff4444'));
            for (let i = 0; i < 6; i++) particles.push(particlePool.get(missX2, charY, '#cc0000'));
            updateUI();
          }
        }
      }
      continue;
    }
    // Normal tap note miss
    if (!n.alive || n.judged) continue;
    const pos = n.getPos(ct);
    const centerDist = pos.dist - JUDGE_DIST;
    const tipDist = centerDist - NOTE_HALF_SIZE;
    if (tipDist < -tipJudge.hitPx) {
      n.alive = false;
      n.judged = true;
      notifyDualPartnerDead(n);
      misses++;
      combo = 0;
      feedbacks.push(new Feedback(charX, charY + charH / 2 + 40, 'X', '#ff4444'));
      updateUI();
    }
  }
}

// ---- Multi-touch batch processing ----
// Set of note indices consumed during current batch to prevent double-hit
let _batchConsumed = null;
let _lastTouchStartTime = 0; // prevent mouse+touch double-fire
let _currentTouchId = undefined;

function processTapBatch(points) {
  // points: array of {x, y} or {x: undefined, y: undefined}
  if (!gameRunning || gameEnded || gamePaused) return;
  if (countdownActive || _resumeCountdownActive) return;

  charBounce = 1;
  try { if (navigator.vibrate) navigator.vibrate(15); } catch(e) {}

  _batchConsumed = new Set();
  for (const p of points) {
    playHitSound();
    _currentTouchId = p.touchId;
    onTap(p.x, p.y);
  }
  _currentTouchId = undefined;
  _batchConsumed = null;
}

function onTap(touchX, touchY) {
  if (!gameRunning || gameEnded || gamePaused) return;
  if (countdownActive || _resumeCountdownActive) return;
  if (touchX !== undefined && touchY !== undefined) {
    ripples.push(new Ripple(touchX, touchY));
  }

  // Determine tap side: left of character center → dir 0, right → dir 1
  // If touchX is undefined (e.g. spacebar), tapDir = -1 means match any side
  let tapDir = -1;
  if (touchX !== undefined) {
    tapDir = touchX < charX ? 0 : 1;
  }

  const ct = getCurrentTime();

  // --- Hold note start detection ---
  if (enableHold) {
    let bestHold = null, bestHoldTip = Infinity;
    for (const n of notes) {
      if (n.type !== 'hold' || !n.alive || n._startJudged) continue;
      if (_batchConsumed && _batchConsumed.has(n)) continue;
      if (tapDir >= 0 && n.dir !== tapDir) continue;
      const pos = n._getPosForTime(n.startTime, ct);
      const tipDist = (pos.dist - JUDGE_DIST) - NOTE_HALF_SIZE;
      if (Math.abs(tipDist) > tipJudge.hitPx) continue;
      if (Math.abs(tipDist) < bestHoldTip) { bestHold = n; bestHoldTip = Math.abs(tipDist); }
    }
    // Leniency fallback for hold start
    if (!bestHold && leniencyMs > 0) {
      let bestTD = Infinity;
      for (const n of notes) {
        if (n.type !== 'hold' || !n.alive || n._startJudged) continue;
        if (_batchConsumed && _batchConsumed.has(n)) continue;
        if (tapDir >= 0 && n.dir !== tapDir) continue;
        const diff = Math.abs(ct - n.startTime);
        if (diff <= leniencyMs / 1000 && diff < bestTD) { bestHold = n; bestTD = diff; bestHoldTip = -1; }
      }
    }
    if (bestHold) {
      if (_batchConsumed) _batchConsumed.add(bestHold);
      bestHold._startJudged = true;
      bestHold._holding = true;
      // Store touch association
      if (_currentTouchId !== undefined) holdTouchMap.set(_currentTouchId, bestHold);
      else holdTouchMap.set('mouse', bestHold);
      // Grade start
      let label, color, pts;
      if (bestHoldTip < 0) {
        // leniency
        const diffMs = Math.abs(ct - bestHold.startTime) * 1000;
        const third = leniencyMs / 3;
        if (diffMs <= third) { label = 'perfect'; color = '#feca57'; pts = 300; perfects++; playPerfectSound(); }
        else if (diffMs <= third * 2) { label = 'good'; color = '#48dbfb'; pts = 150; goods++; }
        else { label = 'hit'; color = '#2ecc71'; pts = 50; hits++; }
      } else {
        if (bestHoldTip <= tipJudge.perfectPx) { label = 'perfect'; color = '#feca57'; pts = 300; perfects++; playPerfectSound(); }
        else if (bestHoldTip <= tipJudge.goodPx) { label = 'good'; color = '#48dbfb'; pts = 150; goods++; }
        else { label = 'hit'; color = '#2ecc71'; pts = 50; hits++; }
      }
      // Hold start scoring: single note score (same as tap)
      const earned = Math.floor(pts * (1 + Math.floor(combo / 10) * 0.1));
      score += earned; combo++;
      if (combo > maxComboVal) maxComboVal = combo;
      checkMilestone();
      const fbX = bestHold.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
      feedbacks.push(new Feedback(fbX, charY + charH / 2 + 30, 'HOLD ' + label + ' +' + earned, color));
      updateUI();
      return; // consumed by hold note
    }
  }

  // --- Normal tap note detection ---
  let best = null, bestAbsTip = Infinity;
  let lenient = false;
  for (const n of notes) {
    if (!n.alive || n.judged) continue;
    if (n.type === 'hold') continue; // skip hold notes in tap matching
    if (_batchConsumed && _batchConsumed.has(n)) continue;
    if (tapDir >= 0 && n.dir !== tapDir) continue;
    const pos = n.getPos(ct);
    const centerDist = pos.dist - JUDGE_DIST;
    // tipDist: distance of spoon tip (front edge) to the judgment arc
    // positive = tip hasn't reached arc, negative = tip passed arc
    const tipDist = centerDist - NOTE_HALF_SIZE;
    // Only consider notes whose tip is within the hit window
    if (Math.abs(tipDist) > tipJudge.hitPx) continue;
    if (Math.abs(tipDist) < bestAbsTip) {
      best = n; bestAbsTip = Math.abs(tipDist);
    }
  }

  // Leniency fallback: if no tip-based match, find nearest note within time threshold
  if (!best && leniencyMs > 0) {
    let bestTimeDiff = Infinity;
    for (const n of notes) {
      if (!n.alive || n.judged) continue;
      if (n.type === 'hold') continue;
      if (_batchConsumed && _batchConsumed.has(n)) continue;
      if (tapDir >= 0 && n.dir !== tapDir) continue;
      const diff = Math.abs(ct - n.beatTime);
      if (diff <= leniencyMs / 1000 && diff < bestTimeDiff) {
        best = n; bestTimeDiff = diff;
      }
    }
    if (best) lenient = true;
  }

  if (!best) return;
  best.alive = false;
  best.judged = true;
  notifyDualPartnerDead(best);
  if (_batchConsumed) _batchConsumed.add(best);
  let label, color, pts;

  if (lenient) {
    // Leniency fallback: grade by time difference
    const diffMs = Math.abs(ct - best.beatTime) * 1000;
    const leniencyThird = leniencyMs / 3;
    if (diffMs <= leniencyThird) {
      label = 'perfect'; color = '#feca57'; pts = 300; perfects++; playPerfectSound();
    } else if (diffMs <= leniencyThird * 2) {
      label = 'good'; color = '#48dbfb'; pts = 150; goods++;
    } else {
      label = 'hit'; color = '#2ecc71'; pts = 50; hits++;
    }
  } else {
    // Tip-based judgment: grade by tip distance to arc
    if (bestAbsTip <= tipJudge.perfectPx) {
      label = 'perfect'; color = '#feca57'; pts = 300; perfects++; playPerfectSound();
    } else if (bestAbsTip <= tipJudge.goodPx) {
      label = 'good'; color = '#48dbfb'; pts = 150; goods++;
    } else {
      label = 'hit'; color = '#2ecc71'; pts = 50; hits++;
    }
  }
  const earned = Math.floor(pts * (1 + Math.floor(combo / 10) * 0.1));
  score += earned;
  combo++;
  if (combo > maxComboVal) maxComboVal = combo;
  checkMilestone();
  // Particles
  const { x, y } = best.getPos(ct);
  for (let i = 0; i < 8; i++) particles.push(particlePool.get(x, y, best.color));
  // Feedback near the judgment arc on the note's side
  const fbX = best.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
  const fbText = label + ' +' + earned + (lenient ? ' (宽容)' : '');
  feedbacks.push(new Feedback(fbX, charY + charH / 2 + 30, fbText, color));
  updateUI();
}

// ============ HOLD NOTE RELEASE ============
function onRelease(touchId) {
  if (!gameRunning || gameEnded || gamePaused) return;
  const id = touchId !== undefined ? touchId : 'mouse';
  const holdNote = holdTouchMap.get(id);
  if (!holdNote) return;
  holdTouchMap.delete(id);
  if (!holdNote._holding || holdNote._endJudged) return;
  holdNote._holding = false;

  // If tail judgment is disabled, just detach touch — auto-complete handles the rest
  if (!holdTailJudge) return;

  const ct = getCurrentTime();
  const diffMs = Math.abs(ct - holdNote.endTime) * 1000;
  const earlyRelease = ct < holdNote.endTime - leniencyMs / 1000;

  if (earlyRelease) {
    // Released too early → miss the end
    holdNote._endJudged = true;
    holdNote.alive = false; holdNote.judged = true;
    holdNote._failTime = performance.now();
    misses++; combo = 0;
    const fbX = holdNote.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
    feedbacks.push(new Feedback(fbX, charY + charH / 2 + 30, 'X 太早!', '#ff4444'));
    // Red burst particles
    for (let i = 0; i < 8; i++) particles.push(particlePool.get(fbX, charY, '#cc0000'));
    updateUI();
    return;
  }

  // Grade end timing
  let label, color, pts;
  const third = Math.max(leniencyMs, 80) / 3;
  if (diffMs <= third) { label = 'perfect'; color = '#feca57'; pts = 300; perfects++; playPerfectSound(); }
  else if (diffMs <= third * 2) { label = 'good'; color = '#48dbfb'; pts = 150; goods++; }
  else { label = 'hit'; color = '#2ecc71'; pts = 50; hits++; }

  holdNote._endJudged = true;
  holdNote.alive = false; holdNote.judged = true;
  // Hold end scoring: single note score (same as tap)
  const earned = Math.floor(pts * (1 + Math.floor(combo / 10) * 0.1));
  score += earned; combo++;
  if (combo > maxComboVal) maxComboVal = combo;
  checkMilestone();
  const { x, y } = holdNote._getPosForTime(holdNote.endTime, ct);
  for (let i = 0; i < 12; i++) particles.push(particlePool.get(x || charX, y || charY, holdNote.color));
  const fbX = holdNote.dir === 0 ? charX - JUDGE_DIST : charX + JUDGE_DIST;
  feedbacks.push(new Feedback(fbX, charY + charH / 2 + 30, 'HOLD END ' + label + ' +' + earned, color));
  updateUI();
}

