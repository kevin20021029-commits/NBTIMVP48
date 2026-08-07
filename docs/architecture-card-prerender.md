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
│    d. 隐藏数字区(底图不画数字): .sc-match-num opacity:0 或模板级去数字
│    e. screenshot 2160×3840(9:16) / 2160×2700(4:5) → WebP q90 → 写入产物目录
│    f. 测量该卡数字区 rect(scale 2 像素) → 写入 manifest
├─ 4. 生成 31 张数字切片 × 2 套(9:16: 104px 字号 / 4:5: 86px 字号):
│    渲染 match=70..99,100 的含数字卡 → 剪裁数字区 rect → 不透明 PNG/WebP
│    —— P3 验证: 切片必须含背景(不透明), 否则半透明边缘二次混合(maxDiff 220 → 0)
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

**结论**：「62 张透明切片（31×2 比例）」方案不成立（透明切片在半透明边缘产生二次混合，P3 实测 maxDiff 220）。
**采用方案（a）变体 A″**：
1. 构建期：底图数字区矩形填为 `CARD_TOKENS.digitPlate` 定义的**不透明纯色底板**（颜色/圆角/尺寸写 token，9:16 与 4:5 各一组）
2. 运行时：`fillRect`（或 roundRect fill）画同色底板 → drawImage 透明数字切片（31 张 × 2 比例，仅 glyph）
3. 底板与底图同色 → 合成无缝、零二次混合
4. **视觉约束**：数字区在 2/3 视觉阶段**必须设计为纯色底板样式**（徽章/胶囊形态），不得恢复"悬浮在插画上的数字"（该样式要求背景随卡不同，与预生成架构冲突）。若必须悬浮样式 → 数字区需移到不覆盖人物的固定位置（如 stage 右上角），由 2/3 拍板
5. 4:5 数字区同理（底板 token 每语言一组）

### 确定性（B2 实测）

- Playwright 首帧截图噪声 = **per-page**（每新页面首次截图 hash 随机，二次起字节级唯一；跨进程稳定值一致）
- 构建循环必须 **per-page 预热**（渲染 + 截图 1 次丢弃）→ 10/10 字节唯一已实测
- 96 张构建总耗时 **80s**（836ms/张，单 page 复用 × 3 语言页面）；renderMs 3700 含页面加载等一次性成本
