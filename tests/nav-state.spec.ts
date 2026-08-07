/**
 * I1-2 导航状态机回归: 8 场景 × 3 语言 + hash-视图一致性断言 + shared 降级负例
 *
 * 背景: BUG-I1 语言切换后被强制拉回结果页 — 根因 goHome 不清 hash,
 * buildLangUrl(740) 把 #result= 带进新页 → restoreFromHash 命中 → 结果页。
 * 修复: setView 集中管理视图与 hash(home/quiz 清 hash, result 保留);离开结果页即清。
 *
 * 运行: npm run test:dom
 * 依赖: playwright.config.ts webServer(8899)
 */
import { test, expect } from '@playwright/test';
import { readdirSync } from 'fs';
import { join } from 'path';

const files = readdirSync(join(__dirname, '..'))
  .filter((f) => /^index(?:-en|-hk)?\.html$/.test(f))
  .sort();

/* 外网不可达:拦截非本地请求 */
async function blockExternal(page: import('@playwright/test').Page) {
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('http') && !u.includes('localhost') && !u.includes('127.0.0.1')) return route.abort();
    return route.continue();
  });
}

/* hash-视图一致性: home/quiz → hash 空; result → #result= 存在 */
async function assertHashViewConsistent(page: import('@playwright/test').Page, expectedView: 'home' | 'quiz' | 'result') {
  const st = await page.evaluate(() => {
    const active = document.querySelector('#app section.active');
    const id = active ? active.id : '';
    const hash = location.hash;
    const view = id === 'page-home' ? 'home' : id === 'page-result' ? 'result' : id === 'page-quiz' || id === 'page-loading' ? 'quiz' : 'unknown';
    return { id, hash, view };
  });
  expect(st.view, `视图应为 ${expectedView}, 实际 ${st.view}(${st.id})`).toBe(expectedView);
  if (expectedView === 'result') {
    expect(st.hash, '结果页必须有 #result=').toMatch(/^#result=/);
  } else {
    expect(st.hash, 'home/quiz 下 hash 必须为空').toBe('');
  }
}

/* 完成测试到结果页(直接调 renderResult 模拟, 与生产 finish 链同出口) */
async function reachResult(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const W = window as any;
    const p = W.RESULTS.results[0];
    W.renderResult(p, { code: p.code, match: 87, edges: [] });
  });
}

/* 答题 N 题(点击选项, 触发 saveProgress) */
async function answerQuestions(page: import('@playwright/test').Page, n: number) {
  await page.evaluate(() => (window as any).startQuiz());
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      const opt = document.querySelector('#q-options .opt') as HTMLElement; // 选项按钮是 .opt
      if (opt) opt.click(); // choose() 内 300-500ms 后自动 advance
    });
    await page.waitForTimeout(700); // 等 advance 定时器
  }
}

test.describe('I1-2 导航状态机', () => {
  for (const file of files) {
    const lang = file === 'index.html' ? 'zh' : file === 'index-hk.html' ? 'hk' : 'en';
    const langFile = (t: string) => t === 'zh' ? 'index.html' : t === 'hk' ? 'index-hk.html' : 'index-en.html';

    test(`${file}: 场景1 答题中切语言 → 保留进度停在新语言对应题`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await answerQuestions(page, 8);
      await assertHashViewConsistent(page, 'quiz');
      // 切语言(点击 lang-option → 整页跳转 + resume=1)
      await Promise.all([
        page.waitForNavigation(),
        page.click(`a[data-lang="${lang === 'zh' ? 'hk' : 'zh'}"]`)
      ]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'quiz');
      const q = await page.evaluate(() => (window as any).current + 1);
      expect(q).toBeGreaterThanOrEqual(8); // 进度保留(续答到第 8 题或之后)
      expect(await page.evaluate(() => (window as any).userAnswers.length)).toBeGreaterThanOrEqual(8);

    });

    test(`${file}: 场景2 结果页切语言 → 停在新语言结果页`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await reachResult(page);
      await assertHashViewConsistent(page, 'result');
      await Promise.all([
        page.waitForNavigation(),
        page.click(`a[data-lang="${lang === 'en' ? 'zh' : 'en'}"]`)
      ]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'result'); // 结果页 hash 跨语言传递 ✓
      expect(page.url()).toMatch(/#result=/);
    });

    test(`${file}: 场景3 首页切语言 → 停在新语言首页`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'home');
      await Promise.all([
        page.waitForNavigation(),
        page.click(`a[data-lang="${lang === 'hk' ? 'zh' : 'hk'}"]`)
      ]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'home'); // 核心 bug 修复: 不再被拉回结果页
    });

    test(`${file}: 场景4 结果页→返回首页→重新开始 → 第1题 + hash 空`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await reachResult(page);
      await page.evaluate(() => (window as any).goHome());
      await assertHashViewConsistent(page, 'home');
      await page.evaluate(() => (window as any).startQuiz());
      await assertHashViewConsistent(page, 'quiz');
      const q = await page.evaluate(() => (window as any).current + 1);
      expect(q).toBe(1); // 旧答案已清, 从第 1 题开始
      expect(await page.evaluate(() => (window as any).userAnswers.length)).toBe(0);
    });

    test(`${file}: 场景5 结果页→返回首页→刷新 → 停在首页`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await reachResult(page);
      await page.evaluate(() => (window as any).goHome());
      await assertHashViewConsistent(page, 'home');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'home'); // 刷新后仍首页(旧 bug: hash 残留被拉回结果页)
    });

    test(`${file}: 场景6 深度解读展开→切语言 → 新语言结果页 + 深度解读干净态`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await reachResult(page);
      await page.evaluate(() => {
        const W = window as any;
        if (W.unlockDeepDive) W.unlockDeepDive();
      });
      await Promise.all([
        page.waitForNavigation(),
        page.click(`a[data-lang="${lang === 'hk' ? 'zh' : 'hk'}"]`)
      ]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'result');
      // 深度解读干净态: dd-locked 未解锁, 无残留半展开/空白
      const dd = await page.evaluate(() => {
        const locked = document.querySelector('.dd-locked');
        return {
          exists: !!locked,
          unlocked: locked ? locked.classList.contains('unlocked') : null
        };
      });
      expect(dd.exists, '深度解读容器应存在').toBe(true);
      expect(dd.unlocked, '切语言后必须回到未展开初始态').toBe(false);
    });

    test(`${file}: 场景7 分享弹窗打开→切语言 → 无弹窗残留 + body 可滚动`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await reachResult(page);
      await page.evaluate(() => {
        const W = window as any;
        if (W.openSharePreview) W.openSharePreview();
      });
      // 弹窗打开时切换器被遮罩挡住, 真实用户需先关弹窗 — 此处用 evaluate 强制点击验证跳转后无残留
      await Promise.all([
        page.waitForNavigation(),
        page.evaluate((sel) => { const a = document.querySelector(sel); if (a) a.click(); }, `a[data-lang="${lang === 'en' ? 'hk' : 'en'}"]`)
      ]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      // 新页无弹窗残留 + body 滚动解锁
      const st = await page.evaluate(() => {
        const m = document.getElementById('sharePreviewModal');
        return {
          modalShown: m ? m.classList.contains('show') : false,
          bodyOverflow: document.body.style.overflow
        };
      });
      expect(st.modalShown, '切语言后弹窗不得残留').toBe(false);
      expect(st.bodyOverflow, 'body 滚动不得被锁').toBe('');
    });

    test(`${file}: 场景8 答题中切语言→切回 → 进度仍正确(双向)`, async ({ page }) => {
      await blockExternal(page);
      await page.goto(`/${file}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await answerQuestions(page, 5);
      // 切到另一语言
      const other = lang === 'zh' ? 'hk' : 'zh';
      await Promise.all([page.waitForNavigation(), page.click(`a[data-lang="${other}"]`)]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      // 切回原语言
      await Promise.all([page.waitForNavigation(), page.click(`a[data-lang="${lang}"]`)]);
      await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
      await assertHashViewConsistent(page, 'quiz');
      expect(await page.evaluate(() => (window as any).userAnswers.length)).toBeGreaterThanOrEqual(5);
    });
  }

  test('负例: 手动 #result=XXXX + 空 sessionStorage → shared 降级路径(好友结果 CTA)', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/index.html?lang=zh#result=RGHC-87', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).RESULTS && (window as any).RESULTS.results.length > 0);
    await page.evaluate(() => {
      try { sessionStorage.removeItem('nbti_last_result'); } catch (e) {}
      const W = window as any;
      W.__hashRestored = false;
      W.restoreFromHash();
    });
    const st = await page.evaluate(() => {
      const cta = document.querySelector('.friend-cta');
      return {
        ctaExists: !!cta,
        ctaText: cta ? cta.textContent : null,
        noShareBtn: !document.getElementById('btn-gen-share'),
        hash: location.hash
      };
    });
    expect(st.ctaExists, 'shared 路径必须显示好友结果 CTA').toBe(true);
    expect(st.ctaText).toContain('好友');
    expect(st.noShareBtn, 'shared 降级无匹配度, 不得出现生成分享卡按钮').toBe(true);
    expect(st.hash).toMatch(/^#result=/);
  });
});
