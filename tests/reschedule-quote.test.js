import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRescheduleQuote } from '../assets/js/ui/rescheduleQuote.js';
import { apiClient } from '../assets/js/services/apiClient.js';

const quote = {
  id: 'quote-test-001', bookingId: 'booking-test', bookingCode: 'SER-TEST', oldDate: '2026-11-21', oldStartTime: '10:00',
  change: { date: '2026-11-20', startTime: '10:00', staffName: 'Mai Linh' },
  newPricing: { discountSource: 'holiday_sale', campaignName: 'Sale lễ' },
  settlement: { oldFinalPrice: 500000, newFinalPrice: 425000, priceDelta: -75000, netPaid: 0, amountDue: 425000, refundDue: 0 },
};
function fixture() {
  const listeners = new Map();
  const button = { disabled: false, textContent: '', addEventListener: (event, callback) => listeners.set(event, callback),
    click: () => listeners.get('click')() };
  const status = { textContent: '' };
  const container = { innerHTML: '', querySelector: (selector) => selector === '[data-confirm-price]' ? button : status };
  return { button, status, container };
}

test('rendering a price quote never confirms; only the explicit button sends its bound quote ID', async () => {
  const original = apiClient.confirmReschedule;
  const calls = [];
  apiClient.confirmReschedule = async (...args) => { calls.push(args); return { booking: { id: quote.bookingId } }; };
  try {
    const ui = fixture();
    let confirmed = 0;
    renderRescheduleQuote(ui.container, quote, { phone: '0987654321', onConfirmed: () => { confirmed += 1; } });
    assert.equal(calls.length, 0);
    await ui.button.click();
    assert.deepEqual(calls, [[quote.bookingId, quote.id, '0987654321', null]]);
    assert.equal(confirmed, 1);
    assert.equal(ui.button.disabled, true);
  } finally { apiClient.confirmReschedule = original; }
});

test('double-clicking confirmation while a save is in flight sends one request', async () => {
  const original = apiClient.confirmReschedule;
  let release;
  let calls = 0;
  apiClient.confirmReschedule = () => { calls += 1; return new Promise((resolve) => { release = resolve; }); };
  try {
    const ui = fixture(); renderRescheduleQuote(ui.container, quote);
    const pending = ui.button.click();
    await ui.button.click();
    assert.equal(calls, 1);
    release({ booking: { id: quote.bookingId } });
    await pending;
  } finally { apiClient.confirmReschedule = original; }
});

test('stale or expired quotes require a fresh quote instead of silently confirming a replacement', async () => {
  const original = apiClient.confirmReschedule;
  apiClient.confirmReschedule = async () => { throw Object.assign(new Error('Giá đã đổi'), { code: 'QUOTE_STALE' }); };
  try {
    const ui = fixture(); let confirmed = false;
    renderRescheduleQuote(ui.container, quote, { onConfirmed: () => { confirmed = true; } });
    await ui.button.click();
    assert.equal(confirmed, false);
    assert.equal(ui.button.disabled, true);
    assert.match(ui.status.textContent, /Giá đã đổi/);
  } finally { apiClient.confirmReschedule = original; }
});

test('refresh failure after a committed save still reports success and never enables a second confirmation', async () => {
  const original = apiClient.confirmReschedule;
  let calls = 0;
  apiClient.confirmReschedule = async () => { calls += 1; return { booking: { id: quote.bookingId } }; };
  try {
    const ui = fixture();
    renderRescheduleQuote(ui.container, quote, { onConfirmed: () => { throw new Error('Network failed while refreshing'); } });
    await ui.button.click();
    assert.match(ui.status.textContent, /Đã lưu lịch mới/);
    assert.equal(ui.button.disabled, true);
    await ui.button.click();
    assert.equal(calls, 1);
  } finally { apiClient.confirmReschedule = original; }
});
