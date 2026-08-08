# 分享卡构建期预生成管线设计（H-P4，A 方案）

> 生成：2026-08-07 H-POC 轮。上游结论：H1 动态维度表（唯一动态 = 匹配度整数 70-99 + 彩蛋 100）、H2 方案对比（A 胜出）、H3 视觉能力解锁（Chromium 构建期全解锁）、H-P0 4:5 恢复（96 组溢出断言双仓库全绿）、H-P2 数字合成规格（31 张完整「NN%」切片，9:16 单 spec / 4:5 per-card spec）、H-P3 PoC（合成 diff 20px/0.00024%，E0 墨绿三方取证，CSS 4 项能力实证）。
> 本文件是**设计文档**，不包含实现代码。实现时逐项对照。

---

## a. `npm run build:cards` 完整流程

```text
build:cards
├─ 1. 枚举 102 组合: 16 人格 × 3 语言 × 2 比例 = 96 + 彩蛋 2 × 3 × 2 = 6
│    (persona, locale, ratio) 全列表来自各仓库 index.html 的 RESULTS.results + EGG_MAP
├─ 2. 预热: 页面加载后离屏渲染 1 次(不截图)
│    —— 规避 Playwright 首帧截图边界采样噪声(P3 取证: 54px/0.00065%/≤14 值, 右下角 1px 带)
├─ 3. 每组合(单页面实例内顺序执行, 每张卡重新 bind):
│    a. 加载 http://127.0.0.1:8899/{locale 文件}(阻塞外网)
│    b. bindShareCard(tpl, persona, match, ratio) — match 占位值(底图不含数字, 见 e)
│    c. 跑三层断言: assertShareDom / checkShareCardText(R1-R3) / share_card_overflow
│       —— 现有页面内函数原样执行, 零改造(任一失败 → 该卡 fail, 构建中断)
│    d. 隐藏数字区(底图不画数字): .sc-match-num visibility:hidden 或模板级去数字
│    e. screenshot 2160×3840(9:16) / 2160×2700(4:5) → WebP q90 → 写入产物目录
│    f. 测量该卡数字区 rect(scale 2 像素) → 写入 manifest
├─ 4. 生成 62 张真 alpha 数字切片(31 × 2 套; 独立页渲染, 方案 1):
│    独立页(透明背景)注入数字元素(computed style 全量拷贝 + flex-end 容器)
│    → omitBackground:true 截图 → 真 alpha(glyph only, 无烘焙背景)
│    —— B1-REV2 定案; 前置: 数字区灰度 AA + 固定高度(见硬性约束)
├─ 5. 生成 manifest.json(字段见 b)
├─ 6. 与基线 diff: 每张卡 pixelSha256 对比 cards/baseline/manifest.json
│    —— 非预期变化(未更新基线即 hash 变化) → fail;预期变化需显式更新基线
└─ 7. 输出摘要: 102 张 × {persona, ratio, canvasW, canvasH, pixelSha256, bytes, format, renderMs}
```

构建耗时：~3-4 分钟（P3 实测单张全流程 3.7s，预热后同页面顺序渲染 ~1.5-2s/张，102 张 ≈ 3-4 分钟）。

## b. 产物目录与 manifest

```text
cards/                     ← 仓库根目录, Vercel 静态服务
├── v1/                    ← 版本目录(卡面/文案每次变更 +1, 天然缓存失效)
│   ├── {persona}_{locale}_{ratio}.webp      ← 96 + 6 彩蛋 = 102 张底图(无数字)
│   ├── digits/9x16/{match}.webp             ← 31 张数字切片(70-99 + 100)
│   ├── digits/4x5/{match}.webp              ← 31 张
│   └── manifest.json
└── baseline/manifest.json ← 基线(CI/本地 diff 参照, 更新需显式命令)
```

manifest.json 字段：

```json
{
  "version": 1,
  "generatedAt": "2026-08-07T00:00:00Z",
  "cards": {
    "SNIPER_zh_9:16": {
      "persona": "SNIPER", "locale": "zh", "ratio": "9:16",
      "file": "SNIPER_zh_9:16.webp",
      "pixelSha256": "074582a4...",
      "bytes": 245110, "format": "image/webp",
      "canvasW": 2160, "canvasH": 3840, "scale": 2,
      "matchRect": { "x": 164, "y": 2060, "w": 266, "h": 166 },
      "isEgg": false
    }
  },
  "digits": {
    "9:16": { "w": 360, "h": 166, "files": { "70": "digits/9x16/70.webp", ... } },
    "4:5": { "w": 300, "h": 138, "files": { ... } }
  },
  "baseline": "074582a4..."   ← 全部卡 hash 的聚合哈希(与 cards/ 目录内容一致性校验)
}
```

- 9:16 的 matchRect 全卡一致（P2 实测 x/y/w/h 固定）→ manifest 只存一条；4:5 逐卡存
- 文件名为**完整组合名**，不用子目录分级（102 张平铺 + digits 子目录，Vercel 静态服务无路由问题）

## c. 两仓库共用一份构建脚本

- **脚本放独立位置**：`D:\1\DL德林\NBTI\shared\`（两仓库之外），通过 `node ../shared/build-cards.mjs` 从各自仓库根调用（`--repo nbti16|nbti48`、`--port 8899|8898`）
- 脚本**零仓库内嵌**：页面函数（bindShareCard 等）从运行时页面读取，不复制逻辑 → 单点维护
- 配置差异仅 3 处（端口、产物路径、question 数），通过 CLI 参数注入，不 fork 脚本
- 后续 1C 的 shared 方案（测试页同步工具）同目录放置，共享 `shared/lib/`（枚举人格、locale 列表）
- 双仓库的 manifest 各自独立（人格集相同但 48 题版 badge 为 /16 同构——**组合数相同 102**，P0 已验证）

## d. og:image 复用

- **每人格 1 张默认卡**（16 × 3 语言 = 48 张，match 用固定值 87 或留空区）：
  - 方案：复用构建产物——底图（无数字）+ 运行时无需合成（og 图 = 底图直接输出一张「87%」合成版作为 og 默认图，或**底图 + 固定数字区**）
  - 推荐：构建时额外输出 `og/{locale}/{persona}.webp`（match 恒 87 合成版），48 张 ≈ 10MB 增量可接受；或用 manifest 的 matchRect + 数字切片在部署时合成（省 10MB，多一步构建逻辑）
- 接入：分享链接 URL 带 `?refPersona={code}`（现有参数，index.html:586）→ 服务端渲染 `<meta property="og:image" content="/cards/v1/og/zh/SNIPER.webp">`——**当前无服务端渲染**（纯静态单文件），替代方案：
  - 静态页 head 放通用 og:image（默认人格卡）——社交平台抓取时无 JS 执行，只能取静态 meta
  - 或 Vercel 中间件（rewrite 按 refPersona 注入 meta，需 vercel.json）——工作量 0.5 天
  - **P0 建议**：先静态默认 og:image（nbti16.vercel.app 的 index.html 放 1 张品牌卡），refPersona 动态 og 列为 2/3 阶段项

## e. 运行时删除清单（NBTI16/index.html 当前分支行号，6 生产文件同构偏移）

| 删除目标 | 位置 | 预估行数 |
|---|---|---|
| html2canvas 1.4.1 内嵌库 | 3478-3498 | ~21（库为压缩单行 + 注释） |
| `assertShareDom` + SHARE_DOM_IDS | 4772-4785 | ~14 |
| `checkCardContent`（内容断言） | 4876-4915 | ~40 |
| `encodeCard`（blob/format 分支） | 4929-4937 | ~9 |
| `export_format_fallback` 分支 | 4938-4946 | ~9 |
| `retryShareGenerate` / `fallbackShareGenerate` | 4948-4963 | ~16 |
| `cardAssetBase64` / `CARD_ASSET_B64` 内联链 | 4965-4987 | ~23 |
| `warmCardAssets` | 4988-5010 | ~23 |
| `checkShareCardText`（文本断言，迁构建期） | 5179-5210 | ~32 |
| `generateShareCard` 的 html2canvas 调用 + phase 状态机 + 三级降级链 | 5211-5300 | ~90 |
| `withTimeout` | 4793-4810 | ~18 |
| `serverCardFallback`（/api/card 调用） | 4845-4875 | ~31 |
| `shareCardUrls` / `shareCardRatioReady` 缓存 | 4502 / 5002 附近 | ~10 |
| 替换：`generateShareCard` → `composeShareCard(match, rect, digits)`（canvas drawImage×2 + toBlob） | 5211 原位置 | 新 ~40 |
| 替换：预览弹窗逻辑 → 直接显示合成图 | 5435-5460 | ~30 |

**合计删除 ~360 行、新增 ~70 行**（净 -290 行/文件，约 -5%）。删除后运行时分享链路 = 底图 URL + manifest matchRect + 数字切片 → canvas 合成 → toBlob → 预览/下载同一 Blob。

## f. 预览 = 下载（硬性要求）

- 现状问题：预览走 live DOM（G2b updatePreview 显示 html2canvas 产物——已统一为生成后预览；但 html2canvas 产物与 DOM 有 9 条分歧，E0 已证）
- **新设计**：生成动作 = 唯一一次合成（底图 + 切片 → canvas → Blob）：
  1. 点击生成 → `composeShareCard()` → Blob → `sharePreviewImg.src = blobURL`（预览）
  2. 下载 = 同一 Blob（`<a download>` 或长按保存）
  3. **预览与下载是同一份字节**——「预览≠导出」整类问题结构性消除（known-issues #9 结案）
  4. 视觉验收从此基于最终交付物（预生成图 = 用户看到的图），P3 已建立方法（像素级 diff + 热力图）

## g. 遥测保留/删除

| 事件 | 现状 | 新方案 |
|---|---|---|
| `share_card_generate_start` | 生成开始 | **保留**（语义不变：合成开始） |
| `share_card_generate_success` | html2canvas 成功 | **保留**（payload 加 `source: 'pregen'`、`renderMs` 应为 <50ms 级） |
| `share_card_generate_failed` | 引擎失败 | **保留**（失败率预期趋近 0；payload 的 fallback 字段删除） |
| `share_card_fallback_used` | 降级链触发 | **删除**（无降级链） |
| `share_card_overflow` / `share_card_text_check_failed` / `share_card_content_check_failed` | 运行时断言 | **迁移构建期**：构建脚本内以 process 级失败上报，运行时不再有这些事件 |
| `card_ratio_switch` | 比例切换 | **保留** |
| `share_card_longpress_shown` | 微信长按提示 | 保留 |
| 新增 `share_card_composed` | — | **新增**：含 {matchRect, sliceBytes, totalMs}，验证合成路径健康 |

## 验收标准（开工前拍板）

1. build:cards 102 张全绿（断言 3 层 + 像素级 hash 与基线一致）
2. 运行时合成：预览=下载同字节；合成失败率 0（图不存在的 404 场景有兜底提示）
3. 双仓库 test:dom 15/15（dom-contract 需随删除清单更新节点数）
4. 页面字节下降 ≥25%（删 html2canvas + base64 预热链）
5. 视觉验收在预生成图上做（P3 方法），不再有 live DOM 验收

---

## 硬性设计约束（Prompt 2/3 必须遵守，B1 实测 2026-08-07）

### 数字区背景一致性（B1 取证）

96 张底图数字合成矩形内像素 sha256 唯一数（scale 2）：
- **9:16：42/48 唯一** —— 数字区 (164,2060,266,166) 覆盖 stage 左下，人物 coverFit 局部伸入 → 背景逐卡不同
- **4:5：3/48 唯一**（每语言 1 个）—— info 列纯色背景，仅语言间微差

**结论（B1-REV2 定案 2026-08-07）**：采用**方案 1（独立页渲染真 alpha 切片）**——
不需要 E 渐变、不需要 A″ 底板，数字区设计零结构性改变：

### 方案 1 实现要点
1. **独立页渲染**：`page.setContent` 最小 HTML（body 透明背景）→ 注入数字元素（computed style
   全量拷贝：fontFamily/fontSize/fontWeight/lineHeight/color/letterSpacing/whiteSpace，不手抄）→
   flex-end 容器复刻原生 `.sc-match-block` 对齐（数字底贴容器底）→ `screenshot({omitBackground:true, clip})`
   → **真 alpha 切片**（实测：alpha=0 占 64.5%、笔画 RGB [0,229,160]=#00e5a0 精确、边缘 4 档渐变无硬边）
2. **灰度 AA 统一（生产代码必改）**：`.sc-stage-match .sc-match-num, .sc-match-info .sc-match-num
   { -webkit-font-smoothing: antialiased; }`——卡片数字与切片同为灰度抗锯齿（桌面 LCD 子像素与
   切片灰度不兼容，P3 的 diff 根因在此；移动端本就灰度，无影响）
3. **数字区固定高度（生产代码必改）**：`.t916 .sc-match-num { height: 83px; }` /
   `.t45 .sc-match-num { height: 69px; }`——消除彩蛋卡与普通卡的亚像素取整差（68.8 vs 69 导致
   切片 2px 错位，彩蛋 4:5 实测 max 208→ 固定后边缘级）
4. **切片数量**：31 张 × 2 套（70-99 + 100；彩蛋 100 复用）≈ 700KB；% 符号进切片（num innerHTML
   含 %），label（匹配度/Match）进底图（常量按语言烘焙）
5. **合成**：运行时 canvas：底图 drawImage → 切片 drawImage（matchRect 1:1）→ toBlob

### 验证数据（B1-REV2 实测）
- 切片真 alpha：alpha=0 64.5%、笔画 #00e5a0 精确、边缘渐变（aHist [428,404,401,1009]）
- 96 张普通卡合成 vs 原生：**overallMax=0 / over8=0/48 / mean=0**（9:16 与 4:5 各 48 张）
- 彩蛋 12 张（2 人格 × 3 语言 × 2 比例）：9:16 全 0；**4:5 数字边缘亚像素差 max≤208、over8≈2045
  （字符整体 1px 级错位，MiniMax 视觉取证为细线描边，人眼不可辨）——记录为 2/3 调优项
  （候选：彩蛋卡数字区整数定位 / 彩蛋专用切片）
- **为什么不是其它三个**：E 渐变（全宽压暗，视觉改动大，且 4:5 数字区在 info 列不受益）；
  A″ 纯色底板（用户否决，视觉结构性改变）；方案 2 局部软边压暗（真 alpha 成立后不需要——
  背景一致性对真 alpha 切片无关）

### 彩蛋 4:5 剩余微差的工程说明
彩蛋卡与普通卡几何/样式/字体逐项一致（rect 149.75×69、fontFamily 相同），但数字渲染存在
亚像素边缘差——定位为 Chromium 文本渲染位置取整的边缘效应。视觉影响：数字边缘 1px 模糊带
（MiniMax 取证图 deliverable_H-POC/b1rev2_egg45_diff.png），人眼不可辨。2/3 视觉阶段若需
严格消除，候选：① 彩蛋卡 info 列强制整数定位 ② 彩蛋数字区独立切片（渲染上下文对齐）。

### 确定性（B2 实测）

- Playwright 首帧截图噪声 = **per-page**（每新页面首次截图 hash 随机，二次起字节级唯一；跨进程稳定值一致）
- 构建循环必须 **per-page 预热**（渲染 + 截图 1 次丢弃）→ 10/10 字节唯一已实测
- 96 张构建总耗时 **80s**（836ms/张，单 page 复用 × 3 语言页面）；renderMs 3700 含页面加载等一次性成本

---

## 合仓决议(2026-08-08, 用户拍板)

**决议**: 合仓已批准, 但排在**第一版视觉上线之后**。理由: shared 落地后(B4)视觉迭代都在一个文件里,
漂移风险已消除(shared-identity.spec.ts 强校验), 先把卡片做好看优先。

**预估工作量(数据支持, B5 取证)**:
- 差异面: 题库(16/48 完全独立, 非超集) + 6 类部署配置(test_version/GTM/qrcode/题数文案) + 0 处结构差异
- CSS 480/480 逐行一致; 函数 208/208 同名(7 个不同中 6 个是配置字符串); 人格/社群/深度解读/彩蛋数据 100% 逐字节一致
- 合仓成本: 题库配置化(两套数组并存) + 6 处字符串参数化 + 构建/部署配置 + 双版本回归 ≈ **2-3 人天**
- 风险: 低(差异面已完整取证)

**触发条件**: 视觉阶段(2/3)完成 + 卡片上线后评估。

---

## L3 结构定案: 脚本入库 + 单向 canonical source(2026-08-08)

**背景**: B4「强 shared」把校验对象(shared/card-runtime.js、text-assert.js)入了库, 但执行工具
(build-cards.mjs、sync-shared.mjs)设计在仓库外(`../shared/`), 丢失后无法从 git 恢复 → 结构性失败。

**L3 定案**:
- 全部构建/同步脚本移入各仓库 `scripts/`(入库, 不再外部共享目录); `shared/` 只保留运行时 web 文件。
- 硬约束: 单仓 `git clone` → `npm i` → `npm run build:cards` 跑通, 零仓库外依赖。

**canonical source(单向, 硬编码)**:
- `scripts/sync-shared.mjs` 顶部写死: `SOURCE_REPO='NBTIMVP16'`、`TARGET_REPO='NBTIMVP48'`, 禁止命令行参数反转方向。
- **shared/ 与 scripts/ 只允许在 NBTIMVP16 修改**; NBTIMVP48 的对应文件视为只读镜像。
- 直接改 48 会被下次 `sync:shared --apply` 覆盖且无额外提示; `npm run sync:shared`(默认 dry-run)的 diff 是唯一提示。
- 方向依据(L3 方向核实): 历史 5 组共享集 commit 均为「16 先改、48 追」(I1-2/I1-3/B4/B5/K2, 时间线对照见 L3 汇报)。

**sync:shared 用法**:
- `npm run sync:shared` → 默认 dry-run, 只输出文件级 diff + 逐行摘要(+added/-removed 行数与行号), 不写入。
- `npm run sync:shared -- --apply` → 显式确认后把 NBTIMVP16 的 shared/scripts/docs/tests/api/.gitattributes 覆盖到 NBTIMVP48。

**api/ 目录契约（用户定，2026-08-08）**:
> api/ 目录下的文件默认视为跨仓共享、必须 byte-identical。如需要引入仓库专属的 API（只在一侧存在），须在 shared-identity 测试中显式加入豁免清单，并在 PR 描述中注明理由。

当前豁免清单（tests/shared-identity.spec.ts 与 scripts/sync-shared.mjs 的 EXEMPTIONS 同步维护）：
- `api/stats.js` — dashboard 后端（仅 16 有 dashboard.html 调用，48 无 dashboard 无调用方）；同步裁决在 dashboard agent（不在本队），pending review。
