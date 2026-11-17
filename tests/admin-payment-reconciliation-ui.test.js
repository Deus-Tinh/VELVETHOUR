import test from 'node:test';
import assert from 'node:assert/strict';
import { apiClient } from '../assets/js/services/apiClient.js';
globalThis.window = {};
const { renderTabReconciliation } = await import('../assets/js/pages/adminDashboardPage.js');
delete globalThis.window;

test('reconciliation displays the configured recipient and escapes its name', async (t) => {
  t.mock.method(apiClient, 'getPaymentReconciliation', async () => ({
    payment: { enabled: true, mode: 'direct_manual', bankName: 'Fixture Bank <VN>', accountNumber: '0000000000' },
  }));
  const container = { isConnected: true, querySelectorAll: () => [] };
  await renderTabReconciliation(container);
  assert.match(container.innerHTML, /Fixture Bank &lt;VN&gt; 0000000000/);
  assert.doesNotMatch(container.innerHTML, /Fixture Bank <VN>|Techcombank/);
});

test('reconciliation omits recipient instructions when payment is disabled', async (t) => {
  t.mock.method(apiClient, 'getPaymentReconciliation', async () => ({
    payment: { enabled: false, bankName: 'Fixture Bank', accountNumber: '0000000000' },
  }));
  const container = { isConnected: true, querySelectorAll: () => [] };
  await renderTabReconciliation(container);
  assert.match(container.innerHTML, /Cấu hình thanh toán chưa hoàn tất/);
  assert.doesNotMatch(container.innerHTML, /Fixture Bank|0000000000|Quét QR/);
});
