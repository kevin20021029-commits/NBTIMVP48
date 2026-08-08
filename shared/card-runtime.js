// shared/card-runtime.js — 分享卡运行时模块(构建期预生成方案, 方案 1 真 alpha 切片)
// 部署: 与 index.html 同目录(Vercel 静态服务), 页面 <script type="module"> 动态引入
// 双仓库 byte-identical(shared-identity.spec.ts 校验)
// 预览与下载共用同一 Blob(exportCard 产出) — 「预览≠导出」结构性消除

export const CARD_TOKENS = {
  version: 1,
  manifestUrl: 'cards/v1/manifest.json',
  digitsDir: 'cards/v1/digits/',
  quality: 0.9,
  /* 数字区固定高度(与构建期 CSS 一致, 供 manifest 校验) */
  digitHeight: { '9:16': 83, '4:5': 69 }
};

let manifestCache = null;

/* ---------- manifest ---------- */
export async function loadManifest() {
  if (manifestCache) return manifestCache;
  const res = await fetch(CARD_TOKENS.manifestUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifest load failed: ' + res.status);
  manifestCache = await res.json();
  return manifestCache;
}

/* ---------- 图片加载 ---------- */
function loadImage(src) {
  return new Promise(function(resolve, reject) {
    const img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject(new Error('image load failed: ' + src)); };
    img.src = src;
  });
}

/* ---------- 底图 URL(manifest 校验) ---------- */
export async function loadCardImage(persona, locale, ratio) {
  const m = await loadManifest();
  const key = persona + '_' + locale + '_' + ratio;
  const card = m.cards[key];
  if (!card) throw new Error('card not in manifest: ' + key);
  return card.file;
}

/* ---------- 数字合成(真 alpha 切片 drawImage 到 matchRect) ---------- */
export async function composeMatchNumber(ctx, match, ratio, rect) {
  const m = await loadManifest();
  const digit = m.digits && m.digits[ratio] && m.digits[ratio][String(match)];
  if (!digit) throw new Error('digit slice missing: ' + ratio + '/' + match);
  /* digit.file 为相对 digits/ 的路径(如 '9x16/87.webp'), 保留 ratio 子目录 —— 两比例 match 号重叠, 扁平会碰撞 */
  const img = await loadImage(CARD_TOKENS.digitsDir + digit.file);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
}

/* ---------- 导出: 底图 + 数字 → WebP Blob(预览与下载同一份) ---------- */
export async function exportCard(persona, match, ratio, locale) {
  const m = await loadManifest();
  const key = persona + '_' + locale + '_' + ratio;
  const card = m.cards[key];
  if (!card) throw new Error('card not in manifest: ' + key);
  const t0 = performance.now();
  const base = await loadImage('cards/v1/' + card.file);
  const canvas = document.createElement('canvas');
  canvas.width = card.canvasW; canvas.height = card.canvasH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  await composeMatchNumber(ctx, match, ratio, card.matchRect);
  const blob = await new Promise(function(resolve, reject) {
    canvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/webp', CARD_TOKENS.quality);
  });
  return { blob, url: URL.createObjectURL(blob), matchRect: card.matchRect, canvasW: card.canvasW, canvasH: card.canvasH, renderMs: Math.round(performance.now() - t0) };
}

/* ---------- 预览弹窗(现有 HTML 骨架, 此处只绑定) ---------- */
export function mountShareModal() {
  /* 弹窗 HTML 已在 index.html(sharePreviewModal);事件由页面内联 onclick 绑定
     (closeSharePreview/retryShareGenerate 等保留);此函数为模块化入口, 预留 */
}

/* ---------- 打开预览(直接显示合成产物 Blob — 预览=下载 同一份字节) ---------- */
export function openSharePreview(blobUrl) {
  const img = document.getElementById('sharePreviewImg');
  const spin = document.getElementById('sharePreviewSpin');
  const dl = document.getElementById('sharePreviewDl');
  if (img) { img.src = blobUrl; img.style.display = ''; }
  if (spin) spin.className = 'share-preview-spin';
  if (dl) { dl.style.display = ''; dl.textContent = '下载分享图'; }
  const m = document.getElementById('sharePreviewModal');
  if (m) { m.classList.add('show'); m.classList.remove('hide'); document.body.style.overflow = 'hidden'; }
}

/* ---------- 下载(同一 Blob URL) ---------- */
export function downloadCard(blobUrl) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'neuralfin-nbti-share-card.webp';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
