import { defineConfig } from '@playwright/test';

/**
 * 浏览器级测试需要本地 server(生产 HTML 内嵌资源 fetch + html2canvas 渲染)。
 * NBTI16 用 8899;NBTI48 用 8898(reuseExistingServer 允许复用已启动的实例)。
 * 纯文件断言(dom-contract / asset-contract)不依赖此配置,但共用同一入口。
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 120000,
  webServer: {
    command: 'python -m http.server 8898 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8898/index.html',
    reuseExistingServer: true,
    timeout: 15000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8898',
  },
});
