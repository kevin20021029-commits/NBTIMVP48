// shared/text-assert.js — 分享卡文本层断言(B7 R1/R2/R3, 双仓库共用)
// B4 后生产页不再内嵌 checkShareCardText; 断言逻辑单点维护于此,
// 构建脚本(build-cards.mjs)与测试(text-check.spec.ts)共同引用。
// 用法: 页面注入后 window.TextAssert.check(tpl, persona, match, ratio, locale) → string[]

(function (global) {
  'use strict';
  function check(tpl, persona, match, ratio, locale) {
    var fails = [];
    function fail(rule, field) { fails.push(rule + '|' + field); }
    /* R1: 模板 textContent 敏感串 */
    var R1 = ['\\n', 'undefined', 'NaN', 'null', '[object Object]', '{{', '}}'];
    var whole = tpl.textContent || '';
    for (var i = 0; i < R1.length; i++) {
      if (whole.indexOf(R1[i]) > -1) fail(R1[i].replace(/[^\w]/g, '_'), 'template');
    }
    function txt(sel) { var el = tpl.querySelector(sel); return el ? el.textContent : ''; }
    /* R2: 必填字段非空 */
    var required = { '.sc-name-main': 'name', '.sc-match-num': 'match', '.sc-tagline': 'tagline', '.sc-version': 'version' };
    for (var sel in required) { if (String(txt(sel)).trim() === '') fail('empty', required[sel]); }
    if (persona && persona.code && locale !== 'en') { if (String(txt('.sc-name-sub')).trim() === '') fail('empty', 'nameSub'); }
    /* R3: 匹配度 0-100 整数 + 指标值数字或白名单枚举 */
    var stats = tpl.querySelector('.sc-stats');
    if (stats && stats.style.display !== 'none') {
      var vals = stats.querySelectorAll('.sc-stat-val');
      for (var si = 0; si < vals.length; si++) {
        var sv = String(vals[si].textContent).trim();
        if (sv === '') { fail('empty', 'stat' + si); continue; }
        if (!/^\d{1,3}$/.test(sv) && ['MAX', 'MIN', '∞'].indexOf(sv) === -1) fail('stat-value', 'stat' + si);
      }
    }
    var mn = String(txt('.sc-match-num')).replace(/%/g, '').trim();
    if (!/^\d{1,3}$/.test(mn) || +mn < 0 || +mn > 100) fail('match-range', 'match');
    return fails;
  }
  global.TextAssert = { check: check };
})(typeof window !== 'undefined' ? window : globalThis);
