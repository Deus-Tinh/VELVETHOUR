import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMonthlyAnalytics, businessYearMonth } from '../server/monthlyAnalytics.js';

test('monthly aggregation uses Vietnam transaction dates, valid payments, and completed service bookings', () => {
  const bookings = [
    {
      id: 'done-1', userId: 'customer-1', status: 'Completed', date: '2026-11-01', serviceId: 'archived-massage',
      serviceName: 'Massage lưu trữ', finalPrice: 180000,
      paymentRecords: [
        { type: 'deposit', amount: 100000, at: '2026-10-31T17:00:00.000Z' },
        { type: 'payment', amount: 80000, at: '2026-11-02T04:00:00.000Z' },
        { type: 'refund', amount: 30000, at: '2026-11-30T16:59:00.000Z' },
        { type: 'payment', amount: 40000, at: '2026-10-31T16:59:59.999Z' },
        { type: 'payment', amount: 50000, refundable: false, at: '2026-11-03T04:00:00.000Z' },
        { type: 'pending', amount: 70000, at: '2026-11-03T04:00:00.000Z' },
      ],
    },
    { id: 'done-2', userId: 'customer-1', status: 'Completed', date: '2026-11-30', serviceId: 'archived-massage', serviceName: 'Massage lưu trữ', finalPrice: 120000,
      paymentRecords: [{ type: 'payment', amount: 25000, at: '2026-11-30T17:00:00.000Z' }] },
    { id: 'done-3', userId: 'customer-2', status: 'Completed', date: '2026-11-16', serviceId: 'deleted-service', serviceName: 'Dịch vụ đã xóa', finalPrice: 300000,
      paymentRecords: [{ type: 'payment', amount: 300000, at: '2026-12-01T00:00:00.000Z' }] },
    { id: 'cancelled', userId: 'customer-3', status: 'Cancelled', paymentStatus: 'cancelled', date: '2026-11-05', serviceId: 'cancelled-service', finalPrice: 500000, paymentRecords: [] },
    { id: 'outside', userId: 'customer-4', status: 'Completed', date: '2026-10-31', serviceId: 'old-service', finalPrice: 900000,
      paymentRecords: [{ type: 'payment', amount: 900000, at: '2026-11-01T04:00:00.000Z' }] },
  ];
  const report = aggregateMonthlyAnalytics({ bookings, year: 2026, month: 11 });
  assert.deepEqual(report.metrics, {
    collected: 1080000, refunded: 30000, netCashFlow: 1050000,
    completedBookings: 3, cancelledBookings: 1, customersServed: 2, averageBookingValue: 200000,
  });
  assert.equal(report.startDate, '2026-11-01');
  assert.equal(report.endDate, '2026-11-30');
  assert.equal(report.dailyCashFlow.length, 30);
  assert.deepEqual(report.dailyCashFlow[0], { date: '2026-11-01', label: '01', revenue: 1000000, collected: 1000000, refunded: 0 });
  assert.equal(report.dailyCashFlow[1].revenue, 80000);
  assert.equal(report.dailyCashFlow[29].revenue, -30000);
  assert.equal(report.topServices[0].name, 'Massage lưu trữ');
  assert.equal(report.topServices[0].count, 2);
  assert.equal(report.topServices[0].share, 66.7);
  assert.equal(report.topServices[0].revenue, 150000);
  assert.equal(report.topServices[1].name, 'Dịch vụ đã xóa', 'historical service name survives service deletion');
  assert.equal(report.topServices[1].revenue, 0, 'payments outside the selected Vietnam month do not enter month cashflow');
  assert.equal('customerName' in report, false, 'report has no customer PII fields');
});

test('empty month returns zero metrics and validates month/year inputs', () => {
  const report = aggregateMonthlyAnalytics({ bookings: [], year: 2099, month: 2 });
  assert.equal(report.dailyCashFlow.length, 28);
  assert.deepEqual(report.metrics, {
    collected: 0, refunded: 0, netCashFlow: 0, completedBookings: 0,
    cancelledBookings: 0, customersServed: 0, averageBookingValue: 0,
  });
  assert.deepEqual(report.topServices, []);
  assert.throws(() => aggregateMonthlyAnalytics({ year: 2026, month: 13 }), RangeError);
  assert.deepEqual(businessYearMonth(new Date('2026-12-31T18:00:00.000Z')), { year: 2027, month: 1 });
});

test('cash movements are deduplicated by recorded identity without dropping legitimate instalments', () => {
  const payment = { id: 'pay_sepay_repeated', type: 'payment', amount: 120000, at: '2028-01-31T17:00:00Z' };
  const refund = { id: 'refund_first', type: 'refund', amount: 130000, at: '2028-02-03T15:00:00+07:00', sourceTransactionId: 'repeated' };
  const bookings = [
    {
      id: 'order-a', serviceId: 'history', status: 'Confirmed', date: '2028-02-01', finalPrice: 900000,
      paymentRecords: [
        { ...payment, id: 'pay_manual_3', amount: 180000, at: '2028-02-02T03:00:00Z' },
        { ...payment, id: 'pay_manual_1', amount: 180000, at: '2028-01-31T16:59:59.999Z' },
        payment, { ...payment, at: '2028-02-01T00:00:00+07:00' },
        { ...payment, id: 'pay_sepay_invalid', refundable: false },
        { ...payment, id: 'unsettled-collection', status: 'pending' },
        { ...payment, id: 'not-a-date', at: '2028-02-30T00:00:00Z' },
        { ...payment, id: 'no-time-zone', at: '2028-02-02T00:00:00' },
        { ...payment, id: 'not-a-currency-amount', amount: true },
        { ...payment, id: 'instalment-1', amount: 50000, reference: 'same booking code' },
        { ...payment, id: 'instalment-2', amount: 50000, reference: 'same booking code' },
        refund, { ...refund }, { ...refund, id: 'refund_pending', status: 'pending' },
        { ...refund, id: 'refund_second', amount: 5000, at: '2028-02-03T08:01:00Z' },
      ],
      refundRequest: { amount: 25000, status: 'pending' },
    },
    { id: 'order-b', serviceId: 'history', status: 'Pending', date: '2028-02-10',
      paymentRecords: [payment, { ...payment, id: 'pay_manual_3', amount: 40000 }] },
  ];
  const report = aggregateMonthlyAnalytics({ bookings, year: 2028, month: 2 });
  assert.equal(report.endDate, '2028-02-29');
  assert.deepEqual(report.metrics, {
    collected: 260000, refunded: 135000, netCashFlow: 125000,
    completedBookings: 0, cancelledBookings: 0, customersServed: 0, averageBookingValue: 0,
  });
  assert.deepEqual(report.dailyCashFlow[2], { date: '2028-02-03', label: '03', revenue: -135000, collected: 0, refunded: 135000 });
  const january = aggregateMonthlyAnalytics({ bookings, year: 2028, month: 1 });
  assert.equal(january.metrics.collected, 180000);
  assert.equal(january.dailyCashFlow.length, 31);
  assert.deepEqual(aggregateMonthlyAnalytics({ bookings: [...bookings].reverse(), year: 2028, month: 2 }), report);
});

test('ambiguous duplicate transaction totals fail clearly for the months affected', () => {
  const record = { id: 'pay_sepay_conflict', type: 'payment', amount: 100000, at: '2028-01-15T03:00:00Z' };
  const bookings = [{ id: 'conflict', paymentRecords: [
    { ...record, amount: 90000, at: '2028-02-15T03:00:00Z' },
    { ...record, amount: 90000, at: '2028-03-15T03:00:00Z' },
    record,
  ] }];
  for (const month of [1, 2, 3]) {
    assert.throws(() => aggregateMonthlyAnalytics({ bookings, year: 2028, month }), /đối soát/);
  }
  assert.equal(aggregateMonthlyAnalytics({ bookings, year: 2028, month: 4 }).metrics.collected, 0);
});

test('the top five use completed appointments and historical service names; ranking is independent of cash', () => {
  const bookings = [3, 1, 6, 2, 5, 4].flatMap((count) => Array.from({ length: count }, (_, i) => ({
    id: `history-${count}-${i}`, date: '2028-02-29', status: 'Completed', serviceId: `history-${count}`,
    serviceName: `Dịch vụ cũ ${count}`, finalPrice: count * 10000,
    customerPhone: i % 2 ? '+84 987 654 321' : '0987654321',
  })));
  const report = aggregateMonthlyAnalytics({ bookings, year: 2028, month: 2 });
  assert.deepEqual(report.topServices.map(({ name, count, share }) => [name, count, share]), [
    ['Dịch vụ cũ 6', 6, 28.6], ['Dịch vụ cũ 5', 5, 23.8], ['Dịch vụ cũ 4', 4, 19],
    ['Dịch vụ cũ 3', 3, 14.3], ['Dịch vụ cũ 2', 2, 9.5],
  ]);
  assert.equal(report.metrics.customersServed, 1);
  assert.equal(report.metrics.averageBookingValue, 43333);
  assert.equal(report.metrics.collected, 0);
  assert.doesNotMatch(JSON.stringify(report), /0987654321|customerPhone/);
});
