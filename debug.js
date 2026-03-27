// debug.js — Debug & calibration panel
// ============ DEBUG / CALIBRATION PANEL ============
(function initDebugPanel() {
  const panel = document.getElementById('debugPanel');
  const debugBtn = document.getElementById('debugBtn');
  const debugClose = document.getElementById('debugClose');

  // Debug parameters
  const debugParams = {
    onsetThreshold: 1.5,
    minGap: 200,
    burstGap: 200,
    maxBurst: 5,
    densityMult: 1.3
  };

  // Waveform state
  let wfOffscreenCanvas = null;
  let wfBeatsOverlay = null;
  let wfZoom = 1;
  let wfScrollX = 0;
  let wfDragging = false;
  let wfDragStartX = 0;
  let wfDragStartScroll = 0;
  let wfAnimFrame = null;
  let lastDetectedBPM = 0;

  // Toggle panel
  function openDebugPanel() {
    panel.classList.add('open');
    syncParamsFromDifficulty();
    const noAudioEl = document.getElementById('dbgNoAudioHint');
    if (audioBuffer) {
      noAudioEl.style.display = 'none';
      updateDebugStats();
      renderWaveform();
    } else {
      noAudioEl.style.display = 'block';
    }
  }
  function closeDebugPanel() {
    panel.classList.remove('open');
    stopCalibration();
  }

  debugBtn.addEventListener('click', openDebugPanel);
  debugClose.addEventListener('click', closeDebugPanel);

  // Hotkey D to toggle during gameplay
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyS' && e.ctrlKey) return; // don't interfere with save
    if (e.code === 'Backquote' || (e.code === 'KeyD' && !gameRunning && !e.repeat)) {
      // Only toggle on start/end screens or with backtick during gameplay
      if (!gameRunning || e.code === 'Backquote') {
        e.preventDefault();
        if (panel.classList.contains('open')) closeDebugPanel();
        else openDebugPanel();
      }
    }
  });

  // Sync params from current difficulty
  function syncParamsFromDifficulty() {
    const d = DIFF_PRESETS[currentDiff || 'normal'];
    debugParams.densityMult = d.densityMult;
    document.getElementById('dbgDensityMult').value = d.densityMult;
    document.getElementById('dbgDensityMultVal').textContent = d.densityMult.toFixed(1);
  }

  // Wire up sliders
  const sliderIds = [
    ['dbgOnsetThresh', 'onsetThreshold'],
    ['dbgMinGap', 'minGap'],
    ['dbgBurstGap', 'burstGap'],
    ['dbgMaxBurst', 'maxBurst'],
    ['dbgDensityMult', 'densityMult']
  ];
  sliderIds.forEach(([id, param]) => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(id + 'Val');
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      debugParams[param] = v;
      valEl.textContent = Number.isInteger(v) ? v : v.toFixed(1);
    });
  });

  // Update stats display
  function updateDebugStats() {
    if (!audioBuffer) return;
    const bpm = estimateBPMForDebug();
    lastDetectedBPM = bpm;
    document.getElementById('dbgBPM').textContent = bpm.toFixed(1);
    document.getElementById('dbgBeatInt').textContent = (60000 / bpm).toFixed(0);
    document.getElementById('dbgDuration').textContent = audioBuffer.duration.toFixed(1);
    updateNoteStats();
    // Update sections display
    const secEl = document.getElementById('dbgSections');
    if (beats && beats._sections) {
      secEl.textContent = beats._sections.map(s => `${s.type}(${s.start.toFixed(0)}-${s.end.toFixed(0)}s)`).join(' ');
    } else {
      secEl.textContent = '--';
    }
  }

  function updateNoteStats() {
    const b = beats || [];
    const leftCount = b.filter(n => n.dir === 0).length;
    const rightCount = b.filter(n => n.dir === 1).length;
    document.getElementById('dbgNoteCount').textContent = b.length;
    document.getElementById('dbgLeftCount').textContent = leftCount;
    document.getElementById('dbgRightCount').textContent = rightCount;
    const dur = audioBuffer ? audioBuffer.duration : 1;
    document.getElementById('dbgDensity').textContent = (b.length / dur).toFixed(2);
    // Hold & dual stats
    let holdCount = 0;
    const dualPairIds = new Set();
    for (const n of b) {
      if (n.type === 'hold') holdCount++;
      if (n.isDual && n._dualPairId > 0) dualPairIds.add(n._dualPairId);
    }
    const lim = getSpecialLimits(currentDiff, audioBuffer ? audioBuffer.duration : 180);
    const holdEl = document.getElementById('dbgHoldCount');
    const dualEl = document.getElementById('dbgDualCount');
    if (holdEl) holdEl.textContent = holdCount + ' / ' + lim.maxHolds;
    if (dualEl) dualEl.textContent = dualPairIds.size + ' / ' + lim.maxDuals;
  }

  // Estimate BPM using the same logic as in detectBeats
  function estimateBPMForDebug() {
    if (!audioBuffer) return 120;
    const data = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;
    const flux = computeMultiResFlux(data, sr);
    return estimateBPM(flux.combinedFlux, flux.hopSec);
  }

  // ---- Waveform rendering ----
  function renderWaveform() {
    if (!audioBuffer) return;
    const wrap = document.getElementById('waveformWrap');
    const cvs = document.getElementById('waveformCanvas');
    const rect = wrap.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const dpr2 = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = cw * dpr2;
    cvs.height = ch * dpr2;
    cvs.style.width = cw + 'px';
    cvs.style.height = ch + 'px';

    // Pre-render waveform to offscreen canvas if needed
    if (!wfOffscreenCanvas || wfOffscreenCanvas._bufLen !== audioBuffer.length) {
      buildWaveformOffscreen();
    }
    if (!wfBeatsOverlay || wfBeatsOverlay._beatLen !== (beats ? beats.length : 0)) {
      buildBeatsOverlay();
    }

    drawWaveformView(cvs, cw, ch, dpr2);
  }

  function buildWaveformOffscreen() {
    if (!audioBuffer) return;
    const data = audioBuffer.getChannelData(0);
    const totalSamples = data.length;
    // Render at ~2000 pixels wide base resolution
    const baseW = 2000;
    const samplesPerPx = Math.floor(totalSamples / baseW);
    const h = 100;

    const oc = document.createElement('canvas');
    oc.width = baseW;
    oc.height = h;
    const octx = oc.getContext('2d');
    octx.fillStyle = '#0f0c29';
    octx.fillRect(0, 0, baseW, h);

    // Draw waveform
    octx.strokeStyle = '#9b59b6';
    octx.lineWidth = 1;
    octx.beginPath();
    const mid = h / 2;
    for (let px = 0; px < baseW; px++) {
      const start = px * samplesPerPx;
      const end = Math.min(start + samplesPerPx, totalSamples);
      let mn = 0, mx = 0;
      for (let i = start; i < end; i++) {
        if (data[i] < mn) mn = data[i];
        if (data[i] > mx) mx = data[i];
      }
      octx.moveTo(px, mid + mn * mid);
      octx.lineTo(px, mid + mx * mid);
    }
    octx.stroke();

    oc._bufLen = audioBuffer.length;
    oc._baseW = baseW;
    oc._duration = audioBuffer.duration;
    wfOffscreenCanvas = oc;
  }

  function buildBeatsOverlay() {
    if (!wfOffscreenCanvas) return;
    const baseW = wfOffscreenCanvas._baseW;
    const dur = wfOffscreenCanvas._duration;
    const h = 100;

    const oc = document.createElement('canvas');
    oc.width = baseW;
    oc.height = h;
    const octx = oc.getContext('2d');

    // Draw beat grid lines (gray)
    if (lastDetectedBPM > 0) {
      const beatSec = 60 / lastDetectedBPM;
      octx.strokeStyle = 'rgba(255,255,255,0.15)';
      octx.lineWidth = 1;
      for (let t = 0; t < dur; t += beatSec) {
        const px = (t / dur) * baseW;
        octx.beginPath();
        octx.moveTo(px, 0);
        octx.lineTo(px, h);
        octx.stroke();
      }
    }

    // Draw beat points as red lines
    const b = beats || [];
    octx.strokeStyle = '#ff4444';
    octx.lineWidth = 1;
    for (const n of b) {
      const px = (n.time / dur) * baseW;
      octx.beginPath();
      octx.moveTo(px, 0);
      octx.lineTo(px, h);
      octx.stroke();
    }

    oc._beatLen = b.length;
    wfBeatsOverlay = oc;
  }

  function drawWaveformView(cvs, cw, ch, dpr2) {
    const vctx = cvs.getContext('2d');
    vctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
    vctx.fillStyle = '#0f0c29';
    vctx.fillRect(0, 0, cw, ch);

    if (!wfOffscreenCanvas) return;
    const baseW = wfOffscreenCanvas._baseW;
    const dur = wfOffscreenCanvas._duration;
    const viewW = baseW / wfZoom;
    // Clamp scroll
    wfScrollX = Math.max(0, Math.min(wfScrollX, baseW - viewW));
    const sx = wfScrollX;

    // Draw waveform slice
    vctx.drawImage(wfOffscreenCanvas, sx, 0, viewW, 100, 0, 0, cw, ch);
    // Draw beats overlay
    if (wfBeatsOverlay) {
      vctx.drawImage(wfBeatsOverlay, sx, 0, viewW, 100, 0, 0, cw, ch);
    }

    // Draw playback cursor during gameplay
    if (gameRunning && audioCtx && audioStartTime) {
      const ct = getCurrentTime();
      if (ct >= 0 && ct <= dur) {
        const cursorBase = (ct / dur) * baseW;
        const cursorView = ((cursorBase - sx) / viewW) * cw;
        if (cursorView >= 0 && cursorView <= cw) {
          vctx.strokeStyle = '#2ecc71';
          vctx.lineWidth = 2;
          vctx.beginPath();
          vctx.moveTo(cursorView, 0);
          vctx.lineTo(cursorView, ch);
          vctx.stroke();
        }
      }
    }

    // Time labels
    vctx.fillStyle = 'rgba(255,255,255,0.5)';
    vctx.font = '10px Courier New';
    vctx.textAlign = 'left';
    const startT = (sx / baseW) * dur;
    const endT = ((sx + viewW) / baseW) * dur;
    vctx.fillText(startT.toFixed(1) + 's', 3, ch - 3);
    vctx.textAlign = 'right';
    vctx.fillText(endT.toFixed(1) + 's', cw - 3, ch - 3);
    vctx.textAlign = 'center';
    vctx.fillText('x' + wfZoom.toFixed(1), cw / 2, ch - 3);
  }

  // Waveform zoom/scroll
  document.getElementById('wfZoomIn').addEventListener('click', () => {
    wfZoom = Math.min(20, wfZoom * 1.5);
    renderWaveform();
  });
  document.getElementById('wfZoomOut').addEventListener('click', () => {
    wfZoom = Math.max(1, wfZoom / 1.5);
    renderWaveform();
  });

  // Drag to scroll waveform
  const wfWrap = document.getElementById('waveformWrap');
  let wfDragMoved = false;
  wfWrap.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    wfDragging = true;
    wfDragMoved = false;
    wfDragStartX = e.clientX;
    wfDragStartScroll = wfScrollX;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!wfDragging) return;
    if (!wfOffscreenCanvas) return;
    const dx = wfDragStartX - e.clientX;
    if (Math.abs(dx) > 3) wfDragMoved = true;
    const baseW = wfOffscreenCanvas._baseW;
    const wrap = document.getElementById('waveformWrap');
    const cw = wrap.getBoundingClientRect().width;
    const viewW = baseW / wfZoom;
    wfScrollX = wfDragStartScroll + dx * (viewW / cw);
    renderWaveform();
  });
  document.addEventListener('mouseup', () => { wfDragging = false; });

  // Mouse wheel to zoom
  wfWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) wfZoom = Math.min(20, wfZoom * 1.2);
    else wfZoom = Math.max(1, wfZoom / 1.2);
    renderWaveform();
  }, { passive: false });

  // Regenerate button
  document.getElementById('dbgRegenBtn').addEventListener('click', () => {
    if (!audioBuffer) {
      document.getElementById('dbgRegenStatus').textContent = '请先加载音频';
      return;
    }
    regenerateBeats();
  });

  async function regenerateBeats() {
    const statusEl = document.getElementById('dbgRegenStatus');
    statusEl.textContent = '生成中...';

    updateWorkerProgress = function(pct, label) {
      statusEl.textContent = `生成中 ${pct}% ${label}`;
    };

    try {
      const pcmData = audioBuffer.getChannelData(0).slice();
      const workerResult = await runWorkerDetection(
        pcmData, audioBuffer.sampleRate, audioBuffer.duration,
        'detectWithParams',
        { params: debugParams }
      );

      let quantized = workerResult.beats;
      beats = quantized.map(b => {
        if (b.type === 'hold') return { type: 'hold', startTime: b.startTime + noteOffsetMs/1000, endTime: b.endTime + noteOffsetMs/1000, dir: b.dir, color: b.color, _mergedCount: b._mergedCount || 2, _spawned: false };
        return { type: 'tap', time: b.time + noteOffsetMs/1000, dir: b.dir, color: b.color, _spawned: false };
      });
      if (workerResult._sections) beats._sections = workerResult._sections;
      if (workerResult._swingInfo) beats._swingInfo = workerResult._swingInfo;

      statusEl.textContent = '已生成 ' + beats.length + ' 个音符';
      wfBeatsOverlay = null;
      updateNoteStats();
      renderWaveform();

      if (audioFileName) saveChart(audioFileName, quantized);
    } catch(e) {
      statusEl.textContent = '生成失败: ' + e.message;
    }
    updateWorkerProgress = null;
  }

  // ---- Calibration Mode ----
  let calActive = false;
  let calAudioCtx = null;
  let calBPM = 120;
  let calBeatInterval = 0;
  let calNextBeatTime = 0;
  let calTimerID = null;
  let calTaps = [];
  let calBeatTimes = [];
  let calMaxTaps = 16;

  const calStartBtn = document.getElementById('calStartBtn');
  const calStopBtn = document.getElementById('calStopBtn');
  const calApplyBtn = document.getElementById('calApplyBtn');
  const calTapCountEl = document.getElementById('calTapCount');
  const calAvgOffsetEl = document.getElementById('calAvgOffset');
  const calInstructionEl = document.getElementById('calInstruction');

  calStartBtn.addEventListener('click', startCalibration);
  calStopBtn.addEventListener('click', stopCalibration);
  calApplyBtn.addEventListener('click', applyCalibrationOffset);

  function startCalibration() {
    if (calActive) return;
    calBPM = lastDetectedBPM > 0 ? lastDetectedBPM : 120;
    calBeatInterval = 60 / calBPM;
    calTaps = [];
    calBeatTimes = [];
    calActive = true;

    calStartBtn.style.display = 'none';
    calStopBtn.style.display = 'inline-block';
    calApplyBtn.style.display = 'none';
    calTapCountEl.textContent = '0';
    calAvgOffsetEl.textContent = '--';
    calInstructionEl.textContent = '听节拍器，点击此面板或按空格键同步...';
    calInstructionEl.style.color = '#feca57';

    // Create audio context for metronome
    calAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    calNextBeatTime = calAudioCtx.currentTime + 0.5;
    scheduleBeat();
    calTimerID = setInterval(scheduleBeat, 50);

    // Listen for taps
    panel.addEventListener('click', onCalTap);
    document.addEventListener('keydown', onCalKey);
  }

  function scheduleBeat() {
    if (!calActive || !calAudioCtx) return;
    const now = calAudioCtx.currentTime;
    // Schedule beats ahead
    while (calNextBeatTime < now + 0.2) {
      playMetronomeClick(calNextBeatTime);
      calBeatTimes.push(calNextBeatTime);
      calNextBeatTime += calBeatInterval;
    }
  }

  function playMetronomeClick(time) {
    if (!calAudioCtx) return;
    const osc = calAudioCtx.createOscillator();
    const gain = calAudioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.connect(gain);
    gain.connect(calAudioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  function onCalTap(e) {
    if (!calActive) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    recordCalTap();
  }

  function onCalKey(e) {
    if (!calActive) return;
    if (e.code === 'Space') {
      e.preventDefault();
      recordCalTap();
    }
  }

  function recordCalTap() {
    if (!calAudioCtx || calTaps.length >= calMaxTaps) return;
    const tapTime = calAudioCtx.currentTime;
    calTaps.push(tapTime);
    calTapCountEl.textContent = calTaps.length;

    if (calTaps.length >= 8) {
      calculateCalibrationOffset();
    }

    if (calTaps.length >= calMaxTaps) {
      calInstructionEl.textContent = '校准完成！查看结果';
      calInstructionEl.style.color = '#2ecc71';
      stopCalibration(true);
    }
  }

  function calculateCalibrationOffset() {
    if (calTaps.length < 4 || calBeatTimes.length < 2) return;
    // For each tap, find the nearest beat time and compute offset
    const offsets = [];
    for (const tap of calTaps) {
      let bestDiff = Infinity;
      for (const bt of calBeatTimes) {
        const diff = tap - bt;
        if (Math.abs(diff) < Math.abs(bestDiff)) bestDiff = diff;
      }
      // Only use reasonable offsets (within half a beat)
      if (Math.abs(bestDiff) < calBeatInterval / 2) {
        offsets.push(bestDiff * 1000); // convert to ms
      }
    }
    if (offsets.length < 3) return;
    // Remove outliers (>2 stddev)
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const stddev = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / offsets.length);
    const filtered = offsets.filter(o => Math.abs(o - mean) < stddev * 2);
    if (filtered.length < 2) return;
    const avgOffset = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    calAvgOffsetEl.textContent = avgOffset.toFixed(1);
    calApplyBtn.style.display = 'inline-block';
    calApplyBtn._offset = Math.round(avgOffset);
  }

  function applyCalibrationOffset() {
    const offset = calApplyBtn._offset || 0;
    // Clamp to slider range
    const clamped = Math.max(-100, Math.min(100, offset));
    offsetSlider.value = clamped;
    noteOffsetMs = clamped;
    const sign = clamped > 0 ? '+' : '';
    offsetValEl.textContent = sign + clamped + 'ms';
    calInstructionEl.textContent = '已应用偏移: ' + sign + clamped + 'ms';
    calInstructionEl.style.color = '#2ecc71';
    calApplyBtn.style.display = 'none';
  }

  function stopCalibration(keepResults) {
    if (!calActive && !keepResults) return;
    calActive = false;
    if (calTimerID) { clearInterval(calTimerID); calTimerID = null; }
    if (calAudioCtx) {
      try { calAudioCtx.close(); } catch(e) {}
      calAudioCtx = null;
    }
    panel.removeEventListener('click', onCalTap);
    document.removeEventListener('keydown', onCalKey);
    calStartBtn.style.display = 'inline-block';
    calStopBtn.style.display = 'none';
    if (!keepResults) {
      calInstructionEl.textContent = '校准已停止';
      calInstructionEl.style.color = '#888';
    }
  }

  // Update waveform cursor during gameplay
  function wfCursorLoop() {
    if (panel.classList.contains('open') && gameRunning && wfOffscreenCanvas) {
      const cvs = document.getElementById('waveformCanvas');
      const wrap = document.getElementById('waveformWrap');
      if (cvs && wrap) {
        const rect = wrap.getBoundingClientRect();
        const dpr2 = Math.min(window.devicePixelRatio || 1, 2);
        drawWaveformView(cvs, rect.width, rect.height, dpr2);
      }
    }
    requestAnimationFrame(wfCursorLoop);
  }
  requestAnimationFrame(wfCursorLoop);

  // Expose for external calls (preAnalyzeAudio)
  window.updateDebugStatsExt = function() { updateDebugStats(); };
  window.renderWaveformExt = function() { wfBeatsOverlay = null; renderWaveform(); };

  // ---- Chart Export/Import ----
  document.getElementById('dbgExportBtn').addEventListener('click', () => {
    if (!beats || beats.length === 0) {
      document.getElementById('dbgRegenStatus').textContent = '无谱面可导出';
      return;
    }
    const chartData = {
      name: audioFileName || 'unknown',
      bpm: lastDetectedBPM,
      noteCount: beats.length,
      notes: beats.map(b => ({ t: +b.time.toFixed(3), d: b.dir, c: b.color }))
    };
    const blob = new Blob([JSON.stringify(chartData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (audioFileName || 'chart').replace(/\.[^.]+$/, '') + '_chart.json';
    a.click();
    URL.revokeObjectURL(a.href);
    document.getElementById('dbgRegenStatus').textContent = '谱面已导出';
  });

  document.getElementById('dbgImportBtn').addEventListener('click', () => {
    document.getElementById('dbgImportFile').click();
  });

  document.getElementById('dbgImportFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.notes || !Array.isArray(data.notes)) throw new Error('Invalid chart');
        beats = data.notes.map(n => ({
          time: n.t, dir: n.d, color: n.c || '#48dbfb', _spawned: false
        }));
        if (data.bpm) lastDetectedBPM = data.bpm;
        wfBeatsOverlay = null;
        updateNoteStats();
        if (audioBuffer) renderWaveform();
        document.getElementById('dbgRegenStatus').textContent = '已导入 ' + beats.length + ' 个音符';
      } catch(err) {
        document.getElementById('dbgRegenStatus').textContent = '导入失败: ' + err.message;
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---- Waveform edit mode: 0=none, 1=add, 2=delete ----
  let wfEditMode = 0;
  const wfAddBeatBtn = document.getElementById('wfAddBeatBtn');
  const wfDelBeatBtn = document.getElementById('wfDelBeatBtn');
  function updateWfEditBtns() {
    wfAddBeatBtn.classList.toggle('dp-btn-active', wfEditMode === 1);
    wfDelBeatBtn.classList.toggle('dp-btn-active', wfEditMode === 2);
  }
  wfAddBeatBtn.addEventListener('click', () => {
    wfEditMode = wfEditMode === 1 ? 0 : 1;
    updateWfEditBtns();
  });
  wfDelBeatBtn.addEventListener('click', () => {
    wfEditMode = wfEditMode === 2 ? 0 : 2;
    updateWfEditBtns();
  });

  // ---- Click on waveform to add/remove beat ----
  let wfClickTimer = null;
  let wfLongPress = false;

  function getTimeFromWfEvent(clientX) {
    if (!wfOffscreenCanvas) return -1;
    const wrap = document.getElementById('waveformWrap');
    const rect = wrap.getBoundingClientRect();
    const relX = clientX - rect.left;
    const cw = rect.width;
    const baseW = wfOffscreenCanvas._baseW;
    const dur = wfOffscreenCanvas._duration;
    const viewW = baseW / wfZoom;
    const baseX = wfScrollX + (relX / cw) * viewW;
    return (baseX / baseW) * dur;
  }

  wfWrap.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    wfLongPress = false;
    wfClickTimer = setTimeout(() => { wfLongPress = true; }, 400);
  });

  wfWrap.addEventListener('pointerup', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    clearTimeout(wfClickTimer);
    // Only act if it wasn't a drag
    if (wfDragMoved) return;
    if (wfEditMode === 0) return; // no mode active, do nothing
    const t = getTimeFromWfEvent(e.clientX);
    if (t < 0) return;

    if (wfEditMode === 2) {
      // Delete mode: remove nearest beat within 0.15s
      if (beats && beats.length > 0) {
        let bestIdx = -1, bestDiff = Infinity;
        for (let i = 0; i < beats.length; i++) {
          const diff = Math.abs(beats[i].time - t);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        if (bestDiff < 0.15) {
          beats.splice(bestIdx, 1);
          wfBeatsOverlay = null;
          updateNoteStats();
          renderWaveform();
          document.getElementById('dbgRegenStatus').textContent = '已删除节拍点 @' + t.toFixed(2) + 's';
        }
      }
    } else if (wfEditMode === 1) {
      // Add mode: add beat at this time
      if (!beats) beats = [];
      beats.push({ time: t, dir: beats.length % 2, color: '#48dbfb', _spawned: false });
      beats.sort((a, b) => a.time - b.time);
      wfBeatsOverlay = null;
      updateNoteStats();
      renderWaveform();
      document.getElementById('dbgRegenStatus').textContent = '已添加节拍点 @' + t.toFixed(2) + 's';
    }
    wfLongPress = false;
  });

  // ---- Touch support for waveform scroll ----
  let wfTouchId = null;
  let wfTouchStartX = 0;
  let wfTouchStartScroll = 0;
  let wfTouchMoved = false;

  wfWrap.addEventListener('touchstart', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    if (wfTouchId !== null) return;
    const touch = e.changedTouches[0];
    wfTouchId = touch.identifier;
    wfTouchStartX = touch.clientX;
    wfTouchStartScroll = wfScrollX;
    wfTouchMoved = false;
    wfLongPress = false;
    wfClickTimer = setTimeout(() => { wfLongPress = true; }, 400);
    e.preventDefault();
  }, { passive: false });

  wfWrap.addEventListener('touchmove', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier !== wfTouchId) continue;
      wfTouchMoved = true;
      clearTimeout(wfClickTimer);
      if (!wfOffscreenCanvas) return;
      const dx = wfTouchStartX - touch.clientX;
      const wrap = document.getElementById('waveformWrap');
      const cw = wrap.getBoundingClientRect().width;
      const baseW = wfOffscreenCanvas._baseW;
      const viewW = baseW / wfZoom;
      wfScrollX = wfTouchStartScroll + dx * (viewW / cw);
      renderWaveform();
    }
    e.preventDefault();
  }, { passive: false });

  wfWrap.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier !== wfTouchId) continue;
      clearTimeout(wfClickTimer);
      if (!wfTouchMoved && wfOffscreenCanvas && wfEditMode !== 0) {
        const t = getTimeFromWfEvent(touch.clientX);
        if (t >= 0) {
          if (wfEditMode === 2) {
            // Delete mode: remove nearest beat
            if (beats && beats.length > 0) {
              let bestIdx = -1, bestDiff = Infinity;
              for (let i = 0; i < beats.length; i++) {
                const diff = Math.abs(beats[i].time - t);
                if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
              }
              if (bestDiff < 0.15) {
                beats.splice(bestIdx, 1);
                wfBeatsOverlay = null; updateNoteStats(); renderWaveform();
              }
            }
          } else if (wfEditMode === 1) {
            // Add mode: add beat
            if (!beats) beats = [];
            beats.push({ time: t, dir: beats.length % 2, color: '#48dbfb', _spawned: false });
            beats.sort((a, b) => a.time - b.time);
            wfBeatsOverlay = null; updateNoteStats(); renderWaveform();
          }
        }
      }
      wfTouchId = null;
      wfTouchMoved = false;
      wfLongPress = false;
    }
  });

})();
