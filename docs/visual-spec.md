# 视觉阶段规范（HOTFIX-C3 E4 归档，Prompt 2/3 第一条规范）

> 生成：2026-08-07。所有数据来自 HOTFIX-C3 实测（元组齐全），2/3 视觉阶段直接引用，不再重测。

## 1. 图片容器几何（D6 实测，固定值）

**3 语言 × 2 比例下容器尺寸完全相同，布局固定**（EN 两行指标标签未撑开容器——C1 B6 的 `.sc-info{min-width:0}` 保证）：

| 比例 | stage 容器 | 宽高比 |
|---|---|---|
| 9:16 | 976 × 1000 px | 0.976 |
| 4:5 | 520 × 600 px | 0.867 |

容器选择器：`.sc-char-stage`（overflow:hidden，`box-shadow: inset 0 0 0 1px rgba(0,229,160,.22)`——见第 4 条）。

## 2. 派系配色 token 状态（D5 实测）

**状态③：根本没定义。** 四个派系色 `#FF7A45 / #3B9EFF / #46D6B4 / #F5C451` 在代码中零引用。
卡片取色全部硬编码绿色：`.sc-match-num`、`.sc-name-sub`、`.sc-stat-fill`、`.sc-social .sc-num`、`.sc-claim-2` 均为 `#00e5a0`；topbar 渐变 `#c9a227,#00e5a0`；模板渐变 `#12241d→#0a100d→#070908`。
`CLAN_MAP`（index.html:4577）只映射派系名称。2/3 需从零接线（不存在"被覆盖"问题）。

## 3. EN footer 尺寸预算（E3 修复后）

EN 9:16 卡片总高 1920，footer 贴底（footerBottom=1920），法务文案水平余量 165px、垂直余量 12px。
EN 特有成本：指标标签固定高（916:64px / 45:58px）+ EN tagline 3 行（行高 1.25）+ social 2 行（行高 1.36）。
**zh/hk 渲染不受影响**：像素哈希 4 组（zh/hk × 9:16/4:5）与 E3 前基线完全一致。

## 4. E0 取证：stage「墨绿」来源（html2canvas 渲染 bug，2/3 派系配色前必须知道）

- 实测渲染像素（stage 左上角 5%）：**RGB(8,47,34) ≈ #082F22**（肉眼墨绿）。
- A/B 实验：移除 `.sc-char-stage` 的 `box-shadow` 后同点变 **RGB(10,12,12)**（近黑，= 底色 #0d0f0e + stage-grad 黑渐变叠加）。
- 定性：**墨绿 = stage 的 `box-shadow: inset 0 0 0 1px rgba(0,229,160,.22)`（硬编码绿色 rgba，与 #00e5a0 同族）被 html2canvas 渲染成整个 stage 区域的填充色**（1px inset shadow 被绘制为整区填充）。
- 叠加关系：box-shadow 绿填充（rgba(0,229,160,.22) × #0d0f0e ≈ (10,62,46)）再叠 `.sc-stage-grad` 顶部 rgba(7,9,8,.3) ≈ (9,46,35) ≈ 实测 (8,47,34) ✓。
- 含义：① 派系配色实现时，这条 box-shadow 会直接决定 stage「框」的观感（渲染为整区填充色，不是 1px 边框）；② 若目标是"无框融合"，移除该 box-shadow 即可得到近黑 stage；③ html2canvas 的 inset box-shadow 渲染行为是全局性的，2/3 任何新阴影都要以渲染图验证。

## 5. 其它 2/3 约束（C1/C3 实测）

- fitText 工具（B6）已就位：标题 nowrap + 按 `.sc-info` 列宽降字号，留 16px 余量防克隆度量裁切。2/3 复用。
- EN 指标标签：916=64px / 45=58px 固定高 + flex 垂直居中（B5），两行允许。
- 预览弹窗：遮罩 rgba(4,6,12,.92) + body 滚动锁定（B3）；卡片高度上限 calc(90vh-200px)（B4）。
- 13 测试页双 bindShareCard 残留 + 374 处裸 DOM 访问：1C 处理（known-issues 第 7/8 条），2/3 排版改动需同步 19 文件。
- 素材 18 张 bbox 表：见 asset-bbox.md。
