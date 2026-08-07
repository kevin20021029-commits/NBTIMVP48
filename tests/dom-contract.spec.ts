/**
 * 分享卡 DOM 契约测试(防回归)
 *
 * 背景:2026-08 曾发生 sharePreviewModal 及其 5 个子节点 + 2 张分享卡模板
 * 被整块误删的回归(删除重复 DOM 块时顺带删了预览弹窗),导致生成后
 * openSharePreview() 对 null 元素操作抛 TypeError,弹窗永远打不开。
 *
 * 本测试遍历全部生产 HTML 文件,断言 7 个关键节点各存在且仅存在 1 次,
 * 同时覆盖「缺失」和「重复」两种回归。
 *
 * 运行: npm run test:dom   (或 npx playwright test tests/dom-contract.spec.ts)
 * 纯文件断言,无需浏览器。
 */
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const REQUIRED_IDS = [
  'sharePreviewModal', // 预览弹窗容器
  'sharePreviewImg', // 预览图
  'sharePreviewSpin', // 生成中指示
  'sharePreviewDl', // 下载按钮
  'sharePreviewHint', // 提示文案
  'shareCardTemplate916',
  'shareCardTemplate45', // 9:16 分享卡模板
  'confirmModal', // 确认弹层容器(E2-P0: 07d7f99 误删后恢复)
  'confirmTitle', // 确认弹层标题
  'confirmDesc', // 确认弹层描述
  'confirmPrimary', // 确认主按钮
  'confirmSecondary', // 确认次按钮
];

/* 生产 HTML 文件:index.html / index-en.html / index-hk.html */
const files = readdirSync(join(__dirname, '..'))
  .filter((f) => /^index(?:-en|-hk)?\.html$/.test(f))
  .sort();

test.describe('分享卡 DOM 契约(7 个关键节点)', () => {
  test('存在生产 HTML 文件', () => {
    expect(files.length, '仓库根目录应有 index*.html 生产文件').toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`${file}: 7 个关键节点各存在且仅存在 1 次`, () => {
      const html = readFileSync(join(__dirname, '..', file), 'utf-8');
      for (const id of REQUIRED_IDS) {
        const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
        expect(count, `${file} 中 #${id} 应恰好 1 次,实际 ${count} 次(缺失或重复)`)
          .toBe(1);
      }
    });
  }
});
