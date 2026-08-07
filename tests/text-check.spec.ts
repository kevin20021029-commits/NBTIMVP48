/**
 * 分享卡文本层断言(B7) + 内容断言 12 组回归
 *
 * 背景:B1 的字面 \n 是像素级断言(checkCardContent)无法发现的一类错误,
 * 新增文本层断言在 bindShareCard 完成后、渲染前执行:
 *   R1 模板 textContent 敏感串(\n/undefined/NaN/null/[object Object]/{{/}})
 *   R2 必填字段非空(人格名/英文名/匹配度/指标值/引言/品牌行)
 *   R3 匹配度 0-100 整数 + 指标值数字或白名单枚举(MAX/MIN/∞)
 * 命中即 track('share_card_text_check_failed') 并走降级链。
 *
 * 运行: npm run test:dom
 * 依赖: playwright.config.ts 的 webServer(端口 8899;NBTI48 为 8898)
 */
import { test, expect } from '@playwright/test';
import { readdirSync } from 'fs';
import { join } from 'path';

const files = readdirSync(join(__dirname, '..'))
  .filter((f) => /^index(?:-en|-hk)?\.html$/.test(f))
  .sort();

/* 外网不可达:拦截非本地请求(统计脚本/外链) */
async function blockExternal(page: import('@playwright/test').Page) {
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('http') && !u.includes('localhost') && !u.includes('127.0.0.1')) return route.abort();
    return route.continue();
  });
}

test.describe('分享卡文本层断言(B7)', () => {
  for (const file of files) {
    test(`${file}: 文本断言 0 失败 × 9:16/4:5`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      const r = await page.evaluate(async () => {
        const out: any[] = [];
        for (const ratio of ['9:16', '4:5']) {
          const p = (window as any).RESULTS.results[0];
          const tpl = document.getElementById(ratio === '4:5' ? 'shareCardTemplate45' : 'shareCardTemplate916')!;
          (window as any).bindShareCard(tpl, p, 87, ratio);
          out.push({ ratio, fails: (window as any).checkShareCardText(tpl, p, 87, ratio, (window as any).CURRENT_LANG) });
        }
        return out;
      });
      for (const x of r) {
        expect(x.fails, `${file} ${x.ratio} 文本断言失败: ${JSON.stringify(x.fails)}`).toEqual([]);
      }
    });
  }

  test('负例: 注入字面 \\n / 越界匹配度被检测, 遥测 payload 完整', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
    const r = await page.evaluate(async () => {
      const W = window as any;
      const tpl = document.getElementById('shareCardTemplate45')!;
      const p = W.RESULTS.results[0];
      W.bindShareCard(tpl, p, 87, '4:5');
      const t = tpl.querySelector('.sc-name-main') as HTMLElement;
      const mn = tpl.querySelector('.sc-match-num') as HTMLElement;
      const origT = t.textContent;
      const origMn = mn.innerHTML;
      const events: any[] = [];
      const origTrack = W.track;
      W.track = (name: string, payload: any) => events.push({ name, payload });
      t.textContent = 'x\\ny';
      const r1 = W.checkShareCardText(tpl, p, 87, '4:5', W.CURRENT_LANG);
      mn.innerHTML = '101<span class="sc-match-pct">%</span>';
      const r2 = W.checkShareCardText(tpl, p, 87, '4:5', W.CURRENT_LANG);
      t.textContent = origT;
      mn.innerHTML = origMn;
      W.track = origTrack;
      return { r1, r2, events };
    });
    expect(r.r1.join(',')).toContain('_n|template'); // 字面 \n 规则命中
    expect(r.r2.join(',')).toContain('match-range|match'); // 匹配度越界命中
    const evt = r.events.find((e) => e.name === 'share_card_text_check_failed');
    expect(evt, '应上报 share_card_text_check_failed').toBeTruthy();
    expect(evt.payload.ratio).toBe('4:5');
    for (const key of ['failedRule', 'field', 'persona', 'locale', 'uaBucket']) {
      expect(typeof evt.payload[key], `payload.${key} 缺失`).toBe('string');
    }
  });
});

test.describe('内容断言回归(E3: 16 人格 × 2 比例 + 溢出断言)', () => {
  for (const file of files) {
    test(`${file}: 16 人格 × 9:16/4:5 全过(含 share_card_overflow 断言)`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      const r = await page.evaluate(async () => {
        const W = window as any;
        const out: any[] = [];
        for (const p of W.RESULTS.results) {
          for (const ratio of ['9:16', '4:5']) {
            let ok = true, err = '';
            try {
              await W.generateShareCard(p, 87, ratio, 2, 0);
            } catch (e: any) {
              ok = false;
              err = String(e.message || e).slice(0, 80);
            }
            out.push({ word: p.word, ratio, ok, err });
          }
        }
        return out;
      });
      for (const x of r) {
        expect(x.ok, `${file} ${x.word} ${x.ratio} 失败: ${x.err}`).toBe(true);
      }
    });
  }
});
