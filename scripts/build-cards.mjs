#!/usr/bin/env node
/**
 * build:cards — 分享卡构建期预生成管线。
 *
 * L3 结构占位：脚本已移入仓库（scripts/），解决「执行工具在仓库外丢失」的结构问题。
 * 内容重建在 L4，依据 docs/architecture-card-prerender.md：
 *   - 102 组合（16 人格 × 3 语言 × 2 比例 + 彩蛋 6）
 *   - per-page 预热 + 三层断言 + 2160×3840/2160×2700 WebP q90 底图（不含匹配度数字）
 *   - 62 张真 alpha 数字切片（独立空白页 omitBackground:true）
 *   - manifest.json（sha256 + matchRect）+ 基线 diff
 *   - --only=<persona>[,<locale>][,<ratio>] 增量构建
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const repoArg =
  (args.find((a) => a.startsWith('--repo=')) ?? '').split('=')[1] ||
  args[args.indexOf('--repo') + 1] ||
  null;

console.error('[build-cards] L3 结构占位：实现待 L4 重建（见 docs/architecture-card-prerender.md）。');
console.error(`[build-cards] --repo=${repoArg}  （仓库根: ${join(__dirname, '..')}）`);
process.exit(1);
