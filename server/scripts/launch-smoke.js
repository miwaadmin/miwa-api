const DEFAULT_SITE = 'https://miwa.care';
const DEFAULT_API = 'https://api.miwa.care';

const siteBase = (process.env.LAUNCH_SITE_URL || DEFAULT_SITE).replace(/\/$/, '');
const apiBase = (process.env.LAUNCH_API_URL || DEFAULT_API).replace(/\/$/, '');

const checks = [
  { id: 'api_health', url: `${apiBase}/health`, expectJson: true },
  { id: 'api_health_alias', url: `${apiBase}/api/health`, expectJson: true },
  { id: 'site_home', url: `${siteBase}/` },
  { id: 'site_login', url: `${siteBase}/login` },
  { id: 'site_register', url: `${siteBase}/register` },
  { id: 'site_forgot_password', url: `${siteBase}/forgot-password` },
  { id: 'site_contacts_route', url: `${siteBase}/contacts` },
  { id: 'site_network_public', url: `${siteBase}/network` },
];

function safeHeaders(headers) {
  return {
    cacheControl: headers.get('cache-control') || null,
    contentType: headers.get('content-type') || null,
  };
}

async function runCheck(item) {
  const startedAt = Date.now();
  try {
    const res = await fetch(item.url, {
      redirect: 'follow',
      headers: { 'user-agent': 'miwa-launch-smoke/1.0' },
    });
    const elapsedMs = Date.now() - startedAt;
    const text = await res.text();
    const headers = safeHeaders(res.headers);
    const result = {
      id: item.id,
      ok: res.ok,
      status: res.status,
      elapsedMs,
      finalUrl: res.url,
      ...headers,
    };

    if (item.expectJson) {
      try {
        const parsed = JSON.parse(text);
        result.ok = result.ok && parsed.status === 'ok' && parsed.service === 'miwa-api';
        result.service = parsed.service || null;
      } catch {
        result.ok = false;
        result.error = 'Expected JSON response';
      }
    } else {
      result.ok = result.ok && /Miwa/i.test(text);
      if (!/Miwa/i.test(text)) result.error = 'Expected Miwa HTML content';
    }

    return result;
  } catch (err) {
    return {
      id: item.id,
      ok: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      error: err?.message || 'Request failed',
    };
  }
}

(async () => {
  const results = [];
  for (const item of checks) {
    results.push(await runCheck(item));
  }

  const failed = results.filter((item) => !item.ok);
  const output = {
    ok: failed.length === 0,
    siteBase,
    apiBase,
    time: new Date().toISOString(),
    summary: {
      pass: results.length - failed.length,
      fail: failed.length,
    },
    results,
  };

  console.log(JSON.stringify(output, null, 2));
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err?.message || 'Launch smoke check crashed',
    time: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
});
