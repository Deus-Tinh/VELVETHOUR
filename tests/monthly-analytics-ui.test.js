import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminMonthlyAnalytics } from '../assets/js/pages/adminMonthlyAnalyticsPage.js';
import { apiClient } from '../assets/js/services/apiClient.js';
import { drawRevenueChart } from '../assets/js/ui/canvasChart.js';

test('a failed analytics request presents a retry message without showing false zero totals', async (t) => {
  t.mock.method(apiClient, 'getMonthlyAnalytics', async () => { throw new TypeError('Failed to fetch'); });
  const result = { isConnected: true };
  const nodes = {
    '.monthly-period-form': { addEventListener() {} },
    '#monthlyAnalyticsYear': { value: '2028' },
    '#monthlyAnalyticsMonth': { value: '2' },
    '#monthlyAnalyticsResult': result,
  };
  await renderAdminMonthlyAnalytics({ querySelector: (key) => nodes[key] });
  assert.match(result.innerHTML, /Không thể tải báo cáo tháng/);
  assert.match(result.innerHTML, /Xem báo cáo/);
  assert.doesNotMatch(result.innerHTML, /kpi-value|Chưa có dữ liệu|Failed to fetch/);
});

test('cash flow chart puts refunds below zero and does not show an undefined booking count', () => {
  const dots = [];
  const text = [];
  const noop = () => {};
  const ctx = {
    scale: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    closePath: noop, fill: noop, createLinearGradient: () => ({ addColorStop: noop }),
    arc: (x, y) => dots.push([x, y]), fillText: (label) => text.push(label),
  };
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 320, height: 240 }) };
  globalThis.document = { getElementById: () => canvas };
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawRevenueChart('monthly', [{ revenue: 250000, label: '01' }, { revenue: 0, label: '02' }, { revenue: -500000, label: '03' }]);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
  assert.ok(dots[0][1] < dots[1][1] && dots[1][1] < dots[2][1]);
  assert.ok(dots[2][1] <= 200, 'refund point should stay inside the plotting area');
  assert.ok(text.includes('-500k'));
  assert.ok(!text.includes('undefined lịch'));
});
