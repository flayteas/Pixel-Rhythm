// ============ CLOUD SYNC (Cloudflare Workers + D1) ============
// No external SDK needed — uses fetch API

const CloudSync = (function() {
  'use strict';

  // ---- Config ----
  // Uses same-origin Pages Functions (no external URL needed)
  const API_BASE = '';

  const TOKEN_KEY = 'pixelRhythm_cloudToken';
  const USERID_KEY = 'pixelRhythm_cloudUserId';

  let _token = null;
  let _userId = null;
  let _initialized = false;
  let _syncing = false;
  let _displayName = null;

  // ---- Initialization ----
  function init() {
    if (_initialized) return;
    try {
      // Ready to use
      _updateUI('signed-out');
      // Restore saved credentials
      _token = localStorage.getItem(TOKEN_KEY);
      _userId = localStorage.getItem(USERID_KEY);
      if (_token && _userId) {
        // Verify token is still valid
        _verifyToken();
      } else {
        _updateUI('signed-out');
      }
      _initialized = true;
      console.log('[Cloud] Initialized');
    } catch(e) {
      console.warn('[Cloud] Init failed:', e);
    }
  }

  // ---- API Helper ----
  async function _api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (_token) {
      opts.headers['Authorization'] = 'Bearer ' + _token;
    }
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(API_BASE + path, opts);
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || 'API error ' + resp.status);
    }
    return data;
  }

  // ---- Auth ----
  async function _verifyToken() {
    try {
      _updateUI('signing-in');
      const data = await _api('GET', '/api/auth/verify');
      _userId = data.userId;
      _displayName = data.displayName || null;
      console.log('[Cloud] Token verified, user:', _userId.slice(0, 8) + '...');
      _updateUI('signed-in');
      // Auto-pull on reconnect
      pullFromCloud();
    } catch(e) {
      console.warn('[Cloud] Token invalid, clearing:', e.message);
      _clearCredentials();
      _updateUI('signed-out');
    }
  }

  async function signInAnonymously() {
    try {
      _updateUI('signing-in');
      const data = await _api('POST', '/api/auth/register');
      _token = data.token;
      _userId = data.userId;
      _saveCredentials();
      console.log('[Cloud] Registered anonymous user:', _userId.slice(0, 8) + '...');
      _updateUI('signed-in');
      // Push local data to cloud on first sign-in
      await pushToCloud();
      // Show recovery code to user
      if (data.recoveryCode) {
        _showRecoveryCode(data.recoveryCode);
      }
      return { uid: _userId };
    } catch(e) {
      console.warn('[Cloud] Registration failed:', e);
      _updateUI('error', '注册失败');
      return null;
    }
  }

  async function recoverAccount(code) {
    try {
      _updateUI('signing-in');
      const data = await _api('POST', '/api/auth/recover', { recoveryCode: code });
      _token = data.token;
      _userId = data.userId;
      _saveCredentials();
      console.log('[Cloud] Account recovered:', _userId.slice(0, 8) + '...');
      _updateUI('signed-in');
      // Pull cloud data to local
      await pullFromCloud();
      return { uid: _userId };
    } catch(e) {
      console.warn('[Cloud] Recovery failed:', e);
      _updateUI('error', '恢复失败');
      return null;
    }
  }

  function _showRecoveryCode(code) {
    let overlay = document.getElementById('recoveryCodeOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'recoveryCodeOverlay';
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:30;background:rgba(15,12,41,0.98);';
      document.getElementById('app').appendChild(overlay);
    }
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <h2 style="font-size:clamp(18px,5vw,24px);color:#feca57;margin:0 0 12px;letter-spacing:2px;">请保存恢复码</h2>
      <p style="color:#c8c0e0;font-size:13px;max-width:min(360px,85vw);text-align:center;line-height:1.7;margin:0 0 16px;">
        清除浏览器缓存或换设备后，可用此恢复码找回云存档。<br>
        <span style="color:#ff6b6b;font-size:12px;">恢复码仅显示一次，请立即截图或抄写！</span>
      </p>
      <div style="background:rgba(254,202,87,0.1);border:2px dashed #feca57;border-radius:12px;padding:16px 32px;margin:0 0 12px;">
        <span id="recoveryCodeText" style="font-size:clamp(24px,7vw,36px);font-family:monospace;letter-spacing:6px;color:#feca57;font-weight:bold;user-select:all;">${code}</span>
      </div>
      <button id="copyRecoveryBtn" class="pixel-btn" style="padding:8px 24px;font-size:13px;margin:0 0 16px;">复制恢复码</button>
      <button id="closeRecoveryBtn" class="pixel-btn" style="padding:12px 40px;font-size:clamp(14px,3.5vw,18px);">我已保存，关闭</button>
    `;

    document.getElementById('copyRecoveryBtn').addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(code);
        document.getElementById('copyRecoveryBtn').textContent = '已复制！';
      } catch(e) {
        // Fallback: select text
        const el = document.getElementById('recoveryCodeText');
        if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      }
    });
    document.getElementById('closeRecoveryBtn').addEventListener('click', () => {
      overlay.style.display = 'none';
    });
  }

  async function signOut() {
    _clearCredentials();
    _updateUI('signed-out');
    console.log('[Cloud] Signed out');
  }

  function _saveCredentials() {
    try {
      localStorage.setItem(TOKEN_KEY, _token);
      localStorage.setItem(USERID_KEY, _userId);
    } catch(e) {}
  }

  function _clearCredentials() {
    _token = null;
    _userId = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USERID_KEY);
    } catch(e) {}
  }

  function isSignedIn() {
    return !!_token && !!_userId;
  }

  // ---- Push to Cloud ----
  async function pushToCloud() {
    if (!_token || _syncing) return false;
    _syncing = true;
    _updateUI('syncing');
    try {
      const data = _collectLocalData();
      await _api('PUT', '/api/sync', data);
      _updateUI('synced', '已上传');
      console.log('[Cloud] Pushed to cloud');
      return true;
    } catch(e) {
      console.warn('[Cloud] Push failed:', e);
      _updateUI('error', '上传失败');
      return false;
    } finally {
      _syncing = false;
    }
  }

  // ---- Pull from Cloud ----
  async function pullFromCloud() {
    if (!_token || _syncing) return false;
    _syncing = true;
    _updateUI('syncing');
    try {
      const data = await _api('GET', '/api/sync');
      if (!data.records && !data.settings) {
        // No cloud data yet — push local data up
        _syncing = false;
        await pushToCloud();
        return true;
      }
      _mergeCloudData(data);
      _updateUI('synced', '已同步');
      console.log('[Cloud] Pulled from cloud');
      return true;
    } catch(e) {
      console.warn('[Cloud] Pull failed:', e);
      _updateUI('error', '同步失败');
      return false;
    } finally {
      _syncing = false;
    }
  }

  // ---- Collect Local Data ----
  function _collectLocalData() {
    const data = {};

    // Records
    try {
      const raw = localStorage.getItem('pixelRhythm_records');
      if (raw) data.records = JSON.parse(raw);
    } catch(e) {}

    // Settings (only gameplay-relevant ones)
    try {
      const raw = localStorage.getItem('pixelRhythm_settings');
      if (raw) data.settings = JSON.parse(raw);
    } catch(e) {}

    // Charts: skip sync (can be regenerated from audio, saves bandwidth)

    // Attach latest replay data (for leaderboard verification)
    if (CloudSync._lastReplay) {
      data.lastReplay = CloudSync._lastReplay;
      CloudSync._lastReplay = null;
    }

    return data;
  }

  // ---- Merge Cloud Data into Local ----
  function _mergeCloudData(cloudData) {
    if (cloudData.records) {
      _mergeRecords(cloudData.records);
    }
    if (cloudData.settings) {
      _mergeSettings(cloudData.settings);
    }
  }

  function _mergeRecords(cloudRecords) {
    const local = (() => {
      try { return JSON.parse(localStorage.getItem('pixelRhythm_records') || '{}'); }
      catch(e) { return {}; }
    })();

    let changed = false;
    for (const [key, cloudRec] of Object.entries(cloudRecords)) {
      const localRec = local[key];
      if (!localRec) {
        local[key] = cloudRec;
        changed = true;
      } else {
        if (cloudRec.highScore > localRec.highScore) {
          local[key] = {
            ...cloudRec,
            playCount: Math.max(cloudRec.playCount || 0, localRec.playCount || 0),
            isFC: cloudRec.isFC || localRec.isFC
          };
          changed = true;
        } else {
          if (cloudRec.isFC && !localRec.isFC) {
            localRec.isFC = true;
            changed = true;
          }
          if ((cloudRec.playCount || 0) > (localRec.playCount || 0)) {
            localRec.playCount = cloudRec.playCount;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      try {
        localStorage.setItem('pixelRhythm_records', JSON.stringify(local));
        if (typeof updateFCBadges === 'function') updateFCBadges();
      } catch(e) {}
    }
  }

  function _mergeSettings(cloudSettings) {
    try {
      localStorage.setItem('pixelRhythm_settings', JSON.stringify(cloudSettings));
      if (typeof loadSettings === 'function') loadSettings();
    } catch(e) {}
  }

  // ---- Auto-sync Hook ----
  function syncAfterSave() {
    if (!_token) return;
    clearTimeout(CloudSync._pushTimer);
    CloudSync._pushTimer = setTimeout(() => {
      pushToCloud();
    }, 2000);
  }

  // ---- UI Update ----
  function _updateUI(state, msg) {
    const btn = document.getElementById('cloudSyncBtn');
    const statusEl = document.getElementById('cloudStatus');
    if (!btn && !statusEl) return;

    const labels = {
      'unconfigured': '云同步（未配置）',
      'signed-out': '☁ 云同步',
      'signing-in': '连接中...',
      'signed-in': '☁ 已连接',
      'syncing': '同步中...',
      'synced': msg || '已同步',
      'error': msg || '同步失败'
    };

    if (btn) {
      btn.textContent = labels[state] || '☁ 云同步';
      btn.disabled = (state === 'syncing' || state === 'signing-in' || state === 'unconfigured');
    }
    if (statusEl) {
      statusEl.textContent = msg || '';
      if (state === 'error') {
        statusEl.style.color = '#ff6b6b';
      } else if (state === 'synced') {
        statusEl.style.color = '#51cf66';
      } else {
        statusEl.style.color = '#feca57';
      }
      if (msg) {
        clearTimeout(CloudSync._statusTimer);
        CloudSync._statusTimer = setTimeout(() => {
          if (statusEl) statusEl.textContent = '';
        }, 3000);
      }
    }
  }

  // ---- Cloud Sync Dialog ----
  function showSyncDialog() {
    let overlay = document.getElementById('cloudOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      _refreshDialog();
      return;
    }

    overlay = document.createElement('div');
    overlay.id = 'cloudOverlay';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:20;background:rgba(15,12,41,0.97);';
    overlay.innerHTML = `
      <h2 style="font-size:clamp(20px,5vw,28px);color:#feca57;margin:0 0 20px;letter-spacing:3px;">☁ 云同步</h2>
      <div id="cloudDialogContent" style="max-width:min(400px,90vw);width:100%;text-align:center;color:#c8c0e0;font-size:14px;line-height:1.8;">
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;" id="cloudDialogActions">
      </div>
      <button id="cloudBackBtn" class="pixel-btn" style="margin-top:20px;padding:12px 40px;font-size:clamp(14px,3.5vw,18px);">返回</button>
    `;

    document.getElementById('app').appendChild(overlay);
    document.getElementById('cloudBackBtn').addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    _refreshDialog();
  }

  function _refreshDialog() {
    const content = document.getElementById('cloudDialogContent');
    const actions = document.getElementById('cloudDialogActions');
    if (!content || !actions) return;

    if (!_initialized) {
      content.innerHTML = '<p style="color:#ff6b6b;">云服务未初始化。</p>';
      actions.innerHTML = '';
      return;
    }

    if (!_token) {
      content.innerHTML = '<p>登录后即可在多设备间同步你的游戏成绩和设置。</p><p style="font-size:12px;color:#8a7fb5;">点击下方按钮创建匿名账号，数据将自动上传到云端。</p>';
      actions.innerHTML = `
        <button class="pixel-btn" id="cloudAnonBtn" style="padding:10px 24px;font-size:14px;">创建云存档</button>
        <button class="pixel-btn" id="cloudRecoverBtn" style="padding:10px 24px;font-size:13px;">恢复账号</button>
      `;
      document.getElementById('cloudAnonBtn').addEventListener('click', async () => {
        await signInAnonymously();
        _refreshDialog();
      });
      document.getElementById('cloudRecoverBtn').addEventListener('click', () => {
        _showRecoverInput();
      });
      return;
    }

    // Signed in
    const uid = _userId ? _userId.slice(0, 8) + '...' : '未知';

    content.innerHTML = `
      <p style="color:#51cf66;">已连接云端</p>
      <p style="font-size:11px;color:#8a7fb5;">设备 ID: ${uid}</p>
      <div style="margin:10px 0;display:flex;align-items:center;justify-content:center;gap:6px;">
        <label style="color:#c8c0e0;font-size:13px;">昵称:</label>
        <input id="cloudNickInput" type="text" maxlength="20" placeholder="匿名玩家"
          style="width:140px;padding:6px 10px;font-size:13px;font-family:inherit;
          background:rgba(254,202,87,0.08);border:2px solid rgba(254,202,87,0.3);border-radius:4px;color:#feca57;outline:none;"
          autocomplete="off" spellcheck="false">
        <button class="pixel-btn" id="cloudNickSaveBtn" style="padding:5px 12px;font-size:12px;">保存</button>
      </div>
      <p id="cloudDialogStatus" style="font-size:13px;min-height:20px;color:#feca57;margin-top:8px;"></p>
    `;

    let btns = `
      <button class="pixel-btn" id="cloudPullBtn" style="padding:10px 24px;font-size:14px;">↓ 下载云端数据</button>
      <button class="pixel-btn" id="cloudPushBtn" style="padding:10px 24px;font-size:14px;">↑ 上传本地数据</button>
    `;
    btns += `<button class="pixel-btn" id="cloudResetRecoveryBtn" style="padding:10px 24px;font-size:13px;">重置恢复码</button>`;
    btns += `<button class="pixel-btn" id="cloudLogoutBtn" style="padding:10px 24px;font-size:13px;">退出登录</button>`;
    actions.innerHTML = btns;

    const statusEl = document.getElementById('cloudDialogStatus');
    const setDialogStatus = (msg, color) => {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || '#feca57'; }
    };

    document.getElementById('cloudPullBtn').addEventListener('click', async () => {
      setDialogStatus('正在同步...', '#feca57');
      const ok = await pullFromCloud();
      setDialogStatus(ok ? '同步完成！' : '同步失败', ok ? '#51cf66' : '#ff6b6b');
    });
    document.getElementById('cloudPushBtn').addEventListener('click', async () => {
      setDialogStatus('正在上传...', '#feca57');
      const ok = await pushToCloud();
      setDialogStatus(ok ? '上传完成！' : '上传失败', ok ? '#51cf66' : '#ff6b6b');
    });

    document.getElementById('cloudLogoutBtn').addEventListener('click', async () => {
      await signOut();
      _refreshDialog();
    });

    document.getElementById('cloudResetRecoveryBtn').addEventListener('click', async () => {
      setDialogStatus('正在生成新恢复码...', '#feca57');
      try {
        const data = await _api('POST', '/api/auth/reset-recovery');
        if (data.recoveryCode) {
          _showRecoveryCode(data.recoveryCode);
          setDialogStatus('已生成新恢复码', '#51cf66');
        }
      } catch(e) {
        setDialogStatus('生成失败', '#ff6b6b');
      }
    });

    const nickInput = document.getElementById('cloudNickInput');
    if (nickInput && _displayName) nickInput.value = _displayName;

    document.getElementById('cloudNickSaveBtn').addEventListener('click', async () => {
      const input = document.getElementById('cloudNickInput');
      const name = input.value.trim();
      if (!name) { setDialogStatus('请输入昵称', '#ff6b6b'); return; }
      setDialogStatus('保存中...', '#feca57');
      try {
        const data = await _api('PUT', '/api/auth/display-name', { displayName: name });
        setDialogStatus('昵称已保存: ' + data.displayName, '#51cf66');
      } catch(e) {
        setDialogStatus('保存失败: ' + e.message, '#ff6b6b');
      }
    });
  }

  function _showRecoverInput() {
    const content = document.getElementById('cloudDialogContent');
    const actions = document.getElementById('cloudDialogActions');
    if (!content || !actions) return;

    content.innerHTML = `
      <p style="color:#feca57;">输入恢复码</p>
      <p style="font-size:12px;color:#8a7fb5;margin-bottom:12px;">输入注册时获得的 8 位恢复码来找回账号</p>
      <input id="recoveryInput" type="text" maxlength="8" placeholder="如：ABCD1234"
        style="width:200px;padding:10px 16px;font-size:20px;font-family:monospace;letter-spacing:4px;text-align:center;
        background:rgba(254,202,87,0.08);border:2px solid rgba(254,202,87,0.3);border-radius:8px;color:#feca57;outline:none;
        text-transform:uppercase;" autocomplete="off" spellcheck="false">
      <p id="recoverStatus" style="font-size:13px;min-height:20px;color:#feca57;margin-top:8px;"></p>
    `;
    actions.innerHTML = `
      <button class="pixel-btn" id="recoverSubmitBtn" style="padding:10px 24px;font-size:14px;">确认恢复</button>
      <button class="pixel-btn" id="recoverBackBtn" style="padding:10px 24px;font-size:13px;">返回</button>
    `;

    const input = document.getElementById('recoveryInput');
    const statusEl = document.getElementById('recoverStatus');
    input.focus();

    document.getElementById('recoverSubmitBtn').addEventListener('click', async () => {
      const code = input.value.trim().toUpperCase();
      if (!code || code.length < 6) {
        statusEl.textContent = '请输入完整的恢复码';
        statusEl.style.color = '#ff6b6b';
        return;
      }
      statusEl.textContent = '正在恢复...';
      statusEl.style.color = '#feca57';
      const result = await recoverAccount(code);
      if (result) {
        statusEl.textContent = '恢复成功！';
        statusEl.style.color = '#51cf66';
        setTimeout(() => _refreshDialog(), 1500);
      } else {
        statusEl.textContent = '恢复码无效或不存在';
        statusEl.style.color = '#ff6b6b';
      }
    });

    document.getElementById('recoverBackBtn').addEventListener('click', () => {
      _refreshDialog();
    });

    // Allow Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('recoverSubmitBtn').click();
    });
  }

  // ---- Leaderboard ----
  async function fetchLeaderboard(songKey) {
    try {
      const resp = await fetch(API_BASE + '/api/leaderboard/' + encodeURIComponent(songKey));
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      return data.leaderboard || [];
    } catch(e) {
      console.warn('[Cloud] Leaderboard fetch failed:', e);
      return [];
    }
  }

  function showLeaderboard() {
    // Create or reuse overlay
    let overlay = document.getElementById('leaderboardOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'leaderboardOverlay';
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:25;background:rgba(15,12,41,0.97);';
      document.getElementById('app').appendChild(overlay);
    }
    overlay.style.display = 'flex';

    // Build song options from presetSelect
    const sel = document.getElementById('presetSelect');
    let songOpts = '';
    if (sel) {
      for (const opt of sel.options) {
        if (!opt.value) continue;
        const name = opt.textContent.replace(/\s*[★☆]\s*FC.*$/, '');
        songOpts += '<option value="' + opt.value + '">' + name + '</option>';
      }
    }

    // Default to current song+diff if available
    const curSong = (typeof getCurrentSongFile === 'function') ? getCurrentSongFile() : '';
    const curDiff = (typeof currentDiff !== 'undefined') ? currentDiff : 'normal';

    overlay.innerHTML = `
      <h2 style="font-size:clamp(20px,5vw,28px);color:#feca57;margin:0 0 12px;letter-spacing:3px;">排行榜</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:12px;max-width:min(500px,92vw);">
        <select id="lbSongSelect" style="flex:1;min-width:140px;font-family:inherit;font-size:13px;padding:6px 10px;background:#302b63;color:#fff;border:2px solid #9b59b6;border-radius:0;cursor:pointer;">
          ${songOpts}
        </select>
        <select id="lbDiffSelect" style="width:100px;font-family:inherit;font-size:13px;padding:6px 10px;background:#302b63;color:#fff;border:2px solid #9b59b6;border-radius:0;cursor:pointer;">
          <option value="easy">Easy</option>
          <option value="normal">Normal</option>
          <option value="hard">Hard</option>
          <option value="expert">Expert</option>
        </select>
      </div>
      <div id="lbContent" style="max-width:min(500px,92vw);width:100%;max-height:55vh;overflow-y:auto;padding:0 12px;">
        <p style="color:#feca57;text-align:center;">加载中...</p>
      </div>
      <button id="lbBackBtn" class="pixel-btn" style="margin-top:16px;padding:12px 40px;font-size:clamp(14px,3.5vw,18px);">返回</button>
    `;

    // Set defaults
    const songSel = document.getElementById('lbSongSelect');
    const diffSel = document.getElementById('lbDiffSelect');
    if (curSong && songSel) { songSel.value = curSong; }
    if (curDiff && diffSel) { diffSel.value = curDiff; }

    // Render function
    function renderBoard() {
      const songFile = songSel.value;
      const diff = diffSel.value;
      if (!songFile) return;
      const songKey = songFile + '|' + diff;
      const container = document.getElementById('lbContent');
      container.innerHTML = '<p style="color:#feca57;text-align:center;">加载中...</p>';

      fetchLeaderboard(songKey).then(board => {
        if (!board || board.length === 0) {
          container.innerHTML = '<p style="color:#8a7fb5;text-align:center;margin:40px 0;">暂无排行数据<br><span style="font-size:12px;">完成一次游戏并开启云同步即可上榜</span></p>';
          return;
        }
        let html = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:#9b9ecf;border-bottom:1px solid rgba(224,195,252,0.15);">
            <th style="padding:8px 4px;text-align:center;width:36px;">#</th>
            <th style="padding:8px 4px;text-align:left;">玩家</th>
            <th style="padding:8px 4px;text-align:right;">分数</th>
            <th style="padding:8px 4px;text-align:center;width:60px;">连击</th>
            <th style="padding:8px 4px;text-align:center;width:36px;"></th>
          </tr></thead><tbody>`;
        board.forEach((entry, i) => {
          const rankColor = i === 0 ? '#feca57' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#e0c3fc';
          const rankIcon = i < 3 ? ['🥇','🥈','🥉'][i] : (i + 1);
          const fcBadge = entry.isFC ? '<span style="color:#feca57;font-size:11px;" title="Full Combo">★</span>' : '';
          const verifiedBadge = entry.verified ? '<span style="color:#51cf66;font-size:10px;" title="已验证">✓</span>' : '';
          html += `<tr style="border-bottom:1px solid rgba(224,195,252,0.06);${i < 3 ? 'background:rgba(254,202,87,0.04);' : ''}">
            <td style="padding:7px 4px;text-align:center;color:${rankColor};font-weight:${i<3?'bold':'normal'};">${rankIcon}</td>
            <td style="padding:7px 4px;color:#e0c3fc;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.name} ${fcBadge}</td>
            <td style="padding:7px 4px;text-align:right;color:#fff;font-weight:bold;">${entry.score.toLocaleString()}</td>
            <td style="padding:7px 4px;text-align:center;color:#9b9ecf;">${entry.maxCombo}</td>
            <td style="padding:7px 4px;text-align:center;">${verifiedBadge}</td>
          </tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
      });
    }

    songSel.addEventListener('change', renderBoard);
    diffSel.addEventListener('change', renderBoard);
    document.getElementById('lbBackBtn').addEventListener('click', () => { overlay.style.display = 'none'; });

    // Initial load
    renderBoard();
  }

  return {
    init,
    signInAnonymously,
    recoverAccount,
    signOut,
    pushToCloud,
    pullFromCloud,
    syncAfterSave,
    showSyncDialog,
    showLeaderboard,
    fetchLeaderboard,
    isSignedIn,
    _pushTimer: null,
    _statusTimer: null,
    _lastReplay: null
  };
})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CloudSync.init());
} else {
  CloudSync.init();
}
