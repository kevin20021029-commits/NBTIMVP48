/**
 * E2-P3a: 生产页无裸 DOM 访问(防回归)
 *
 * 背景:C1 曾发生 showConfirm 抛 "Cannot set properties of null" —
 * getElementById/querySelector 后未判空就访问 .textContent/.innerHTML/.style/.src/.classList/.value。
 * 本测试只扫生产 3 页(index.html/index-en.html/index-hk.html),
 * 模式 A: document.getElementById/querySelector 直接链式访问;
 * 模式 B: var x = document.getElementById(...) 后 15 行内未判空访问 x.xxx。
 * 任一命中即 fail。修复请改 safeEl()/safeFail() 而非放宽此测试。
 *
 * 运行: npm run test:dom
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const files = ['index.html', 'index-en.html', 'index-hk.html'];
const ACCESS = '(textContent|innerHTML|style|src|classList|value)';
const RE_DIRECT = new RegExp(
  `document\\.(?:getElementById|querySelector)\\(\\s*['"][^'"]*['"]\\s*\\)\\.${ACCESS}`
);
const RE_VAR_DECL = /var\s+(\w+)\s*=\s*document\.(?:getElementById|querySelector)\([^)]*\)/;

test.describe('生产页无裸 DOM 访问(E2-P3)', () => {
  for (const file of files) {
    test(`${file}: 无裸访问(链式 + 变量未判空)`, () => {
      const src = readFileSync(join(__dirname, '..', file), 'utf-8');
      const lines = src.split('\n');
      const hits: string[] = [];

      lines.forEach((line, i) => {
        if (line.length > 1500) return; // 跳过内嵌 html2canvas 库 minified 行
        const m = RE_DIRECT.exec(line);
        if (m) hits.push(`[A] ${i + 1}: ${line.trim().slice(0, 90)}`);
      });

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 1500) continue;
        const dm = RE_VAR_DECL.exec(lines[i]);
        if (!dm) continue;
        const v = dm[1];
        if (v.startsWith('_')) continue;
        for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
          if (lines[j].length > 1500) continue;
          const use = new RegExp(`\\b${v}\\.${ACCESS}`).exec(lines[j]);
          if (!use) continue;
          const seg = lines.slice(i, j + 1).join('\n');
          if (new RegExp(`if\\s*\\(\\s*!${v}|${v}\\s*===\\s*null|if\\s*\\(\\s*${v}\\s*\\)|if\\s*\\(\\s*${v}\\s*&&`).test(seg)) break;
          hits.push(`[B] ${j + 1}: ${lines[j].trim().slice(0, 90)}`);
          break;
        }
      }

      expect(hits, `${file} 裸访问 ${hits.length} 处(需改 safeEl/safeFail):\n${hits.join('\n')}`).toEqual([]);
    });
  }
});
