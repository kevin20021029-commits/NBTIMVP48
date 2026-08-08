#!/usr/bin/env node
/**
 * build:cards — 分享卡构建期预生成管线（L4 重建）
 *
 * 依据 docs/architecture-card-prerender.md（H-P4 设计）+ B1/B2/B3 实测。
 * 硬性要求：
 *   a. per-page 预热（首帧截图 hash 随机已实证 → 预热后 10/10 字节唯一）
 *   b. 数字切片真 alpha：独立透明页 + computed style 拷贝 + omitBackground:true
 *   c. 底图不含匹配度数字（visibility:hidden），匹配度/Match 标签留在底图上
 *   d. --only=<persona>[,<locale>][,<ratio>] 增量构建（单卡 <3s）
 *   e. manifest 含每张 sha256 + matchRect
 *
 * 用法：
 *   npm run build:cards -- --repo nbti16            # 全量 108 张 + 62 切片
 *   npm run build:cards -- --repo nbti16 --only=SNIPER,zh,9:16
 *   npm run build:cards -- --repo nbti16 --update-baseline
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── 参数 ──
const args = process.argv.slice(2);
function arg(name, def) {
  // 兼容 --name=value 与 --name value 两种写法（package.json script 用空格分隔）
  const eq = args.find((x) => x.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf('--' + name);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) return args[i + 1];
  return def;
}
const repo = arg('repo', 'nbti16');
const port = parseInt(arg('port', repo === 'nbti16' ? '8899' : '8898'), 10);
const only = arg('only', null); // persona[,locale][,ratio]
const updateBaseline = args.includes('--update-baseline');
const forceSlices = args.includes('--force-slices');

const LOCALES = ['zh', 'en', 'hk'];
const LOCALE_FILE = { zh: 'index.html', en: 'index-en.html', hk: 'index-hk.html' };
const RATIOS = ['9:16', '4:5'];
const RATIO_DIR = { '9:16': '9x16', '4:5': '4x5' };
const TWO_DIGIT = Array.from({ length: 30 }, (_, i) => 70 + i); // 70..99
const SLICE_MATCHES = [...TWO_DIGIT, 100];
const NORMAL_MATCH = 87; // 2 位占位（70-99 宽度一致，见实测）
const EGG_MATCH = 100;   // 彩蛋固定 100

const V1 = join(ROOT, 'cards', 'v1');
const DIGITS = join(V1, 'digits');
const MANIFEST = join(V1, 'manifest.json');
const BASELINE = join(ROOT, 'cards', 'baseline', 'manifest.json');

// --only 解析
let onlyP = null, onlyL = null, onlyR = null;
if (only) {
  const p = only.split(',');
  onlyP = p[0] || null;
  onlyL = p[1] || null;
  onlyR = p[2] || null;
}

const stats = { cards: 0, slices: 0, skipped: 0, failed: [] };

// ── 静态服务器（零仓库外依赖） ──
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${port}`;

// ── 页面实例准备 ──
const browser = await chromium.launch();

/** 创建指定 locale 的页面（DPR=2），加载并等待数据就绪，做 per-page 预热 */
async function createLocalePage(locale, personas, eggs) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
  // 禁用页面语言分流重定向（index-en/hk 的 IIFE 基于 navigator.languages；headless 默认 zh 会把 en/hk 踢回 zh）。
  // 真实用户：英文浏览器 detectLang()='en'=CURRENT_LANG 不会跳；中文浏览器跳 zh 是设计行为。headless 撞边界 → 用 nbti_redirect_done 短路。
  await page.addInitScript(() => { try { sessionStorage.setItem('nbti_redirect_done', '1'); } catch (e) {} });
  await page.goto(`${baseURL}/${LOCALE_FILE[locale]}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RESULTS && window.RESULTS.results.length > 0);
  // 注入共享断言单点（构建脚本与测试共用 shared/text-assert.js）
  await page.addScriptTag({ url: '/shared/text-assert.js' }).catch(() => {});
  // per-page 预热：渲染 + 截图 1 次丢弃（规避首帧截图边界噪声）
  const warm = personas[0] || eggs[0];
  if (warm) {
    await bindAndPrep(page, locale, warm.word, '9:16', NORMAL_MATCH);
    const tpl = page.locator('#shareCardTemplate916');
    await tpl.screenshot({ type: 'webp', quality: 90 }).catch(() => {});
  }
  return page;
}

/** 绑定 + 三层断言 + 测 matchRect + 隐藏数字区；返回绑定后的模板信息 */
async function bindAndPrep(page, locale, word, ratio, match) {
  return page.evaluate(async ({ word, ratio, match, tplId }) => {
    const W = window;
    const tpl = document.getElementById(tplId);
    tpl.style.left = '0px';
    tpl.style.top = '0px';
    // 遮挡应用主体与底部 ticker，防截图重叠（ticker 无限滚动动画 → 截图非确定性主源）
    const app = document.getElementById('app');
    const appPrev = app ? app.style.display : null;
    if (app) app.style.display = 'none';
    const ticker = document.getElementById('ticker');
    const tickerPrev = ticker ? ticker.style.display : null;
    if (ticker) ticker.style.display = 'none';
    // 找 persona（普通 or 彩蛋）
    let persona = W.RESULTS.results.find((p) => p.word === word);
    if (!persona) {
      const egg = Object.keys(W.EGG_MAP).map((k) => W.EGG_MAP[k]).find((e) => e.word === word);
      const meta = W.RESULTS.easterEggs && W.RESULTS.easterEggs[egg.key];
      persona = { word: egg.word, name: meta && meta.persona ? meta.persona : egg.word, tagline: meta && meta.note ? meta.note : '' };
    }
    W.bindShareCard(tpl, persona, match, ratio);
    // 三层断言（页面函数原样执行；overflow 无独立函数，见 L4 汇报）
    const fails = [];
    try {
      if (typeof W.assertShareDom === 'function') {
        const m = W.assertShareDom();
        if (m !== true) fails.push('dom:' + String(m)); // assertShareDom 成功返回 true
      }
    } catch (e) { fails.push('dom:' + (e && e.message)); }
    if (W.TextAssert) {
      const tf = W.TextAssert.check(tpl, persona, match, ratio, W.CURRENT_LANG);
      if (tf && tf.length) fails.push('text:' + tf.join(','));
    }
    if (fails.length) return { ok: false, fails };
    // 测量可见 .sc-match-num 的 rect（scale 2 画布像素）
    const visible = [...tpl.querySelectorAll('.sc-match-block')].find((b) => getComputedStyle(b).display !== 'none');
    const num = visible ? visible.querySelector('.sc-match-num') : null;
    const tr = tpl.getBoundingClientRect();
    let matchRect = null;
    if (num) {
      const nr = num.getBoundingClientRect();
      matchRect = {
        x: Math.round((nr.x - tr.x) * 2),
        y: Math.round((nr.y - tr.y) * 2),
        w: Math.round(nr.width * 2),
        h: Math.round(nr.height * 2),
      };
    }
    // 隐藏数字区（底图不含匹配度数字；label 留在底图）
    tpl.querySelectorAll('.sc-match-num').forEach((n) => { n.style.visibility = 'hidden'; });
    return {
      ok: true,
      matchRect,
      canvasW: Math.round(tr.width * 2),
      canvasH: Math.round(tr.height * 2),
      appPrev,
      isEgg: !persona.code,
    };
  }, { word, ratio, match, tplId: ratio === '4:5' ? 'shareCardTemplate45' : 'shareCardTemplate916' });
}

/** 构建单张底图 */
async function buildCard(page, locale, word, ratio, match) {
  const t0 = Date.now();
  const prep = await bindAndPrep(page, locale, word, ratio, match);
  if (!prep.ok) return { ok: false, err: prep.fails.join('; ') };
  // 等待角色图加载 + coverFit 完成（图片加载时机是截图非确定性的主要来源）
  await page.waitForFunction(({ tplId }) => {
    const tpl = document.getElementById(tplId);
    const char = tpl && tpl.querySelector('.share-card-character');
    if (!char || char.style.display === 'none') return true;
    return char.complete && char.naturalWidth > 0;
  }, { tplId: ratio === '4:5' ? 'shareCardTemplate45' : 'shareCardTemplate916' }).catch(() => {});
  // 文件名不用 ':'（Windows 保留字符，会被当 ADS 截断）→ 用 'x'；manifest key 仍用 '9:16' 语义
  const file = `${word}_${locale}_${ratio.replace(':', 'x')}.webp`;
  const outPath = join(V1, file);
  mkdirSync(V1, { recursive: true });
  const tpl = page.locator(ratio === '4:5' ? '#shareCardTemplate45' : '#shareCardTemplate916');
  await tpl.screenshot({ path: outPath, type: 'webp', quality: 90 });
  const bytes = readFileSync(outPath);
  const pixelSha256 = createHash('sha256').update(bytes).digest('hex');
  const renderMs = Date.now() - t0;
  return {
    ok: true,
    entry: {
      persona: word, locale, ratio,
      file,
      pixelSha256,
      bytes: bytes.length,
      format: 'image/webp',
      canvasW: prep.canvasW, canvasH: prep.canvasH, scale: 2,
      matchRect: prep.matchRect,
      isEgg: prep.isEgg,
    },
    renderMs, bytes: bytes.length,
  };
}

// ── 收集各 locale 的 personas/eggs（过滤 --only） ──
const comboPlan = [];
for (const locale of LOCALES) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
  await page.goto(`${baseURL}/${LOCALE_FILE[locale]}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RESULTS && window.RESULTS.results.length > 0);
  const data = await page.evaluate(() => {
    const W = window;
    const personas = W.RESULTS.results.map((p) => p.word);
    const eggs = Object.keys(W.EGG_MAP).map((k) => W.EGG_MAP[k].word);
    return { personas, eggs };
  });
  await page.close();
  for (const word of [...data.personas, ...data.eggs]) {
    for (const ratio of RATIOS) {
      if (onlyP && word !== onlyP) continue;
      if (onlyL && locale !== onlyL) continue;
      if (onlyR && ratio !== onlyR) continue;
      const isEgg = data.eggs.includes(word);
      comboPlan.push({ locale, word, ratio, match: isEgg ? EGG_MATCH : NORMAL_MATCH, isEgg });
    }
  }
}

// ── 构建底图 ──
const manifestCards = {};
const builtCards = [];
for (const locale of LOCALES) {
  const wordsForLocale = [...new Set(comboPlan.filter((c) => c.locale === locale).map((c) => c.word))];
  if (!wordsForLocale.length) continue;
  const page = await createLocalePage(locale, wordsForLocale.map((w) => ({ word: w })), wordsForLocale.map((w) => ({ word: w })));
  for (const combo of comboPlan.filter((c) => c.locale === locale)) {
    // 调整视口适配比例
    if (combo.ratio === '9:16') await page.setViewportSize({ width: 1080, height: 1920 });
    else await page.setViewportSize({ width: 1080, height: 1350 });
    const res = await buildCard(page, combo.locale, combo.word, combo.ratio, combo.match);
    if (res.ok) {
      manifestCards[`${combo.word}_${combo.locale}_${combo.ratio}`] = res.entry;
      builtCards.push(res.entry);
      stats.cards++;
      console.log(`  [OK] ${combo.word}_${combo.locale}_${combo.ratio}  ${res.bytes}B  ${res.renderMs}ms`);
    } else {
      stats.failed.push(`${combo.word}_${combo.locale}_${combo.ratio}: ${res.err}`);
      console.log(`  [FAIL] ${combo.word}_${combo.locale}_${combo.ratio}: ${res.err}`);
    }
  }
  await page.close();
}

// ── 数字切片（31 × 2 套，真 alpha：独立透明页 + computed style 拷贝 + omitBackground） ──
const manifestDigits = { '9:16': {}, '4:5': {} };
async function buildSlices(ratios, force) {
  for (const ratio of ratios) {
    const slicePage = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 2 });
    await slicePage.setContent('<body style="background:transparent;margin:0"></body>');
    // 从 zh 页面取 .sc-match-num 的 computed style（fontSize 依比例）
    const srcPage = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await srcPage.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
    await srcPage.waitForFunction(() => window.RESULTS);
    const styles = await srcPage.evaluate((ratio) => {
      const tpl = document.getElementById(ratio === '4:5' ? 'shareCardTemplate45' : 'shareCardTemplate916');
      window.bindShareCard(tpl, window.RESULTS.results[0], 87, ratio);
      const num = tpl.querySelector('.sc-match-num');
      const pct = num.querySelector('.sc-match-pct');
      const cs = (el) => {
        const s = getComputedStyle(el);
        // computed style 返回 camelCase 属性名，内联 style 需 kebab-case（否则浏览器忽略）
        return ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'letterSpacing', 'whiteSpace', 'fontStyle', 'fontVariant']
          .map((k) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${s[k]}`);
      };
      return { num: cs(num), pct: pct ? cs(pct) : [] };
    }, ratio);
    await srcPage.close();
    // 灰度 AA 统一（B1-REV2 硬性约束：切片与卡片同为灰度抗锯齿；index.html CSS 尚未加，构建侧强制）
    // 属性转义：font-family 计算值含双引号，会截断双引号包裹的 style 属性
    const esc = (s) => s.replace(/"/g, '&quot;');
    const numCss = esc(styles.num.join(';') + ';-webkit-font-smoothing:antialiased;');
    const pctCss = esc(styles.pct.join(';'));
    for (const match of SLICE_MATCHES) {
      const rel = `${RATIO_DIR[ratio]}/${match}.webp`;
      const outPath = join(DIGITS, rel);
      if (existsSync(outPath) && !force) { stats.skipped++; continue; }
      mkdirSync(join(DIGITS, RATIO_DIR[ratio]), { recursive: true });
      // 独立透明页注入数字元素（computed style 全量拷贝 + flex-end 容器复刻原生对齐）
      await slicePage.setContent(
        `<body style="background:transparent;margin:0"><div style="display:flex;align-items:flex-end;min-height:200px">` +
        `<span class="sc-match-num" style="${numCss}">${match}<span class="sc-match-pct" style="${pctCss}">%</span></span>` +
        `</div></body>`
      );
      const el = slicePage.locator('.sc-match-num');
      await el.screenshot({ path: outPath, type: 'webp', quality: 90, omitBackground: true });
      const bytes = readFileSync(outPath).length;
      manifestDigits[ratio][String(match)] = { file: rel };
      stats.slices++;
      console.log(`  [SLICE] ${rel}  ${bytes}B`);
    }
    await slicePage.close();
  }
}
// 全量：两个 ratio；增量(--only)：仅 comboPlan 涉及的 ratio；缺失切片自动补建
await buildSlices([...new Set((onlyP ? comboPlan : RATIOS).map((c) => (typeof c === 'string' ? c : c.ratio)))], forceSlices);

// ── manifest（增量合并） ──
let prev = {};
if (existsSync(MANIFEST)) { try { prev = JSON.parse(readFileSync(MANIFEST, 'utf-8')); } catch {} }
const mergedCards = { ...(prev.cards || {}), ...manifestCards };
const mergedDigits = {
  '9:16': { ...(prev.digits && prev.digits['9:16']), ...manifestDigits['9:16'] },
  '4:5': { ...(prev.digits && prev.digits['4:5']), ...manifestDigits['4:5'] },
};
const allHashes = Object.values(mergedCards).map((c) => c.pixelSha256).sort();
const aggregate = createHash('sha256').update(allHashes.join('')).digest('hex');
const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  cards: mergedCards,
  digits: mergedDigits,
  baseline: aggregate,
};
mkdirSync(V1, { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

// ── 基线 diff ──
if (existsSync(BASELINE) && !updateBaseline) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf-8'));
  const changed = [];
  for (const key of Object.keys(manifest.cards)) {
    const cur = manifest.cards[key].pixelSha256;
    const old = base.cards && base.cards[key] && base.cards[key].pixelSha256;
    if (old && old !== cur) changed.push(`${key} ${old.slice(0, 8)}→${cur.slice(0, 8)}`);
  }
  if (changed.length) {
    console.log(`\n[baseline] ${changed.length} 张与基线不一致:`);
    changed.forEach((c) => console.log('  ' + c));
    console.log('[baseline] 需 --update-baseline 接受，或修复回归。');
  } else {
    console.log(`\n[baseline] ${Object.keys(manifest.cards).length} 张全部与基线一致。`);
  }
}
if (updateBaseline) {
  mkdirSync(join(ROOT, 'cards', 'baseline'), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(manifest, null, 2) + '\n');
  console.log('[baseline] 已更新 baseline/manifest.json');
}

// ── 摘要 ──
console.log(`\n[build:cards] repo=${repo} 总底图=${stats.cards} 切片=${stats.slices} 跳过=${stats.skipped} 失败=${stats.failed.length}`);
if (stats.failed.length) {
  console.log('[build:cards] 失败清单:');
  stats.failed.forEach((f) => console.log('  ' + f));
}
console.log(`[build:cards] manifest: ${MANIFEST} (cards=${Object.keys(mergedCards).length}, baseline=${aggregate.slice(0, 16)}…)`);

await browser.close();
server.close();
process.exit(stats.failed.length ? 1 : 0);
