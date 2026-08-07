/**
 * 资源一致性测试:根目录 *.webp(前端使用) 与 assets/jpg/*.jpg(/api/card 使用) 一一对应。
 * 防回归:新增/删除/改名任一侧资源时另一侧漏同步。
 * 运行: npx playwright test tests/asset-contract.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

test('assets/jpg 与根 *.webp 一一对应(无缺失无多余)', () => {
  const webps = readdirSync(ROOT).filter((f) => f.endsWith('.webp')).sort();
  const jpgs = readdirSync(join(ROOT, 'assets', 'jpg')).filter((f) => f.endsWith('.jpg')).sort();
  expect(webps.length, '根目录应有 webp 资源').toBeGreaterThan(0);

  const missing = webps.filter((w) => !existsSync(join(ROOT, 'assets', 'jpg', w.replace(/\.webp$/, '.jpg'))));
  const extra = jpgs.filter((j) => !webps.some((w) => w.replace(/\.webp$/, '.jpg') === j));

  expect(missing, '缺少对应 jpg: ' + missing.join(', ')).toEqual([]);
  expect(extra, '多余 jpg(无对应 webp): ' + extra.join(', ')).toEqual([]);
  expect(jpgs.length, 'jpg 数量应与 webp 一致').toBe(webps.length);
});
