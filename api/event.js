/* 事件接收 API:浏览器 sendBeacon → 本函数 → Supabase events 表
 * 部署:Vercel 自动识别 /api 目录,无需配置路由
 * 环境变量(在 Vercel 项目设置里配置,严禁放进前端代码):
 *   SUPABASE_URL           形如 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   service_role key
 * 地域:从 Vercel 请求头免费获取 x-vercel-ip-country / x-vercel-ip-city
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
  'share_card_download'
]);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY
);

const clean = (s, max) => (typeof s === 'string' ? s.slice(0, max) : null);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ ok: false });
  }
  if (!ALLOWED_EVENTS.has(body.event_name)) return res.status(400).json({ ok: false });

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
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true });
};
