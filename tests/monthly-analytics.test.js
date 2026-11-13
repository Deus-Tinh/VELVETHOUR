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
