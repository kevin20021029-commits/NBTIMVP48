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


## 10. F4 证据: 仓库漂移事件两次(2026-08-07 H-POC 轮)

**事件一(NBTI48 H-P0 误落 main)**: H-P0 commit c6f1a5d 在 NBTI48 的 main 上创建(未建分支即 commit)。
纠正(reflog 完整还原): `git branch feat/card-prerender-poc c6f1a5d` → `git checkout feat/card-prerender-poc`
→ `git checkout main` → `git reset --hard 7bf09a1` → `git checkout feat/card-prerender-poc`。
**未 force push,远端 main 从未被污染**(纠正前 main 领先 origin/main 1 commit 但未推送)。
根因: 双仓库操作时 NBTI16 建了分支、NBTI48 忘记建。

**事件二(文档/测试历史漂移 + H-P4 未同步)**: 本轮 B0b 全量校验发现 4 文件漂移——
① known-issues.md 缺第 9 条、visual-spec.md 缺第 6 节(C3 内容只进了 16)
② tests/dom-contract.spec.ts 与 tests/text-check.spec.ts 是 E2 时代旧版(48 缺 C3 后 39 节点重构)
③ H-P4 文档(8052fb1)只在 16。
已按 16 为权威版同步 48,8 文件 byte-identical 验证通过,48 test:dom 15/15 全绿。
根因: C3 轮起对 48 的 docs/tests 同步靠人工记忆,无强制校验。

**对策(写入 B5 层次一)**: tests/ docs/ shared/ 必须收进强 byte-identical 校验,
不一致即 test:dom 报红(具体方案见 docs/architecture-card-prerender.md 与 B5 结论)。
