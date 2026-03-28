# 像素笛韵 (Pixel Rhythm) - 开发日志

## 项目概述

浏览器端音律游戏，双文件架构（`index.html` ~4249行 + `audioWorker.js` ~785行），使用 Canvas 2D 渲染，Web Audio API 进行音频分析与播放。支持触屏多点触控、键盘操作、自动谱面生成、长键（实验性）等功能。音频分析在 Web Worker 中执行，不阻塞主线程。

## 资源文件清单

| 文件 | 说明 | 来源 |
|------|------|------|
| `index.html` | 游戏主体（HTML + CSS + JS 全内联，~4249行） | 用户上传 + 修改 |
| `audioWorker.js` | 音频分析 Web Worker（节拍检测 + 后处理管线，~785行） | v34 新增 |
| `character.png` | 像素角色（吹笛少女） | 用户上传 |
| `left.png` | 左侧音符图像（红色勺子） | 用户上传 |
| `right.png` | 右侧音符图像（left.png 水平镜像） | 自动生成 |
| `background01.jpg` | 主背景（演唱会紫色灯光） | 用户上传 |
| `background02.jpg` | 高连击切换背景（蓝色纸屑） | 用户上传 |
| `button.png` | 像素风格按钮材质（112x32px） | 用户绘制 |
| `slider-thumb.png` | 南瓜滑块拖动图标（28x31px） | 用户绘制 |
| `hit1.wav` / `hit2.wav` / `hit3.wav` | 打击音效 | 用户上传 |
| `perfect_ding.wav` | Perfect 判定音效（2200Hz 钟鸣，0.22s） | AI 合成，v52 新增 |
| `escaping_gravity.ogg` | 内置曲目「Escaping Gravity」 | 用户上传 |
| `escaping_gravity.flac` | Escaping Gravity 无损版 | 用户上传 |
| `startbg.jpg` | 开始界面背景照片墙（1600×1200, 333KB） | 用户上传 + 压缩 |
| `covers/*.jpg` | 歌曲封面图（74张，256×256 JPG，4~18KB/张） | 用户上传 + PIL 压缩 |

### 内置音乐 - 司南的歌

| 文件 | 曲名 | 格式 | 来源 |
|------|------|------|------|
| `preset.mp3` | 拜无忧 | MP3 | zip 解压 |
| `逆流雨.mp3` | 逆流雨 | MP3 | FLAC→MP3 转码 |
| `过期凤梨.mp3` | 过期凤梨 | MP3 | FLAC→MP3 转码 |
| `南风说.mp3` | 南风说 | MP3 | FLAC→MP3 转码 |
| `苏东坡.mp3` | 苏东坡 | MP3 | FLAC→MP3 转码 |
| `你相信平行时空吗.mp3` | 你相信平行时空吗 | MP3 | zip 直接解压 |
| `到此一游.mp3` | 到此一游 | MP3 | zip 直接解压 |
| `尔尔.mp3` | 尔尔 | MP3 | zip 直接解压 |
| `星星在唱歌.mp3` | 星星在唱歌 | MP3 | zip 直接解压 |
| `思有邪.mp3` | 思有邪 | MP3 | zip 直接解压 |
| `吹灭小山河.mp3` | 吹灭小山河 | MP3 | zip 直接解压 |

---

## 修改记录

### v0 - 初始构建

**任务**: 将用户上传的素材组装为可运行的 Web 游戏

- 复制所有资源到 output 目录
- 用 PIL 将 `left.png` 水平翻转生成 `right.png`（原始未提供）
- 解压 `C200004KYSgD1xA81H.zip` 获取「拜无忧」mp3
- 环境无 ffmpeg，保留 mp3 格式直接使用，修改 HTML 中预设引用：
  - `preset.ogg` → `preset.mp3`
  - 动态 MIME 类型检测：`url.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg'`

---

### v1 - 判定系统重构：时间窗口 → 图像空间判定

**任务**: 将判定从时间窗口(±ms)改为基于音符图像与弧线的空间重叠

- 新增 `NOTE_DRAW_SIZE=44`, `NOTE_HALF_SIZE=22`, `ZONE_PRESETS` 常量
- `onTap()`: 只匹配图像与弧线重叠的音符，按图像内位置(前1/3=P, 中1/3=G, 后1/3=H)分级
- `handleJudge()`: Miss 判定改为图像完全越过弧线
- `drawJudgmentArcs()`: 辅助可视化改为三段彩色弧形带 + P/G/H 标注
- `Note.draw()`: 音符上显示分区刻度线
- UI: 复选框标签改为「判定区域辅助」

---

### v2 - 判定辅助可视化持续显示

**任务**: 将判定刻度线集成到判定辅助按钮，始终可见

- 判定弧上的三段色带 + 边界线 + P/G/H 标注，统一受 `showGuideDots` 控制
- 音符上的分区刻度线移除距离衰减，alpha 跟随音符本身透明度

---

### v3 - 宽容窗口（时间兜底）

**任务**: 降低空挥挫败感，在空间判定失败时提供时间兜底

- 新增全局变量 `leniencyMs`（默认150ms），开始界面添加滑块（0~150ms）
- `onTap()` 新增 fallback 分支：空间判定无命中时，查找时间差 ≤ 阈值的最近音符
- 宽容命中按时间差三等分判定等级，反馈文字追加 `(宽容)` 标记
- 设为 0ms 时 fallback 完全跳过

---

### v4 - 连击计数器动画 + 里程碑特效

**任务**: 增强连击动态反馈，里程碑(10/20/30/50/75/100)触发额外特效

**CSS 新增:**
- `@keyframes comboPop`: 放大1.5x + 旋转5deg + 回弹，350ms
- `updateUI()` 中叠加 `combo-pop` 类到连击数字

**里程碑系统:**
- `MILESTONES = [10, 20, 30, 50, 75, 100]`，`lastMilestone` 防重复
- `triggerMilestone(combo)`:
  - 30个彩虹粒子从左右判定弧爆发（HSL色环均匀分布）
  - 屏幕白色闪烁（alpha 0.5 快速衰减）
  - 复用 hit 音效以高增益播放
  - 屏幕中央大号文字 `COMBO xN!` 上浮淡出（显示1.5s）
- `checkMilestone()` 在 `onTap` 连击递增后调用
- 粒子上限从 60 提升到 120
- 游戏开始/重来时重置所有里程碑状态

---

### v5 - 判定系统再重构：图像分区 → 纯勺尖判定

**任务**: 简化判定心理模型，只看勺尖到弧线的距离

**核心变更:**
- 删除 `ZONE_PRESETS` / `zoneConfig`（图像三段分区）
- 新增 `TIP_JUDGE_PRESETS` / `tipJudge`（基于勺尖距离的px阈值）
- 判定逻辑: `tipDist = centerDist - NOTE_HALF_SIZE`（勺尖到弧线的距离）
  - `|tipDist| <= perfectPx` → Perfect
  - `|tipDist| <= goodPx` → Good
  - `|tipDist| <= hitPx` → Hit
  - 超出 hitPx → 无效
- Miss: 勺尖越过弧线超过 hitPx 后触发

**辅助可视化同步更新:**
- 弧线: 三段色带改为以勺尖目标线(tipR)为中心的同心距离环
- 金色实线 = 勺尖理想命中位置，虚线 = P/G/H 边界
- 音符: 移除所有刻度线和十字标记，只保留一个红点标记勺尖判定位置

---

### v6 - 宽容窗口默认值调整

- `leniencyMs` 默认值从 50ms 调至 150ms
- HTML 滑块 value 和显示文字同步更新

---

### v7 - 判定区域淡红光效

**任务**: 在判定弧区域添加常驻视觉提示

- 在 `drawJudgmentArcs()` 中、guide dots 之前，绘制始终可见的红色径向渐变光晕
- 范围: `tipR ± hitPx + 4px`（向外扩4px柔化边缘）
- 使用 `createRadialGradient`，峰值 alpha=0.20，两端衰减到 0
- 不受 `showGuideDots` 开关影响，始终显示

---

### v8 - 降低判定精度要求

**任务**: 扩大判定像素阈值，让玩家更容易命中

| 难度 | Perfect | Good | Hit | 倍率 |
|------|---------|------|-----|------|
| Easy | ±18px | ±30px | ±42px | ~1.7x |
| Normal | ±13px | ±24px | ±36px | ~1.7x |
| Hard | ±9px | ±18px | ±28px | ~1.6x |

---

### v9 - 减慢音符飞行速度

- `NOTE_TRAVEL_TIME` 基础值从 2.0s 提升到 2.8s
- `applyDifficulty()` 中公式同步更新: `(2.8 / 0.85) / speedMult`
- 各难度实际飞行时间增加约 40%

---

### v10 - 音符延迟默认改为 -60ms

- `noteOffsetMs` 默认值从 0 改为 -60
- HTML 滑块 `value="-60"`，显示文字 `-60ms`
- 音符提前 60ms 出现，给玩家额外反应余量

---

### v11 - 动态视觉反馈系统

**任务**: 帮助玩家准确把握"何时点击"

**1. 动态判定弧高亮 (`drawJudgmentArcs`)**
- 每侧弧线根据最近未判定音符的勺尖距离动态变化
- 检测范围 120px，二次曲线加速（越近越猛）
- 双重描边叠加，峰值透明度 0.85，shadowBlur 最高 30px
- 弧线颜色从白色渐变为红色

**2. 音符靠近光晕 (`Note.draw`)**
- 勺尖距弧线 80px 以内出现径向渐变光晕（左蓝/右红）
- 光晕半径最大 38px，附带 canvas shadowBlur
- 距离 40% 以内叠加金色暖光覆盖

**3. 完美点指示器**
- 音符距弧线 60px 以内，弧线上出现白色脉冲亮点
- 内核亮白小点 + 金色 shadowBlur（最高 32px）

---

### v12 - 多点触控优化

**任务**: 确保同时点击两侧互不干扰

**批处理架构 `processTapBatch()`:**
- 所有触摸点收集到数组，在一个批次内依次调用 `onTap`
- 批次共享 `_batchConsumed` Set，防止同批次两根手指命中同一音符
- `charBounce` 和震动反馈每批只触发一次

**鼠标/触摸去重:**
- `_lastTouchStartTime` 记录，mousedown 在 300ms 内跳过
- 解决混合设备 touch + mouse 双重事件

---

### v13 - 像素风格 UI 替换

**任务**: 用用户绘制的像素按钮和南瓜滑块替换默认 UI

**按钮材质 (`button.png`, 112x32px):**
- `.pixel-btn` CSS 类: `background-size: 100% 100%`, `image-rendering: pixelated`
- hover 放大 5% + 亮度 1.2, active 缩小 3% + 变暗, disabled 灰化
- 应用到: 开始游戏、全屏游玩、加载谱面、调试面板、再来一次、返回主页、继续/重来/退出
- 上传标签也使用同一背景
- 调试面板内部按钮保持原样

**滑块南瓜 (`slider-thumb.png`, 28x31px):**
- 全局 `input[type=range]` 样式覆盖（-webkit + -moz）
- 自定义 thumb: 22x24px, `background-size: contain`, pixelated
- 轨道: 6px 高，半透明紫色圆角条

---

### v14 - 音符方向分配策略优化

**任务**: 基于频段+能量综合决定音符方向

**共享函数 `assignNoteDirections(onsets)`:**

| 频段特征 | 方向 | 颜色 | 条件 |
|---------|------|------|------|
| 低频主导（鼓/贝斯） | 左 | 红色 | lo > mi×1.4 且 lo > hi×1.4 |
| 高频主导（旋律/人声） | 右 | 紫色 | hi > mi×1.4 且 hi > lo×1.4 |
| 偏低频（>45%占比） | 80%概率左 | 红色 | 软偏向 |
| 偏高频（>45%占比） | 80%概率右 | 紫色 | 软偏向 |
| 中频/中性 | 交替+随机 | 青色 | 平衡优先 |

**平衡机制:**
- 全局 L/R 计数器，差值 >2 时强制偏向少的一侧
- 中性音符默认交替
- 连续同方向上限 3 个
- 两处调用点（主生成 + 调试重新生成）统一使用

---

### v15 - 内置音乐分栏管理

**任务**: 新建"司南的歌"分组，支持批量添加音频

- `<optgroup label="司南的歌">` / `<optgroup label="内置曲目">`
- 第一批: 从 FLAC zip 解压转码（soundfile MP3 编码）— 逆流雨/过期凤梨/南风说/苏东坡
- 第二批: 从 MP3 zip 直接解压 — 你相信平行时空吗/到此一游/尔尔/星星在唱歌/思有邪/吹灭小山河
- 文件名清理: 移除 "司南 - " 前缀和 "-soConvert" 后缀

---

### v16 - 暂停恢复 3 秒倒计时

**任务**: 暂停恢复时给玩家缓冲时间

**`resumeGame()` 改造:**
- 点击继续/按 Escape 后，先显示 3→2→1→GO! 倒计时
- 使用 `performance.now()` 独立计时（audioCtx 仍暂停）
- `_resumeCountdownActive` 标志位控制

**阻塞逻辑:**
- 倒计时期间: 音频保持 suspended、音符静止、玩家输入屏蔽
- Escape 键在倒计时期间不响应
- 倒计时结束后 `audioCtx.resume()` 恢复播放

**游戏循环:**
- `drawResumeCountdown()` 在 `drawCountdown()` 之前检查
- 命中时渲染静态场景（音符 + 进度条 + 分割线）但不推进游戏逻辑

---

### v17 - 长键系统（实验性）

**任务**: 将密集段同侧音符合并为长按音符

**数据结构:**
```javascript
// 普通音符
{ type: 'tap', time, dir, color, _spawned }
// 长键
{ type: 'hold', startTime, endTime, dir, color, _spawned, _holding, _startJudged, _endJudged }
```

**密集段合并 `mergeDenseNotes(result, threshold)`:**
- 遍历音符，寻找连续同侧且间隔 ≤ threshold 的序列（≥3个）
- 合并为一个 hold: startTime=首个, endTime=末个
- 颜色取能量最高的音符
- 时长 < `holdMinDuration`(400ms) 的 hold 回退为两个 tap（头+尾）
- 应用于3处: preAnalyzeAudio / startGame / debugRegenerate

**HoldNote 类:**
- 继承 Note 的位置计算逻辑
- 绘制: 渐变色粗线体（12px宽，圆头）+ 白色内线 + 尾端圆点
- 按住时: 头部金色脉冲光晕，体色变金
- 头部夹紧到判定弧（start 已判定后不再远离）
- 结束接近时尾端闪烁提示

**判定逻辑:**
- 起始: 与 tap 相同的空间/宽容双重判定，触发 _startJudged + _holding
- 结束: `onRelease()` 中按松手时间 vs endTime 三等分分级
- 过早松手 → Miss; 超时未完成 → 自动 Miss
- 起始和结束各 +1 combo

**多指支持:**
- `holdTouchMap: Map<touchId, HoldNote>` 独立管理
- touchstart/mousedown 绑定 touchId，touchend/mouseup/touchcancel 触发 release
- 键盘: Space→kb_space, 左键→kb_left, 右键→kb_right

**谱面存储兼容:**
- save: hold 存为 `{ type:'hold', st, et, d, c }`, tap 存为 `{ t, d, c }`
- load: 有 type='hold' 的还原为 hold，无 type 的默认为 tap
- 兼容旧谱面

**UI 选项:**
- 复选框「长键（实验性）」— 默认不开启
- 合并阈值滑块: 100~400ms，默认 200ms
- 最短长键滑块: 200~800ms，默认 400ms

---

### v18 - 里程碑显示时间延长

- combo 成就文字显示时间从 ~1.1s 延长到 ~1.5s
- `m.life` decay: 0.015 → 0.011
- 上浮速度: 0.5px/帧 → 0.35px/帧

---

## 架构关键点

### 代码结构 (index.html 内联 JS, ~4141行)

```
L1-148       CSS 样式（pixel-btn, slider-thumb, comboPop 动画, 响应式）
L149-340     HTML 结构（开始/结束/暂停/调试面板，含长键/合并/宽容滑块）
L341-415     全局变量 & 难度系统 & 性能缓存
L416-555     图像加载 / 布局 / 背景缓存 / 勺子精灵
L556-662     音频上传 & 预设加载 & 预分析
L663-942     音频分析核心（spectral flux, comb filter BPM, DP beat tracking, 频段方向分配）
L943-1325    谱面生成（section detection, swing, onset picking, grid snap, gap fill, direction assignment）
L1326-1445   谱面量化/存储/加载/音效/宽容/长键设置变量
L1446-1496   打击音效/勺子绘制
L1497-1724   渲染（判定弧 + 红色光晕 + 动态高亮 + 完美点指示 + 勺尖辅助环）
L1725-1784   密集段合并函数 mergeDenseNotes
L1785-1883   Note 类（tap 音符：位置计算、图像绘制、接近光晕、红点标记）
L1884-2011   HoldNote 类（长键：渐变体/光晕/尾端标记/按压反馈）
L2012-2090   粒子 / 涟漪 / 连击轨道粒子
L2091-2224   反馈文字 / UI更新 / 里程碑系统（1.5s显示）
L2225-2274   星空背景（缓存） / 角色绘制
L2275-2560   游戏逻辑（spawnNotes/handleJudge/processTapBatch/onTap/onRelease）
L2561-2700   音频可视化 / 进度条 / 倒计时 / 背景渐变
L2701-2766   主游戏循环（绘制顺序 + 恢复倒计时）
L2767-3007   游戏流程（start/end/pause/resume 含3秒倒计时/replay/exit）
L3008-3152   事件监听（触摸/鼠标/键盘 + release handlers + 全屏）
L3153-4141   调试面板（波形、校准、谱面编辑、导入导出、参数调节）
```

### 判定系统数据流（当前版本）

```
用户触摸/点击/按键
  → processTapBatch(points[]) — 收集所有触点，传入 touchId
    → onTap(touchX, touchY) × N（每个触点）
      → 确定 tapDir (左0/右1/任意-1)
      │
      → [如果启用长键] 第零优先: 长键起始判定
      │  遍历 hold notes，计算 startTime 的 tipDist
      │  命中 → _startJudged=true, _holding=true, holdTouchMap.set(touchId, note)
      │  → 分级 + 得分 + combo++ → return
      │
      → 第一优先: tap 勺尖空间判定
      │  遍历 notes (跳过 hold)，计算 tipDist
      │  |tipDist| <= hitPx → 候选
      │  选 |tipDist| 最小 → Perfect/Good/Hit
      │
      → 第二优先: 宽容兜底 (leniencyMs > 0)
      │  仅在空间判定无命中时触发
      │  遍历 notes (跳过 hold)
      │  时间差三等分 → Perfect/Good/Hit + (宽容)
      │
      → 无命中: return

用户松手
  → onRelease(touchId)
    → holdTouchMap.get(touchId) → holdNote
    → 过早松手(ct < endTime - leniencyMs) → Miss
    → 正常松手 → 按时间差分级 → 得分 + combo++

自动 Miss (handleJudge)
  → tap: tipDist < -hitPx → Miss
  → hold start: 未按且 startTime 已过 → Miss
  → hold end: 已按但 endTime+leniency 已过 → Miss
```

### 音符方向分配流

```
detectBeats / detectBeatsWithParams
  → 频段能量: lo(0-300Hz), mi(300-2000Hz), hi(2000Hz+)
  → assignNoteDirections(onsets)
    → lo dominant (>1.4x others) → 左, 红色
    → hi dominant (>1.4x others) → 右, 紫色
    → lo leaning (>45%) → 80%左
    → hi leaning (>45%) → 80%右
    → neutral → 交替 + 平衡计数器
    → 连续同向 cap=3
  → [如果启用长键] mergeDenseNotes
    → 连续同侧 ≥3个, 间隔 ≤ threshold → hold
    → hold 时长 < holdMinDuration → 回退为 tap×2
```

### 长键生命周期

```
beats 数组 (type='hold')
  → spawnNotes(): new HoldNote(startTime, endTime, dir, color)
  → draw(): 渐变体 + 头部/尾端标记
  → onTap(): startTime 判定 → _startJudged, _holding, holdTouchMap
  → draw(): 按住状态 → 金色光晕
  → onRelease(): endTime 判定 → _endJudged, alive=false
  → 或 handleJudge(): 超时 → 自动 Miss
  → notes.filter(): 清理已完成的 hold
```

---

## 已知限制

- `right.png` 是 `left.png` 的自动镜像，非原创设计
- FLAC→MP3 转码为 mono（soundfile 限制），音质有损
- `hit2.wav` / `hit3.wav` 已复制但代码中仅加载 `hit1.wav`
- 时间窗口常量 (`PERFECT_WINDOW` 等) 保留但不再用于游戏判定，仅供谱面兼容
- 里程碑数组为硬编码，超过 100 连击后不再触发额外特效
- 长键功能标记为"实验性"，默认关闭
- 部分歌曲（如吹灭小山河）开头全为高频主导，几乎所有音符分配到右侧
- `逆流雨.ogg` 为早期测试残留文件（3.6KB，无效），实际使用 `逆流雨.mp3`

---

### v19 - 长键边界扩展（吸收邻近 tap）

**任务**: 让长键"吃掉"前后紧邻的同侧普通键，减少长键与 tap 的交替感

**新增函数 `expandHoldBoundaries(notes)`:**
- 对每个 hold，向前查找同侧 tap，间隔 ≤ `mergeThreshMs/1000`（默认 0.35s）→ 延伸 `startTime`
- 向后同理 → 延伸 `endTime`
- 被吸收的 tap 标记 `_absorbed=true`，最终 filter 移除
- 迭代最多 3 次直到无新吸收
- 管线位置: `mergeDenseNotes` → **`expandHoldBoundaries`** → `mergeAdjacentHolds`
- 三处调用点: preAnalyzeAudio / startGame / debugRegenerate

---

### v20 - 合并相邻长键

**任务**: 消除多个短长键"断断续续"的现象，形成连贯长音

**新增函数 `mergeAdjacentHolds(notes)`:**
- 扫描音符列表，若两个同侧 hold 间隔 ≤ 0.3s → 合并为一个（取最早 startTime，最晚 endTime）
- 跳过中间穿插的异侧 tap（保留），吞并同侧连续 hold
- 最终按时间重排序
- 管线位置: `expandHoldBoundaries` → **`mergeAdjacentHolds`**

---

### v21 - 密集段方向统一（解决长键无法合并问题）

**问题**: `assignNoteDirections` 的 `CONSEC_CAP=3` 和默认交替逻辑导致密集区间音符频繁 L/R 切换，`mergeDenseNotes` 要求连续同侧 ≥3 无法满足

**新增函数 `unifyDenseDirections(notes, threshold)`:**
- 扫描音符列表，找到间隔 ≤ threshold 的密集片段（≥3 个音符）
- 将片段内所有音符统一为多数方向
- 管线位置: `quantizeNotes` → **`unifyDenseDirections`** → `mergeDenseNotes`
- 三处调用点同步

---

### v22 - 长键渲染修复（不可见 bug）

**问题**: `HoldNote.draw()` 中 `if (endPos.progress < -0.2) return` 导致长键在头部已可见时仍被跳过（因为尾部 progress 可能是 -5 等极小值）

**修复:**
- 早退条件改为 `if (startPos.progress < -0.2) return`（按头部判断可见性）
- 新增尾部距离 clamp: `tailDist` 上限 `spawnDist + JUDGE_DIST + 40`，防止坐标溢出

---

### v23 - 谱面缓存与长键设置联动修复

**问题**: `preAnalyzeAudio()` 在歌曲加载时运行（此时 `enableHold=false`），生成纯 tap 谱面并缓存。游戏启动时 `loadChart` 命中缓存，跳过重新检测，长键永远不出现

**修复:**
- 新增 `chartKey(name)` 函数，缓存 key 包含 hold 状态（`filename|hold`）
- `saveChart` / `loadChart` / `checkSavedChart` 全部使用复合 key
- 勾选/取消"长键"复选框时清空 `beats` 并刷新缓存状态

---

### v24 - 长键默认开启 + 合并阈值调整

- `enableHold` 默认值改为 `true`，HTML checkbox 加 `checked`
- `mergeThreshMs` 默认值从 200ms 改为 350ms
- HTML 滑块 value 和显示文字同步

---

### v25 - 音符速度控制滑条

**新增 UI**: 开始界面 `#optionsRow` 内 "音符速度" 滑条（1.5s~4.0s，步长 0.05，默认 2.8s）

**实现:**
- 新增全局变量 `baseTravelTime = 2.8`
- `speedSlider` input 事件更新 `baseTravelTime` 并调用 `applyDifficulty()`
- `applyDifficulty()` 公式改为 `NOTE_TRAVEL_TIME = baseTravelTime / d.speedMult`
- 只影响音符飞行速度，不改变节奏密度

---

### v26 - 击中音效改为点击即触发

**修改前**: 命中音符时才播放音效
**修改后**: 点击/触摸/按键时立即播放，无论是否命中

**实现:**
- `processTapBatch()` 中每个触点先调用 `playHitSound()` 再执行判定
- 移除原来 3 处判定成功时的 `playHitSound()` 调用（tap 命中、hold 起始命中、hold 结束命中）
- 长键释放（onRelease）不播放音效

---

### v27 - 局内重开长键丢失修复

**问题**: `replayGame()` 复制 beats 时只保留 `time/dir/color`，丢失 hold 的 `type/startTime/endTime`

**修复**: 复制时区分 hold 和 tap，完整保留所有属性:
```javascript
if (b.type === 'hold') return { type: 'hold', startTime: b.startTime, endTime: b.endTime, dir: b.dir, color: b.color, _spawned: false };
return { type: 'tap', time: b.time, dir: b.dir, color: b.color, _spawned: false };
```

---

### v28 - 密集段方向统一的全局平衡感知

**问题**: `unifyDenseDirections` 盲目选区间内多数方向，导致大量音符堆积到同一侧

**修复**: 统一方向时参考全局 L/R 累计数量:
- 先统计全局 L/R 总数
- 每个密集区间选全局数量少的一侧作为统一方向
- 统一后实时更新全局计数，下一个区间自然倒向另一侧
- 仅全局平局时才 fallback 到区间内多数

---

### v29 - UI 重构 + 镜像模式

**主界面精简:**
- `#optionsRow` 只保留: 难度、音符速度、镜像（左右反转）
- "开始游戏"和"设置"按钮并排

**新增设置界面 (`#settingsOverlay`):**
- 音符延迟、打击音量、判定区域辅助、宽容窗口、长键开关、合并阈值、最短长键
- "返回"按钮回到主界面
- 响应式: 移动端单列布局

**镜像功能:**
- 新增 `mirrorMode` 全局变量 + checkbox
- `applyMirror(notes)`: 翻转所有音符 `dir`（0↔1）
- 管线末尾调用（`mergeAdjacentHolds` → **`applyMirror`**）
- 缓存 key 包含 mirror 状态（`filename|hold|mirror`）
- 切换时清空 beats 强制重新生成

---

## 架构关键点（更新）

### 谱面生成管线（当前版本，在 Web Worker 中执行）

```
audioWorker.js: detectBeats / detectBeatsWithParams
  → assignNoteDirections (频段→方向+颜色)
  → runPipeline:
      → quantizeNotes (网格对齐)
      → unifyDenseDirections (密集段统一方向，全局平衡感知)  [v21+v28]
      → mergeDenseNotes (连续同侧≥3 → hold)                [v17]
      → expandHoldBoundaries (吸收邻近 tap)                  [v19]
      → mergeAdjacentHolds (合并相邻 hold，gap≤0.3s)         [v20]
      → applyMirror (镜像翻转)                                [v29]
  → postMessage → 主线程接收 beats 数组
```

### 代码结构

**index.html** (内联 JS, ~4249 行):
```
L1-150       CSS 样式（pixel-btn, slider-thumb, comboPop, 响应式, 设置面板）
L150-361     HTML 结构（开始/设置/结束/暂停/调试面板，含长键/合并/宽容滑块）
L362-408     全局变量 & 难度系统 & 错误处理
L409-466     空间判定参数 & 性能缓存 & 图像加载
L467-577     resize / 背景缓存构建器
L578-738     音频上传 & 预设加载 & Web Worker 桥接 & preAnalyzeAudio
L739-1401    音频分析核心（保留副本，供调试面板 estimateBPMForDebug 等使用）
L1402-1582   BPM 量化 & 谱面存储/加载（含 chartKey hold|mirror 支持）
L1583-1595   勺子绘制
L1596-1809   渲染（判定弧 + 光晕 + 动态高亮 + 辅助环）
L1810-2013   谱面后处理管线（unify / mirror / merge / expand / mergeAdjacent）
L2014-2253   Note 类 + HoldNote 类（含 dx/dy 预缓存）
L2254-2355   粒子 / 涟漪 / 对象池（Note×100, HoldNote×50, Particle×300）
L2356-2489   反馈文字 / 连击轨道 / 里程碑系统
L2490-2537   星空背景 & 角色绘制
L2538-2849   游戏逻辑（spawn / judge / processTapBatch / onTap / onRelease）
L2850-2989   可视化 / 进度条 / 倒计时 / 背景过渡
L2990-3076   主游戏循环（含 updateNearestTipDists + 角度分桶清理）
L3077-3199   游戏流程（startGame 含 Worker 进度条 / endGame）
L3200-3336   暂停 / 恢复 / 重来（含 3 秒恢复倒计时）
L3337-3496   事件监听 + 全屏 + 设置面板
L3497-4249   调试 / 校准面板（含 regenerateBeats → Worker）
```

**audioWorker.js** (785 行):
```
L1-18        消息分发 & 进度通知
L20-55       runDetection / runDetectionWithParams（入口）
L57-133      combFilter / estimateBPM / dpBeatTrack / medianFilter
L135-202     detectSections / detectSwing / getSectionAtTime
L204-291     assignNoteDirections / computeMultiResFlux
L293-465     detectBeats（主检测，10 阶段进度）
L467-619     后处理管线（quantize / unify / merge / expand / mergeAdjacent / mirror / runPipeline）
L621-785     detectBeatsWithParams（调试参数检测）
```

### 已知限制（更新）

- `right.png` 是 `left.png` 的自动镜像，非原创设计
- FLAC→MP3 转码为 mono（soundfile 限制），音质有损
- `hit2.wav` / `hit3.wav` 已复制但代码中仅加载 `hit1.wav`
- 时间窗口常量 (`PERFECT_WINDOW` 等) 保留但不再用于游戏判定，仅供谱面兼容
- 里程碑数组为硬编码，超过 100 连击后不再触发额外特效
- `逆流雨.ogg` 为早期测试残留文件（3.6KB，无效），实际使用 `逆流雨.mp3`
- 合并相邻 hold 的 gap 阈值 (0.3s) 为硬编码，未暴露到 UI
- 音频分析函数在 index.html 和 audioWorker.js 中各存一份（主线程副本供调试面板直接调用）
- Worker 使用 Transferable 传输 PCM 数据，传输后主线程的 slice 副本被 neutered（不影响 audioBuffer）

---

### v30 - 长键分数重设

**目标**: 长键保留合并 tap 的分数并给予 1.1x 倍率奖励

**新增 `_mergedCount` 字段:**
- `mergeDenseNotes` 中记录合并数量 `runLen`
- 经 saveChart(`mc`) / loadChart / beats 映射 / HoldNote 构造器全链路传递

**分数公式:**
- `holdMult = mergedCount × 1.1 / 2`（总分平分给 start 和 end）
- `earned = basePts × holdMult × comboBonus`
- 示例: 5 tap 合并，Perfect → start 825 + end 825 = 1650（vs 5×300=1500，多 10%）

---

### v31 - 音效节流 + 无用变量清理

**音效节流:**
- 新增 `lastHitSoundTime` 全局变量
- `playHitSound()` 开头检查间隔 < 30ms 则跳过
- 防止多点触控同帧重复播放

**删除无用变量:**
- `comboOrbs`（声明未使用）
- `pauseTimeOffset`（声明+赋值但从未读取，3 处清理）
- `scorePop` / `comboPop`（JS 变量未使用，CSS keyframe `comboPop` 保留）

---

### v32 - 对象池优化

**目标**: 减少 GC 压力，复用 Note / HoldNote / Particle 对象

**ObjectPool 类 (~L2238):**
- 通用池，接受 Factory 类 + 初始大小
- `get(...args)`: 从池中取出或新建，调用 `init()` 重置
- `release(obj)`: 归还到池中
- 动态扩容（池空时 `new` 新对象）

**池实例:**
- `notePool`: Note 池，初始 100
- `holdNotePool`: HoldNote 池，初始 50
- `particlePool`: Particle 池，初始 300

**类改造:**
- `Note` / `HoldNote` / `Particle` 新增 `init()` 方法（原构造器逻辑移入）
- 构造器调用 `init()`，保持向后兼容

**调用点修改:**
- `spawnNotes()`: `notePool.get()` / `holdNotePool.get()` 替代 `new`
- `triggerMilestone()` / `onTap` 判定 / `onRelease`: `particlePool.get()` 替代 `new Particle`
- gameLoop 音符清理: 遍历判断 keep/discard，discard 调用 `notePool.release()` / `holdNotePool.release()`
- gameLoop 粒子清理: 死亡粒子调用 `particlePool.release()`，超限粒子也归还池中

---

### v33 - drawJudgmentArcs 动态光晕优化

**目标**: 消除 `drawJudgmentArcs` 内每帧 O(n) 遍历全部音符计算最近距离的瓶颈

**角度分桶数组:**
- 新增 `notesLeft`（dir===0）/ `notesRight`（dir===1）全局数组
- `spawnNotes()` 同时 push 到对应桶
- gameLoop 清理时同步重建三个数组（notes / notesLeft / notesRight）
- 两处 reset 路径均清空桶数组

**预计算最近距离:**
- 新增 `nearestLeftTipDist` / `nearestRightTipDist` 全局变量
- 新增 `updateNearestTipDists(ct)` 函数，每帧调用一次，遍历对应桶数组
- `drawJudgmentArcs` 改为读取预计算值，不再内部扫描音符

**三角函数缓存:**
- `Note.init()` / `HoldNote.init()` 预计算 `this.dx` / `this.dy`（替代 `Math.cos(angle)` / `Math.sin(angle)`）
- `getPos()` / `_getPosForTime()` 使用 `this.dx` / `this.dy`
- `HoldNote.draw()` 中两处 `Math.cos/sin(this.angle)` 替换为 `this.dx` / `this.dy`
- `Note.draw()` 尖端计算同理

**性能提升:**
- 光晕计算从 O(n) 降至 O(n/2)（仅扫描对应侧桶）
- 计算与渲染解耦：距离计算集中在 gameLoop，drawJudgmentArcs 纯渲染
- 消除热路径中全部 Math.cos/sin 调用

---

### v34 - 音频分析迁移至 Web Worker

**目标**: 将 CPU 密集型音频分析从主线程移至 Web Worker，消除分析期间的 UI 阻塞

**新增文件 `audioWorker.js` (~785行):**
- 包含完整的节拍检测管线：`computeMultiResFlux` → `estimateBPM` → `dpBeatTrack` → `detectSections` → `detectSwing` → `assignNoteDirections`
- 包含完整的后处理管线：`quantizeNotes` → `unifyDenseDirections` → `mergeDenseNotes` → `expandHoldBoundaries` → `mergeAdjacentHolds` → `applyMirror`
- 支持两种消息类型：`detect`（正常检测）和 `detectWithParams`（调试参数检测）
- 通过 `postMessage` 发送进度更新（百分比 + 阶段标签）

**主线程改造 (`index.html`):**
- 新增 `getAudioWorker()` 管理 Worker 实例（懒加载单例）
- 新增 `runWorkerDetection()` Promise 封装，处理 progress / result / error 消息
- 新增 `updateWorkerProgress` 回调变量，各调用点自定义进度显示

**三处调用点:**
1. `preAnalyzeAudio()`: Worker 检测 + 状态栏文字进度
2. `startGame()`: Worker 检测 + Canvas 进度条（百分比 + 阶段文字 + 进度条动画）
3. `regenerateBeats()` (调试面板): Worker 检测 + 状态文字进度

**数据传输:**
- 主线程通过 `.slice()` 复制 PCM Float32Array，使用 Transferable 传递（零拷贝）
- Worker 接收原始 PCM 数据 + sampleRate + duration + 所有设置参数
- Worker 返回完整 beats 数组 + _sections + _swingInfo

**兼容性:**
- 原始检测函数保留在主线程中（调试面板的 `estimateBPMForDebug` 等仍直接调用）
- Worker 不依赖 AudioContext（仅处理 Float32Array）

---

### v35 - 视觉优化三项（背景遮罩 + 长键失败特效 + 结束界面歌曲名）

**1. 背景暗化遮罩:**
- 新增 `drawBgDimOverlay()`: 在 `drawBgWithTransition()` 后叠加 `rgba(0,0,0,0.3)` 半透明黑色遮罩
- 主循环中在背景绘制后立即调用，降低背景亮度避免刺眼
- 频谱环 `drawAudioRing()` 亮度改为恒定 `rgba(224,195,252,0.35)`，移除随频率波动的 alpha

**2. 长键吸附与失败特效:**
- **吸附增强**: `_holding` 时线宽从 12 增至 16，整体透明度从 0.7 提升至 0.85
- **失败动画**: `HoldNote` 新增 `_failTime` 字段
  - earlyRelease / startMiss / endMiss 三处设置 `_failTime = performance.now()`
  - `draw()` 方法检测 `_failTime`：0.4s 内绘制红色圆环收缩淡出效果
  - gameLoop 清理逻辑：`_failTime` 存续期间保留 hold note 不回收
- **红色粒子爆发**: 三处失败路径各生成 6~8 个 `#cc0000` 粒子

**3. 结束界面歌曲名:**
- `#endScreen` 新增 `<p id="songNameDisplay">` 元素
- `endGame()` 中获取歌曲名：
  - 内置音乐：从 `presetSelect.options[selectedIndex].text` 读取
  - 本地音乐：使用 `audioFileName` 去除扩展名

### v36 - 长键计分回归 + 长键区间注入对侧音符

**长键计分改回单音符分数**
- 移除 `holdMult = (_mergedCount || 2) * 1.1 / 2` 乘数
- 长键起始判定和结束判定各得一个音符的基础分：`pts * comboBonus`
- 与普通 tap 音符得分公式完全一致，不再因合并数量额外加分

**新管线阶段：`injectOppositeNotes`**
- 位于 `mergeAdjacentHolds` 之后、`applyMirror` 之前
- 遍历所有长键，对时长 ≥ 0.4s 且区间内无对侧 tap 的长键注入对侧音符
- 注入密度：长键 >1s 用半拍间隔，≤1s 用全拍间隔
- 与长键首尾保持 `beatSec * 0.45` 的安全边距，避免判定冲突
- 碰撞检测：注入点 ±0.05s 内有现有 tap 则跳过
- `unifyDenseDirections` 保持启用，负责形成更长的长键；对侧音符由注入阶段负责

**技术细节**
- `detectBeats` / `detectBeatsWithParams` 现在在返回数组上附加 `_bpm` 属性
- `runPipeline` 从 `detected._bpm` 计算 `beatSec` 并传入 `injectOppositeNotes`
- 同步修改 `audioWorker.js`（实际运行）和 `index.html`（参考副本）两份

---

### v37 - 长键尾判功能开关

**新增 UI**: 设置面板中"长键"右侧新增「长键尾判」复选框，默认开启

**逻辑:**
- **开启时（默认）**: 行为与原来一致 — 玩家需在 endTime 附近松手，按时间差分级，过早松手判 Miss
- **关闭时**:
  - `onRelease` 中松手不再触发尾部判定，仅解除触摸绑定
  - `handleJudge` 中当 `endTime + 宽容窗口` 过后，自动以 Perfect 完成尾判（+300分 + combo + 粒子特效）
  - 玩家只需按住不放（或随时松手），尾部自动满分通过

**全局变量:** `holdTailJudge = true`，`holdTailJudgeCb` 绑定 change 事件

---

### v38 - 内置音乐扩充（78首司南歌曲）

- 从 Sinan.zip 解压 78 首歌曲
- 跳过 10 首已有歌曲（拜无忧/逆流雨/过期凤梨/南风说/苏东坡/你相信平行时空吗/到此一游/星星在唱歌/思有邪/吹灭小山河）
- 新增 68 首到「司南的歌」optgroup
- 发现 64 首标记为 .mp3 的文件实际为 M4A/AAC 格式
- 使用 ffmpeg 将所有 80 首音频统一重编码为 64kbps MP3（总大小从 402MB 降至 168MB）
- `escaping_gravity.ogg`（Theora+Vorbis 容器）转为 MP3，HTML 引用同步更新
- 删除重复文件（soConvert 版本）、无效文件（baiwuyou.mp3、逆流雨.ogg）、无损 FLAC

---

### v39 - 全连无 Miss 动画 + 结束界面信息增强 + 音符速度滑条扩展

**1. Full Combo 动画 (`_fcAnimLoop`)**
- 当 `misses === 0 && (perfects + goods + hits) > 0` 时触发
- `endGame()` 不再立即显示结算页面，先播放 3 秒 Canvas 动画
- 动画内容:
  - 角色旋转（2 圈 `Math.PI * 4`）+ 左右摇晃（`sin` 衰减）+ 呼吸缩放
  - 金色 "FULL COMBO!" 文字（脉冲 + 光晕），0.5s 淡入
  - 持续释放彩虹粒子围绕角色
- 动画结束后调用 `_showEndScreen()` 显示结算
- `endGame()` 新增 `if (gameEnded) return` 防重复调用

**2. 结束界面增强**
- 新增 `#endDiffInfo` 元素: 显示 `难度: Normal | 音符速度: 2.80s`
- 新增 `#fullComboText` 元素: 金色 "FULL COMBO!" 文字（仅全连时显示）
- `endGame` 拆分为 `endGame()` + `_showEndScreen()`

**3. 音符速度滑条范围调整**
- `#speedSlider` min 从 1.5 改为 1.0（更快），max 从 4.0 改为 5.0（更慢）

---

### v40 - 教程模式

**任务**: 新增独立教程系统，帮助新玩家了解操作和判定机制

**界面入口:**
- 开始界面新增「教程」按钮（pixel-btn），位于调试面板下方
- 点击后隐藏开始界面，显示全屏教程覆盖层 `#tutorialScreen`

**教程内容:**
- 标题「游戏教程」
- 四个章节: 基本操作、判定系统、长键、试试看
- 按键用 `.tut-key` 标签样式展示（A/S/D/F、H/J/K/L、空格）
- 判定等级用对应颜色标注（Perfect/Good/Hit/Miss）

**演示区:**
- 独立 `#tutCanvas`（560×320 逻辑分辨率，2x 渲染）
- 6 个预设音符（左右交替，间隔 1s）
- 自有 `TutNote` / `TutFeedback` / `TutParticle` 类（不依赖主游戏对象池）
- 复用主游戏的 `character.png`、`left.png`、`right.png` 图像资源
- 独立判定参数（P=13px, G=24px, H=36px），飞行时间 2.5s

**辅助视觉:**
- 判定弧红色光晕（常驻）+ 音符接近时动态增强
- 音符接近弧线时弧线金色脉冲闪烁
- 底部提示文字「点击左侧!」/「点击右侧!」（脉冲透明度）
- 音符接近光晕（dir 对应颜色）
- 中心虚线分割线 + 左侧/右侧标签

**输入处理:**
- 鼠标/触摸: 按点击位置相对 canvas 中心判断左右
- 键盘: A/S/D/F/←=左侧, H/J/K/L/→=右侧, 空格=自动匹配最近
- 空间判定 + 时间宽容兜底（200ms）

**状态管理:**
- `tutMode` 标志位，独立于 `gameRunning`
- 命中计数 + 剩余音符提示
- 全部完成/miss 后显示结果，按钮变为「重新演示」
- 返回主页时 `stopTutDemo()` 释放动画帧

**与主游戏兼容:**
- 不创建 AudioContext，不加载音频，不触发自动播放策略
- 不修改任何主游戏全局变量
- 教程 IIFE 内部完全封装，通过闭包隔离

---

### v41 — FC 动画修复（摇摆 + 文字居中）

**问题:** 全连动画中角色高速旋转观感不佳；手机横屏时 "FULL COMBO!" 文字偏移到右侧显示不全。

**修复:**

1. **角色动画: 旋转 → 摇摆**
   - 移除 `spinAngle = t * Math.PI * 4`（2 圈全旋转）
   - 改为柔和摇摆组合:
     - `rockAngle = Math.sin(t * π * 5) * 0.25 * (1 - t * 0.6)` — 左右轻摇，带衰减
     - `bounceY = -|sin(t * π * 4)| * 18 * (1 - t * 0.5)` — 弹跳
     - `swayX = sin(t * π * 3) * 12 * (1 - t)` — 水平漂移
     - `scale = 1 + 0.12 * sin(t * π * 3)` — 呼吸缩放
   - 整体效果：角色在庆祝中轻快摇摆，3 秒内自然衰减至静止

2. **文字坐标系修复**
   - 原代码使用 `canvas.width / 2`（像素宽度，含 DPR 缩放），横屏下偏移明显
   - 改为 `W / 2, H * 0.25`（逻辑坐标），始终居中
   - 字号上限: `Math.min(W * 0.07, H * 0.08, 48)`，防止过大

**根因:** `canvas.width` = 逻辑宽度 × devicePixelRatio，但 canvas 2D 上下文的 `translate()` 在 `ctx.scale(dpr, dpr)` 之后工作在逻辑坐标空间，应使用 `W`/`H` 而非 `canvas.width`/`canvas.height`。

---

### v42 — 双押键视觉区分

**功能:** 使同时需要左右点击的音符（双押）在视觉上明显区分于普通单键。

**双押检测 (`detectDualNotes`):**
- 谱面生成后执行一次扫描，遍历 beats 数组
- 找出时间差 ≤ `DUAL_HOLD_THRESHOLD`（默认 80ms）的左右音符对（dir=0 + dir=1）
- 贪心配对：按时间排序，每个音符只属于一对，取最近的异侧配对
- 配对音符标记 `isDual: true`、`_dualPairId`（唯一配对 ID）
- 在 `preAnalyzeAudio` 和 `startGame` 中 beats 映射完成后调用

**视觉表现:**
1. **单键 yOffset 错落:** 非双押音符的 y 坐标增加 `(Math.random() - 0.5) * 10` px 偏移，使音符高低错落
2. **双押键水平对齐:** 双押音符 `yOffset = 0`，强制同一水平线
3. **金色光晕:** 双押音符（含 HoldNote）额外绘制 `#feca57` 径向渐变光晕，带呼吸闪烁（sin 周期 200ms）
4. **双押连线:** 游戏循环中检测同 `_dualPairId` 的活跃音符对，绘制金色虚线连线（`setLineDash([6,4])`，宽度 2.5px，带 shadowBlur）

**代码修改:**
- `Note` 类: 新增 `isDual`、`yOffset`、`_dualPairId` 属性；`getPos` 中 y 加 `yOffset`；`draw` 中增加双押光晕渲染
- `HoldNote` 类: 同上，`_getPosForTime` 中 y 加 `yOffset`
- `spawnNotes`: 从 beat 对象复制 `isDual`/`yOffset`/`_dualPairId` 到生成的 Note/HoldNote
- `gameLoop`: 在 `n.draw(ct)` 之后新增双押连线绘制 pass（按 `_dualPairId` 分组配对）

**设置面板:**
- 「双押特效」复选框（`#dualEffect`，默认勾选）— 控制光晕和连线渲染（关闭后仍保留单键偏移）
- 「双押阈值」滑块（`#dualThreshSlider`，30~150ms，默认 80ms）— 调整配对时间窗口

**性能:** 连线绘制使用 Map 按 pairId 分组，活跃双押对通常 < 5 个，无性能影响。不影响现有判定逻辑。

---

### v43 — Perfect 击打专属音效（Star Burst 星爆）

**功能:** Perfect 判定时播放独立的特殊音效，与普通打击音区分，增强正反馈。

**音效生成:**
- 使用 Python 合成 5 款候选音效（Crystal Chime / Sparkle Ping / Warm Bell / Pixel Pop / Star Burst）
- 用户选择 **Star Burst 星爆**：快速上行扫频（600→2600Hz）+ 闪烁泛音尾巴，0.4s，44100Hz 16-bit mono WAV

**实现:**
- 音效数据 base64 内嵌在 `index.html` 中（~47KB），无需外部文件，离线可用
- `loadPerfectSound()`: IIFE，页面加载时解码 base64 → ArrayBuffer 存入 `perfectSndRaw`
- `decodePerfectSound()`: 在 `createAudioContext()` 之后调用，将 raw 数据解码为 `AudioBuffer`
- `playPerfectSound()`: 创建 `BufferSource` → `GainNode` → `destination`，30ms 去重防叠爆
- 在所有 6 处 `perfects++` 判定点调用（普通 tap、长键起始、长键结尾、宽容判定、尾判关闭自动 Perfect）

**设置面板:**
- 新增「Perfect音效」音量滑块（`#perfectVolSlider`，0~100%，默认 60%）
- 拉到 0% 即完全静音，不影响普通打击音量

---

### v44 — 双押优化（去滑块 + 上移 + 时间对齐）

**变更:**
1. **移除双押阈值滑块** — 设置面板不再暴露 `dualThreshSlider`，阈值固定为 80ms（`DUAL_HOLD_THRESHOLD = 0.08`），仅保留「双押特效」开关
2. **双押键上移** — 双押音符 `yOffset = -12`（向上偏移 12px），与普通单键的随机 ±5px 偏移形成明显视觉区分
3. **时间自动对齐** — `detectDualNotes` 中配对成功后，将两个音符的时间强制设为平均值 `(tA + tB) / 2`，确保双押键在判定上完全同时到达

---

### v45 — 安静前奏节拍检测修复 + 游戏内更新日志

**问题:** 以「思有邪」为例，前 11 秒完全没有音符。原因：
- 频谱通量（spectral flux）全局归一化后，安静前奏的变化量（峰值 0.14）低于固定阈值 0.15
- Intro 段阈值还额外乘以 1.2（更严格），进一步阻止检测
- 间隙填充只在已有音符之间，首个音符前的空白无法补充

**修复（audioWorker.js）:**

1. **局部自适应增强** — 在 BPM/DP 追踪之后、onset 拾取之前，按 section 统计局部最大通量。若 `secMax < globalMax * 0.35`，按比例提升该段通量（上限 2.5x），使安静段的内部变化不被全局峰值淹没

2. **Intro 段阈值降低** — `secThreshMult` 从 1.2（更严格）改为 0.65（更宽松），onset 阈值从 `0.15 * 1.2 = 0.18` 降至 `0.15 * 0.65 = 0.0975`

3. **首音符前间隙填充** — 若第一个检测到的音符时间 > 2.5 拍，从歌曲开头开始按 `beatSec * 2`（Intro/Bridge）或 `beatSec`（其它）步长填充合成音符

**效果（思有邪）:** 首个 onset 从 11.98s 提前至 3.45s，前 15s onset 数从 7 → 19

**游戏内更新日志:**
- 开始页面新增「更新日志」按钮，点击显示 v37~v44 版本记录
- 独立全屏 overlay，支持滚动浏览，底部返回按钮

---

### v46 — Expert 难度 & 双押调整

**变更:**

1. **新增 Expert（专家）难度**
   - `densityMult: 2.73`（Hard 1.82 的 1.5 倍），音符密度大幅提升
   - `speedMult: 1.15`，音符流速加快
   - `judgeMult: 0.45`，判定窗口最严格（Perfect ±7px / Good ±14px / Hit ±22px）
   - `dualInjectRate: 0.40`，40% 的音符为双押
   - 允许连续短长键交替出现，谱面复杂度更高
   - UI 下拉菜单、结束页面 diffLabels 均已添加 Expert

2. **双押检测倍率减半（大于 1 的部分）**
   - Easy: 1.4 → 1.2，Normal: 1.8 → 1.4，Hard: 2.5 → 1.75，Expert: 3.5 → 2.25
   - 公式：`newMult = 1.0 + (oldMult - 1.0) / 2`
   - 降低过度双押检测，使双押分布更合理

3. **长键期间禁止双押**
   - `detectDualNotes`: 跳过 `type === 'hold'` 的音符，不参与配对
   - `detectDualNotes`: 检查候选配对的时间是否落在任一 hold 的 `[startTime - 50ms, endTime + 50ms]` 范围内，若是则跳过
   - `injectDualNotes`: 候选池排除 hold 类型音符，并通过 `isDuringHold(t)` 排除时间上与 hold 重叠的 tap 音符
   - 移除 `allowConsecutiveHold` 字段，所有难度统一禁止 hold 双押

4. **双押默认阈值确认为 120ms**（`DUAL_HOLD_THRESHOLD = 0.12`），各难度通过 `dualThreshMult` 缩放实际检测窗口

**最终 DIFF_PRESETS:**

| 难度 | densityMult | judgeMult | speedMult | dualThreshMult | dualInjectRate |
|------|-------------|-----------|-----------|----------------|----------------|
| Easy | 1.04 | 1.4 | 1.0 | 1.2 | 0.08 |
| Normal | 1.3 | 1.0 | 1.0 | 1.4 | 0.12 |
| Hard | 1.82 | 0.65 | 1.0 | 1.75 | 0.25 |
| Expert | 2.73 | 0.45 | 1.15 | 2.25 | 0.40 |

---

### v47 — 音符密度提升 & 特殊键数量上限

**变更:**

1. **提高各难度 densityMult**
   - Easy: 1.04 → 1.4，Normal: 1.3 → 1.7，Hard: 1.82 → 2.3，Expert: 2.73 → 3.2
   - 普通音符数量显著增加，谱面更饱满

2. **新增 `SPECIAL_LIMITS` 常量 — 特殊键数量上限**

   | 难度 | maxHolds | maxDuals |
   |------|----------|----------|
   | Easy | 5 | 3 |
   | Normal | 10 | 6 |
   | Hard | 15 | 10 |
   | Expert | 20 | 15 |

3. **新增 `enforceSpecialNoteLimits(beatsArr, diff)` 后处理函数**
   - 在 `detectDualNotes` + `injectDualNotes` 之后调用（`preAnalyzeAudio` 和 `startGame` 两处均已添加）
   - **长键上限处理**: 若 hold 数量超过 `maxHolds`，按持续时间从小到大排序，将最短的 hold 拆回两个 tap 音符（起点 + 终点），直到数量符合上限。终点 tap 仅在 hold 时长 ≥ 150ms 时添加
   - **双押上限处理**: 若双押对数超过 `maxDuals`，随机选择多余的对，取消 `isDual` 标记、`_dualPairId` 归零、`yOffset` 恢复随机值，连线自动消失
   - 处理完毕后输出最终统计到 console

4. **双押注入率减半**
   - Easy: 0.08 → 0.04，Normal: 0.12 → 0.06，Hard: 0.25 → 0.12，Expert: 0.40 → 0.20
   - 结合上限兜底，避免密度提升后双押过多

5. **调试面板新增统计**
   - 谱面统计区域新增「长键: X / maxHolds」和「双押对: X / maxDuals」显示
   - `updateNoteStats()` 实时遍历 beats 数组统计 hold 数量和 dual pair 数量

**最终 DIFF_PRESETS:**

| 难度 | densityMult | judgeMult | speedMult | dualThreshMult | dualInjectRate |
|------|-------------|-----------|-----------|----------------|----------------|
| Easy | 1.4 | 1.4 | 1.0 | 1.2 | 0.04 |
| Normal | 1.7 | 1.0 | 1.0 | 1.4 | 0.06 |
| Hard | 2.3 | 0.65 | 1.0 | 1.75 | 0.12 |
| Expert | 3.2 | 0.45 | 1.15 | 2.25 | 0.20 |

---

### v48 — 双押连线弧形化 & 光晕淡出 & 上限按时长比例 & 设置持久化

**问题分析（以「南风说」为例）:**

1. **连线贯穿全屏** — 双押对的两个音符分别从左右两侧向中心移动，`getPos` 返回的 x 坐标分别为 `charX - visualDist` 和 `charX + visualDist`。连线 `moveTo(posA.x) → lineTo(posB.x)` 直接横穿整个屏幕经过角色中心
2. **光晕残留无连线** — 双押对一侧被判定后 `alive=false`，连线绘制条件 `pair.length === 2` 不满足，但另一侧音符的金色光晕（仅检查 `isDual`）仍然显示
3. **双押上限过低** — Normal 固定 `maxDuals=6`，不分歌曲长度，3 分钟歌曲大量双押被裁切

**修复:**

1. **弧形连线** — `ctx.lineTo` 改为 `ctx.quadraticCurveTo`，控制点在两音符中点上方，弧高 = `min(span × 0.18, 40px)`，视觉上弧线绕过角色区域

2. **光晕闪烁淡出**
   - Note / HoldNote 新增 `_dualFadeStart` 字段（init 中初始化为 0）
   - 新增 `notifyDualPartnerDead(deadNote)` 函数，在所有 tap 判定命中和 miss 路径后调用
   - 光晕绘制检测 `_dualFadeStart > 0` 后，300ms 内以高频闪烁（`sin(now/40)`）叠加线性衰减，完成后清除 `isDual` / `_dualPairId`

3. **上限按歌曲时长比例计算**
   - `SPECIAL_LIMITS` 改为 `SPECIAL_LIMITS_BASE`（每分钟基础值）+ `getSpecialLimits(diff, durationSec)` 函数
   - 公式: `实际上限 = base × ceil(duration / 60)`
   - 例: Normal 3 分钟歌 → maxHolds=30, maxDuals=18（原固定值 10/6）
   - `enforceSpecialNoteLimits` 签名增加 `durationSec` 参数，两处调用均传入 `audioBuffer.duration`

4. **设置本地持久化（v47.5 补充记录）**
   - `saveSettings()` / `loadSettings()` 使用 localStorage 键 `pixelRhythm_settings`
   - 保存 13 项设置（难度、速度、偏移、镜像、辅助点、宽容窗口、长键开关、尾判、合并阈值、最短时长、双押特效、打击音量、Perfect 音量）
   - 所有设置控件的 change/input 事件自动触发 `saveSettings()`
   - 页面加载时 `loadSettings()` 恢复所有值并同步 UI 控件

---

### v49 — 双押分布均匀化 & 教程扩充

**问题:** 每首歌的双押都集中在开头

**根因:** `injectDualNotes` 按 `b.energy || b.strength || 0.5` 降序排序候选。经 worker 管线处理后几乎所有音符的 energy/strength 为 undefined，回退到 0.5。排序等价于无操作，保持原始时间顺序，开头音符被优先选中注入双押。

**修复:**
- 候选改为按时间升序排列（`candidates.sort((a,b) => a.time - b.time)`）
- 计算等间距步长 `step = candidates.length / needed`
- 以 `floor(i * step + step * 0.5)` 从候选中均匀取点，双押均匀分散在整首歌时间线上
- 例: 100 个候选注入 6 对 → 取第 8、25、42、58、75、92 号

**其他:**
- 弧形连线仅在 progress > 0.45 时开始显示，0.45→0.60 平滑淡入，消除刚出现时的全屏闪烁
- 教程新增「长键 (Hold)」和「双押 (Dual)」操作说明，含尾判提示、键盘/触屏操作方式

---

### v50 — 倒计时预览 & 双押修复 & 代码拆分

**变更:**

1. **倒计时预览** — 开始游戏三秒倒计时期间音符提前生成并飞行，可提前预判节奏
2. **双押修复** — 修复局内重来后双押连线消失的问题（重来时保留双押标记）；修复超出上限的双押取消后仍保留对齐时间的问题（恢复原始生成时间，注入的镜像音符直接移除）
3. **对侧音符对齐** — 长键对侧短键优先对齐已检测的节拍网格，无网格覆盖时回退到 BPM 等分步进
4. **代码拆分** — 单文件 `index.html` 拆分为 8 个模块文件：
   - `style.css` — 全部 CSS 样式
   - `constants.js` — 全局常量、难度预设、resize 逻辑
   - `audio.js` — 音频加载、分析、Worker 桥接
   - `notes.js` — Note / HoldNote 类、谱面后处理管线
   - `render.js` — 渲染、游戏循环、事件监听、全屏
   - `tutorial.js` — 教程系统
   - `debug.js` — 调试面板
   - `audioWorker.js` — Web Worker（未变）

---

### v51 — 全屏强制横屏 & 移动端布局优化 & 长键对侧音符精简

**1. 全屏强制横屏**

**目标**: 移动端点击全屏按钮后自动锁定横屏方向

**实现 (`render.js` ~L1185-1300):**
- 两级策略：
  1. **原生 API**: `screen.orientation.lock('landscape')` — Chrome Android 等支持
  2. **CSS 旋转兜底**: 竖屏时对 `document.documentElement` 应用 `rotate(90deg)` + `transform-origin: top left` + 位移，强制横屏显示（兼容 iOS Safari）
- 新增全局标志位: `_forcedLandscape`、`_orientationLocked`
- 新增函数:
  - `applyForcedLandscape()`: 检测竖屏时应用 CSS 旋转（宽高互换），横屏时移除
  - `removeForcedLandscape()`: 清除所有 CSS transform
  - `onForcedLandscapeResize()`: 监听 resize/orientationchange 事件，动态调整
- 退出全屏时自动解锁方向、移除旋转

**2. 开始界面横向布局**

**目标**: 移动端横屏下所有按钮一屏可见，无需滚动

**HTML 结构重组 (`index.html`):**
- `#startScreen` 拆分为 `#startHeader`（标题区）+ `#startBody`（内容区）
- `#startBody` 包含 `#startCol1`（音乐选择、上传、提示）和 `#startCol2`（选项、按钮）
- 按钮分组: `#mainActions`（开始/设置）、`#secondaryActions`（全屏/加载谱面）、`#utilActions`（调试/教程/更新日志）

**CSS 响应式策略 (`style.css`):**
- 默认: `#startBody { flex-direction: row }` — 双列布局
- `@media (max-width:520px) and (orientation:portrait)` — 窄屏竖屏回退单列
- `@media (max-height:450px)` — 紧凑间距
- `@media (max-height:360px)` — 隐藏副标题、分割线、提示文字

**3. 长键对侧短键精简**

**目标**: 减少长键持续期间对侧注入的短键数量，只保留主要节拍，提升节奏感

**修改函数 `injectOppositeNotes()` (audioWorker.js + audio.js):**
- 安全边距从 `beatSec * 0.35` 提升至 `beatSec * 0.5`
- 注入音符最小间距从 0.12s 提升至 `beatSec * 0.9`（接近全拍间隔）
- 候选点增加节拍网格对齐约束: `snapTolerance = beatSec * 0.2`，仅保留落在拍线附近的点
- 数量上限: `Math.floor(span / beatSec)`（hold 时长内的整拍数）
- 无网格候选时回退: 直接在拍线位置生成音符（而非半拍步进）

---

### v52 — Perfect 音效替换 & 歌曲加载进度 & 音频分析加速

**1. Perfect 音效替换（constants.js + perfect_ding.wav）**

**背景**: 原 Star Burst 星爆音效（快速上行扫频 600→2600Hz）在游戏中听感突兀，用户要求换成清脆的"叮"声。

**候选生成**: Python 合成 5 款叮声候选（Crystal / Bell / Chime / Warm / Pixel），用户试听后选择 **#3 Chime Ding**。

**音效参数:**
- 基频 2200Hz，4 层 detuned 正弦波对（±3Hz 拍频产生微光/闪烁质感）
- 指数衰减 τ=0.06s，总时长 0.22s
- 44100Hz 16-bit mono WAV，文件大小 ~19KB

**加载方式重构:**
- 移除 constants.js 中 ~47KB 的 base64 内嵌字符串
- 改为 IIFE `loadPerfectSound()` 在页面加载时 `fetch('perfect_ding.wav')` → `ArrayBuffer`
- `decodePerfectSound()` 在 AudioContext 创建后将 raw 数据解码为 `AudioBuffer`
- constants.js 文件从 ~47KB 降至 ~28KB

**新增文件:** `perfect_ding.wav`（需与 index.html 同目录部署）

**2. 歌曲加载实时进度（constants.js）**

**问题**: 移动端加载内置歌曲时只显示"正在加载..."，无进度反馈，用户以为卡死。

**实现:**
- 预设加载函数中，先读取 `response.headers.get('Content-Length')`
- 若服务器返回 Content-Length 且浏览器支持 `response.body`（ReadableStream），使用 `getReader()` 流式读取
- 每收到一个 chunk 更新状态栏: `正在加载「歌名」... 42% (1.8/4.3MB)`
- 百分比上限 99%（最后 1% 留给 blob 组装）
- 不支持流式读取时 fallback 到原来的 `resp.blob()`

```javascript
const reader = resp.body.getReader();
let received = 0;
const chunks = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
  received += value.length;
  const pct = Math.min(99, Math.round(received / total * 100));
  presetStatus.textContent = '正在加载「' + songName + '」... ' + pct + '% (' + sizeMB + '/' + totalMB + 'MB)';
}
blob = new Blob(chunks);
```

**3. 音频分析性能优化（audioWorker.js）**

**问题**: 桌面端选择本地歌曲后音频分析耗时过长（高采样率文件尤其明显）。

**优化措施（综合提升约 3~4 倍）:**

| 优化项 | 修改前 | 修改后 | 效果 |
|--------|--------|--------|------|
| 采样率 | 原始（可达 48kHz/96kHz） | >30kHz 时自动降采样至 ~22kHz | 数据量减半~四分之一 |
| Hop Size | `sampleRate * 0.01` | `sampleRate * 0.02` | 帧数减半 |
| 频段查找 | 每帧每 bin 计算 `j * sr / fftSize` | 预计算 `bandLo/bandMi/bandHi` Uint8Array 查找表 | 消除热循环中的浮点除法 |
| 梳状滤波器 | `combFilter()` 函数 + 每 lag 新建 Float32Array | 内联循环 + 就地累加 energy | 消除函数调用和 GC 压力 |

**降采样实现:**
```javascript
if (sr > 30000) {
  const factor = Math.round(sr / 22050);
  const newLen = Math.floor(data.length / factor);
  pcm = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) pcm[i] = data[i * factor];
  sampleRate = sr / factor;
}
```

---

### v53 — 本地成绩记录系统

**功能概述**: 使用 localStorage 为每首歌每个难度保存个人最佳成绩，提供独立成绩页面、结算对比和 FC 徽章。

**数据结构 (`pixelRhythm_records`)**

```javascript
// key: "songFile.mp3|difficulty"
// value:
{
  highScore: 28000,
  maxCombo: 200,
  perfects: 120, goods: 30, hits: 10, misses: 0,
  isFC: true,
  playCount: 3,
  lastPlayed: 1711526400000  // Date.now()
}
```

**新增函数 (constants.js)**

| 函数 | 作用 |
|------|------|
| `getAllRecords()` | 读取全部记录 |
| `getRecord(songFile, diff)` | 读取指定歌曲+难度的记录 |
| `saveRecord(songFile, diff, result)` | 保存成绩。分数更高时更新全部字段；分数不高时仅更新 playCount/lastPlayed/isFC |
| `getCurrentSongFile()` | 获取当前歌曲文件名（优先 presetSelect，fallback audioFileName） |
| `updateFCBadges()` | 扫描所有记录，为下拉列表中的 FC 歌曲追加 `★FC(EX)` 等标识 |
| `getRecordKey(songFile, diff)` | 生成 localStorage key |

**成绩记录页面 (index.html + render.js)**

- 入口: 开始界面「成绩记录」按钮 → `#recordsOverlay` 全屏覆盖层
- 顶部: 四个难度标签按钮（Expert/Hard/Normal/Easy），点击切换
- 统计栏: `已游玩: X/80 | FC: Y | 总分: Z`
- 表格: 已游玩歌曲按 highScore 降序排列，未游玩歌曲灰色排在末尾
- 每行显示: 排名、歌名、最高分（白色粗体）、最大连击、判定分布（P/G/H/M 各自颜色）、FC 标记

**结算界面增强 (render.js `_showEndScreen`)**

- `#recordCompare`: 显示历史最佳分数 + 分差（正/负）+ 历史最大连击 + FC 状态
- `#newRecordBadge`: 刷新最高分时显示红色 "NEW RECORD!" 文字（带发光效果）
- 首次游玩显示"首次游玩此曲!"
- 结算时自动调用 `saveRecord` + `updateFCBadges`

**FC 徽章 (`updateFCBadges`)**

- 遍历所有 `<option>` 的 value，检查四个难度的记录
- 找到 isFC=true 的最高难度，追加 ` ★FC(EX)` / ` ★FC(H)` 等文字
- 页面加载时调用一次，每次结算后再次调用
- 用正则 strip 旧标记避免重复追加

**修改文件**: `constants.js`（记录函数）、`render.js`（成绩页面渲染 + 结算对比 + 事件监听）、`index.html`（recordsOverlay HTML + recordsBtn + 结算对比元素）、`style.css`（rec-tab 样式）

---

### v54 — 选曲面板 & 开始界面视觉重做

**功能概述**: 新增右侧选曲面板，重做开始界面布局和视觉风格。

- 新增右侧选曲面板：液态玻璃毛玻璃效果（`backdrop-filter:blur(20px) saturate(1.3)`），垂直滚动卡片列表
- 歌曲封面自动生成：`genCover()` 函数基于歌名哈希生成渐变色 + 首字大字 canvas 图片
- 支持自定义封面图：通过 `coverMap` 对象映射歌名到 `covers/` 目录下的 JPG 文件
- 选中卡片金色发光边框 + 缩放动画，底部 toast 提示已选歌曲
- 背景替换为像素棋盘格马赛克，canvas 生成 12×8 像素纹理，CSS pixelated 放大平铺
- 开始界面布局改为居中单列，按钮分组（主操作/次要/工具栏）更均衡
- 窄屏/竖屏响应式：选曲面板移至底部改为横向滚动，卡片自动缩小
- 封面图压缩流程：原图 → PIL resize 256×256 → JPEG quality 75（~4-18KB/张）

**修改文件**: `index.html`（选曲面板 HTML + inline script + coverMap）、`style.css`（面板样式 + 毛玻璃 + 响应式）

---

### v55 — 开始界面背景照片 & 封面扫描线移除

**功能概述**: 替换开始界面背景为照片墙，优化封面显示效果。

- 开始界面背景替换为 `startbg.jpg`（照片墙，1600×1200 压缩至 333KB）
- 按钮区域局部高斯模糊：独立 `#bgBlurOverlay` div + `::before` 伪元素实现 `backdrop-filter:blur(5px)`
- 使用 `mask-image:radial-gradient(ellipse 50% 60% at 40% 50%)` 限制模糊范围为椭圆区域，边缘保持清晰
- 半透明暗色渐变叠加层提升按钮区域文字可读性
- 移除 `.song-cover::after` CRT 扫描线效果（`repeating-linear-gradient` 2px 水平条纹）
- 解决 `backdrop-filter` 与 `z-index` 堆叠上下文冲突：从伪元素方案改为独立 DOM 元素
- CSS 版本从 v=54 升至 v=55

**修改文件**: `index.html`（新增 `#bgBlurOverlay` div、CSS 版本号）、`style.css`（背景样式 + 模糊叠加 + 移除扫描线）

---

### v56 — 主界面按钮优化 & 设置整合 & 封面扩充

**功能概述**: 精简主界面按钮布局，将辅助功能整合进设置面板，大规模添加歌曲封面。

- 设置入口改为左上角 64×64 像素风齿轮图标（canvas 绘制 16×16 像素网格 4x 放大）
- 齿轮按钮悬停旋转 30° + 亮度提升动画，响应式自动缩小（36px@450px / 28px@360px）
- 镜像（左右反转）选项从主界面 `#optionsRow` 移入设置面板 `#settingsOverlay`
- 调试面板入口从底部工具栏移入设置面板，与返回按钮并排
- 移除「加载已有谱面」按钮（`#loadChartBtn`），`constants.js` 添加 null guard 保持兼容
- 统一主界面按钮尺寸：通过 CSS 分层控制（主操作 `12px 36px` / 次要+工具 `10px 24px`），移除各按钮内联 style
- 新增歌曲封面至 74 首：批量压缩为 256×256 JPEG（quality 75），单张 4~18KB
- CSS 版本从 v=55 升至 v=56

**新增文件**: `covers/` 目录下 74 张歌曲封面 JPG

**修改文件**: `index.html`（齿轮按钮 + coverMap 74条 + 移除 settingsBtn/debugBtn/loadChartBtn/mirrorCheck + 齿轮绘制脚本 + 更新日志）、`style.css`（齿轮按钮样式 + 按钮统一尺寸 + 响应式适配）、`render.js`（gearBtn 事件替换 settingsBtn）、`constants.js`（loadChartBtn null guard）

---

### v57 — 手机横屏安全区适配 & 加载/分析进度显示

**功能概述**: 修复刘海屏/圆角屏手机横屏黑边问题，将歌曲加载与谱面分析进度从隐藏区域移至主界面可见位置。

- viewport meta 添加 `viewport-fit=cover`，允许页面扩展至安全区（刘海/圆角）
- `#mosaicBg` 和 `#bgBlurOverlay` 使用负 `env(safe-area-inset-left/right)` 向两侧扩展，消除左右黑边
- `#songPanel` 宽度加 `env(safe-area-inset-right)` 并添加右侧 padding，贴合右边缘且内容不被遮挡
- `#startScreenInner` 左侧 padding 加 `env(safe-area-inset-left)`，防止内容被刘海遮挡
- `#gearBtn` left 位置加 `env(safe-area-inset-left)`，齿轮按钮不被刘海遮挡
- 新增 `#loadStatus` 元素，位于难度/速度选项与开始按钮之间，显示歌曲加载进度和谱面分析进度
- 重构 `constants.js` 状态显示：新增 `setStatus()` / `setAnalysisStatus()` 辅助函数，同步写入隐藏 `#presetStatus` 和可见 `#loadStatus`
- 移除 `#loadChartBtn` HTML 元素（JS 已有 null guard）
- CSS 版本从 v=56 升至 v=57

**修改文件**: `index.html`（viewport-fit + #loadStatus 元素 + 移除 loadChartBtn + 更新日志 + CSS v57）、`style.css`（safe-area-inset 适配 + #loadStatus 样式 + 背景/面板/齿轮安全区扩展）、`constants.js`（setStatus/setAnalysisStatus 辅助函数 + 全部状态输出改用新函数）

---

## 开发与部署工作流

> 本节面向协作开发者/AI agent，描述项目的开发模式和部署链路。

### 项目结构

```
C:\pixel-flute/              ← 用户本地项目目录（Windows）
├── index.html               ← 游戏入口
├── style.css                ← 全部 CSS
├── constants.js             ← 全局常量、难度、resize、音频加载
├── audio.js                 ← 音频分析、Worker 桥接
├── notes.js                 ← Note/HoldNote 类、谱面后处理
├── render.js                ← 渲染、游戏循环、事件、全屏
├── tutorial.js              ← 教程系统
├── debug.js                 ← 调试面板
├── audioWorker.js           ← Web Worker（节拍检测 + 后处理管线）
├── perfect_ding.wav         ← Perfect 判定音效
├── hit1.wav / hit2.wav / hit3.wav  ← 打击音效
├── character.png            ← 像素角色
├── left.png / right.png     ← 音符图像
├── background01.jpg / background02.jpg  ← 背景
├── button.png               ← 按钮材质
├── slider-thumb.png         ← 南瓜滑块
├── startbg.jpg              ← 开始界面背景照片墙
├── covers/                  ← 歌曲封面图（74张 256×256 JPG）
├── preset.mp3               ← 拜无忧
├── *.mp3                    ← 其它内置歌曲（共 78 首司南的歌）
└── .gitignore
```

### 开发模式

**用户环境:** Windows，使用 Git Bash 操作命令行。用户不熟悉 Git/GitHub，需要具体的逐步指令。

**AI 辅助开发流程:**
1. 用户描述需求（中文），AI 在沙盒中修改代码并测试
2. AI 将修改后的文件打包供用户下载
3. 用户将文件复制到 `C:\pixel-flute` 覆盖原文件
4. 用户在 Git Bash 中执行推送命令（AI 提供具体命令）

**典型交付指令模板:**
```bash
cd /c/pixel-flute
git add <修改的文件列表>
git commit -m "描述"
git push
```

**注意事项:**
- 用户使用 Git Bash，路径格式为 `/c/pixel-flute`（不是 `C:\pixel-flute`）
- `~` 在 Git Bash 中表示 `C:/Users/用户名/`，不要用 `~/c/pixel-flute`
- Git Bash 中粘贴用 Shift+Insert，复制用右键选中
- 所有代码文件使用 UTF-8 编码（含中文注释和歌名）

### 部署链路

项目为纯静态前端（HTML + CSS + JS + 媒体文件），无需构建步骤，无需 Node.js/npm。

**双平台部署:**

```
本地 C:\pixel-flute
  │
  │  git push
  ▼
GitHub: flayteas/Pixel-Rhythm (main 分支)
  │
  ├──→ GitHub Pages（自动部署）
  │     URL: https://flayteas.github.io/Pixel-Rhythm/
  │     设置: Settings → Pages → Deploy from branch → main → / (root)
  │     延迟: 推送后约 1~2 分钟生效
  │
  └──→ Cloudflare Pages（自动部署）
        URL: https://pixel-rhythm.pages.dev/（或自定义域名）
        设置: Cloudflare Dashboard → Pages → 连接 Git → 选择 Pixel-Rhythm 仓库
        构建命令: （空，不需要）
        输出目录: /（根目录）
        延迟: 推送后约 30 秒~1 分钟生效
        优势: 全球 CDN，中国大陆访问速度优于 GitHub Pages
```

**Cloudflare Pages 首次设置要点:**
- 需在 GitHub Settings → Applications → Cloudflare Pages 中授权访问目标仓库
- 框架预设选 "None"，构建命令和输出目录留空
- 无需安装任何 CLI 工具

**访问统计:**
- GitHub: 仓库 → Insights → Traffic（14 天页面浏览/独立访客，仅仓库管理员可见）
- Cloudflare: Dashboard → Pages → 项目 → Analytics（请求数、带宽、地区分布，数据更丰富）

### 代码修改注意事项

- **纯静态项目**: 没有打包工具、没有模块系统、没有 npm。所有 JS 文件通过 `<script>` 标签按顺序加载，共享全局作用域
- **加载顺序**: `constants.js` → `audio.js` → `notes.js` → `render.js` → `tutorial.js` → `debug.js`（顺序不可打乱）
- **audioWorker.js 独立运行**: 在 Web Worker 中执行，不能访问 DOM 或主线程变量。与主线程仅通过 `postMessage` 通信
- **两份分析代码**: `audio.js` 和 `audioWorker.js` 各有一份音频分析/后处理代码。Worker 版本为实际运行版本，主线程版本供调试面板直接调用。修改分析逻辑时**两份都要同步更新**
- **谱面缓存 key**: 包含 `hold|mirror` 状态，切换设置后会自动重新生成。修改谱面生成逻辑后可能需要清除 localStorage 中的缓存
- **资源文件**: 所有音效/图片/音乐与 index.html 同目录平铺放置，封面图集中在 `covers/` 子目录
- **`.gitignore`**: 排除了残留重复文件、候选音效、临时开发文件等（详见文件内容）
