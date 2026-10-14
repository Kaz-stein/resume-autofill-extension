/**
 * serve.js —— 零依赖的本地静态服务器（只为测试用）
 *
 * 为什么需要它：
 *   Chrome/Edge 扩展默认无法访问 file:// 页面（需要用户手动勾选「允许访问文件网址」）。
 *   用 http://127.0.0.1 打开测试页，可以避免这个额外步骤，也更接近真实网站的加载方式。
 *
 * 用法：node test-fixture/serve.js   → 打开 http://127.0.0.1:8899/demo-form.html
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8899);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath === '/' ? 'demo-form.html' : urlPath);

    // 防目录穿越：确保解析后的路径仍在 test-fixture 目录内
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`测试服务器已启动：http://127.0.0.1:${PORT}/demo-form.html`);
    console.log('按 Ctrl+C 停止。');
  });
