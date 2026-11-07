// Verifies the stored OpenRouter credential end-to-end. Never prints the secret.
const fs = require('node:fs');
const https = require('node:https');

const CRED = 'C:\\Users\\Дмитрий\\.dsh\\.credentials.yaml';
const MODEL = process.argv[2] || 'openai/gpt-6.1-terra';
const TOOL_MODEL = process.argv[3] || MODEL;

function loadKey() {
  const text = fs.readFileSync(CRED, 'utf8');
  const m = text.match(/^\s*OPENROUTER_API_KEY:\s*(\S+)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '') : '';
}

const KEY = loadKey();
if (!KEY) { console.error('no OPENROUTER_API_KEY in credential store'); process.exit(2); }
const masked = `${KEY.slice(0, 9)}…${KEY.slice(-4)} (${KEY.length} chars)`;

function request(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'openrouter.ai', path, method, timeout: 90000,
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dsh.local',
        'X-Title': 'DeepSeek Harness',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { let p; try { p = JSON.parse(d); } catch { p = d; } resolve({ status: res.statusCode, body: p }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout 90s')));
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const clip = (v, n = 400) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };

(async () => {
  console.log('key:', masked);

  console.log('\n=== 1. balance / limits ===');
  const k = await request('GET', '/api/v1/key');
  console.log('GET /key →', k.status);
  if (k.status === 200 && k.body?.data) {
    const d = k.body.data;
    console.log('  label      :', d.label ?? '(none)');
    console.log('  free tier  :', d.is_free_tier);
    console.log('  usage      :', d.usage ?? 0);
    console.log('  limit      :', d.limit ?? '(no limit)');
    console.log('  remaining  :', d.limit_remaining ?? '(n/a)');
    console.log('  limit reset:', d.limit_reset ?? '(n/a)');
    console.log('  rate limit :', d.rate_limit ? JSON.stringify(d.rate_limit) : '(n/a)');
  } else {
    console.log('  body:', clip(k.body));
  }
  const c = await request('GET', '/api/v1/credits');
  console.log('GET /credits →', c.status, clip(c.body, 200));

  console.log('\n=== 2. plain completion ===', MODEL);
  const p = await request('POST', '/api/v1/chat/completions', {
    model: MODEL,
    messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
    max_tokens: 32,
  });
  console.log('status:', p.status);
  if (p.status === 200) {
    console.log('  text    :', clip(p.body.choices?.[0]?.message?.content ?? '(empty)', 80));
    console.log('  provider:', p.body.provider ?? '(not reported)');
    console.log('  usage   :', JSON.stringify(p.body.usage ?? {}));
  } else {
    console.log('  body:', clip(p.body, 600));
  }

  console.log('\n=== 3. tool-calling ===', TOOL_MODEL);
  const t = await request('POST', '/api/v1/chat/completions', {
    model: TOOL_MODEL,
    messages: [{ role: 'user', content: 'Call the get_time tool. Do not answer in text.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'get_time',
        description: 'Return current UTC time.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    }],
    tool_choice: 'auto',
    max_tokens: 512,
  });
  console.log('status:', t.status);
  if (t.status === 200) {
    const calls = t.body.choices?.[0]?.message?.tool_calls;
    console.log('  tool_calls:', calls ? JSON.stringify(calls.map((x) => ({ name: x.function?.name, args: x.function?.arguments }))) : 'NONE — model would break agent tools');
    console.log('  finish   :', t.body.choices?.[0]?.finish_reason);
  } else {
    console.log('  body:', clip(t.body, 600));
  }
})();
