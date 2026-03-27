# 像素笛韵 代码拆分方案

## 当前状态

- `index.html` 单文件 ~6091 行（CSS + HTML + JS 全内联）
- `audioWorker.js` ~785 行（Web Worker，已独立）
- 全局变量 45 个，函数间重度交叉引用

## 拆分目标

将单文件拆为 **8 个文件**，使用 `<script>` 顺序加载（不引入构建工具）。全局变量保持挂在 `window` 上，保证行为不变。

---

## 文件清单

### 1. `style.css` （从 index.html 提取）

**来源**: index.html 第 7~165 行（`<style>` 标签内全部内容）

**内容**: 所有 CSS 规则，包括：
- 基础布局、按钮样式（`.pixel-btn`）、滑块样式
- 调试面板样式（`#debugPanel` 相关）
- 响应式媒体查询（3 个断点）
- 动画关键帧（`comboPop`）

**依赖**: 无 JS 依赖。

---

### 2. `index.html` （精简后）

**保留内容**:
- `<head>` 中 `<link rel="stylesheet" href="style.css">`
- 全部 HTML 结构（第 167~850 行），包括：
  - `#startScreen`（主菜单、选歌、设置按钮）
  - `#settingsOverlay`（设置面板）
  - `#changelogOverlay`（更新日志，内容较多）
  - `<canvas id="gameCanvas">`
  - `#uiOverlay`（分数/连击显示）
  - `#endScreen`、`#pauseOverlay`
  - `#debugPanel`（调试面板 HTML 结构）
  - `#tutorialScreen`（教程 HTML 结构）
- 底部按顺序加载 JS：
```html
<script src="constants.js"></script>
<script src="audio.js"></script>
<script src="notes.js"></script>
<script src="render.js"></script>
<script src="tutorial.js"></script>
<script src="debug.js"></script>
```

---

### 3. `constants.js` — 全局状态 & 初始化

**来源**: 第 857~1137 行 + 第 1935~2289 行

**内容**:
- 所有全局变量声明（45 个：`audioCtx`, `beats`, `notes`, `score`, `combo`, `gameRunning` 等）
- `DIFF_PRESETS`, `TIP_JUDGE_PRESETS`, `SPECIAL_LIMITS_BASE`, `DUAL_HOLD_THRESHOLD`
- `applyDifficulty()` 函数
- `getSpecialLimits(diff, durationSec)` 函数
- 图像加载（`charImg`, `noteImgL`, `noteImgR`, `bgImg`, `bgImg2`）
- `resize()` 函数、背景缓存构建（`getBgCache`, `getBgCache2`）
- DOM 元素引用获取（`canvas`, `ctx`, `startBtn`, `presetSelect` 等）
- 音频 UI 事件（预设选择、文件上传、`preAnalyzeAudio`）
- 谱面存储/加载（`saveChart`, `loadChart`, `checkSavedChart`, `chartKey`）
- 设置面板逻辑（`saveSettings`, `loadSettings`, `hookSettingsSave` IIFE）
- 音效加载与播放（`playHitSound`, `playPerfectSound`, `loadPerfectSound` IIFE，含 base64 数据）
- `loadSettings()` 调用（最后执行）

**暴露到全局**: 所有变量和函数直接声明在顶层作用域。

**注意事项**:
- `preAnalyzeAudio()` 调用了 `runWorkerDetection`（在 audio.js 中）和 `detectDualNotes` / `injectDualNotes` / `enforceSpecialNoteLimits`（在 notes.js 中），需确保 audio.js 和 notes.js 先于此文件中的运行时调用被加载。但由于 `preAnalyzeAudio` 是异步函数且只在用户选歌后触发，实际执行时所有脚本已加载完毕。
- base64 音效数据（~29KB）保留在此文件的 IIFE 中。

---

### 4. `audio.js` — 音频分析 & Worker 桥接

**来源**: 第 899~952 行（Worker 管理）+ 第 997~1917 行（DSP 函数）

**内容**:
- `getAudioWorker()`, `runWorkerDetection()` — Worker 通信
- `updateWorkerProgress` 回调变量
- DSP 函数（主线程副本，供调试面板使用）：
  - `combFilter`, `estimateBPM`, `dpBeatTrack`, `medianFilter`
  - `detectSections`, `detectSwing`, `getSectionAtTime`
  - `assignNoteDirections`, `computeMultiResFlux`
  - `detectBeats`, `detectBeatsWithParams`
  - 后处理管线：`quantizeNotes`, `unifyDenseDirections`, `mergeDenseNotes`, `expandHoldBoundaries`, `mergeAdjacentHolds`, `injectOppositeNotes`, `applyMirror`, `runPipeline`

**依赖**:
- 读取全局: `audioWorker`, `DIFF_PRESETS`, `currentDiff`, `enableHold`, `mergeThreshMs`, `holdMinDuration`, `mirrorMode`
- 这些全局变量由 constants.js 声明，加载顺序保证可用。

---

### 5. `notes.js` — 音符类 & 双押处理

**来源**: 第 2291~3656 行

**内容**:
- **ObjectPool 类**（通用对象池）
- **Note 类**（tap 音符：`init`, `getPos`, `draw`）
- **HoldNote 类**（长键：`init`, `_getPosForTime`, `getPos`, `draw`）
- **Particle 类**（粒子效果）
- 池实例：`notePool`, `holdNotePool`, `particlePool`
- `getCurrentTime()` 函数
- **双押检测**: `detectDualNotes(beatsArr, threshold)`
- **双押注入**: `injectDualNotes(beatsArr, diff)`
- **上限裁切**: `enforceSpecialNoteLimits(beatsArr, diff, durationSec)`
- `notifyDualPartnerDead(deadNote)` — 双押光晕淡出通知
- **游戏核心逻辑**:
  - `spawnNotes()` — 音符生成
  - `updateNearestTipDists(ct)` — 预计算最近距离
  - `handleJudge()` — Miss 自动判定
  - `processTapBatch(points)` — 输入批处理
  - `onTap(tapX, tapY, touchId)` — 单次点击判定
  - `onRelease(touchId)` — 长键释放判定

**依赖**:
- 重度读写全局: `notes`, `notesLeft`, `notesRight`, `beats`, `particles`, `feedbacks`, `ripples`
- 读全局: `ctx`, `W`, `H`, `JUDGE_DIST`, `charX`, `charY`, `tipJudge`, `audioCtx`, `audioStartTime`, `NOTE_TRAVEL_TIME`, `combo`, `score` 等
- 调用 render.js 中的: `updateUI()`, `triggerMilestone()`（通过全局函数名）

---

### 6. `render.js` — 渲染 & 游戏循环 & 流程控制

**来源**: 第 2291~2289 行（部分渲染辅助）+ 第 3658~4750 行

**内容**:
- **反馈文字**: `Feedback` 类
- **涟漪效果**: `Ripple` 类
- **UI 更新**: `updateUI()`, `checkMilestone()`, `triggerMilestone(combo)`
- **星空背景**: `initStars()`, `drawStars()`
- **角色绘制**: `drawCharacter()`
- **连击轨道**: `drawComboOrbs(ct)`
- **判定弧绘制**: `drawJudgmentArcs(ct)` — 含动态光晕
- **音频可视化**: `drawAudioRing()`
- **进度条**: `drawProgress(ct)`
- **中心分割线**: `drawCenterDivider()`
- **倒计时**: `drawCountdown()`, `drawResumeCountdown()`
- **背景过渡**: `checkBgTransition()`, `drawBgWithTransition()`, `drawBgDimOverlay()`
- **主游戏循环**: `gameLoop(ts)` — 每帧调度所有系统
- **FC 动画**: `_fcAnimLoop()`, `_showEndScreen()`
- **游戏流程**: `startGame()`, `endGame()`, `pauseGame()`, `resumeGame()`, `replayGame()`, `exitToMenu()`
- **事件监听器**: 全部 40+ 个事件绑定（触摸、鼠标、键盘、按钮点击、全屏）

**依赖**:
- 调用 notes.js: `spawnNotes()`, `handleJudge()`, `updateNearestTipDists()`
- 调用 audio.js: `runWorkerDetection()`
- 调用 constants.js: `applyDifficulty()`, `resize()`
- 读写大量全局状态

---

### 7. `tutorial.js` — 教程系统

**来源**: 第 4824~5325 行（`initTutorial` IIFE）

**内容**: 完整的教程 IIFE，包含：
- `TutNote`, `TutFeedback`, `TutParticle` 独立类
- 教程画布渲染循环
- 教程输入处理
- 与主游戏唯一交互：设置 `window.tutMode` 标志位

**依赖**:
- 读取 `charImg`, `noteImgL`, `noteImgR`（图像资源，由 constants.js 加载）
- 设置 `tutMode` 全局变量
- **最独立的模块**，几乎无修改成本。

---

### 8. `debug.js` — 调试/校准面板

**来源**: 第 5328~6088 行（`initDebugPanel` IIFE）

**内容**: 完整的调试面板 IIFE，包含：
- 波形渲染（offscreen canvas）
- BPM 估算（调用 audio.js 的 `computeMultiResFlux`, `estimateBPM`）
- 参数调节滑块
- 谱面重新生成（调用 `runWorkerDetection`）
- 节拍点手动编辑
- 谱面导入/导出
- 校准模式

**依赖**:
- 调用 audio.js: `computeMultiResFlux`, `estimateBPM`, `runWorkerDetection`
- 读取全局: `audioBuffer`, `beats`, `currentDiff`, `DIFF_PRESETS`
- 暴露: `updateDebugStatsExt`, `renderWaveformExt`（供 `preAnalyzeAudio` 回调）

---

## 加载顺序 & 依赖图

```
style.css          (无依赖)
    ↓
index.html         (引用 style.css)
    ↓
constants.js       (无 JS 依赖，声明所有全局变量)
    ↓
audio.js           (依赖 constants.js 的全局变量)
    ↓
notes.js           (依赖 constants.js + audio.js)
    ↓
render.js          (依赖 constants.js + audio.js + notes.js)
    ↓
tutorial.js        (仅依赖 constants.js 的图像变量)
    ↓
debug.js           (依赖 constants.js + audio.js)
```

## 拆分步骤

### Phase 1: 提取 CSS
1. 将 `<style>` 内容移至 `style.css`
2. `<head>` 中改为 `<link rel="stylesheet" href="style.css">`
3. 验证样式不变

### Phase 2: 提取独立模块
4. 提取 `tutorial.js`（IIFE 直接剪切粘贴）
5. 提取 `debug.js`（IIFE 直接剪切粘贴）
6. 验证教程和调试面板功能正常

### Phase 3: 提取核心模块
7. 提取 `constants.js`（全局变量 + 初始化 + 设置 + 音效）
8. 提取 `audio.js`（DSP 函数 + Worker 桥接）
9. 提取 `notes.js`（音符类 + 双押 + 判定逻辑）
10. 提取 `render.js`（渲染 + 游戏循环 + 事件监听）
11. index.html 只保留 HTML 结构 + `<script>` 标签

### Phase 4: 验证
12. 完整功能测试清单：
    - [ ] 选歌 → 分析 → 开始游戏 → 正常游玩
    - [ ] 暂停 / 恢复（3秒倒计时）
    - [ ] 重来（双押连线保留）
    - [ ] 退出到主页
    - [ ] 全连 FC 动画
    - [ ] 切换难度 → 调试面板数据更新
    - [ ] 教程进入/退出
    - [ ] 调试面板：波形、重新生成、导入导出
    - [ ] 设置保存/恢复（刷新页面后保留）
    - [ ] 移动端触摸操作
    - [ ] 双押连线、光晕、淡出
    - [ ] 长键按压、尾判
    - [ ] 倒计时音符预览
    - [ ] Perfect 叮声播放

## 风险点

1. **全局变量顺序**: `loadSettings()` 必须在所有 UI 元素和变量声明之后执行。当前在 constants.js 末尾调用，需确认 DOM 已就绪（当前 `<script>` 在 body 末尾，DOM 已解析完毕，无问题）。

2. **IIFE 内部引用外部函数**: `debug.js` 的 IIFE 内通过闭包引用了 `estimateBPMForDebug` 等函数，这些函数调用了 audio.js 中的全局函数。由于 IIFE 在脚本加载时立即执行，需确保 audio.js 在 debug.js 之前加载。

3. **事件监听器中的函数引用**: render.js 中的事件监听器引用 notes.js 中的 `processTapBatch` 等函数。由于事件在用户交互时才触发，加载顺序保证了函数已定义。

4. **`preAnalyzeAudio` 的跨模块调用**: 此函数在 constants.js 中定义，但调用了 audio.js 的 `runWorkerDetection` 和 notes.js 的 `detectDualNotes`。由于它是 async 且用户触发，运行时所有模块已加载。但 `diffSelect` 的 change 事件监听器（在 constants.js 中注册）也调用了它，同样安全因为事件在页面完全加载后才可能触发。

5. **base64 音效数据**: 保留在 constants.js 中，不拆出独立文件，避免额外 HTTP 请求。

## 预估行数

| 文件 | 行数 | 说明 |
|------|------|------|
| style.css | ~160 | 纯样式 |
| index.html | ~700 | 纯 HTML + script 标签 |
| constants.js | ~1400 | 全局状态 + 初始化 + 设置 |
| audio.js | ~950 | DSP + Worker |
| notes.js | ~1400 | 音符类 + 判定 |
| render.js | ~1100 | 渲染 + 循环 + 流程 |
| tutorial.js | ~500 | 教程 IIFE |
| debug.js | ~760 | 调试 IIFE |
| **合计** | **~6970** | 含文件头注释 |
