// render.js — Rendering, game loop & flow control

// Helper: invalidate all background caches (call after resize or fullscreen changes)
function invalidateBgCaches() {
  bgCache = null;
  bgCache2 = null;
}

// Helper: reset all runtime note/particle/feedback arrays
function resetGameArrays() {
  notes = []; notesLeft = []; notesRight = [];
  particles = []; feedbacks = []; ripples = [];
  holdTouchMap.clear();
}

// ============ RIPPLE CLASS ============
class Ripple {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 5; this.maxR = 40;
    this.life = 1;
  }
  update() {
    this.r += 2;
    this.life = 1 - (this.r / this.maxR);
  }
  draw() {
    if (this.life <= 0) return;
    ctx.globalAlpha = this.life * 0.4;
    ctx.strokeStyle = '#e0c3fc';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ============ FEEDBACK & COMBO EFFECTS ============
class Feedback {
  constructor(x, y, text, color) {
    this.x = x; this.y = y;
    this.text = text; this.color = color;
    this.life = 1; this.decay = 0.022;
    this.scale = 1.5; // starts big, shrinks to 1
  }
  update() {
    this.y -= 0.8;
    this.life -= this.decay;
    if (this.scale > 1) this.scale -= 0.06;
    if (this.scale < 1) this.scale = 1;
  }
  draw() {
    if (this.life <= 0) return;
    ctx.globalAlpha = this.life;
    const sz = Math.round(20 * this.scale);
    ctx.font = `bold ${sz}px 'Courier New',monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1;
  }
}
function updateUI() {
  const sv = document.getElementById('scoreVal');
  const cv = document.getElementById('comboVal');
  sv.textContent = Math.floor(score);
  cv.textContent = combo;
  // Pop animation via CSS class
  const sd = document.getElementById('scoreDisplay');
  const cd = document.getElementById('comboDisplay');
  sd.classList.remove('pop');
  cd.classList.remove('pop');
  cd.classList.remove('combo-pop');
  void sd.offsetWidth; // force reflow
  sd.classList.add('pop');
  cd.classList.add('pop');
  if (combo > 1) cd.classList.add('combo-pop');
  setTimeout(() => { sd.classList.remove('pop'); cd.classList.remove('pop'); }, 150);
  setTimeout(() => { cd.classList.remove('combo-pop'); }, 350);
}
// ============ COMBO MILESTONE SYSTEM ============
const MILESTONES = [10, 20, 30, 50, 75, 100];
let lastMilestone = 0;
let screenFlashAlpha = 0;
let milestoneTexts = []; // {text, life, scale, color}

function triggerMilestone(comboVal) {
  // Rainbow particles burst from both judgment arcs
  const arcRad = (ARC_DEG / 2) * Math.PI / 180;
  for (let i = 0; i < 30; i++) {
    const hue = (i * 12) % 360;
    const color = `hsl(${hue},100%,60%)`;
    // Spawn from left or right arc
    const side = i < 15 ? Math.PI : 0;
    const ang = side + (Math.random() - 0.5) * arcRad * 2;
    const px = charX + Math.cos(ang) * JUDGE_DIST;
    const py = charY + Math.sin(ang) * JUDGE_DIST;
    const p = particlePool.get(px, py, color);
    p.vx = Math.cos(ang) * (3 + Math.random() * 5);
    p.vy = Math.sin(ang) * (3 + Math.random() * 5) - Math.random() * 2;
    p.decay = 0.015 + Math.random() * 0.015;
    p.size = 3 + Math.random() * 3;
    particles.push(p);
  }
  // Screen flash
  screenFlashAlpha = 0.5;
  // Sound (reuse hit sound with higher gain)
  if (hitSndBuffer && audioCtx) {
    try {
      const src = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      src.buffer = hitSndBuffer;
      gain.gain.value = Math.min(1.0, hitVolume * 2);
      src.connect(gain);
      gain.connect(audioCtx.destination);
      src.start(0);
    } catch(e) {}
  }
  // Centered milestone text
  const hue = (comboVal * 7) % 360;
  milestoneTexts.push({
    text: 'COMBO x' + comboVal + '!',
    life: 1,
    scale: 2.5,
    color: `hsl(${hue},100%,65%)`,
    y: H * 0.32
  });
}

function checkMilestone() {
  if (MILESTONES.indexOf(combo) !== -1 && combo !== lastMilestone) {
    lastMilestone = combo;
    triggerMilestone(combo);
  }
}

function drawScreenFlash() {
  if (screenFlashAlpha <= 0.01) { screenFlashAlpha = 0; return; }
  ctx.globalAlpha = screenFlashAlpha;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  screenFlashAlpha *= 0.88;
}

function drawMilestoneTexts() {
  for (let i = milestoneTexts.length - 1; i >= 0; i--) {
    const m = milestoneTexts[i];
    if (m.life <= 0) { milestoneTexts.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.min(1, m.life * 1.5);
    if (m.scale > 1) m.scale *= 0.92;
    if (m.scale < 1) m.scale = 1;
    const sz = Math.round(clamp(36, 28, 48) * m.scale);
    ctx.font = `bold ${sz}px 'Courier New',monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, W / 2, m.y);
    // Subtle outline for readability
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeText(m.text, W / 2, m.y);
    ctx.restore();
    m.y -= 0.35;
    m.life -= 0.011;
  }
}

function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
// ============ STARS BACKGROUND (cached) ============
let stars = [];
function initStars() {
  stars = [];
  for (let i = 0; i < 40; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * H,
      s: 1 + Math.random() * 2, b: Math.random(), sp: 0.005 + Math.random() * 0.015 });
  }
  starsDirty = true;
}
function updateStarsCache() {
  if (!starsCache) {
    starsCache = document.createElement('canvas');
    starsCache.width = W * dpr; starsCache.height = H * dpr;
  }
  const sctx = starsCache.getContext('2d');
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.clearRect(0, 0, W, H);
  sctx.fillStyle = '#fff';
  for (const s of stars) {
    s.b += s.sp * 6;
    sctx.globalAlpha = 0.3 + Math.abs(Math.sin(s.b)) * 0.5;
    sctx.fillRect(s.x | 0, s.y | 0, s.s | 0, s.s | 0);
  }
  sctx.globalAlpha = 1;
  starsDirty = false;
}
function drawStars() {
  starsTimer++;
  if (starsTimer >= 6 || starsDirty) { updateStarsCache(); starsTimer = 0; }
  if (starsCache) ctx.drawImage(starsCache, 0, 0, W * dpr, H * dpr, 0, 0, W, H);
}
// ============ CHARACTER DRAWING ============
function drawCharacter() {
  if (!charLoaded) return;
  if (charBounce > 0.01) charBounce *= 0.88; else charBounce = 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const pulseScale = 1 + charBounce * 0.15;
  const squashY = 1 + charBounce * 0.1;
  const bounceY = -charBounce * 8;
  ctx.translate(charX, charY + bounceY);
  ctx.scale(pulseScale, squashY);
  ctx.drawImage(charImg, -charW / 2, -charH / 2, charW, charH);
  ctx.restore();
}
// ============ JUDGMENT ARCS (no shadowBlur) ============
let judgeGlow = 0;
function hslColor(h, s, l) { return `hsl(${h},${s}%,${l}%)`; }
function drawJudgmentArcs(ct) {
  // ---- VERTICAL MODE: horizontal judgment bars at bottom ----
  if (verticalMode) {
    judgeGlow += 0.05;
    const pulse = 0.35 + Math.sin(judgeGlow) * 0.15;
    const comboGlow = combo >= 10;
    const hue1 = (judgeGlow * 60) % 360;
    const hue2 = (hue1 + 180) % 360;
    const barW = Math.max(W * 0.14, 44);
    const barH = 4;
    const lanes = [
      { x: vLaneLeftX, color: '#48dbfb', hue: hue1, nearDist: nearestLeftTipDist },
      { x: vLaneRightX, color: '#ff6b6b', hue: hue2, nearDist: nearestRightTipDist }
    ];
    for (const lane of lanes) {
      const bx = lane.x - barW / 2;
      // Base bar
      ctx.save();
      if (comboGlow) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = hslColor(lane.hue, 90, 70);
      } else {
        ctx.globalAlpha = pulse;
        ctx.fillStyle = lane.color;
      }
      ctx.fillRect(bx, vJudgeY - barH / 2, barW, barH);
      // Inner bright line
      ctx.globalAlpha = comboGlow ? 0.6 : 0.4;
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx, vJudgeY - 1, barW, 2);
      ctx.restore();

      // Dynamic glow based on nearest note
      if (typeof ct === 'number' && lane.nearDist < 120) {
        const intensity = 1 - lane.nearDist / 120;
        const i2 = intensity * intensity;
        ctx.save();
        ctx.globalAlpha = 0.15 + i2 * 0.7;
        ctx.shadowColor = 'rgba(255,40,40,1)';
        ctx.shadowBlur = 8 + i2 * 30;
        ctx.fillStyle = `rgba(255,${Math.round(80 - i2 * 60)},${Math.round(60 - i2 * 50)},1)`;
        ctx.fillRect(bx - 4, vJudgeY - barH, barW + 8, barH * 2);
        ctx.restore();
      }

      // Faint judgment zone background
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#ff3c3c';
      ctx.fillRect(bx - 6, vJudgeY - tipJudge.hitPx, barW + 12, tipJudge.hitPx * 2);
      ctx.globalAlpha = 1;
    }

    // Guide rings (horizontal bands)
    if (showGuideDots) {
      for (const lane of lanes) {
        const bx = lane.x - barW / 2;
        // Hit band
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(bx - 4, vJudgeY - tipJudge.hitPx, barW + 8, tipJudge.hitPx * 2);
        // Good band
        ctx.fillStyle = '#48dbfb';
        ctx.fillRect(bx - 4, vJudgeY - tipJudge.goodPx, barW + 8, tipJudge.goodPx * 2);
        // Perfect band
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#feca57';
        ctx.fillRect(bx - 4, vJudgeY - tipJudge.perfectPx, barW + 8, tipJudge.perfectPx * 2);
        ctx.globalAlpha = 1;
      }
    }
    return;
  }
  judgeGlow += 0.05;
  const r = JUDGE_DIST;
  const arcRad = (ARC_DEG / 2) * Math.PI / 180;
  const pulse = 0.35 + Math.sin(judgeGlow) * 0.15;
  const comboGlow = combo >= 10;
  const hue1 = (judgeGlow * 60) % 360;
  const hue2 = (hue1 + 180) % 360;
  ctx.save();
  if (comboGlow) {
    const glowA = 0.25 + Math.sin(judgeGlow * 2) * 0.1;
    ctx.lineWidth = 8;
    ctx.globalAlpha = glowA;
    ctx.strokeStyle = hslColor(hue1, 100, 60);
    ctx.beginPath(); ctx.arc(charX, charY, r, Math.PI - arcRad, Math.PI + arcRad); ctx.stroke();
    ctx.strokeStyle = hslColor(hue2, 100, 60);
    ctx.beginPath(); ctx.arc(charX, charY, r, -arcRad, arcRad); ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = hslColor(hue1, 90, 70);
    ctx.beginPath(); ctx.arc(charX, charY, r, Math.PI - arcRad, Math.PI + arcRad); ctx.stroke();
    ctx.strokeStyle = hslColor(hue2, 90, 70);
    ctx.beginPath(); ctx.arc(charX, charY, r, -arcRad, arcRad); ctx.stroke();
  } else {
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(charX, charY, r, Math.PI - arcRad, Math.PI + arcRad); ctx.stroke();
    ctx.beginPath(); ctx.arc(charX, charY, r, -arcRad, arcRad); ctx.stroke();
  }
  ctx.restore();
  // Inner arcs
  ctx.lineWidth = 1.5;
  if (comboGlow) { ctx.strokeStyle = hslColor(hue1, 70, 50); ctx.globalAlpha = 0.6; }
  else { ctx.strokeStyle = 'rgba(255,107,107,0.5)'; }
  ctx.beginPath(); ctx.arc(charX, charY, r - 2, Math.PI - arcRad, Math.PI + arcRad); ctx.stroke();
  if (comboGlow) { ctx.strokeStyle = hslColor(hue2, 70, 50); }
  else { ctx.strokeStyle = 'rgba(254,202,87,0.5)'; }
  ctx.beginPath(); ctx.arc(charX, charY, r - 2, -arcRad, arcRad); ctx.stroke();
  ctx.globalAlpha = 1;
  // Always-visible faint red glow in judgment zone (tipR +/- hitPx)
  {
    const tipR = r + NOTE_HALF_SIZE;
    const hitR = tipJudge.hitPx;
    for (const side of [Math.PI, 0]) {
      // Radial gradient centered on tipR for each arc side
      const cx = charX + Math.cos(side) * tipR;
      const cy = charY + Math.sin(side) * tipR;
      // Draw a soft glow band using arc fill with low alpha
      const innerR = tipR - hitR - 4;
      const outerR = tipR + hitR + 4;
      // Create radial gradient from inner to outer
      const grad = ctx.createRadialGradient(charX, charY, innerR, charX, charY, outerR);
      grad.addColorStop(0.0,  'rgba(255,60,60,0.0)');
      grad.addColorStop(0.15, 'rgba(255,60,60,0.08)');
      grad.addColorStop(0.35, 'rgba(255,60,60,0.16)');
      grad.addColorStop(0.5,  'rgba(255,60,60,0.20)');
      grad.addColorStop(0.65, 'rgba(255,60,60,0.16)');
      grad.addColorStop(0.85, 'rgba(255,60,60,0.08)');
      grad.addColorStop(1.0,  'rgba(255,60,60,0.0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(charX, charY, outerR, side - arcRad, side + arcRad);
      ctx.arc(charX, charY, innerR, side + arcRad, side - arcRad, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Dynamic arc highlight based on nearest approaching note ----
  if (typeof ct === 'number') {
    // Use pre-computed nearest tip distances (updated once per frame in gameLoop)
    const sideDists = [[Math.PI, nearestLeftTipDist], [0, nearestRightTipDist]];
    for (const [side, closestTipDist] of sideDists) {
      // Dynamic glow: intensity ramps up as note approaches (within 120px)
      const glowRange = 120;
      if (closestTipDist < glowRange) {
        const intensity = 1 - closestTipDist / glowRange; // 0->1 as note approaches
        const i2 = intensity * intensity; // quadratic ramp for punchier feel
        // Bright arc overlay -- double stroke for thickness
        ctx.save();
        ctx.lineWidth = 6 + i2 * 10;
        ctx.globalAlpha = 0.15 + i2 * 0.7;
        ctx.strokeStyle = `rgba(255,${Math.round(80 - i2 * 60)},${Math.round(60 - i2 * 50)},1)`;
        ctx.shadowColor = 'rgba(255,40,40,1)';
        ctx.shadowBlur = 8 + i2 * 30;
        ctx.beginPath();
        ctx.arc(charX, charY, r, side - arcRad, side + arcRad);
        ctx.stroke();
        // Second pass for extra glow
        ctx.lineWidth = 2 + i2 * 4;
        ctx.globalAlpha = 0.3 + i2 * 0.6;
        ctx.strokeStyle = `rgba(255,${Math.round(200 - i2 * 100)},${Math.round(150 - i2 * 100)},1)`;
        ctx.shadowBlur = 4 + i2 * 16;
        ctx.beginPath();
        ctx.arc(charX, charY, r, side - arcRad, side + arcRad);
        ctx.stroke();
        ctx.restore();

        // Perfect point indicator: bright pulsing dot on arc
        if (closestTipDist < 60) {
          const dotIntensity = 1 - closestTipDist / 60;
          const di2 = dotIntensity * dotIntensity;
          const pulseSize = Math.sin(judgeGlow * 6) * 1.5; // subtle pulse
          ctx.save();
          ctx.globalAlpha = 0.5 + di2 * 0.5;
          ctx.fillStyle = '#fff';
          ctx.shadowColor = 'rgba(255,200,80,1)';
          ctx.shadowBlur = 12 + di2 * 20;
          ctx.beginPath();
          ctx.arc(charX + Math.cos(side) * r, charY, 4 + di2 * 5 + pulseSize, 0, Math.PI * 2);
          ctx.fill();
          // Inner bright core
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.7 + di2 * 0.3;
          ctx.fillStyle = 'rgba(255,255,220,1)';
          ctx.beginPath();
          ctx.arc(charX + Math.cos(side) * r, charY, 2 + di2 * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Guide: tip-based judgment distance rings when showGuideDots is on
  if (showGuideDots) {
    // The tip hits the arc at radius r + NOTE_HALF_SIZE (note center perspective).
    // Judgment rings are centered on that radius, showing +/-perfectPx / +/-goodPx / +/-hitPx.
    const tipR = r + NOTE_HALF_SIZE; // radius where tip aligns with arc

    // Fill concentric bands (from outside in: Hit -> Good -> Perfect -> Good -> Hit)
    // Hit band (green)
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#2ecc71';
    for (const side of [Math.PI, 0]) {
      ctx.beginPath();
      ctx.arc(charX, charY, tipR + tipJudge.hitPx, side - arcRad, side + arcRad);
      ctx.arc(charX, charY, tipR - tipJudge.hitPx, side + arcRad, side - arcRad, true);
      ctx.closePath(); ctx.fill();
    }
    // Good band (cyan)
    ctx.fillStyle = '#48dbfb';
    for (const side of [Math.PI, 0]) {
      ctx.beginPath();
      ctx.arc(charX, charY, tipR + tipJudge.goodPx, side - arcRad, side + arcRad);
      ctx.arc(charX, charY, tipR - tipJudge.goodPx, side + arcRad, side - arcRad, true);
      ctx.closePath(); ctx.fill();
    }
    // Perfect band (gold)
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#feca57';
    for (const side of [Math.PI, 0]) {
      ctx.beginPath();
      ctx.arc(charX, charY, tipR + tipJudge.perfectPx, side - arcRad, side + arcRad);
      ctx.arc(charX, charY, tipR - tipJudge.perfectPx, side + arcRad, side - arcRad, true);
      ctx.closePath(); ctx.fill();
    }

    // Ring lines
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    // Tip target line (gold, solid) -- the ideal hit point
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#feca57';
    for (const side of [Math.PI, 0]) {
      ctx.beginPath(); ctx.arc(charX, charY, tipR, side - arcRad, side + arcRad); ctx.stroke();
    }
    // Perfect boundary (gold, dashed)
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([3, 3]);
    for (const side of [Math.PI, 0]) {
      ctx.beginPath(); ctx.arc(charX, charY, tipR + tipJudge.perfectPx, side - arcRad, side + arcRad); ctx.stroke();
      ctx.beginPath(); ctx.arc(charX, charY, tipR - tipJudge.perfectPx, side - arcRad, side + arcRad); ctx.stroke();
    }
    // Good boundary (cyan, dashed)
    ctx.strokeStyle = '#48dbfb';
    ctx.globalAlpha = 0.25;
    for (const side of [Math.PI, 0]) {
      ctx.beginPath(); ctx.arc(charX, charY, tipR + tipJudge.goodPx, side - arcRad, side + arcRad); ctx.stroke();
      ctx.beginPath(); ctx.arc(charX, charY, tipR - tipJudge.goodPx, side - arcRad, side + arcRad); ctx.stroke();
    }
    // Hit boundary (green, dashed)
    ctx.strokeStyle = '#2ecc71';
    ctx.globalAlpha = 0.2;
    for (const side of [Math.PI, 0]) {
      ctx.beginPath(); ctx.arc(charX, charY, tipR + tipJudge.hitPx, side - arcRad, side + arcRad); ctx.stroke();
      ctx.beginPath(); ctx.arc(charX, charY, tipR - tipJudge.hitPx, side - arcRad, side + arcRad); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Labels
    ctx.globalAlpha = 0.5;
    ctx.font = '10px Courier New, monospace';
    ctx.textAlign = 'center';
    const ly = charY - 8;
    // Left arc
    ctx.fillStyle = '#feca57'; ctx.fillText('P', charX - tipR, ly);
    ctx.fillStyle = '#48dbfb'; ctx.fillText('G', charX - tipR - tipJudge.goodPx, ly);
    ctx.fillStyle = '#2ecc71'; ctx.fillText('H', charX - tipR - tipJudge.hitPx, ly);
    // Right arc
    ctx.fillStyle = '#feca57'; ctx.fillText('P', charX + tipR, ly);
    ctx.fillStyle = '#48dbfb'; ctx.fillText('G', charX + tipR + tipJudge.goodPx, ly);
    ctx.fillStyle = '#2ecc71'; ctx.fillText('H', charX + tipR + tipJudge.hitPx, ly);

    ctx.globalAlpha = 1;
  }
}
// Combo orbiting particles (for combo >= 10, no shadowBlur)
function drawComboOrbs(ct) {
  if (combo < 10) return;
  const orbCount = Math.min(12, 4 + Math.floor((combo - 10) / 5));
  const orbR = JUDGE_DIST + 20;
  const speed = 1.5 + combo * 0.02;
  // HSL cycling for combo >= 30
  const useRainbow = combo >= 30;
  for (let i = 0; i < orbCount; i++) {
    const ang = (ct * speed + (i / orbCount) * Math.PI * 2) % (Math.PI * 2);
    const ox = charX + Math.cos(ang) * orbR;
    const oy = charY + Math.sin(ang) * orbR;
    const sz = 2 + (combo >= 20 ? 1 : 0);
    if (useRainbow) {
      const h = ((ct * 80) + i * 30) % 360;
      ctx.fillStyle = hslColor(h, 90, 65);
    } else {
      ctx.fillStyle = '#e0c3fc';
    }
    ctx.globalAlpha = 0.6 + Math.sin(ct * 3 + i) * 0.2;
    ctx.fillRect(ox | 0, oy | 0, sz, sz);
  }
  ctx.globalAlpha = 1;
  // Edge vignette for combo >= 20
  if (combo >= 20) {
    const intensity = Math.min(0.15, (combo - 20) / 100);
    const pulseA = intensity + Math.sin(ct * 2) * 0.03;
    const h = useRainbow ? ((ct * 40) % 360) : 270;
    // Top/bottom edge bars
    ctx.fillStyle = hslColor(h, 60, 50);
    ctx.globalAlpha = pulseA;
    ctx.fillRect(0, 0, W, 6);
    ctx.fillRect(0, H - 6, W, 6);
    ctx.fillRect(0, 0, 6, H);
    ctx.fillRect(W - 6, 0, 6, H);
    ctx.globalAlpha = 1;
  }
}
// ============ AUDIO VISUALIZER (throttled) ============
let freqData;
let vizCache = null;
function drawAudioRing() {
  if (!analyser) return;
  if (frameCount % 3 !== 0 && vizCache) {
    for (const seg of vizCache) {
      ctx.strokeStyle = seg.style; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke();
    }
    return;
  }
  if (!freqData) freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);
  const slices = 24;
  const step = Math.floor(freqData.length / slices);
  vizCache = [];
  for (let i = 0; i < slices; i++) {
    const val = freqData[i * step] / 255;
    const ang = (i / slices) * Math.PI * 2 - Math.PI / 2;
    const baseR = JUDGE_DIST + 12;
    const len = val * 25;
    const x1 = charX + Math.cos(ang) * baseR, y1 = charY + Math.sin(ang) * baseR;
    const x2 = charX + Math.cos(ang) * (baseR + len), y2 = charY + Math.sin(ang) * (baseR + len);
    const style = 'rgba(224,195,252,0.35)';
    vizCache.push({ x1, y1, x2, y2, style });
    ctx.strokeStyle = style; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
}
// ============ PROGRESS BAR & CENTER DIVIDER ============
function drawProgress(ct) {
  if (!audioBuffer) return;
  const pct = Math.min(1, ct / audioBuffer.duration);
  const barW = W - 40, barH = 4, bx = 20, by = H - 20;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(bx, by, barW * pct, barH);
}
function drawCenterDivider() {
  if (verticalMode) {
    // Two vertical lane guide lines
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    const dashLen = 6, gapLen = 8;
    for (const lx of [vLaneLeftX, vLaneRightX]) {
      ctx.beginPath();
      for (let y = 0; y < H; y += dashLen + gapLen) {
        ctx.moveTo(lx, y);
        ctx.lineTo(lx, Math.min(y + dashLen, H));
      }
      ctx.stroke();
    }
    // L/R labels above judgment line
    ctx.globalAlpha = 0.25;
    ctx.font = '12px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#48dbfb';
    ctx.fillText('L', vLaneLeftX, vJudgeY + 20);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText('R', vLaneRightX, vJudgeY + 20);
    ctx.globalAlpha = 1;
    return;
  }
  // Subtle vertical dashed line at character center to show left/right zones
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  const dashLen = 6, gapLen = 8;
  ctx.beginPath();
  for (let y = 0; y < H; y += dashLen + gapLen) {
    ctx.moveTo(charX, y);
    ctx.lineTo(charX, Math.min(y + dashLen, H));
  }
  ctx.stroke();
  // Small L/R labels near bottom
  ctx.globalAlpha = 0.2;
  ctx.font = '12px Courier New, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#48dbfb';
  ctx.fillText('L', charX - JUDGE_DIST, H - 30);
  ctx.fillStyle = '#ff6b6b';
  ctx.fillText('R', charX + JUDGE_DIST, H - 30);
  ctx.globalAlpha = 1;
}
// ============ COUNTDOWN ============
let countdownText = '';
function drawCountdown() {
  if (!countdownActive) return false;
  const ct = audioCtx.currentTime;
  const remaining = countdownEnd - ct;
  if (remaining <= 0) {
    countdownActive = false;
    return false;
  }
  let txt;
  if (remaining > 2.25) txt = '3';
  else if (remaining > 1.5) txt = '2';
  else if (remaining > 0.75) txt = '1';
  else txt = 'GO!';

  if (txt !== countdownText) countdownText = txt;
  // Draw centered text
  const scale = 1 + (remaining % 0.75) * 0.3; // pulse effect
  ctx.globalAlpha = Math.min(1, remaining * 2);
  const sz = Math.round(60 * scale);
  ctx.font = `bold ${sz}px 'Courier New',monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = txt === 'GO!' ? '#2ecc71' : '#feca57';
  ctx.fillText(txt, W / 2, H / 2);
  ctx.globalAlpha = 1;
  return true;
}

let _resumeCountdownActive = false;
let _resumeCountdownStart = 0;
let _resumePendingAudio = false;

function drawResumeCountdown() {
  if (!_resumeCountdownActive) return false;
  const elapsed = (performance.now() - _resumeCountdownStart) / 1000;
  const total = 3.0;
  const remaining = total - elapsed;
  if (remaining <= 0) {
    _resumeCountdownActive = false;
    // Now actually resume audio
    if (_resumePendingAudio) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      _resumePendingAudio = false;
    }
    return false;
  }
  let txt;
  if (remaining > 2.25) txt = '3';
  else if (remaining > 1.5) txt = '2';
  else if (remaining > 0.75) txt = '1';
  else txt = 'GO!';
  const scale = 1 + (remaining % 0.75) * 0.3;
  ctx.globalAlpha = Math.min(1, remaining * 2);
  const sz = Math.round(60 * scale);
  ctx.font = `bold ${sz}px 'Courier New',monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = txt === 'GO!' ? '#2ecc71' : '#feca57';
  ctx.fillText(txt, W / 2, H / 2);
  ctx.globalAlpha = 1;
  return true;
}
// ============ BACKGROUND TRANSITION ============
function checkBgTransition() {
  if (bgTransiting) return; // wait for current transition to finish
  // combo >= 25 and currently on bg1 -> transition to bg2
  if (combo >= 25 && bgPhase === 1 && bgImg2Loaded) {
    bgTransiting = true;
    bgTransStart = performance.now() / 1000;
    bgTransDir = 1; // -> bg2
  }
  // combo dropped below 25 and currently on bg2 -> transition back to bg1
  if (combo < 25 && bgPhase === 2) {
    bgTransiting = true;
    bgTransStart = performance.now() / 1000;
    bgTransDir = -1; // -> bg1
  }
}
function drawBgWithTransition() {
  const bg1c = getBgCache();
  const bg2c = getBgCache2() || bg1c;
  if (!bgTransiting) {
    // Draw current phase background
    if (bgPhase === 2) {
      ctx.drawImage(bg2c, 0, 0, W * dpr, H * dpr, 0, 0, W, H);
    } else {
      ctx.drawImage(bg1c, 0, 0, W * dpr, H * dpr, 0, 0, W, H);
    }
    return;
  }
  const elapsed = performance.now() / 1000 - bgTransStart;
  const t = Math.min(1, elapsed / BG_TRANS_DUR); // 0->1

  const fromC = bgTransDir === 1 ? bg1c : bg2c;
  const toC   = bgTransDir === 1 ? bg2c : bg1c;

  // Simple crossfade: draw 'from' at full, draw 'to' with increasing alpha
  ctx.drawImage(fromC, 0, 0, W * dpr, H * dpr, 0, 0, W, H);
  ctx.globalAlpha = t;
  ctx.drawImage(toC, 0, 0, W * dpr, H * dpr, 0, 0, W, H);
  ctx.globalAlpha = 1;

  // Transition complete
  if (t >= 1) {
    bgTransiting = false;
    bgPhase = bgTransDir === 1 ? 2 : 1;
  }
}
// Dim overlay after background draw -- reduces glare
function drawBgDimOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, W, H);
}
// ============ MAIN LOOP ============
function gameLoop(ts) {
  if (!gameRunning) return;
  if (gamePaused) { requestAnimationFrame(gameLoop); return; }
  frameCount++;
  const ct = getCurrentTime();
  // Check & draw background with transition
  checkBgTransition();
  drawBgWithTransition();
  drawBgDimOverlay();
  drawStars();
  drawAudioRing();
  updateNearestTipDists(ct);
  drawJudgmentArcs(ct);
  drawCharacter();
  // Combo orbs
  drawComboOrbs(ct);
  // Countdown overlay (start-of-game or resume-from-pause)
  const resumeCD = drawResumeCountdown();
  if (resumeCD) {
    // During resume countdown, just render static scene, no gameplay
    for (const n of notes) n.draw(ct);
    drawProgress(ct);
    drawCenterDivider();
    requestAnimationFrame(gameLoop);
    return;
  }
  if (!drawCountdown()) {
    // Normal gameplay
    spawnNotes();
    handleJudge();
  } else {
    // During countdown: spawn notes so they are visible approaching
    spawnNotes();
  }
  for (const n of notes) n.draw(ct);
  // Draw dual-press connecting lines between paired notes (arc style)
  if (dualEffectEnabled) {
    const dualMap = new Map(); // pairId -> [noteA, noteB]
    for (const n of notes) {
      if (!n.alive || !n._dualPairId) continue;
      // Include notes with active dual OR fading dual
      if (!n.isDual && !n._dualFadeStart) continue;
      const arr = dualMap.get(n._dualPairId);
      if (arr) arr.push(n); else dualMap.set(n._dualPairId, [n]);
    }
    for (const [, pair] of dualMap) {
      if (pair.length !== 2) continue;
      // Only draw line if BOTH are still fully dual (not fading)
      if (!pair[0].isDual || !pair[1].isDual) continue;
      const posA = pair[0].getPos(ct);
      const posB = pair[1].getPos(ct);
      if (posA.progress < -0.05 || posB.progress < -0.05) continue;
      // Only show arc when notes are past 45% of travel (close to center), and fade in smoothly
      const minProg = Math.min(posA.progress, posB.progress);
      if (minProg < 0.45) continue;
      const fadeIn = Math.min((minProg - 0.45) / 0.15, 1); // 0->1 over progress 0.45->0.60
      const alphaLine = fadeIn * Math.min(minProg, 1) * 0.6;
      // Arc: control point above the midpoint
      const midX = (posA.x + posB.x) / 2;
      const midY = (posA.y + posB.y) / 2;
      const span = Math.abs(posA.x - posB.x);
      const arcHeight = Math.min(span * 0.18, 40); // arc curves upward, proportional to distance
      ctx.save();
      ctx.globalAlpha = alphaLine;
      ctx.strokeStyle = '#feca57';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.shadowColor = '#feca57';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(posA.x, posA.y);
      ctx.quadraticCurveTo(midX, midY - arcHeight, posB.x, posB.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  // Particles (capped + pool release)
  if (particles.length > 120) {
    const excess = particles.splice(0, particles.length - 120);
    for (const p of excess) particlePool.release(p);
  }
  const activeParticles = [];
  for (const p of particles) {
    if (p.life > 0) { p.update(); p.draw(); activeParticles.push(p); }
    else particlePool.release(p);
  }
  particles = activeParticles;
  // Ripples
  ripples = ripples.filter(r => r.life > 0);
  for (const r of ripples) { r.update(); r.draw(); }
  // Feedbacks
  feedbacks = feedbacks.filter(f => f.life > 0);
  for (const f of feedbacks) { f.update(); f.draw(); }
  // Screen flash (milestone)
  drawScreenFlash();
  // Milestone texts
  drawMilestoneTexts();
  drawProgress(ct);
  drawCenterDivider();
  // Cleanup notes (release to pool) + rebuild bucketed arrays
  const activeNotes = [];
  const activeLeft = [];
  const activeRight = [];
  for (const n of notes) {
    let keep = true;
    if (n.type === 'hold') {
      // Keep alive during fail animation (0.4s)
      if (n._failTime > 0 && (performance.now() - n._failTime) < 400) keep = true;
      else if (!n.alive && n.judged && n._endJudged) keep = false;
      else if (!n.alive && !n._holding) keep = false;
      else { const endProg = n._getDistForTime(n.endTime, ct).progress; if (endProg >= 1.5) keep = false; }
    } else {
      if (!n.alive && n.judged) keep = false;
      else if (!n.alive) keep = false;
      else if (n.getPos(ct).progress >= 1.5) keep = false;
    }
    if (keep) {
      activeNotes.push(n);
      (n.dir === 0 ? activeLeft : activeRight).push(n);
    } else {
      n.type === 'hold' ? holdNotePool.release(n) : notePool.release(n);
    }
  }
  notes = activeNotes;
  notesLeft = activeLeft;
  notesRight = activeRight;
  // End check
  if (audioBuffer && ct > audioBuffer.duration + 1) { endGame(); return; }
  requestAnimationFrame(gameLoop);
}
// ============ START / END GAME ============
async function startGame() {
  try {
    document.getElementById('startScreen').style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('uiOverlay').style.display = 'flex';
    if (document.activeElement) document.activeElement.blur();
    canvas.focus();

    currentDiff = document.getElementById('diffSelect').value;
    applyDifficulty();
    resize(); initStars();

    score = 0; combo = 0; maxComboVal = 0;
    lastMilestone = 0; screenFlashAlpha = 0; milestoneTexts = [];
    perfects = 0; goods = 0; hits = 0; misses = 0;
    resetGameArrays();
    freqData = null; vizCache = null;
    gameEnded = false;
    // Reset background transition
    bgPhase = 1; bgTransiting = false; bgTransDir = 0;
    invalidateBgCaches();
    updateUI();

    // Loading screen
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0c29'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e0c3fc';
    ctx.font = '18px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('\u6b63\u5728\u5206\u6790\u97f3\u9891\u8282\u594f...', W / 2, H / 2);

    // Wait for any in-progress pre-analysis to finish (avoids worker contention)
    if (_preAnalyzePromise) await _preAnalyzePromise;

    // Audio context (reset properly)
    createAudioContext();
    await decodeHitSound();
    await decodePerfectSound();
    await new Promise(r => setTimeout(r, 50));
    audioBuffer = await decodeAudio(audioFile);

    // Chart: load saved or detect fresh
    let detected;
    if (useLoadedChart && audioFileName) {
      detected = loadChart(audioFileName);
      useLoadedChart = false;
    }
    if (!detected) {
      // Use Web Worker for detection
      updateWorkerProgress = function(pct, label) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0f0c29'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#e0c3fc';
        ctx.font = '18px Courier New, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`\u5206\u6790\u4e2d... ${pct}% ${label}`, W / 2, H / 2);
        // Progress bar
        const barW = W * 0.5, barH = 6, barX = (W - barW) / 2, barY = H / 2 + 24;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = '#e0c3fc';
        ctx.fillRect(barX, barY, barW * pct / 100, barH);
      };
      const pcmData = audioBuffer.getChannelData(0).slice();
      const workerResult = await runWorkerDetection(pcmData, audioBuffer.sampleRate, audioBuffer.duration, 'detect');
      detected = workerResult.beats;
      detected._sections = workerResult._sections;
      detected._swingInfo = workerResult._swingInfo;
      updateWorkerProgress = null;
      // Auto-save chart
      if (audioFileName) saveChart(audioFileName, detected);
    }
    beats = detected.map(b => {
      if (b.type === 'hold') return { type: 'hold', startTime: b.startTime + noteOffsetMs/1000, endTime: b.endTime + noteOffsetMs/1000, dir: b.dir, color: b.color, _mergedCount: b._mergedCount || 2, _spawned: false };
      return { type: 'tap', time: b.time + noteOffsetMs/1000, dir: b.dir, color: b.color, _spawned: false };
    });
    if (detected._sections) beats._sections = detected._sections;
    if (detected._swingInfo) beats._swingInfo = detected._swingInfo;
    detectDualNotes(beats, DUAL_HOLD_THRESHOLD * (DIFF_PRESETS[currentDiff] || DIFF_PRESETS.normal).dualThreshMult);
    injectDualNotes(beats, currentDiff);
    enforceSpecialNoteLimits(beats, currentDiff, audioBuffer ? audioBuffer.duration : 180);
    if (noteOffsetMs !== 0) console.log(`[PR] Note offset applied: ${noteOffsetMs}ms`);

    // Pre-build background caches to avoid lag during bg transitions
    getBgCache();
    if (bgImg2Loaded) getBgCache2();

    // Play with countdown
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    const countdownDur = 3.0;
    countdownActive = true;
    countdownEnd = audioCtx.currentTime + countdownDur;
    audioStartTime = audioCtx.currentTime + countdownDur;
    sourceNode.start(audioCtx.currentTime + countdownDur);
    sourceNode.onended = () => { if (gameRunning && !gameEnded) endGame(); };
    gameRunning = true;
    gamePaused = false;
    requestAnimationFrame(gameLoop);
  } catch(err) {
    console.error('startGame error:', err);
    alert('\u542f\u52a8\u5931\u8d25: ' + err.message);
    document.getElementById('startScreen').style.display = 'flex';
    canvas.style.display = 'none';
  }
}

function endGame() {
  if (gameEnded) return;
  gameEnded = true;
  if (sourceNode) try { sourceNode.stop(); } catch(e) {}
  if (audioCtx) { try { audioCtx.close(); } catch(e) {} }
  audioCtx = null;
  analyser = null;

  const isFullCombo = misses === 0 && (perfects + goods + hits) > 0;

  if (isFullCombo) {
    // Full combo: play character spin animation for 3 seconds, then show end screen
    _fcAnimStart = performance.now();
    _fcAnimActive = true;
    gameRunning = true; // keep loop alive for animation
    requestAnimationFrame(_fcAnimLoop);
  } else {
    _showEndScreen();
  }
}

// ---- Full Combo Animation ----
let _fcAnimStart = 0;
let _fcAnimActive = false;
const FC_ANIM_DURATION = 3000; // 3 seconds

function _fcAnimLoop(ts) {
  if (!_fcAnimActive) return;
  const elapsed = ts - _fcAnimStart;
  if (elapsed >= FC_ANIM_DURATION) {
    _fcAnimActive = false;
    gameRunning = false;
    _showEndScreen();
    return;
  }
  const t = elapsed / FC_ANIM_DURATION; // 0->1
  // Draw background
  checkBgTransition();
  drawBgWithTransition();
  drawBgDimOverlay();
  drawStars();
  // Draw character with celebratory sway (no spin)
  if (charLoaded) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Gentle side-to-side rocking that slows down
    const rockAngle = Math.sin(t * Math.PI * 5) * 0.25 * (1 - t * 0.6);
    const bounceY = -Math.abs(Math.sin(t * Math.PI * 4)) * 18 * (1 - t * 0.5);
    const swayX = Math.sin(t * Math.PI * 3) * 12 * (1 - t);
    const scale = 1 + 0.12 * Math.sin(t * Math.PI * 3);
    ctx.translate(charX + swayX, charY + bounceY);
    ctx.rotate(rockAngle);
    ctx.scale(scale, scale);
    ctx.drawImage(charImg, -charW / 2, -charH / 2, charW, charH);
    ctx.restore();
  }
  // Draw "FULL COMBO!" text overlay (use logical W/H, not canvas pixel size)
  const textAlpha = Math.min(1, elapsed / 500);
  const textScale = 1 + 0.06 * Math.sin(elapsed / 180);
  ctx.save();
  ctx.globalAlpha = textAlpha;
  const fontSize = Math.round(Math.min(W * 0.07, H * 0.08, 48));
  ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#feca57';
  ctx.shadowBlur = 20 + 10 * Math.sin(elapsed / 200);
  ctx.fillStyle = '#feca57';
  ctx.translate(W / 2, H * 0.25);
  ctx.scale(textScale, textScale);
  ctx.fillText('FULL COMBO!', 0, 0);
  ctx.restore();
  // Burst particles during animation
  if (Math.random() < 0.3) {
    const px = charX + (Math.random() - 0.5) * 120;
    const py = charY + (Math.random() - 0.5) * 120;
    const colors = ['#feca57', '#ff6b6b', '#48dbfb', '#2ecc71', '#e67e22', '#9b59b6'];
    particles.push(particlePool.get(px, py, colors[Math.floor(Math.random() * colors.length)]));
  }
  const activeP = [];
  for (const p of particles) {
    if (p.life > 0) { p.update(); p.draw(); activeP.push(p); }
    else particlePool.release(p);
  }
  particles = activeP;

  requestAnimationFrame(_fcAnimLoop);
}

function _showEndScreen() {
  gameRunning = false;
  gameEnded = true;
  canvas.style.display = 'none';
  document.getElementById('uiOverlay').style.display = 'none';
  document.getElementById('endScreen').style.display = 'flex';
  // Song name
  let songDisplayName = '';
  if (audioFileName) {
    const sel = document.getElementById('presetSelect');
    if (sel && sel.value && audioFileName === sel.value) {
      songDisplayName = sel.options[sel.selectedIndex].text;
    } else {
      songDisplayName = audioFileName.replace(/\.[^/.]+$/, '');
    }
  }
  document.getElementById('songNameDisplay').textContent = songDisplayName;
  // Difficulty & speed info
  const diffLabels = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
  const diffLabel = diffLabels[currentDiff] || currentDiff;
  document.getElementById('endDiffInfo').textContent = '\u96be\u5ea6: ' + diffLabel + ' | \u97f3\u7b26\u901f\u5ea6: ' + baseTravelTime.toFixed(2) + 's';
  // Full combo
  const isFullCombo = misses === 0 && (perfects + goods + hits) > 0;
  document.getElementById('fullComboText').style.display = isFullCombo ? 'block' : 'none';
  document.getElementById('finalScore').textContent = Math.floor(score);
  document.getElementById('maxCombo').textContent = maxComboVal;
  document.getElementById('perfectCount').textContent = perfects;
  document.getElementById('goodCount').textContent = goods;
  document.getElementById('hitCount').textContent = hits;
  document.getElementById('missCount').textContent = misses;

  // Save record & show comparison
  const songFile = getCurrentSongFile();
  const compareEl = document.getElementById('recordCompare');
  const newRecordEl = document.getElementById('newRecordBadge');
  compareEl.style.display = 'none';
  newRecordEl.style.display = 'none';

  if (songFile) {
    const result = {
      score: Math.floor(score),
      maxCombo: maxComboVal,
      perfects, goods, hits, misses
    };
    const { isNewBest, prev } = saveRecord(songFile, currentDiff, result);

    if (prev && prev.highScore) {
      const diff = result.score - prev.highScore;
      const sign = diff > 0 ? '+' : '';
      compareEl.textContent = '\u5386\u53f2\u6700\u4f73: ' + prev.highScore + ' (\u5dee\u8ddd: ' + sign + diff + ')' +
        (prev.isFC ? ' | FC \u2605' : '') +
        ' | \u6700\u5927\u8fde\u51fb: ' + prev.maxCombo;
      compareEl.style.display = 'block';
    } else if (!prev) {
      compareEl.textContent = '\u9996\u6b21\u6e38\u73a9\u6b64\u66f2!';
      compareEl.style.display = 'block';
    }

    if (isNewBest && prev && prev.highScore) {
      newRecordEl.style.display = 'block';
    }

    // Update FC badges on dropdown
    updateFCBadges();
  }
}
// ============ PAUSE / RESUME / REPLAY ============
let pauseStartTime = 0;

function pauseGame() {
  if (!gameRunning || gamePaused || gameEnded) return;
  gamePaused = true;
  pauseStartTime = performance.now();
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
  document.getElementById('pauseOverlay').classList.add('open');
}

function resumeGame() {
  if (!gamePaused) return;
  document.getElementById('pauseOverlay').classList.remove('open');
  // Start a 3-second visual countdown before actually resuming
  _resumeCountdownStart = performance.now();
  _resumeCountdownActive = true;
  // Keep gamePaused=true so notes don't move, but let gameLoop render the countdown
  gamePaused = false;
  _resumePendingAudio = true; // flag: audio stays suspended until countdown ends
}

async function replayGame() {
  // Stop current audio
  document.getElementById('pauseOverlay').classList.remove('open');
  document.getElementById('endScreen').style.display = 'none';
  if (sourceNode) try { sourceNode.stop(); } catch(e) {}
  if (audioCtx) { try { audioCtx.close(); } catch(e) {} }
  audioCtx = null; analyser = null;
  gamePaused = false; gameRunning = false; gameEnded = false;

  // Re-use existing beats (same chart), preserving dual-press attributes
  const savedBeats = beats ? beats.map(b => {
    if (b.type === 'hold') return { type: 'hold', startTime: b.startTime, endTime: b.endTime, dir: b.dir, color: b.color, _mergedCount: b._mergedCount || 2, _spawned: false, isDual: b.isDual || false, _dualPairId: b._dualPairId || 0, yOffset: b.yOffset || 0 };
    return { type: 'tap', time: b.time, dir: b.dir, color: b.color, _spawned: false, isDual: b.isDual || false, _dualPairId: b._dualPairId || 0, yOffset: b.yOffset || 0 };
  }) : null;
  const savedSections = beats ? beats._sections : null;
  const savedSwing = beats ? beats._swingInfo : null;

  // Re-init
  canvas.style.display = 'block';
  document.getElementById('uiOverlay').style.display = 'flex';
  canvas.focus();

  applyDifficulty();
  resize(); initStars();
  score = 0; combo = 0; maxComboVal = 0;
  lastMilestone = 0; screenFlashAlpha = 0; milestoneTexts = [];
  perfects = 0; goods = 0; hits = 0; misses = 0;
  resetGameArrays();
  freqData = null; vizCache = null;
  gameEnded = false;
  bgPhase = 1; bgTransiting = false; bgTransDir = 0;
  invalidateBgCaches();
  updateUI();

  createAudioContext();
  await decodeHitSound();
  await new Promise(r => setTimeout(r, 50));
  audioBuffer = await decodeAudio(audioFile);

  // Restore saved chart
  if (savedBeats) {
    beats = savedBeats;
    if (savedSections) beats._sections = savedSections;
    if (savedSwing) beats._swingInfo = savedSwing;
  }

  getBgCache();
  if (bgImg2Loaded) getBgCache2();

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  const countdownDur = 3.0;
  countdownActive = true;
  countdownEnd = audioCtx.currentTime + countdownDur;
  audioStartTime = audioCtx.currentTime + countdownDur;
  sourceNode.start(audioCtx.currentTime + countdownDur);
  sourceNode.onended = () => { if (gameRunning && !gameEnded) endGame(); };

  gameRunning = true;
  gamePaused = false;
  requestAnimationFrame(gameLoop);
}

function exitToMenu() {
  document.getElementById('pauseOverlay').classList.remove('open');
  if (sourceNode) try { sourceNode.stop(); } catch(e) {}
  if (audioCtx) { try { audioCtx.close(); } catch(e) {} }
  audioCtx = null; analyser = null;
  gameRunning = false; gamePaused = false; gameEnded = false;
  canvas.style.display = 'none';
  document.getElementById('uiOverlay').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
  useLoadedChart = false;
  checkSavedChart();
}
// ============ EVENT LISTENERS ============
startBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (gameRunning) return;
  startGame();
});
startBtn.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); }
});
document.getElementById('restartBtn').addEventListener('click', () => {
  document.getElementById('endScreen').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
  useLoadedChart = false;
  checkSavedChart();
});
document.getElementById('endReplayBtn').addEventListener('click', () => { replayGame(); });
document.getElementById('pauseResumeBtn').addEventListener('click', () => { resumeGame(); });
document.getElementById('pauseRetryBtn').addEventListener('click', () => { replayGame(); });
document.getElementById('pauseExitBtn').addEventListener('click', () => { exitToMenu(); });
document.getElementById('pauseBtn').addEventListener('click', (e) => { e.stopPropagation(); pauseGame(); });

// Tap/Click with position for ripple
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  // Skip if a touch just fired (prevent double-fire on hybrid devices)
  if (performance.now() - _lastTouchStartTime < 300) return;
  processTapBatch([{ x: e.clientX, y: e.clientY, touchId: 'mouse' }]);
});
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  _lastTouchStartTime = performance.now();
  const points = [];
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    points.push({ x: t.clientX, y: t.clientY, touchId: t.identifier });
  }
  processTapBatch(points);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    onRelease(e.changedTouches[i].identifier);
  }
}, { passive: false });
canvas.addEventListener('touchcancel', (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) {
    onRelease(e.changedTouches[i].identifier);
  }
}, { passive: false });
canvas.addEventListener('mouseup', (e) => { onRelease('mouse'); });
// Prevent scroll on touch move
document.addEventListener('touchmove', (e) => {
  if (gameRunning) e.preventDefault();
}, { passive: false });

// Keyboard release for hold notes
function handleGameKeyUp(e) {
  if (e.code === 'Space' || e.key === ' ') onRelease('kb_space');
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'KeyF') onRelease('kb_left');
  else if (e.code === 'ArrowRight' || e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'KeyL') onRelease('kb_right');
}
document.addEventListener('keyup', handleGameKeyUp);

// Space key (matches any side), left/right keys for directional input
function handleGameKey(e) {
  if (e.repeat) return;
  // Pause toggle
  if (e.code === 'Escape') {
    e.preventDefault();
    if (_resumeCountdownActive) return; // don't interrupt resume countdown
    if (gamePaused) resumeGame();
    else if (gameRunning && !gameEnded) pauseGame();
    return;
  }
  if (gamePaused) return;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault(); e.stopPropagation();
    processTapBatch([{ x: undefined, y: undefined, touchId: 'kb_space' }]); // space: match closest note on either side
  } else if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'KeyF') {
    e.preventDefault();
    processTapBatch([{ x: charX - 1, y: charY, touchId: 'kb_left' }]); // left side tap
  } else if (e.code === 'ArrowRight' || e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'KeyL') {
    e.preventDefault();
    processTapBatch([{ x: charX + 1, y: charY, touchId: 'kb_right' }]); // right side tap
  }
}
document.addEventListener('keydown', handleGameKey);
canvas.addEventListener('keydown', handleGameKey);
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === ' ') e.preventDefault();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
// ============ FULLSCREEN + LANDSCAPE LOCK (with CSS fallback) ============
const fullscreenBtn = document.getElementById('fullscreenBtn');
let _forcedLandscape = false;   // true when CSS transform fallback is active
let _orientationLocked = false; // true when screen.orientation.lock succeeded

// Detect if the device is in portrait mode
function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

// CSS transform fallback: rotate #app 90deg when in portrait + fullscreen
function applyForcedLandscape() {
  if (!_forcedLandscape) return;
  const app = document.getElementById('app');
  if (isPortrait()) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    app.style.transformOrigin = 'top left';
    app.style.transform = `rotate(90deg) translateY(-${vw}px)`;
    app.style.width = vh + 'px';
    app.style.height = vw + 'px';
  } else {
    removeForcedLandscape();
  }
}

function removeForcedLandscape() {
  const app = document.getElementById('app');
  app.style.transform = '';
  app.style.transformOrigin = '';
  app.style.width = '';
  app.style.height = '';
}

function onForcedLandscapeResize() {
  if (!_forcedLandscape) return;
  applyForcedLandscape();
  setTimeout(() => { resize(); invalidateBgCaches(); initStars(); }, 50);
}

async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) await el.msRequestFullscreen();
  } catch(e) { console.warn('Fullscreen request failed:', e); }

  // Try native orientation lock first (skip in vertical mode)
  _orientationLocked = false;
  if (!verticalMode) {
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
        _orientationLocked = true;
      }
    } catch(e) {
      _orientationLocked = false;
    }

    // If native lock failed and device is portrait, use CSS transform fallback
    if (!_orientationLocked && isPortrait()) {
      _forcedLandscape = true;
      applyForcedLandscape();
      window.addEventListener('resize', onForcedLandscapeResize);
    }
  }

  // Resize after a short delay to let fullscreen + rotation settle
  setTimeout(() => { resize(); invalidateBgCaches(); initStars(); }, 400);
}

function exitFullscreen() {
  // Remove CSS fallback
  if (_forcedLandscape) {
    _forcedLandscape = false;
    removeForcedLandscape();
    window.removeEventListener('resize', onForcedLandscapeResize);
  }
  try {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch(e) {}
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch(e) {}
  _orientationLocked = false;
  setTimeout(() => { resize(); invalidateBgCaches(); }, 200);
}

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    exitFullscreen();
    fullscreenBtn.textContent = '\u5168\u5c4f\u6e38\u73a9';
  } else {
    enterFullscreen();
    fullscreenBtn.textContent = '\u9000\u51fa\u5168\u5c4f';
  }
});

// Update button text on fullscreen change
function handleFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && _forcedLandscape) {
    _forcedLandscape = false;
    removeForcedLandscape();
    window.removeEventListener('resize', onForcedLandscapeResize);
  }
  fullscreenBtn.textContent = isFs ? '\u9000\u51fa\u5168\u5c4f' : '\u5168\u5c4f\u6e38\u73a9';
  setTimeout(() => { resize(); invalidateBgCaches(); }, 200);
}
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
// ============ SETTINGS OVERLAY ============
document.getElementById('gearBtn').addEventListener('click', () => {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('settingsOverlay').style.display = 'flex';
});
document.getElementById('settingsBackBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
});
document.getElementById('changelogBtn').addEventListener('click', () => {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('changelogOverlay').style.display = 'flex';
});
document.getElementById('changelogBackBtn').addEventListener('click', () => {
  document.getElementById('changelogOverlay').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
});

// ============ RECORDS PAGE ============
let _recordsCurrentDiff = 'expert';

function renderRecordsList(diff) {
  _recordsCurrentDiff = diff;
  const container = document.getElementById('recordsList');
  const all = getAllRecords();
  const sel = document.getElementById('presetSelect');

  // Collect all songs from dropdown
  const songs = [];
  for (const opt of sel.options) {
    if (!opt.value) continue;
    songs.push({ file: opt.value, name: opt.textContent.replace(/\s*\u2605FC.*$/, '') });
  }

  // Build table
  let html = '<table style="width:100%;border-collapse:collapse;color:#c8c0e0;font-size:13px;">';
  html += '<thead><tr style="border-bottom:2px solid #9b59b6;text-align:left;">';
  html += '<th style="padding:6px 4px;color:#feca57;">#</th>';
  html += '<th style="padding:6px 4px;color:#feca57;">歌曲</th>';
  html += '<th style="padding:6px 4px;color:#feca57;text-align:right;">最高分</th>';
  html += '<th style="padding:6px 4px;color:#feca57;text-align:right;">最大连击</th>';
  html += '<th style="padding:6px 4px;color:#feca57;text-align:center;">判定</th>';
  html += '<th style="padding:6px 4px;color:#feca57;text-align:center;">FC</th>';
  html += '</tr></thead><tbody>';

  let rank = 0;
  // Sort songs: played songs first (by score desc), then unplayed
  const played = [];
  const unplayed = [];
  for (const s of songs) {
    const rec = all[getRecordKey(s.file, diff)];
    if (rec) played.push({ ...s, rec });
    else unplayed.push(s);
  }
  played.sort((a, b) => b.rec.highScore - a.rec.highScore);

  for (const s of played) {
    rank++;
    const r = s.rec;
    const fcBadge = r.isFC ? '<span style="color:#feca57;font-weight:bold;text-shadow:0 0 6px #feca57;">\u2605 FC</span>' : '<span style="color:#555;">-</span>';
    const judgStr = '<span style="color:#feca57;">P' + r.perfects + '</span> <span style="color:#48dbfb;">G' + r.goods + '</span> <span style="color:#2ecc71;">H' + r.hits + '</span> <span style="color:#ff4444;">M' + r.misses + '</span>';
    const rowBg = rank % 2 === 0 ? 'rgba(155,89,182,0.08)' : 'transparent';
    html += '<tr style="border-bottom:1px solid rgba(155,89,182,0.2);background:' + rowBg + ';">';
    html += '<td style="padding:5px 4px;">' + rank + '</td>';
    html += '<td style="padding:5px 4px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + s.name + '</td>';
    html += '<td style="padding:5px 4px;text-align:right;color:#fff;font-weight:bold;">' + r.highScore + '</td>';
    html += '<td style="padding:5px 4px;text-align:right;">' + r.maxCombo + '</td>';
    html += '<td style="padding:5px 4px;text-align:center;font-size:11px;">' + judgStr + '</td>';
    html += '<td style="padding:5px 4px;text-align:center;">' + fcBadge + '</td>';
    html += '</tr>';
  }

  for (const s of unplayed) {
    rank++;
    const rowBg = rank % 2 === 0 ? 'rgba(155,89,182,0.08)' : 'transparent';
    html += '<tr style="border-bottom:1px solid rgba(155,89,182,0.1);background:' + rowBg + ';opacity:0.4;">';
    html += '<td style="padding:5px 4px;">' + rank + '</td>';
    html += '<td style="padding:5px 4px;">' + s.name + '</td>';
    html += '<td colspan="4" style="padding:5px 4px;text-align:center;color:#666;">--\u672a\u6e38\u73a9--</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';

  // Summary
  const totalPlayed = played.length;
  const totalFC = played.filter(s => s.rec.isFC).length;
  const totalScore = played.reduce((sum, s) => sum + s.rec.highScore, 0);
  html = '<div style="text-align:center;margin-bottom:12px;color:#e0c3fc;font-size:14px;">' +
    '\u5df2\u6e38\u73a9: ' + totalPlayed + '/' + songs.length +
    ' | FC: ' + totalFC +
    ' | \u603b\u5206: ' + totalScore +
    '</div>' + html;

  container.innerHTML = html;

  // Update tab active state
  document.querySelectorAll('.rec-tab').forEach(btn => {
    btn.classList.toggle('rec-tab-active', btn.dataset.diff === diff);
  });
}

document.getElementById('recordsBtn').addEventListener('click', () => {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('recordsOverlay').style.display = 'flex';
  renderRecordsList(_recordsCurrentDiff);
});
document.getElementById('recordsBackBtn').addEventListener('click', () => {
  document.getElementById('recordsOverlay').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
});
document.querySelectorAll('.rec-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    renderRecordsList(btn.dataset.diff);
  });
});

// Update FC badges on page load
updateFCBadges();
document.getElementById('mirrorCheck').addEventListener('change', (e) => {
  mirrorMode = e.target.checked;
  beats = null; // force re-detection with new mirror setting
  checkSavedChart();
});
