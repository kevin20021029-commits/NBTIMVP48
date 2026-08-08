/**
 * 强 shared 校验(F4 对策): 两仓库 shared/ scripts/ docs/ tests/ api/ .gitattributes 必须 byte-identical。
 * 不一致即报红 — 「两边都绿 ≠ 两边同标准」的机制化终结(known-issues 第 11 条)。
 *
 * L3 重新接线:
 *  - 兄弟仓库发现改为按 package.json name(nbti16|nbti48) 反向查找父目录另一仓库
 *  - 找不到兄弟 → test.skip(显式跳过), 杜绝「自比假绿灯」与「孤立 clone 报红」
 *  - 校验方式改为目录遍历(shared/ scripts/ docs/ tests/ api/) + 单文件(.gitattributes),
 *    双向比对(本仓独有 / 兄弟独有 / 内容不一致), 不再依赖硬编码文件清单
 *    —— 修复 api/stats.js 类漂移: 旧硬编码清单漏掉 api/stats.js(16 有 48 无, 已通过 sync 对齐)
 * 运行: npm run test:dom
 */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

/** 按 package.json name 反向查找父目录另一仓库; 找不到返回 null */
function findSibling(): string | null {
  let myName: string;
  try {
    myName = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).name ?? '';
  } catch {
    return null;
  }
  const myId = myName.includes('nbti48') ? 'nbti48' : myName.includes('nbti16') ? 'nbti16' : '';
  if (!myId) return null;
  const siblingId = myId === 'nbti16' ? 'nbti48' : 'nbti16';
  const parent = join(ROOT, '..');
  for (const entry of readdirSync(parent)) {
    const pkgPath = join(parent, entry, 'package.json');
    if (!existsSync(pkgPath)) continue;
    try {
      const name: string = JSON.parse(readFileSync(pkgPath, 'utf-8')).name ?? '';
      if (name.includes(siblingId)) return join(parent, entry);
    } catch {
      /* 非仓库目录, 跳过 */
    }
  }
  return null;
}

const SIBLING = findSibling();

/** 与 scripts/sync-shared.mjs 的同步集保持一致 */
const SYNC_DIRS = ['shared', 'scripts', 'docs', 'tests', 'api'];
const SYNC_FILES = ['.gitattributes'];

/**
 * 豁免清单（契约：api/ 默认跨仓 byte-identical；仓库专属 API 必须显式列入此处并注明理由）
 * api/stats.js: dashboard 后端（仅 16 有 dashboard.html 调用，48 无 dashboard 无调用方）；
 * 同步裁决在 dashboard agent（不在本队），本队不放行 —— pending review。
 */
const EXEMPTIONS: string[] = ['api/stats.js'];

function collectRel(root: string): string[] {
  const out = new Set<string>();
  for (const f of SYNC_FILES) {
    if (existsSync(join(root, f))) out.add(f);
  }
  const walk = (dir: string, prefix: string): void => {
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
  return [...out].sort().filter((rel) => !EXEMPTIONS.includes(rel));
}

test('强 shared: 两仓库 shared/scripts/docs/tests/api/.gitattributes byte-identical(双向, EXEMPTIONS 豁免)', () => {
  test.skip(!SIBLING, `未找到兄弟仓库(按 package.json name 反向查找父目录) — 跳过跨仓 byte-identical 校验`);
  const mine = collectRel(ROOT);
  const theirs = collectRel(SIBLING);
  const diffs: string[] = [];
  for (const rel of mine) {
    const a = join(ROOT, rel);
    const b = join(SIBLING, rel);
    if (!existsSync(b)) {
      diffs.push(rel + ' (本仓独有, 兄弟缺失)');
      continue;
    }
    const fa = readFileSync(a);
    const fb = readFileSync(b);
    if (fa.compare(fb) !== 0) diffs.push(rel + ' (内容不一致)');
  }
  for (const rel of theirs) {
    if (!mine.includes(rel)) diffs.push(rel + ' (兄弟独有, 本仓缺失)');
  }
  expect(diffs, '两仓库 shared 文件不一致: ' + diffs.join(', ')).toEqual([]);
});

test('生产文件与共享契约一致: index.html 不含 html2canvas/降级链残留', () => {
  const idx = readFileSync(join(ROOT, 'index.html'), 'utf-8');
  const banned = ['function generateShareCard', 'function serverCardFallback', 'function checkCardContent', 'function cardAssetBase64'];
  const hits = banned.filter((b) => idx.includes(b));
  expect(hits, 'index.html 含应删除代码: ' + hits.join(', ')).toEqual([]);
  expect(idx.includes('html2canvas 1.4.1 内嵌'), 'html2canvas 内嵌库必须为零残留').toBe(false);
});
