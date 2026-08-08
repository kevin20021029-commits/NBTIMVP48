#!/usr/bin/env node
/**
 * sync:shared — 双仓库 shared/scripts/docs/tests/api/.gitattributes 同步（单向）。
 *
 * 方向（硬编码，禁止命令行反转）：
 *   SOURCE_REPO = NBTIMVP16（canonical source，唯一允许修改共享文件的仓库）
 *   TARGET_REPO = NBTIMVP48（只读镜像）
 * 依据 L3 方向核实：历史 5 组共享集 commit 均为「16 先改、48 追」。
 *
 * 用法：
 *   npm run sync:shared          # 默认 dry-run：输出 diff，不写入
 *   npm run sync:shared -- --apply   # 显式确认后才覆盖 TARGET_REPO
 *
 * diff 输出纪律：文件级状态 + 逐行摘要（+added/-removed 行数 + 行号摘要），
 * 不写"已同步 3 个文件"这类无元组摘要。
 *
 * 运行位置不限（16 或 48 均可），方向固定为 16 → 48。
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 硬编码方向（L3 定源：NBTIMVP16 先改，NBTIMVP48 追） ──
const SOURCE_REPO = 'NBTIMVP16';
const TARGET_REPO = 'NBTIMVP48';

// ── 同步集：与 tests/shared-identity.spec.ts 的 SHARED_REL 保持一致 ──
const SYNC_DIRS = ['shared', 'scripts', 'docs', 'tests', 'api'];
const SYNC_FILES = ['.gitattributes'];
// 豁免清单（与 shared-identity.spec.ts 一致）：api/stats.js = dashboard 后端，16-only，裁决在 dashboard agent
const SYNC_EXEMPTIONS = ['api/stats.js'];

const REPO_ROOT = join(__dirname, '..');            // <repo>/
const PARENT = join(REPO_ROOT, '..');               // pipeline/
const SOURCE = join(PARENT, SOURCE_REPO);
const TARGET = join(PARENT, TARGET_REPO);

// ── 轻量 LCS 行 diff：返回操作序列 [' ','+','-'] + 两侧行号 ──
function lineDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = al.length;
  const m = bl.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      ops.push([' ', i + 1, j + 1]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push(['-', i + 1, j + 1]);
      i++;
    } else {
      ops.push(['+', i + 1, j + 1]);
      j++;
    }
  }
  while (i < n) {
    ops.push(['-', i + 1, m + 1]);
    i++;
  }
  while (j < m) {
    ops.push(['+', n + 1, j + 1]);
    j++;
  }
  return ops;
}

// 收集某仓库同步集内全部相对路径（递归目录 + 单文件），排序保证确定性
function collectRel(root) {
  const out = new Set();
  for (const f of SYNC_FILES) {
    if (existsSync(join(root, f))) out.add(f);
  }
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        walk(abs, rel);
      } else {
        out.add(rel);
      }
    }
  };
  for (const d of SYNC_DIRS) walk(join(root, d), d);
  return [...out].sort().filter((rel) => !SYNC_EXEMPTIONS.includes(rel));
}

const rels = collectRel(SOURCE);
const results = [];
let changed = 0;

for (const rel of rels) {
  const srcAbs = join(SOURCE, rel);
  const tgtAbs = join(TARGET, rel);
  let status;
  let detail = '';
  const srcBytes = readFileSync(srcAbs);

  if (!existsSync(tgtAbs)) {
    status = 'CREATE';
    detail = `+${srcBytes.length} bytes`;
    changed++;
  } else {
    const tgtBytes = readFileSync(tgtAbs);
    if (Buffer.compare(srcBytes, tgtBytes) === 0) {
      status = 'SAME';
    } else {
      status = 'DIFF';
      const ops = lineDiff(srcBytes.toString('utf-8'), tgtBytes.toString('utf-8'));
      const added = ops.filter((o) => o[0] === '+').length;
      const removed = ops.filter((o) => o[0] === '-').length;
      const addLines = ops.filter((o) => o[0] === '+').slice(0, 5).map((o) => `+${o[2]}`);
      const delLines = ops.filter((o) => o[0] === '-').slice(0, 5).map((o) => `-${o[1]}`);
      detail = `+${added}/-${removed} 行; 头5: ${[...delLines, ...addLines].join(' ') || '(行号一致仅内容?)'}`;
      changed++;
    }
  }
  results.push({ rel, status, detail });
}

// 检查 TARGET 独有的文件（SOURCE 已删 → 需要人工处理）
const targetRels = collectRel(TARGET);
for (const rel of targetRels) {
  if (!rels.includes(rel)) {
    results.push({ rel, status: 'TARGET_ONLY', detail: 'TARGET 独有(源已无) — 不自动删除' });
  }
}

// ── 输出 ──
console.log(`[sync:shared] ${SOURCE_REPO} → ${TARGET_REPO}  (dry-run 默认; --apply 才写入)`);
console.log(`[sync:shared] 同步集: ${SYNC_DIRS.join(', ')} + ${SYNC_FILES.join(', ')}`);
let nSame = 0;
let nCreate = 0;
let nDiff = 0;
for (const r of results) {
  if (r.status === 'SAME') {
    nSame++;
    continue;
  }
  console.log(`  [${r.status.padEnd(11)}] ${r.rel}  ${r.detail}`);
  if (r.status === 'CREATE') nCreate++;
  if (r.status === 'DIFF') nDiff++;
}
console.log(`[sync:shared] 文件总数=${results.length} (same=${nSame}, create=${nCreate}, diff=${nDiff}, target_only=${results.length - nSame - nCreate - nDiff})`);
console.log(`[sync:shared] 变更=${changed} 个文件。${changed === 0 ? '两仓库 byte-identical。' : changed > 0 ? '未写入 — 加 --apply 覆盖。' : ''}`);

// ── --apply：显式确认才写入 ──
if (process.argv.includes('--apply')) {
  if (changed === 0) {
    console.log('[sync:shared] 无变更，--apply 无操作。');
  } else {
    let applied = 0;
    for (const r of results) {
      if (r.status !== 'CREATE' && r.status !== 'DIFF') continue;
      const srcAbs = join(SOURCE, r.rel);
      const tgtAbs = join(TARGET, r.rel);
      mkdirSync(join(tgtAbs, '..'), { recursive: true });
      writeFileSync(tgtAbs, readFileSync(srcAbs));
      console.log(`  [APPLIED] ${r.rel}`);
      applied++;
    }
    console.log(`[sync:shared] 已写入 ${applied} 个文件: ${SOURCE_REPO} → ${TARGET_REPO}`);
  }
}

process.exit(changed > 0 && !process.argv.includes('--apply') ? 1 : 0);
