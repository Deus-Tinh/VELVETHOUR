import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChatMessage, emptyChatContext, extractBudget, extractDateAndTime, extractDuration,
  isAiConfigured, mergeChatContext, recommendServices, redactChatText, requestAiCriteria, validateAiCriteria,
} from '../server/chatbot.js';

test('Vietnamese constraints keep budget and duration in VND/minutes', () => {
  assert.deepEqual(extractBudget('ngân sách khoảng 300–500k'), { budget_min: 300000, budget_max: 500000 });
  assert.deepEqual(extractBudget('Dưới 500.000đ'), { budget_min: null, budget_max: 500000 });
  assert.deepEqual(extractBudget('Trên 500k'), { budget_min: 500000, budget_max: null });
  assert.equal(extractDuration('khoảng một tiếng'), 60);
  assert.equal(extractDuration('45 phút'), 45);
  assert.equal(extractDateAndTime('3 giờ').preferred_time, '15:00');
  assert.equal(extractDateAndTime('3 giờ chiều').preferred_time, '15:00');
  const saturday = extractDateAndTime('sáng thứ 7').preferred_date;
  assert.match(saturday, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${saturday}T00:00:00Z`).getUTCDay(), 6);
  assert.equal(extractDateAndTime('Chọn dịch vụ này').preferred_date, null);
  assert.equal(extractDateAndTime('Spa có khuyến mãi gì?').preferred_date, null);
  assert.ok(extractDateAndTime('ngày mai').preferred_date);
});

test('cheapest requests sort by live price and ordinal follow-ups resolve a real service', () => {
  const services = [
    { id: 'first', name: 'Massage Đầu', category: 'hair-spa', active: true, shortDesc: 'Massage đầu', duration: 30, price: 300000 },
    { id: 'second', name: 'Massage Cổ Vai', category: 'focus-therapy', active: true, shortDesc: 'Massage cổ vai gáy', duration: 45, price: 450000 },
    { id: 'third', name: 'Chăm Sóc Da', category: 'skin-care', active: true, shortDesc: 'Chăm sóc da mặt', duration: 60, price: 600000 },
  ];
  const cheapestRules = classifyChatMessage('Dịch vụ nào rẻ nhất?', emptyChatContext(), services);
  const cheapestContext = mergeChatContext(emptyChatContext(), cheapestRules);
  assert.equal(cheapestContext.sort_by, 'price_asc');
  assert.deepEqual(recommendServices(services, cheapestContext, 3).map((service) => service.id), ['first', 'second', 'third']);

  const previous = { ...emptyChatContext(), last_recommended_services: [
    { serviceId: 'first', duration: 30 }, { serviceId: 'second', duration: 45 }, { serviceId: 'third', duration: 60 },
  ] };
  const price = classifyChatMessage('Cái thứ 2 bao nhiêu?', previous, services);
  const selected = mergeChatContext(previous, price);
  assert.equal(selected.intent, 'PRICE_INQUIRY');
  assert.equal(selected.service_id, 'second');
  const booking = classifyChatMessage('Đặt cái đó', selected, services);
  assert.equal(booking.intent, 'BOOKING_REQUEST');
  assert.equal(booking.contextPatch.service_id, 'second');

  const cheaper = classifyChatMessage('Không, tôi muốn cái rẻ hơn.', selected, services);
  assert.equal(cheaper.intent, 'SERVICE_RECOMMENDATION');
  const alternatives = recommendServices(services, mergeChatContext(selected, cheaper), 3);
  assert.ok(alternatives.every((service) => service.id !== 'second'));
  assert.equal(alternatives[0].id, 'first');

  const availability = classifyChatMessage('Còn lịch chiều mai không?', selected, services);
  assert.equal(availability.intent, 'AVAILABILITY_CHECK');
  assert.equal(availability.contextPatch.service_id, 'second');
  assert.match(availability.contextPatch.preferred_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('chat rules preserve multi-turn context and resolve the screenshot quick replies', () => {
  const initial = emptyChatContext();
  const relax = classifyChatMessage('Cần thư giãn', initial);
  assert.equal(relax.contextPatch.service_category, 'relaxation');
  assert.equal(classifyChatMessage('Hủy lịch hẹn', initial).intent, 'BOOKING_CANCEL_REQUEST');

  const waiting = mergeChatContext(initial, { ...relax, contextPatch: { ...relax.contextPatch, conversation_state: 'awaiting_budget' } });
  const budget = classifyChatMessage('300.000đ – 500.000đ', waiting);
  const selected = mergeChatContext(waiting, budget);
  assert.equal(selected.service_category, 'relaxation');
  assert.equal(selected.budget_min, 300000);
  assert.equal(selected.budget_max, 500000);

  const followUp = classifyChatMessage('Ngày mai', { ...selected, intent: 'AVAILABILITY_CHECK', conversation_state: 'awaiting_availability_date' });
  assert.equal(followUp.intent, 'AVAILABILITY_CHECK');
  assert.match(followUp.contextPatch.preferred_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(extractDateAndTime('ngày 23/10 lúc 10h30').preferred_time, '10:30');

  const fallbackRules = { intent: 'FALLBACK', contextPatch: { intent: 'FALLBACK' }, reset: false };
  assert.equal(mergeChatContext(initial, fallbackRules, { intent: 'SERVICE_RECOMMENDATION' }).intent, 'SERVICE_RECOMMENDATION');
  assert.equal(mergeChatContext(initial, fallbackRules, { intent: 'BOOKING_REQUEST' }).intent, 'FALLBACK');
});

test('recommendations enforce the chosen budget and topic using actual service records', () => {
  const services = [
    { id: 'massage', name: 'Body Massage', category: 'body-massages', active: true,
      shortDesc: 'Massage thư giãn', duration: 90, price: 680000,
      variants: [{ duration: 60, price: 490000 }, { duration: 90, price: 680000 }] },
    { id: 'skin', name: 'Facial Care', category: 'hair-spa', active: true,
      shortDesc: 'Chăm sóc da mặt', duration: 75, price: 690000, variants: [{ duration: 60, price: 590000 }] },
    { id: 'disabled', name: 'Inactive Massage', category: 'body-massages', active: false,
      shortDesc: '', duration: 60, price: 300000 },
  ];
  const relax = recommendServices(services, { service_category: 'relaxation', budget_min: 300000, budget_max: 500000, desired_duration: 60, keywords: [] });
  assert.deepEqual(relax.map((item) => item.id), ['massage']);
  assert.equal(relax[0].price, 490000);
  assert.equal(relax[0].duration, 60);
  const skin = recommendServices(services, { service_category: 'skin-care', budget_max: 600000, keywords: [] });
  assert.deepEqual(skin.map((item) => item.id), ['skin']);
});

test('AI output is constrained to allowed criteria and personal data is redacted', async () => {
  const validated = validateAiCriteria({
    intent: 'BOOKING_REQUEST', service_category: 'users', budget_min: -1, budget_max: 600000,
    desired_duration: 900, keywords: ['vai gay', 9, 'thu gian'],
  }, [{ id: 'body-massages' }]);
  assert.equal(validated.service_category, null);
  assert.equal(validated.budget_min, null);
  assert.equal(validated.budget_max, 600000);
  assert.equal(validated.desired_duration, null);
  assert.deepEqual(validated.keywords, ['vai gay', 'thu gian']);
  assert.equal(redactChatText('Gọi 0987654321 hoặc abc@example.com'), 'Gọi [số điện thoại đã ẩn] hoặc [email đã ẩn]');

  let sentBody;
  const criteria = await requestAiCriteria('Mình ngồi văn phòng, gọi 0987654321 muốn thư giãn dưới 500k.', {}, [],
    { AI_PROVIDER: 'openai', AI_API_KEY: 'test-only', AI_MODEL: 'test-model' },
    async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        intent: 'SERVICE_RECOMMENDATION', service_category: 'relaxation', budget_min: null,
        budget_max: 500000, desired_duration: 60, keywords: ['vai gay'],
        assistant_reply: 'Mình hiểu bạn đang tìm một cách thư giãn sau giờ làm. Mình sẽ lọc lựa chọn phù hợp bên dưới nhé.',
      }) } }] }) };
    }, { history: [
      { role: 'user', content: 'Liên hệ minh@example.com hoặc 0912345678' },
      { role: 'assistant', content: 'Mình có thể giúp bạn tìm dịch vụ.' },
    ] });
  assert.equal(criteria.budget_max, 500000);
  assert.match(criteria.assistant_reply, /sau giờ làm/);
  assert.equal(JSON.stringify(sentBody).includes('0987654321'), false);
  assert.equal(JSON.stringify(sentBody).includes('minh@example.com'), false);
  assert.equal(JSON.stringify(sentBody).includes('0912345678'), false);
  assert.equal(sentBody.messages[1].content.includes('[email đã ẩn]'), true);
  assert.equal(sentBody.messages[1].content.includes('[số điện thoại đã ẩn]'), true);
});

test('AI remains optional when provider configuration is incomplete', async () => {
  let called = false;
  const result = await requestAiCriteria('Xin chào', {}, [], {}, async () => { called = true; });
  assert.equal(result, null);
  assert.equal(called, false);
  assert.equal(isAiConfigured({ AI_PROVIDER: 'gemini', AI_API_KEY: 'test-only', AI_MODEL: 'gemini-3.6-flash' }), true);
  assert.equal(isAiConfigured({ AI_PROVIDER: 'openai', AI_API_KEY: 'test-only', AI_MODEL: 'test-model' }), true);
  assert.equal(isAiConfigured({ AI_PROVIDER: 'unsupported', AI_API_KEY: 'test-only', AI_MODEL: 'test-model' }), false);
});

test('Gemini provider sends JSON-mode requests and parses Gemini responses', async () => {
  let requestUrl;
  let requestOptions;
  const criteria = await requestAiCriteria('Xin chào', {
    intent: 'FALLBACK', service_id: 'service-2', last_recommended_services: [
      { serviceId: 'service-1', duration: 30 }, { serviceId: 'service-2', duration: 60 },
    ],
  }, [], {
    AI_PROVIDER: 'gemini', AI_API_KEY: 'test-gemini-key', AI_MODEL: 'gemini-3.6-flash',
  }, async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      intent: 'GREETING', service_category: null, budget_min: null, budget_max: null,
      desired_duration: null, keywords: [], assistant_reply: 'Xin chào! Mình có thể tư vấn dịch vụ phù hợp cho bạn.',
    }) }] } }] }) };
  });

  assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
  assert.equal(requestOptions.headers['x-goog-api-key'], 'test-gemini-key');
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.match(body.systemInstruction.parts[0].text, /Không mặc định mọi câu hỏi đều liên quan đến spa/);
  const providerInput = JSON.parse(body.contents[0].parts[0].text);
  assert.equal(providerInput.message, 'Xin chào');
  assert.equal(providerInput.context.selected_service_id, 'service-2');
  assert.deepEqual(providerInput.context.last_recommended_service_ids, ['service-1', 'service-2']);
  assert.equal(criteria.intent, 'GREETING');
  assert.match(criteria.assistant_reply, /tư vấn dịch vụ/);
});

test('Gemini overload falls back to the configured Flash-Lite model', async () => {
  const requestedModels = [];
  const criteria = await requestAiCriteria('Mình muốn thư giãn dưới 500k.', {}, [], {
    AI_PROVIDER: 'gemini',
    AI_API_KEY: 'test-gemini-key',
    AI_MODEL: 'gemini-3.8-flash',
    AI_FALLBACK_MODEL: 'gemini-3.5-flash-lite',
  }, async (url) => {
    const model = decodeURIComponent(url.match(/models\/([^:]+):/)[1]);
    requestedModels.push(model);
    if (model === 'gemini-3.8-flash') {
      return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      intent: 'SERVICE_RECOMMENDATION', service_category: 'relaxation', budget_min: null,
      budget_max: 500000, desired_duration: null, keywords: [],
      assistant_reply: 'Mình sẽ tìm các lựa chọn phù hợp trong ngân sách của bạn.',
    }) }] } }] }) };
  });

  assert.deepEqual(requestedModels, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert.match(criteria.assistant_reply, /ngân sách/);
  assert.equal(criteria.budget_max, 500000);
});

test('Gemini request timeout leaves time for the fallback model', async () => {
  const requestedModels = [];
  const criteria = await requestAiCriteria('Tôi muốn được tư vấn chăm sóc da.', {}, [], {
    AI_PROVIDER: 'gemini',
    AI_API_KEY: 'test-gemini-key',
    AI_MODEL: 'gemini-3.8-flash',
    AI_FALLBACK_MODEL: 'gemini-3.5-flash-lite',
    AI_REQUEST_TIMEOUT: '1000',
  }, async (url, options) => {
    const model = decodeURIComponent(url.match(/models\/([^:]+):/)[1]);
    requestedModels.push(model);
    if (model === 'gemini-3.8-flash') {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      intent: 'SERVICE_RECOMMENDATION', service_category: 'skin-care', budget_min: null,
      budget_max: null, desired_duration: null, keywords: [],
      assistant_reply: 'Mình có thể giúp bạn tìm dịch vụ chăm sóc da phù hợp.',
    }) }] } }] }) };
  });

  assert.deepEqual(requestedModels, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert.match(criteria.assistant_reply, /chăm sóc da/);
});

test('Gemini authentication errors do not retry another model', async () => {
  let requestCount = 0;
  const criteria = await requestAiCriteria('Xin chào', {}, [], {
    AI_PROVIDER: 'gemini',
    AI_API_KEY: 'test-gemini-key',
    AI_MODEL: 'gemini-3.8-flash',
    AI_FALLBACK_MODEL: 'gemini-3.5-flash-lite',
  }, async () => {
    requestCount += 1;
    return { ok: false, status: 401, json: async () => ({ error: { status: 'UNAUTHENTICATED' } }) };
  });

  assert.equal(criteria, null);
  assert.equal(requestCount, 1);
});
