# Known Issues（已归档 / 待验证）

## 1. 导出挂起 / 白图问题：归因未复现（已结案）

**现象（2026-08 用户报障）**：点击「保存/分享图片」时图片生成失败——白图 / 空白 / 报错 / 一直转圈。

**归因实验结论（无法复现，归因未知）**：
- A0（git checkout 07d7f99，P0-1 之前的原始代码：并行双尺寸渲染、无状态机、modal 缺失）+ hm.js/gtag 延迟 20s，WebKit × 10 → **10/10 成功**（均值 1.26s），无挂起。
- A0′（同 07d7f99 复测）、A1（+onclone）、A2（+懒注入）、A3（当前全量）在相同网络条件下全部 10/10 成功。
- 结论：**在自动化环境（WebKit/Chromium）中无法复现「永久转圈」**。已由 P0-2（8s/5s 超时 + 降级链 + 锁复位）保证任何挂起都有界；P0-3（onclone 清理克隆体 + 资源内联）消除克隆体网络依赖。

**最可能成因（未证实）**：真机内存压力——旧版并行双尺寸渲染（两个 2160×3840 canvas + toDataURL 同时进行，峰值内存 ~150MB+）在低端 iPhone / 微信内置 WebView 上导致 html2canvas 挂起或 canvas 被回收。**已由 P0-2 取消并行渲染（改为单尺寸 + chips 懒渲染）顺带修复，未经真机证实**。真机验证路径：/dev/diag.html（导出压测 + 并行渲染开关）。

**其他已确认修复的关联问题**：
- 分享预览弹窗 HTML 缺失（P0-1 恢复，曾导致生成后 openSharePreview 抛 TypeError）。

## 2. warm 预热失败回退依赖 html2canvas 特性（换引擎必须重新设计）

`warmCardAssets()` 在结果页渲染完成时预取角色图/二维码转 base64（3s 独立超时）。**warm 失败时回退到原 `<img src>` 相对路径**——该回退依赖 html2canvas 的 useCORS 同源加载能力。

**换渲染引擎（如 html-to-image / satori / 服务端出图）时必须重新设计**，建议链路：
warm 失败 → 生成时阻塞重试 1 次 → 仍失败则输出「纯色占位块」（不依赖网络资源）。

## 3. 未解矛盾：首轮挂起 vs A0′ 复现 10/10

**矛盾**：首轮诊断（P0-0，修复前原始代码，http://localhost）在 WebKit 上复现 html2canvas 挂起（8s+ 无响应）；A0′ 实验（git checkout 07d7f99 = 同一原始代码，同一 http://localhost 协议，WebKit × 10）10/10 成功、均值 1.26s。

**二者只能一真**。最可能解释：**网络条件不等价**——A0′ 实验的网络 stub 是「延迟 20s 后必然响应/abort」（route handler 定时器到点即返回，网络栈正常释放）；而首轮诊断时沙箱真实访问 hm.baidu.com 是**永不响应的 TCP 黑洞**（DNS/TCP 层挂起，无超时上限），克隆 iframe 的资源等待被黑洞卡死。两种网络行为在浏览器引擎层面不等价。

**状态**：无法在自动化环境复现黑洞条件（需要真机真实网络或可控的"永不响应"代理）。按决策不再开新实验；真机验证路径 = /dev/diag.html 的「加载真实外链」开关 + 导出压测。

## 4. 导出字节波动：已随 WebP 切换解决（结案）

**现象**：PNG 输出时代，同页跨轮次 9:16 字节波动达 2.3 倍（2,046KB / 4,077KB / 4,770KB），与像素确定性（SHA-256 唯一）表面矛盾。

**结论（2026-08-07，WebP 生产路径复测）**：同 context 连续 10 次渲染，完整元组：
`{persona:SNIPER, ratio:9:16, scale:2, canvas:2160x3840, pixelSha256:4b37f07d4c4a074c, bytes:210946, format:image/webp, wasCached:false, renderMs:227-278}` —— **pixelSha256 10/10 相同且 bytes 10/10 相同（210946）**。

**判定**：波动为 PNG 编码器（Chromium toDataURL('image/png')）的不稳定行为；切换 WebP（toBlob q90）后不再复现。像素确定性（SHA-256 唯一）在 Chromium/WebKit 双引擎跨 context 下均成立。不影响用户（默认输出已 WebP）。

## 5. TODO: 暖色(#FF7A45)细字的 4:2:0 验证延迟至视觉阶段

**绑定**：视觉阶段 Prompt 2/3 验收项。
**原因**：YCbCr 中暖色/红色的能量集中在 Cr 通道（能量高于绿色系——绿色能量在 Cb/亮度通道，受损更小）；4:2:0 色度降采样对 Cr 的破坏更大，暗底暖色细字可能出现色渗/边缘发灰。当前模板无 #FF7A45，本次仅以绿色 #00e5a0 数字验证（色度差 <4/255 可接受）——暖色需真机目测确认，故延迟。

## 6. TODO: warm 失败回退依赖 html2canvas 特性（确认仍在）

已记录（第 2 条），2026-08-07 复核仍在：`warmCardAssets()` 失败时回退相对路径 `<img src>`，依赖 html2canvas 一级克隆 iframe 继承 baseURI 才能加载。换渲染引擎必须重新设计（warm 失败 → 阻塞重试 1 次 → 仍失败则纯色占位块）。另确认：生产主窗口场景下该回退可用（6/6 断言通过）；diag 的二级 iframe 场景不可用（baseURI 不继承——已用预热内联修复）。


## 7. TODO(1C): 13 测试页残留第一版 bindShareCard 双份定义

**现象**: 13 个测试页(flowtest/hashtest × zh/en/hk × 两仓库 + p02check)存在两个 bindShareCard 定义:
第一版残留(约 4997 行)与生产版(约 5118 行)。JS 函数声明提升使后者生效,行为与生产一致,
但双份代码会漂移(C1 B7 曾发现 en 测试页 name-sub 绑定缺失,生产 index-en 同样中招)。
**转入 1C 待办**: 测试页全量同步(handoff §7.1)时删除第一版残留,保留生产版。


## 8. TODO(1C): 13 测试页 374 处裸 DOM 访问不改

E2-P1 已把生产 6 页 96 处裸访问改 safeEl/safeFail(no-bare-dom-access 红线 3/3 绿)。
13 测试页(flowtest/hashtest × zh/en/hk × 两仓库 + p02check)的 374 处(H=263 M=111)
**按 E2 指令不动**, 1C 测试页整体处理时一并修复(与第 7 条双 bindShareCard 同步)。


## 9. P0(2026-08-07 C3): 预览 ≠ 导出 —— 视觉验收必须基于导出图,不能基于 live DOM 预览

**现象**: 分享卡角色插画区(stage)在导出 PNG 中为整块墨绿,而 live DOM 预览中该区域正常(近黑底+人物)。

**实测(C3, 同状态同尺寸 2160x3840, SNIPER 9:16)**:
- stage 区域绿色占比: live DOM 截图 **0.5%** vs 导出 PNG **25.4%**(上半 41.3%);y=640-740 条带 live 0.0% vs 导出 89.4%。
- 同坐标像素对(均为 BGR):
  - (600,700) 墨绿块内: live=(14,15,13) vs 导出=(44,61,11)
  - (104,1387) stage 左缘: live=(45,61,10)(墨绿 1px 描边) vs 导出=(14,16,11)
  - (1080,1280) stage 中心(人物): live=(50,78,135) vs 导出=(50,76,136) —— 人物本身一致
- 因果链: 角色图 webp 背景透明(绿块区 live 近黑像素 99.3% = 透出黑底)→ html2canvas 将 `.sc-char-stage` 的 `box-shadow: inset 0 0 0 1px rgba(0,229,160,.22)` 渲染成**整区填充色**(visual-spec §4 已证)→ 透明区透出墨绿。

**结论**: 预览≠导出成立(P0 类)。现有全部基于预览的视觉验收方法无效;验收必须用导出图(html2canvas 产物)。
**同类潜在分歧属性**: 半透明 alpha 合成(shadow/border/背景)、opacity、PNG/webp 透明通道、border-radius 抗锯齿。完整清单见 docs/visual-spec.md §6。
**本轮不修**(2/3 整体重做 stage)。


## 10. P1(2026-08-08 L2-4 核实): lang_switch「到达时上报」从未实现——【过程可信度问题】

**现象**: I1-3 汇报称 lang_switch 已入白名单并实现「到达时上报」，但双仓全历史 pickaxe 核实(git log --all -S)：
- `track('lang_switch'` → 0 提交；`isLangSwitch` → 0 提交；`nbti_lang_switch` → 仅 I1-2(16:934deec6 / 48:ca612ca) 以 `localStorage.setItem('nbti_lang_switch','1')` 标记 SET 引入，无消费端(getItem/removeItem 均无)。
- 结论: **lang_switch sender 从未实现**【前任报了没做】,非 grep 姿势问题。L2-4 已在 feat/ship-navfix 补实现(sendBeacon lang_switch + sessionStorage 一次性 flag + page_view isLangSwitch:true)。
**定性**: 这是【过程可信度问题】而非单纯技术遗留——前任至少一次把未实现功能标记为【已实现并实测通过】。对 5 条历史【已实现并实测通过】条目的抽查(T7)：4 条代码实证为真(E2-P3/B7/G3/H-P0)，1 条(B3)工具链丢失不可复核，未见系统性造假；但该误报表明「已实测」标注不可盲信。
**教训**: 标着「已实测」的汇报条目可能有别项未做,需抽查复核；后续【已实现并实测通过】标注须附 commit_sha + 复现步骤。


## 11. P1(2026-08-08 L2 修复): nav-state 断言集系统性盲区 — 「结果页→goHome→点切语言」未被覆盖

**现象**: 原 nav-state.spec.ts 26 项(8 场景×3 语言 + Q1 + 负例)未覆盖「结果页→返回首页→点切语言」组合。场景4/5 覆盖「结果页→返回首页」但随后是 startQuiz/reload(不点语言链接)；Q1 覆盖「答题中→首页→切语言」(hash 本为空)。因此 I1-2 引入的「goHome 清 URL hash 但语言链接 href 不重建」未被测出——修复前 main 与 PoC 分支均可复现「切语言仍被拉回结果页」。
**处置**: L2-修复1 补 syncLangLinks()(setView 清 hash 后重建三语链接) + 新增回归测试「结果页→goHome→点切语言 → 停新语言首页」；本地 42/42 全绿，线上三语验证通过。
**教训**: 视图状态机断言需覆盖「动作组合」而非单个动作(goHome + 切语言 组合)。


## 12. P1(2026-08-08 L2 修复): 生产 /api/event 全量 500（res.set is not a function）——已修复

**现象**: 生产 POST/OPTIONS /api/event 返回 500 FUNCTION_INVOCATION_FAILED：`TypeError: res.set is not a function`（Vercel Node 运行时 res 无 Express 风格 .set()）。
**从何时起**: git blame → `res.set(CORS)` 由 07d7f99a（2026-08-07 14:22 +0800）引入；07d7f99a 之前版本（9978d85，2026-08-07 11:30 创建）只用 `res.status/json`（Vercel 支持，已用 api/stats.js 实证返回 401 正常）→ 可用。故 500 区间 ≈ 07d7f99a 首次进 production 至 2026-08-08 修复部署，约 1 天。【定性：非「从未入库」——更早版本代码路径正常；实际入账与否需 count(*) 佐证】
**处置**: L2-修复2 改标准 Node `res.setHeader`(CORS 用 Object.entries 展开)/`res.statusCode`/`res.end(JSON)`，保留 rejected_event，补 Content-Type: application/json；已上线（16=02dc7dc / 48=d23c224），线上 OPTIONS 204 / 白名单 200 / 非白名单 400 验证通过。双仓 byte-identical SHA d2e824e50b6f500372321b46ab37215dd3705a01。


## 13. Token 特批使用记录(2026-08-08 L2 完结)

X-Dash-Token 曾于预上线测试阶段由项目负责人主动公开使用，经负责人确认当前风险可接受，本轮验证特批使用。上线后（真实用户数据流入）需立即轮换该 token，并恢复生产凭据不下放执行 agent 的默认限制。
本次特批范围扩展至 Dashboard 的 mode=times 验证（同一特批延伸，非新开口子）。


## 14. B3 build:cards 不可复核(2026-08-08 抽查 T7)

B3(adaf5e7d) 声称「build:cards v1 — 108 张底图+62 张真 alpha 切片+manifest(sha256/matchRect)，双仓库实测 108 张/19.9MB/198s/断言全绿」标为【已实现并实测通过】。抽查结论：【CANNOT_VERIFY】——build:cards 脚本指向仓库外 ../shared/build-cards.mjs（已丢失、从未入库），仓库内无 cards/、无 manifest、无切片、无基线 diff 产物，无法复现。
**与 #10 lang_switch 严格区分**：#10 是【过程可信度问题】——实现代码 grep 全历史=0 却被标为【已实现并实测通过】，标注与实现不符；B3 是【工具链丢失】——实现工具从未入库+产物 gitignore，标注无法复核，但无证据表明未实现。两者性质不同：前者损害汇报可信度，后者是资产丢失。
