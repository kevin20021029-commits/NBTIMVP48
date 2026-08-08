/* 事件接收 API:浏览器 sendBeacon → 本函数 → Supabase events 表
 * 部署:Vercel 自动识别 /api 目录,无需配置路由
 * 环境变量(在 Vercel 项目设置里配置,严禁放进前端代码):
 *   SUPABASE_URL           形如 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   service_role key
 * 地域:从 Vercel 请求头免费获取 x-vercel-ip-country / x-vercel-ip-city
 * 已知取舍:无鉴权/限频(白名单只限事件名),小项目可接受;若被灌水再按 IP 限频。
 */
const { createClient } = require('@supabase/supabase-js');

/* 事件名白名单:防止机器人灌垃圾数据;新增事件时在此追加 */
const ALLOWED_EVENTS = new Set([
  'page_view',
  'test_start',
  'test_completed',
  'deep_dive_expand_click',
  'deep_dive_qrcode_click',
  'share_card_generate_start',
  'share_card_generate_success',
  'share_card_generate_failed',
  /* 应用原有 track() 事件(经升级后的 track() 同样入库) */
  'deep_dive_preview_view',
  'deep_dive_unlock_click',
  'deep_dive_app_open_success',
  'share_card_click_from_friend',
  'share_card_generate',
  'share_card_download',
  /* 前端 DOM 契约自检:分享卡关键节点缺失时上报(生产静默) */
  'share_dom_missing',
  /* 漏斗补齐:进度(maxQ+每题耗时)/分享卡归因落地/归因转化 */
  'test_progress',
  'ref_landing',
  'ref_convert',
  /* 导出遥测:重试/降级级别/比例切换/微信长按兜底 */
  'share_card_retry',
  'share_card_fallback_used',
  'card_ratio_switch',
  'share_card_longpress_shown',
  /* 内容断言失败(白图/缺图/文字缺失/溢出) */
  'share_card_content_check_failed',
  'share_card_text_check_failed',
  'share_card_overflow',
  /* 全局运行时错误上报(error + unhandledrejection) */
  'js_runtime_error',
  /* 编码格式降级(WebP 不支持 → JPEG q92) */
  'export_format_fallback'
]);

/* CORS:生产同源(页面与 API 同在 vercel.app)不需要;但 file:// 打开页面或镜像域名时,
 * sendBeacon 携带 application/json Blob 会先发 OPTIONS 预检——必须放行,否则事件静默丢失 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY
);

const clean = (s, max) => (typeof s === 'string' && s.trim() ? s.slice(0, max) : null);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.set(CORS); return res.status(204).end(); }
  if (req.method !== 'POST') { res.set(CORS); return res.status(405).json({ ok: false }); }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    res.set(CORS);
    return res.status(400).json({ ok: false });
  }
  /* 防 JSON.parse('null'|'[]'|数字) 等畸形体:缺 event_name 时直接 400,不抛未捕获 TypeError */
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.set(CORS);
    return res.status(400).json({ ok: false });
  }
  if (!ALLOWED_EVENTS.has(body.event_name)) {
    /* K2b: 非白名单事件不再静默丢弃 — server log + 入库 rejected_event(当天可见, 修白名单遗漏) */
    console.error('[event] rejected:', JSON.stringify({ name: body.event_name, lang: body.lang || null, ua: clean(body.ua, 120) }));
    try {
      await supabase.from('events').insert({
        event_name: 'rejected_event',
        user_id: clean(body.user_id, 64),
        test_version: clean((body.params && body.params.test_version) || null, 20),
        lang: clean(body.lang, 8),
        page: clean(body.page, 40),
        url: clean(body.url, 500),
        ua: clean(body.ua, 300),
        params: { rejected: body.event_name, reason: 'not_whitelisted' }
      });
    } catch (e) {
      console.error('[event] rejected insert failed:', e.message);
    }
    res.set(CORS);
    return res.status(400).json({ ok: false, rejected: body.event_name });
  }

  const params = (body.params && typeof body.params === 'object') ? body.params : {};
  const row = {
    event_name: body.event_name,
    user_id: clean(body.user_id, 64),
    test_version: clean(params.test_version, 20),
    persona_result: clean(params.persona_result, 40),
    lang: clean(body.lang, 8),
    page: clean(body.page, 40),
    url: clean(body.url, 500),
    country: clean(req.headers['x-vercel-ip-country'], 8),
    city: clean(req.headers['x-vercel-ip-city'], 64),
    ua: clean(body.ua, 300),
    params
  };

  const { error } = await supabase.from('events').insert(row);
  if (error) {
    console.error('[event] supabase insert failed:', error.message);
    res.set(CORS);
    return res.status(500).json({ ok: false, error: error.message });
  }
  res.set(CORS);
  return res.status(200).json({ ok: true });
};
