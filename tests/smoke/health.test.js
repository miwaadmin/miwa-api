const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api } = require('./_helpers');

test('public diagnostics expose safe service health only', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const root = await api('GET', '/', null);
  assert.equal(root.status, 200);
  assert.deepEqual(root.body, {
    service: 'miwa-api',
    status: 'running',
  });

  for (const path of ['/health', '/api/health']) {
    const res = await api('GET', path, null);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.service, 'miwa-api');
    assert.equal(res.body.environment, process.env.NODE_ENV || 'unknown');
    assert.match(res.body.time, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'JWT_SECRET'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'AZURE_OPENAI_KEY'), false);
  }
});
