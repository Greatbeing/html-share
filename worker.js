/**
 * HTML Share Worker v2
 * 支持社交平台链接预览（og:meta 标签）
 * 
 * 核心机制：
 * 1. 保存 HTML 时，同时保存 title/description/preview_image
 * 2. 爬虫访问时，返回带 og:meta 标签的 HTML（含预览图）
 * 3. 普通浏览器访问时，返回原始 HTML 内容
 */

// 常见爬虫 User-Agent 关键词
const CRAWLER_PATTERNS = [
  'facebookexternalhit', 'Facebot', 'Twitterbot', 'twitter',
  'LinkedInBot', 'Slackbot', 'TelegramBot', 'WhatsApp',
  'Discordbot', 'Googlebot', 'Baiduspider', 'bingbot',
  'MSNBot', 'YandexBot', 'Sogou', '360Spider', 'Bytespider',
  'ToutiaoSpider', 'WeChat', 'MicroMessenger', 'wechat',
  'Google-InspectionTool', 'meta-externalagent',
  'fetch', 'curl', 'python-requests', 'Go-http-client',
  'Java/', 'Apache-HttpClient'
];

function isCrawler(ua) {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return CRAWLER_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

// 从 HTML 中提取 title
function extractTitle(html) {
  // 尝试 <title> 标签
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    return titleMatch[1].trim().substring(0, 100);
  }
  // 尝试 <h1> 标签
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1].trim()) {
    return h1Match[1].replace(/<[^>]*>/g, '').trim().substring(0, 100);
  }
  return 'HTML 分享内容';
}

// 从 HTML 中提取纯文本描述
function extractDescription(html) {
  // 移除 script/style 标签
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // 移除所有 HTML 标签
  text = text.replace(/<[^>]*>/g, '');
  // 解码 HTML 实体
  text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // 去除多余空白
  text = text.replace(/\s+/g, ' ').trim();
  // 截取前 200 字符
  return text.substring(0, 200) || '点击查看完整内容';
}

// 生成爬虫预览页（含 og:meta 标签）
function generatePreviewHTML(title, description, previewImageUrl, originalUrl, htmlContent) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>

<!-- Open Graph / Facebook -->
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${previewImageUrl ? `<meta property="og:image" content="${previewImageUrl}">` : ''}
${previewImageUrl ? `<meta property="og:image:width" content="1200">` : ''}
${previewImageUrl ? `<meta property="og:image:height" content="630">` : ''}
<meta property="og:url" content="${originalUrl}">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${previewImageUrl ? `<meta name="twitter:image" content="${previewImageUrl}">` : ''}

<!-- 微信 / 其他 -->
<meta itemprop="name" content="${escapeHtml(title)}">
<meta itemprop="description" content="${escapeHtml(description)}">
${previewImageUrl ? `<meta itemprop="image" content="${previewImageUrl}">` : ''}

<style>
body { margin: 0; padding: 0; }
.redirect-hint {
  display: flex; align-items: center; justify-content: center;
  height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5; color: #333; flex-direction: column; gap: 12px;
}
.redirect-hint a { color: #6366f1; text-decoration: none; font-size: 18px; font-weight: 600; }
.redirect-hint p { font-size: 14px; color: #666; }
</style>

<script>
// 如果是普通浏览器（爬虫检测误判），自动跳转到原始内容
(function(){
  var ua = navigator.userAgent.toLowerCase();
  var isBot = ${JSON.stringify(CRAWLER_PATTERNS.map(p => p.toLowerCase()))}.some(function(p){ return ua.indexOf(p) !== -1; });
  if(!isBot) {
    // 普通浏览器，显示原始 HTML 内容
    document.documentElement.innerHTML = decodeURIComponent("${encodeURIComponent(htmlContent)}");
  }
})();
</script>
</head>
<body>
<div class="redirect-hint">
  <p>${escapeHtml(title)}</p>
  <a href="${originalUrl}">点击查看完整内容</a>
</div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const ua = request.headers.get('User-Agent') || '';
    const isBot = isCrawler(ua);

    try {
      // ?v=xxxxx → 查看/分享短码
      if (path === '/' && url.searchParams.has('v')) {
        return handleViewShortcode(url.searchParams.get('v'), env, url, isBot, ua);
      }

      // /s/xxxxx → 短链接格式
      const shortMatch = path.match(/^\/s\/([a-zA-Z0-9_-]+)$/);
      if (shortMatch) {
        return handleViewShortcode(shortMatch[1], env, url, isBot, ua);
      }

      // 首页
      if (path === '/') {
        return handleIndex(env);
      }

      // 获取短码内容（API，直接返回 HTML）
      const apiMatch = path.match(/^\/api\/v\/([a-zA-Z0-9_-]+)$/);
      if (apiMatch) {
        return handleViewRaw(apiMatch[1], env);
      }

      // 保存 HTML（含预览信息）
      if (path === '/api/save' && request.method === 'POST') {
        return handleSave(request, env, url);
      }

      // 上传预览图
      if (path === '/api/upload-preview' && request.method === 'POST') {
        return handleUploadPreview(request, env, url);
      }

      // 获取预览图
      const imgMatch = path.match(/^\/api\/preview\/([a-zA-Z0-9_-]+)$/);
      if (imgMatch) {
        return handleGetPreview(imgMatch[1], env);
      }

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return new Response('Internal Error: ' + e.message, { status: 500 });
    }
  },
};

async function handleIndex(env) {
  try {
    const page = await env.HTML_SHARE.get('index', { type: 'text' });
    if (page) {
      return new Response(page, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200
      });
    }
  } catch (e) {}
  return new Response('<h1>HTML Share Tool</h1><p>请通过前端工具访问</p>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function handleViewShortcode(code, env, url, isBot, ua) {
  try {
    // 从 KV 获取元数据
    const metaJson = await env.HTML_SHARE.get('meta:' + code, { type: 'text' });
    const htmlValue = await env.HTML_SHARE.get(code, { type: 'text' });

    if (!htmlValue) {
      return new Response('Not Found', { status: 404 });
    }

    const html = typeof htmlValue === 'string' ? htmlValue : JSON.stringify(htmlValue);

    // 如果是爬虫，返回带 og:meta 的预览页
    if (isBot) {
      let meta = {};
      try { meta = JSON.parse(metaJson || '{}'); } catch(e) {}

      const title = meta.title || extractTitle(html);
      const description = meta.description || extractDescription(html);
      const previewUrl = meta.previewUrl || null;
      const originalUrl = url.origin + url.pathname + '?v=' + code;

      const previewHtml = generatePreviewHTML(title, description, previewUrl, originalUrl, html);
      return new Response(previewHtml, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // 普通浏览器，直接返回 HTML 内容
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (e) {
    console.error('View shortcode error:', e);
    return new Response('Error loading content', { status: 500 });
  }
}

async function handleViewRaw(code, env) {
  try {
    const value = await env.HTML_SHARE.get(code, { type: 'text' });
    if (!value) {
      return new Response('Not Found', { status: 404 });
    }
    const html = typeof value === 'string' ? value : JSON.stringify(value);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (e) {
    return new Response('Error loading content', { status: 500 });
  }
}

async function handleSave(request, env, url) {
  try {
    const body = await request.json();
    let html = body.html;
    if (typeof html === 'object') html = JSON.stringify(html);
    if (!html || typeof html !== 'string') {
      return json({ error: 'html 字段不能为空' }, 400);
    }

    // 生成 8 位短码
    const code = generateCode();

    // 保存 HTML 内容到 KV（30 天过期）
    await env.HTML_SHARE.put(code, html, { expirationTtl: 2592000 });

    // 保存元数据（title, description, previewUrl）
    const title = body.title || extractTitle(html);
    const description = body.description || extractDescription(html);
    const meta = {
      title,
      description,
      previewUrl: body.previewUrl || null,
      createdAt: new Date().toISOString()
    };
    await env.HTML_SHARE.put('meta:' + code, JSON.stringify(meta), { expirationTtl: 2592000 });

    // 返回两种链接格式
    const shareUrl = `${url.origin}/?v=${code}`;
    const shortUrl = `${url.origin}/s/${code}`;

    return json({ code, url: shareUrl, shortUrl });
  } catch (e) {
    console.error('Save error:', e);
    return json({ error: '保存失败: ' + e.message }, 500);
  }
}

async function handleUploadPreview(request, env, url) {
  try {
    const formData = await request.formData();
    const code = formData.get('code');
    const image = formData.get('image');

    if (!code || !image) {
      return json({ error: '缺少 code 或 image 参数' }, 400);
    }

    // 限制图片大小 2MB
    if (image.size > 2 * 1024 * 1024) {
      return json({ error: '预览图不能超过 2MB' }, 400);
    }

    // 读取图片数据
    const arrayBuffer = await image.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // 存储到 KV
    await env.HTML_SHARE.put('preview:' + code, bytes, {
      expirationTtl: 2592000
    });

    // 更新元数据中的 previewUrl
    const metaJson = await env.HTML_SHARE.get('meta:' + code, { type: 'text' });
    let meta = {};
    try { meta = JSON.parse(metaJson || '{}'); } catch(e) {}
    meta.previewUrl = `${url.origin}/api/preview/${code}`;
    await env.HTML_SHARE.put('meta:' + code, JSON.stringify(meta), { expirationTtl: 2592000 });

    return json({ success: true, previewUrl: `${url.origin}/api/preview/${code}` });
  } catch (e) {
    console.error('Upload preview error:', e);
    return json({ error: '上传预览图失败: ' + e.message }, 500);
  }
}

async function handleGetPreview(code, env) {
  try {
    const value = await env.HTML_SHARE.get('preview:' + code, { type: 'arrayBuffer' });
    if (!value) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(value, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response('Error loading preview', { status: 500 });
  }
}

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
