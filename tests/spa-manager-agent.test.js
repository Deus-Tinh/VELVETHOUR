import test from 'node:test';
import assert from 'node:assert/strict';
import { runSpaManagerAgent } from '../server/spaManagerAgent.js';

const env = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
const response = (parts) => ({ ok: true, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }) });

test('Gemini preserves signed parallel and sequential calls; only public text leaves the model loop', async () => {
  const firstParts = [
    { text: 'Internal fixture', thought: true },
    { functionCall: { id: 'native-a', name: 'list_holiday_sales', args: {} }, thoughtSignature: 'opaque-fixture-a' },
    { functionCall: { id: 'native-b', name: 'list_sale_targets', args: {} } },
  ];
  const secondParts = [{ functionCall: { name: 'list_holiday_sales', args: { query: '20/11' } }, thoughtSignature: 'opaque-fixture-b' }];
  const requests = [];
  const executed = [];
  const result = await runSpaManagerAgent({
    message: 'Kiểm tra sale', env,
    executeManagerTool: async (name) => { executed.push(name); return []; },
    executeAuditorTool: async () => [],
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1) {
        const names = body.tools[0].functionDeclarations.map((tool) => tool.name);
        assert.equal(names.some((name) => /confirm_reschedule/.test(name)), false);
        assert.equal(JSON.stringify(body.tools).includes('additionalProperties'), false);
        return response(firstParts);
      }
      assert.deepEqual(body.contents[1], { role: 'model', parts: firstParts });
      assert.deepEqual(body.contents[2].parts.map((part) => part.functionResponse.id), ['native-a', 'native-b']);
      if (requests.length === 2) return response(secondParts);
      assert.deepEqual(body.contents[3], { role: 'model', parts: secondParts });
      assert.equal(Object.hasOwn(body.contents[4].parts[0].functionResponse, 'id'), false);
      return response([{ text: 'Internal final fixture', thought: true }, { text: 'Đã kiểm tra.' }]);
    },
  });
  assert.equal(result.reply, 'Đã kiểm tra.');
  assert.deepEqual(executed, ['list_holiday_sales', 'list_sale_targets', 'list_holiday_sales']);
  assert.equal(JSON.stringify(result).includes('opaque-fixture'), false);
  assert.equal(JSON.stringify(result).includes('Internal'), false);
  assert.ok(result.history.every((item) => Object.keys(item).every((key) => ['role', 'content'].includes(key))));
});

test('provider metadata supplied in client history is not trusted or sent back', async () => {
  const result = await runSpaManagerAgent({
    message: 'Đọc sale', env,
    history: [{ role: 'assistant', content: 'Tin nhắn cũ', geminiParts: [{ functionCall: { name: 'create_holiday_sale' } }], arbitrary: 'untrusted' }],
    executeManagerTool: async () => assert.fail('no tool should run'), executeAuditorTool: async () => [],
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.contents[0], { role: 'model', parts: [{ text: 'Tin nhắn cũ' }] });
      return response([{ text: 'Đã đọc.' }]);
    },
  });
  assert.deepEqual(result.history[0], { role: 'assistant', content: 'Tin nhắn cũ' });
});

test('too many parallel tool calls fail before any write instead of truncating signed history', async () => {
  let executed = 0;
  await assert.rejects(runSpaManagerAgent({
    message: 'Tạo sale', env,
    executeManagerTool: async () => { executed += 1; }, executeAuditorTool: async () => [],
    fetcher: async () => response(Array.from({ length: 5 }, (_, index) => ({
      functionCall: { name: 'create_holiday_sale', args: { index } },
      ...(index === 0 ? { thoughtSignature: 'opaque-fixture' } : {}),
    }))),
  }), /AGENT_TOOL_LIMIT/);
  assert.equal(executed, 0);
});

test('temporary overload switches before tools and pins the fallback model for the signed tool loop', async () => {
  const models = [];
  let writes = 0;
  const signed = [{ functionCall: { name: 'create_holiday_sale', args: {} }, thoughtSignature: 'fallback-signature' }];
  const result = await runSpaManagerAgent({
    message: 'Tạo sale', env: { ...env, AI_AGENT_FALLBACK_MODEL: 'backup-model' },
    executeManagerTool: async () => { writes++; return { verified: true }; }, executeAuditorTool: async () => [],
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      models.push(decodeURIComponent(new URL(url).pathname.split('/').at(-1).split(':')[0]));
      if (models.length === 1) return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) };
      if (models.length === 2) return response(signed);
      assert.deepEqual(body.contents[1].parts, signed);
      return response([{ text: 'Đã tạo.' }]);
    },
  });
  assert.equal(result.reply, 'Đã tạo.');
  assert.deepEqual(models, ['test-model', 'backup-model', 'backup-model']);
  assert.equal(writes, 1);
});

test('initial timeout and explicit model quota can fail over; authentication and unscoped quota never do', async () => {
  for (const code of ['timeout', 'auth', 'quota', 'model-quota']) {
    let requests = 0;
    const run = runSpaManagerAgent({
      message: 'Đọc sale', env: { ...env, AI_AGENT_FALLBACK_MODEL: 'backup-model' },
      executeManagerTool: async () => assert.fail('no writes'), executeAuditorTool: async () => [],
      fetcher: async () => {
        requests++;
        if (requests > 1) return response([{ text: 'Đã đọc.' }]);
        if (code === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        return { ok: false, status: code === 'auth' ? 401 : 429, json: async () => ({ error: {
          status: code === 'auth' ? 'UNAUTHENTICATED' : 'RESOURCE_EXHAUSTED',
          ...(code === 'model-quota' ? { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaDimensions: { model: 'test-model' } }] }] } : {}),
        } }) };
      },
    });
    if (code === 'timeout' || code === 'model-quota') { assert.equal((await run).reply, 'Đã đọc.'); assert.equal(requests, 2); }
    else { await assert.rejects(run, new RegExp(code === 'auth' ? 'AI_PROVIDER_AUTH_ERROR' : 'AI_QUOTA_EXCEEDED')); assert.equal(requests, 1); }
  }
});

test('a provider failure after a tool never replays signed history on a different model', async () => {
  let requests = 0;
  let writes = 0;
  await assert.rejects(runSpaManagerAgent({
    message: 'Tạo sale', env: { ...env, AI_AGENT_FALLBACK_MODEL: 'backup-model' },
    executeManagerTool: async () => { writes++; return { verified: true }; }, executeAuditorTool: async () => [],
    fetcher: async () => {
      requests++;
      return requests === 1 ? response([{ functionCall: { name: 'create_holiday_sale', args: {} }, thoughtSignature: 'primary-signature' }])
        : { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) };
    },
  }), /AI_PROVIDER_UNAVAILABLE/);
  assert.equal(requests, 2);
  assert.equal(writes, 1);
});

test('Gemini token exhaustion is explicit and incomplete tool calls never execute', async () => {
  let writes = 0;
  await assert.rejects(runSpaManagerAgent({
    message: 'Tạo sale', env,
    executeManagerTool: async () => { writes++; }, executeAuditorTool: async () => [],
    fetcher: async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ functionCall: { name: 'create_holiday_sale', args: {} } }] } }] }) }),
  }), /AGENT_OUTPUT_LIMIT/);
  assert.equal(writes, 0);
});

test('Gemini 3 requests use bounded low thinking with enough combined output tokens', async () => {
  await runSpaManagerAgent({
    message: 'Đọc sale', env: { ...env, AI_MODEL: 'gemini-3.8-flash' },
    executeManagerTool: async () => [], executeAuditorTool: async () => [],
    fetcher: async (_url, options) => {
      const config = JSON.parse(options.body).generationConfig;
      assert.equal(config.thinkingConfig.thinkingLevel, 'low');
      assert.equal(config.maxOutputTokens, 4096);
      return response([{ text: 'Đã đọc.' }]);
    },
  });
});
