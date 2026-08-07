/**
 * 强 shared 校验(F4 对策): 两仓库 shared/ docs/ tests/ api/ 必须 byte-identical。
 * 不一致即报红 — 「两边都绿 ≠ 两边同标准」的机制化终结(known-issues 第 11 条)。
 * 依赖: 两仓库同父目录(../NBTI16 与 ../NBTI48)。
 * 运行: npm run test:dom
 */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const SIBLING = join(ROOT, '..', 'NBTI16');

const SHARED_REL = [
  'shared/card-runtime.js',
  'shared/text-assert.js',
  'api/event.js',
  'docs/known-issues.md',
  'docs/visual-spec.md',
  'docs/asset-bbox.md',
  'docs/architecture-card-prerender.md',
  'tests/dom-contract.spec.ts',
  'tests/asset-contract.spec.ts',
  'tests/text-check.spec.ts',
  'tests/no-bare-dom-access.spec.ts',
  'tests/nav-state.spec.ts',
];

test('强 shared: 两仓库 shared/docs/tests/api byte-identical', () => {
  const diffs: string[] = [];
  for (const rel of SHARED_REL) {
    const a = join(ROOT, rel);
    const b = join(SIBLING, rel);
    try {
      const fa = readFileSync(a);
      const fb = readFileSync(b);
      if (fa.compare(fb) !== 0) diffs.push(rel + ' (内容不一致)');
    } catch (e: any) {
      diffs.push(rel + ' (缺失: ' + e.message + ')');
    }
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
