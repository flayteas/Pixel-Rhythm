// tutorial.js — Tutorial system
// ============ TUTORIAL MODE ============
(function initTutorial() {
  const tutBtn = document.getElementById('tutorialBtn');
  const tutScreen = document.getElementById('tutorialScreen');
  const tutCanvas = document.getElementById('tutCanvas');
  const tutCtx = tutCanvas.getContext('2d');
  const tutStartBtn = document.getElementById('tutStartDemo');
  const tutBackBtn = document.getElementById('tutBackBtn');
  const tutStatus = document.getElementById('tutDemoStatus');
  const tutHint = document.getElementById('tutDemoHint');

  let tutMode = false;
  let tutRunning = false;
  let tutStartTime = 0;
  let tutNotes = [];
  let tutFeedbacks = [];
  let tutParticles = [];
  let tutHitCount = 0;
  let tutTotalNotes = 6;
  let tutDone = false;
  let tutFrameId = null;

  // Tutorial canvas dimensions (logical)
  const TW = 560, TH = 320;
  const tCharX = TW / 2, tCharY = TH * 0.48;
  const tCharW = 80, tCharH = 84;
  const tJudgeDist = tCharW / 2 + 42;
  const tArcDeg = 60;
  const tNoteTravelTime = 2.5;
  const tNoteSize = 22;
  const tNoteHalf = tNoteSize;
  const tTipPerfect = 13, tTipGood = 24, tTipHit = 36;

  // Tutorial beats definition
  const tutBeats = [
    { time: 1.5, dir: 0 },
    { time: 2.5, dir: 1 },
    { time: 3.5, dir: 0 },
    { time: 4.5, dir: 1 },
    { time: 5.5, dir: 0 },
    { time: 6.5, dir: 1 },
  ];

  function resizeTutCanvas() {
    const wrapper = tutCanvas.parentElement;
    const w = wrapper.clientWidth;
    const h = Math.round(w * TH / TW);
    tutCanvas.style.width = w + 'px';
    tutCanvas.style.height = h + 'px';
    tutCanvas.width = TW * 2;
    tutCanvas.height = TH * 2;
    tutCtx.setTransform(2, 0, 0, 2, 0, 0);
  }

  // Mini Note class for tutorial
  class TutNote {
    constructor(time, dir) {
      this.time = time;
      this.dir = dir;
      this.alive = true;
      this.judged = false;
      this.angle = dir === 0
        ? Math.PI + (Math.random() * 0.6 - 0.3)
        : 0 + (Math.random() * 0.6 - 0.3);
      this.dx = Math.cos(this.angle);
      this.dy = Math.sin(this.angle);
    }
    getPos(ct) {
      const elapsed = ct - this.time;
      const progress = elapsed / tNoteTravelTime;
      const spawnDist = TW * 0.48;
      const dist = tJudgeDist + (spawnDist - tJudgeDist) * (1 - progress);
      const x = tCharX + this.dx * dist;
      const y = tCharY + this.dy * dist;
      return { x, y, dist, progress };
    }
    getTipDist(ct) {
      const pos = this.getPos(ct);
      return (pos.dist - tJudgeDist) - tNoteHalf;
    }
    draw(ct) {
      if (!this.alive) return;
      const pos = this.getPos(ct);
      if (pos.progress < -0.15 || pos.progress > 1.3) return;
      const alpha = pos.progress < 0 ? 0.3 + pos.progress * 3 : Math.min(1, 1.2 - pos.progress * 0.5);
      if (alpha <= 0) return;
      tutCtx.save();
      tutCtx.globalAlpha = alpha;
      // Draw note image
      const img = this.dir === 0 ? noteImgL : noteImgR;
      if (img.complete && img.naturalWidth) {
        tutCtx.drawImage(img, pos.x - tNoteSize, pos.y - tNoteSize, tNoteSize * 2, tNoteSize * 2);
      } else {
        tutCtx.fillStyle = this.dir === 0 ? '#ff6b6b' : '#9b59b6';
        tutCtx.beginPath();
        tutCtx.arc(pos.x, pos.y, tNoteSize * 0.7, 0, Math.PI * 2);
        tutCtx.fill();
      }
      // Approach glow when close
      const tipDist = Math.abs(this.getTipDist(ct));
      if (tipDist < 60) {
        const intensity = 1 - tipDist / 60;
        const glowColor = this.dir === 0 ? `rgba(255,107,107,${intensity * 0.5})` : `rgba(155,89,182,${intensity * 0.5})`;
        tutCtx.shadowColor = glowColor;
        tutCtx.shadowBlur = 15 * intensity;
        tutCtx.beginPath();
        tutCtx.arc(pos.x, pos.y, tNoteSize * 0.5, 0, Math.PI * 2);
        tutCtx.fillStyle = glowColor;
        tutCtx.fill();
        tutCtx.shadowBlur = 0;
      }
      tutCtx.restore();
    }
  }

  // Tutorial feedback text
  class TutFeedback {
    constructor(x, y, text, color) {
      this.x = x; this.y = y; this.text = text; this.color = color;
      this.life = 1.0; this.vy = -1.2;
    }
    update() { this.life -= 0.018; this.y += this.vy; }
    draw() {
      if (this.life <= 0) return;
      tutCtx.save();
      tutCtx.globalAlpha = this.life;
      tutCtx.font = 'bold 14px Courier New, monospace';
      tutCtx.textAlign = 'center';
      tutCtx.fillStyle = this.color;
      tutCtx.shadowColor = this.color;
      tutCtx.shadowBlur = 6;
      tutCtx.fillText(this.text, this.x, this.y);
      tutCtx.restore();
    }
  }

  // Tutorial particle
  class TutParticle {
    constructor(x, y, color) {
      this.x = x; this.y = y; this.color = color;
      this.vx = (Math.random() - 0.5) * 4;
      this.vy = (Math.random() - 0.5) * 4;
      this.life = 1.0; this.size = 2 + Math.random() * 2;
    }
    update() { this.life -= 0.03; this.x += this.vx; this.y += this.vy; this.vx *= 0.96; this.vy *= 0.96; }
    draw() {
      if (this.life <= 0) return;
      tutCtx.save();
      tutCtx.globalAlpha = this.life;
      tutCtx.fillStyle = this.color;
      tutCtx.beginPath();
      tutCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      tutCtx.fill();
      tutCtx.restore();
    }
  }

  function drawTutBg() {
    const bg = tutCtx.createLinearGradient(0, 0, 0, TH);
    bg.addColorStop(0, '#0f0c29');
    bg.addColorStop(0.5, '#302b63');
    bg.addColorStop(1, '#24243e');
    tutCtx.fillStyle = bg;
    tutCtx.fillRect(0, 0, TW, TH);
  }

  function drawTutCharacter() {
    if (!charLoaded) return;
    tutCtx.save();
    tutCtx.imageSmoothingEnabled = false;
    tutCtx.translate(tCharX, tCharY);
    tutCtx.drawImage(charImg, -tCharW / 2, -tCharH / 2, tCharW, tCharH);
    tutCtx.restore();
  }

  function drawTutArcs(ct) {
    // Find nearest notes for each side
    let nearL = 999, nearR = 999;
    for (const n of tutNotes) {
      if (!n.alive || n.judged) continue;
      const td = Math.abs(n.getTipDist(ct));
      if (n.dir === 0 && td < nearL) nearL = td;
      if (n.dir === 1 && td < nearR) nearR = td;
    }

    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const startAng = (side === 0 ? 180 - tArcDeg / 2 : -tArcDeg / 2) * Math.PI / 180;
      const endAng = startAng + tArcDeg * Math.PI / 180;
      const r = tJudgeDist;

      // Dynamic glow based on nearest note
      const nearDist = side === 0 ? nearL : nearR;
      const glowIntensity = nearDist < 80 ? Math.pow(1 - nearDist / 80, 2) : 0;

      // Red radial glow (always visible)
      tutCtx.save();
      const grad = tutCtx.createRadialGradient(tCharX, tCharY, r - tTipHit - 4, tCharX, tCharY, r + tTipHit + 4);
      grad.addColorStop(0, 'rgba(255,80,80,0)');
      grad.addColorStop(0.3, `rgba(255,80,80,${0.12 + glowIntensity * 0.25})`);
      grad.addColorStop(0.5, `rgba(255,80,80,${0.18 + glowIntensity * 0.35})`);
      grad.addColorStop(0.7, `rgba(255,80,80,${0.12 + glowIntensity * 0.25})`);
      grad.addColorStop(1, 'rgba(255,80,80,0)');
      tutCtx.fillStyle = grad;
      tutCtx.beginPath();
      tutCtx.arc(tCharX, tCharY, r + tTipHit + 4, startAng, endAng);
      tutCtx.arc(tCharX, tCharY, r - tTipHit - 4, endAng, startAng, true);
      tutCtx.closePath();
      tutCtx.fill();
      tutCtx.restore();

      // Arc line
      tutCtx.save();
      const arcAlpha = 0.5 + glowIntensity * 0.4;
      tutCtx.strokeStyle = `rgba(255,255,255,${arcAlpha})`;
      tutCtx.lineWidth = 1.5 + glowIntensity * 2;
      tutCtx.shadowColor = glowIntensity > 0.3 ? '#ff6b6b' : '#fff';
      tutCtx.shadowBlur = glowIntensity * 20;
      tutCtx.beginPath();
      tutCtx.arc(tCharX, tCharY, r, startAng, endAng);
      tutCtx.stroke();
      tutCtx.restore();

      // Flashing hint when note is approaching
      if (glowIntensity > 0.5 && tutRunning) {
        const pulseAlpha = 0.3 + 0.3 * Math.sin(performance.now() / 100);
        tutCtx.save();
        tutCtx.strokeStyle = `rgba(254,202,87,${pulseAlpha})`;
        tutCtx.lineWidth = 3;
        tutCtx.shadowColor = '#feca57';
        tutCtx.shadowBlur = 15;
        tutCtx.beginPath();
        tutCtx.arc(tCharX, tCharY, r, startAng, endAng);
        tutCtx.stroke();
        tutCtx.restore();
      }
    }
  }

  function drawTutDivider() {
    tutCtx.save();
    tutCtx.setLineDash([4, 4]);
    tutCtx.strokeStyle = 'rgba(255,255,255,0.15)';
    tutCtx.lineWidth = 1;
    tutCtx.beginPath();
    tutCtx.moveTo(TW / 2, 0);
    tutCtx.lineTo(TW / 2, TH);
    tutCtx.stroke();
    tutCtx.setLineDash([]);
    // Side labels
    tutCtx.font = '11px Courier New, monospace';
    tutCtx.textAlign = 'center';
    tutCtx.fillStyle = 'rgba(255,107,107,0.5)';
    tutCtx.fillText('左侧', TW * 0.2, 16);
    tutCtx.fillStyle = 'rgba(155,89,182,0.5)';
    tutCtx.fillText('右侧', TW * 0.8, 16);
    tutCtx.restore();
  }

  function getTutTime() {
    return (performance.now() - tutStartTime) / 1000;
  }

  function tutOnTap(tapX) {
    if (!tutRunning || tutDone) return;
    const ct = getTutTime();
    const tapDir = tapX < TW / 2 ? 0 : 1;

    // Play hit sound (reuse main game's hit sound if available)
    if (typeof playHitSound === 'function') {
      try { playHitSound(); } catch(e) {}
    }

    // Find best matching note
    let best = null, bestDist = Infinity;
    for (const n of tutNotes) {
      if (!n.alive || n.judged) continue;
      if (n.dir !== tapDir) continue;
      const td = n.getTipDist(ct);
      if (Math.abs(td) <= tTipHit && Math.abs(td) < bestDist) {
        best = n; bestDist = Math.abs(td);
      }
    }
    if (!best) {
      // Leniency fallback
      for (const n of tutNotes) {
        if (!n.alive || n.judged) continue;
        if (n.dir !== tapDir) continue;
        const diff = Math.abs(ct - n.time) * 1000;
        if (diff < 200 && diff < bestDist) {
          best = n; bestDist = diff;
        }
      }
    }
    if (!best) return;

    best.alive = false; best.judged = true;
    tutHitCount++;
    const td = Math.abs(best.getTipDist(ct));
    let label, color;
    if (td <= tTipPerfect) { label = 'Perfect!'; color = '#feca57'; }
    else if (td <= tTipGood) { label = 'Good!'; color = '#48dbfb'; }
    else { label = 'Hit!'; color = '#2ecc71'; }

    const pos = best.getPos(ct);
    tutFeedbacks.push(new TutFeedback(pos.x, pos.y - 20, label, color));
    for (let i = 0; i < 6; i++) tutParticles.push(new TutParticle(pos.x, pos.y, color));

    // Update hint
    const remaining = tutTotalNotes - tutHitCount;
    if (remaining > 0) {
      tutHint.textContent = '还剩 ' + remaining + ' 个音符';
    }

    // Check completion
    if (tutHitCount >= tutTotalNotes) {
      tutDone = true;
      tutStatus.textContent = '演示完成！做得好！';
      tutStatus.style.color = '#2ecc71';
      tutHint.textContent = '你已掌握基本操作，可以开始游戏了';
      tutStartBtn.textContent = '重新演示';
    }
  }

  function tutHandleMiss(ct) {
    for (const n of tutNotes) {
      if (!n.alive || n.judged) continue;
      const tipDist = n.getTipDist(ct);
      if (tipDist < -tTipHit) {
        n.alive = false; n.judged = true;
        const pos = n.getPos(ct);
        tutFeedbacks.push(new TutFeedback(pos.x, pos.y - 20, 'Miss', '#ff4444'));
        // Check if all notes done
        const alive = tutNotes.filter(nn => nn.alive && !nn.judged).length;
        if (alive === 0 && !tutDone) {
          tutDone = true;
          const ratio = tutHitCount + '/' + tutTotalNotes;
          tutStatus.textContent = '演示完成 (' + ratio + ')';
          tutStatus.style.color = tutHitCount === tutTotalNotes ? '#2ecc71' : '#feca57';
          tutHint.textContent = '点击"重新演示"再试一次';
          tutStartBtn.textContent = '重新演示';
        }
      }
    }
  }

  function tutLoop() {
    if (!tutRunning) return;
    const ct = getTutTime();

    drawTutBg();
    drawTutDivider();
    drawTutArcs(ct);
    drawTutCharacter();

    // Draw notes
    for (const n of tutNotes) n.draw(ct);

    // Handle auto-miss
    tutHandleMiss(ct);

    // Update and draw feedbacks
    tutFeedbacks = tutFeedbacks.filter(f => f.life > 0);
    for (const f of tutFeedbacks) { f.update(); f.draw(); }

    // Update and draw particles
    tutParticles = tutParticles.filter(p => p.life > 0);
    for (const p of tutParticles) { p.update(); p.draw(); }

    // Side hint: which side to click next
    if (!tutDone) {
      let nextNote = null;
      for (const n of tutNotes) {
        if (n.alive && !n.judged) { nextNote = n; break; }
      }
      if (nextNote) {
        const tipDist = nextNote.getTipDist(ct);
        if (tipDist < 80 && tipDist > -tTipHit) {
          const sideText = nextNote.dir === 0 ? '点击左侧!' : '点击右侧!';
          const sideColor = nextNote.dir === 0 ? 'rgba(255,107,107,0.8)' : 'rgba(155,89,182,0.8)';
          const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 150);
          tutCtx.save();
          tutCtx.globalAlpha = pulse;
          tutCtx.font = 'bold 16px Courier New, monospace';
          tutCtx.textAlign = 'center';
          tutCtx.fillStyle = sideColor;
          tutCtx.shadowColor = sideColor;
          tutCtx.shadowBlur = 10;
          tutCtx.fillText(sideText, TW / 2, TH - 12);
          tutCtx.restore();
        }
      }
    }

    // End check: all notes passed or done
    const allDone = tutNotes.every(n => !n.alive || n.judged);
    const maxTime = tutBeats[tutBeats.length - 1].time + tNoteTravelTime + 1;
    if (!tutDone && (allDone || ct > maxTime)) {
      tutDone = true;
      const ratio = tutHitCount + '/' + tutTotalNotes;
      tutStatus.textContent = '演示完成 (' + ratio + ')';
      tutStatus.style.color = tutHitCount === tutTotalNotes ? '#2ecc71' : '#feca57';
      tutHint.textContent = '点击"重新演示"再试一次';
      tutStartBtn.textContent = '重新演示';
    }

    tutFrameId = requestAnimationFrame(tutLoop);
  }

  function startTutDemo() {
    tutNotes = tutBeats.map(b => new TutNote(b.time, b.dir));
    tutFeedbacks = [];
    tutParticles = [];
    tutHitCount = 0;
    tutTotalNotes = tutBeats.length;
    tutDone = false;
    tutStartTime = performance.now();
    tutRunning = true;
    tutStatus.textContent = '音符来了！在它们到达弧线时点击对应侧';
    tutStatus.style.color = '#feca57';
    tutHint.textContent = '还剩 ' + tutTotalNotes + ' 个音符';
    tutStartBtn.textContent = '重新演示';
    resizeTutCanvas();
    if (tutFrameId) cancelAnimationFrame(tutFrameId);
    tutFrameId = requestAnimationFrame(tutLoop);
  }

  function stopTutDemo() {
    tutRunning = false;
    if (tutFrameId) { cancelAnimationFrame(tutFrameId); tutFrameId = null; }
  }

  // Tutorial canvas input handling
  tutCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = tutCanvas.getBoundingClientRect();
    const scaleX = TW / rect.width;
    const tapX = (e.clientX - rect.left) * scaleX;
    tutOnTap(tapX);
  });
  tutCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = tutCanvas.getBoundingClientRect();
    const scaleX = TW / rect.width;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const tapX = (e.changedTouches[i].clientX - rect.left) * scaleX;
      tutOnTap(tapX);
    }
  }, { passive: false });

  // Keyboard support in tutorial
  function tutKeyHandler(e) {
    if (!tutMode || !tutRunning) return;
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'KeyF') {
      e.preventDefault();
      tutOnTap(TW * 0.25); // left side
    } else if (e.code === 'ArrowRight' || e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'KeyL') {
      e.preventDefault();
      tutOnTap(TW * 0.75); // right side
    } else if (e.code === 'Space') {
      e.preventDefault();
      // Auto-match nearest
      const ct = getTutTime();
      let bestX = TW / 2;
      let bestTimeDiff = Infinity;
      for (const n of tutNotes) {
        if (!n.alive || n.judged) continue;
        const diff = Math.abs(ct - n.time);
        if (diff < bestTimeDiff) { bestTimeDiff = diff; bestX = n.dir === 0 ? TW * 0.25 : TW * 0.75; }
      }
      tutOnTap(bestX);
    }
  }
  document.addEventListener('keydown', tutKeyHandler);

  // Button handlers
  tutBtn.addEventListener('click', () => {
    tutMode = true;
    document.getElementById('startScreen').style.display = 'none';
    tutScreen.classList.add('open');
    tutStatus.textContent = '';
    tutHint.textContent = '点击"开始演示"体验一下';
    tutStartBtn.textContent = '开始演示';
    resizeTutCanvas();
    // Draw initial static scene
    drawTutBg();
    drawTutDivider();
    drawTutArcs(0);
    drawTutCharacter();
  });

  tutStartBtn.addEventListener('click', () => { startTutDemo(); });

  tutBackBtn.addEventListener('click', () => {
    tutMode = false;
    stopTutDemo();
    tutScreen.classList.remove('open');
    document.getElementById('startScreen').style.display = 'flex';
  });

  window.addEventListener('resize', () => { if (tutMode) resizeTutCanvas(); });
})();
