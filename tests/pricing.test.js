import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, calculateRescheduleAdjustment, PRICING_POLICY_VERSION } from '../assets/js/domain/pricingService.js';
import { normalizeHolidaySale } from '../assets/js/domain/holidaySaleModel.js';
import { promotionService } from '../assets/js/services/staffSettingsPromoService.js';

const service = {
  id: 'massage', category: 'body-massages', therapyGroup: 'body-massage', active: true,
  duration: 60, price: 500000, variants: [{ duration: 60, price: 500000 }, { duration: 90, price: 700000 }],
};
const evaluatedAt = '2026-10-19T03:00:00.000Z';
function sale(patch = {}) {
  return {
    id: 'sale-a', name: 'Sale ngày lễ', occasion: '20/11', serviceDateFrom: '2026-11-20', serviceDateTo: '2026-11-20',
    enabled: true, discountType: 'percent', percentageBps: 1500, fixedAmountVnd: null, maxDiscountVnd: null,
    scopeType: 'all', targets: [], revision: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    ...patch,
  };
}
function coupon(patch = {}) {
  return {
    id: 'promo', code: 'SAVE10', active: true, type: 'percent', value: 10, startDate: '2026-10-01',
    expiresAt: '2026-12-31', minOrder: 0, maxDiscount: 0, usageLimit: 100, usedCount: 0, ...patch,
  };
}
function price(patch = {}) {
  return calculatePrice({ service, duration: 60, serviceDate: '2026-11-20', campaigns: [], evaluatedAt, ...patch });
}
function errorCode(code) { return (error) => error.code === code; }
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test('pricing requires a real service date, an explicit UTC evaluation time and an existing variant', () => {
  for (const serviceDate of [undefined, '', '2026-02-30', '2026-11-20T00:00:00Z']) {
    assert.throws(() => price({ serviceDate }), errorCode('INVALID_SERVICE_DATE'));
  }
  for (const time of [undefined, 'bad', '2026-02-30T00:00:00.000Z']) {
    assert.throws(() => price({ evaluatedAt: time }), errorCode('INVALID_EVALUATION_TIME'));
  }
  for (const duration of [30, '60', 0, 61, Infinity]) assert.throws(() => price({ duration }), errorCode('INVALID_DURATION'));
  assert.throws(() => price({ service: { ...service, active: false } }), errorCode('SERVICE_NOT_FOUND'));
  assert.throws(() => price({ service: { ...service, variants: [{ duration: 60, price: -1 }] } }), errorCode('INVALID_PRICE'));
  assert.throws(() => price({ service: { ...service, variants: [service.variants[0], service.variants[0]] } }), errorCode('INVALID_DURATION'));
});

test('a booking made before a holiday qualifies using its service date and keeps a complete quote', () => {
  const result = price({ campaigns: [sale()] });
  assert.equal(result.originalPrice, 500000);
  assert.equal(result.discountAmount, 75000);
  assert.equal(result.finalPrice, 425000);
  assert.equal(result.discountSource, 'holiday_sale');
  assert.equal(result.serviceDate, '2026-11-20');
  assert.equal(result.evaluatedAt, evaluatedAt);
  assert.equal(result.campaignId, 'sale-a');
  assert.equal(result.campaignRevision, 1);
  assert.equal(result.pricingPolicyVersion, PRICING_POLICY_VERSION);
  assert.equal(result.discountDetails.sale.percentageBps, 1500);
});

test('booking during a holiday for a later service date does not qualify', () => {
  const result = price({ campaigns: [sale()], serviceDate: '2026-11-21', evaluatedAt: '2026-11-20T03:00:00.000Z' });
  assert.equal(result.finalPrice, 500000);
  assert.equal(result.discountSource, 'none');
});

test('service date boundaries are inclusive and disabled campaigns do not apply', () => {
  const campaigns = [sale({ serviceDateFrom: '2026-11-19', serviceDateTo: '2026-11-21' })];
  for (const serviceDate of ['2026-11-19', '2026-11-20', '2026-11-21']) assert.equal(price({ campaigns, serviceDate }).finalPrice, 425000);
  for (const serviceDate of ['2026-11-18', '2026-11-22']) assert.equal(price({ campaigns, serviceDate }).finalPrice, 500000);
  assert.equal(price({ campaigns: [sale({ enabled: false })] }).finalPrice, 500000);
});

test('each duration uses its own list price; missing service variants never fall back silently', () => {
  assert.equal(price({ duration: 90, campaigns: [sale()] }).finalPrice, 595000);
  const withoutVariants = { ...service, variants: [] };
  assert.equal(price({ service: withoutVariants }).finalPrice, 500000);
  assert.throws(() => price({ service: withoutVariants, duration: 90 }), errorCode('INVALID_DURATION'));
});

test('targets match service, operational category or exact service duration', () => {
  const specific = sale({ scopeType: 'service_variant', targets: [{ targetId: 'massage', durationMinutes: 90 }] });
  assert.equal(price({ duration: 90, campaigns: [specific] }).finalPrice, 595000);
  assert.equal(price({ campaigns: [specific] }).finalPrice, 500000);
  assert.equal(price({ campaigns: [sale({ scopeType: 'service', targets: [{ targetId: 'other' }] })] }).finalPrice, 500000);
  assert.equal(price({ campaigns: [sale({ scopeType: 'category', targets: [{ targetId: 'body-massages' }] })] }).finalPrice, 425000);
  assert.equal(price({ campaigns: [sale({ scopeType: 'category', targets: [{ targetId: 'body-massage' }] })] }).finalPrice, 500000,
    'a display therapy group must not accidentally match an operational category');
});

test('the greatest actual discount wins after caps, independent of advertised percentage', () => {
  const campaigns = [
    sale({ id: 'headline-20', percentageBps: 2000, maxDiscountVnd: 60000 }),
    sale({ id: 'fixed-70', discountType: 'fixed', percentageBps: null, fixedAmountVnd: 70000 }),
  ];
  const result = price({ campaigns });
  assert.equal(result.campaignId, 'fixed-70');
  assert.equal(result.discountAmount, 70000);
  assert.equal(result.finalPrice, 430000, 'multiple sales must never stack');
});

test('equal discounts prefer variant, service, category, then all-menu scope before recency', () => {
  const campaigns = [
    sale({ id: 'all', updatedAt: '2026-10-19T00:00:00.000Z' }),
    sale({ id: 'category', scopeType: 'category', targets: [{ targetId: service.category }] }),
    sale({ id: 'service', scopeType: 'service', targets: [{ targetId: service.id }] }),
    sale({ id: 'variant', scopeType: 'service_variant', targets: [{ targetId: service.id, durationMinutes: 60 }] }),
  ];
  assert.equal(price({ campaigns }).campaignId, 'variant');
  assert.equal(price({ campaigns: campaigns.slice(0, 3) }).campaignId, 'service');
  assert.equal(price({ campaigns: campaigns.slice(0, 2) }).campaignId, 'category');
});

test('same-kind scope prefers fewer targets, then latest update; exact ties use stable IDs', () => {
  const broad = sale({ id: 'broad', scopeType: 'service', targets: [{ targetId: service.id }, { targetId: 'another' }], updatedAt: '2026-10-19T00:00:00.000Z' });
  const narrow = sale({ id: 'narrow', scopeType: 'service', targets: [{ targetId: service.id }] });
  assert.equal(price({ campaigns: [broad, narrow] }).campaignId, 'narrow');
  const newer = { ...narrow, id: 'newer', revision: 2, updatedAt: '2026-10-19T00:00:00.000Z' };
  assert.equal(price({ campaigns: [narrow, newer] }).campaignId, 'newer');
  assert.equal(price({ campaigns: [sale({ id: 'z' }), sale({ id: 'a' })] }).campaignId, 'a');
});

test('quote selection is independent of database order and does not mutate frozen inputs', () => {
  const campaigns = deepFreeze([sale({ id: 'z' }), sale({ id: 'a' }), sale({ id: 'b', percentageBps: 1000 })]);
  const input = deepFreeze({ service: structuredClone(service), duration: 60, serviceDate: '2026-11-20', campaigns, evaluatedAt });
  const before = JSON.stringify(input);
  const forward = calculatePrice(input);
  const backward = calculatePrice({ ...input, campaigns: [...campaigns].reverse() });
  assert.deepEqual(backward, forward);
  assert.equal(JSON.stringify(input), before);
});

test('percentage rounding is integer VND and discounts cannot make totals negative', () => {
  const tiny = { ...service, variants: [{ duration: 60, price: 10001 }] };
  const result = price({ service: tiny, campaigns: [sale({ percentageBps: 3333 })] });
  assert.equal(result.discountAmount, 3333);
  assert.equal(result.finalPrice, 6668);
  for (const campaign of [sale({ percentageBps: 10000 }), sale({ discountType: 'fixed', percentageBps: null, fixedAmountVnd: 1000000 })]) {
    assert.equal(price({ campaigns: [campaign] }).finalPrice, 0);
  }
});

test('a valid coupon stacks additively with a qualifying holiday sale on the list price', () => {
  const result = price({ campaigns: [sale()], promoCode: 'save10', coupon: coupon() });
  assert.equal(result.originalPrice, 500000);
  assert.equal(result.discountAmount, 125000);
  assert.equal(result.finalPrice, 375000);
  assert.equal(result.promoCode, 'SAVE10');
  assert.equal(result.discountSource, 'holiday_sale_and_coupon');
  assert.equal(result.discountDetails.stacking, 'additive_on_list_price');
});

test('an invalid or inactive requested coupon is rejected even when a holiday sale qualifies', () => {
  for (const record of [coupon({ active: false }), null]) {
    assert.throws(() => price({ campaigns: [sale()], promoCode: 'save10', coupon: record }), errorCode('PROMO_INVALID'));
  }
});

test('without a matching sale only explicitly requested coupons are applied', () => {
  assert.equal(price({ coupon: coupon() }).finalPrice, 500000);
  const result = price({ campaigns: [sale({ enabled: false })], promoCode: ' save10 ', coupon: coupon() });
  assert.equal(result.finalPrice, 450000);
  assert.equal(result.discountSource, 'coupon');
  assert.equal(result.promoCode, 'SAVE10');
  assert.equal(result.campaignId, null);
});

test('valid existing coupon amounts remain compatible with the current promotion module', () => {
  for (const record of [coupon(), coupon({ value: 12.5 }), coupon({ maxDiscount: 30000 }), coupon({ type: 'fixed', value: 900000 })]) {
    const result = price({ coupon: record, promoCode: record.code });
    assert.equal(result.discountAmount, promotionService.discountFor(record, 500000));
  }
});

test('coupon dates use explicit evaluation time in Vietnam; sale dates still use serviceDate', () => {
  const record = coupon({ expiresAt: '2026-11-19' });
  assert.equal(price({ promoCode: record.code, coupon: record, evaluatedAt: '2026-11-19T16:59:59.999Z' }).finalPrice, 450000);
  assert.throws(() => price({ promoCode: record.code, coupon: record, evaluatedAt: '2026-11-19T17:00:00.000Z' }), errorCode('PROMO_EXPIRED'));
});

test('invalid, not started, expired, exhausted and minimum-order coupons reject instead of silently charging full price', () => {
  for (const [record, code] of [
    [null, 'PROMO_INVALID'], [coupon({ active: false }), 'PROMO_INVALID'], [coupon({ type: 'unexpected' }), 'PROMO_INVALID'],
    [coupon({ startDate: '2026-12-01' }), 'PROMO_NOT_STARTED'], [coupon({ expiresAt: '2026-10-18' }), 'PROMO_EXPIRED'],
    [coupon({ usedCount: 100 }), 'PROMO_LIMIT'], [coupon({ minOrder: 600000 }), 'PROMO_MIN'],
    [coupon({ value: -5 }), 'PROMO_INVALID'], [coupon({ maxDiscount: -1 }), 'PROMO_INVALID'],
  ]) assert.throws(() => price({ coupon: record, promoCode: 'SAVE10' }), errorCode(code));
});

test('packages use their own configured variant price without component discounts', () => {
  const pkg = { id: 'package', kind: 'package', category: 'packages', active: true, components: ['massage'], variants: [{ duration: 90, price: 1000000 }] };
  const componentSale = sale({ scopeType: 'service', targets: [{ targetId: 'massage' }], percentageBps: 9000 });
  assert.equal(price({ service: pkg, duration: 90, campaigns: [componentSale] }).finalPrice, 1000000);
  assert.equal(price({ service: pkg, duration: 90, campaigns: [componentSale, sale({ id: 'all' })] }).finalPrice, 850000);
});

test('malformed campaign configurations and duplicate campaign IDs fail explicitly', () => {
  for (const patch of [
    { percentageBps: 0 }, { percentageBps: 10001 }, { percentageBps: 1500.5 }, { fixedAmountVnd: 1000 },
    { maxDiscountVnd: 0 }, { enabled: 1 }, { serviceDateFrom: '2026-02-30' }, { serviceDateTo: '2026-11-19' },
    { revision: 0 }, { updatedAt: 'yesterday' }, { scopeType: 'unknown' },
    { scopeType: 'service', targets: [] }, { targets: [{ targetId: 'massage' }] },
    { scopeType: 'service', targets: [{ targetId: 'massage' }, { targetId: 'massage' }] },
  ]) assert.throws(() => price({ campaigns: [sale(patch)] }), errorCode('HOLIDAY_SALE_INVALID'));
  assert.throws(() => price({ campaigns: [sale(), sale()] }), errorCode('HOLIDAY_SALE_INVALID'));
});

test('campaign validation checks target existence and actual service variants when a catalog is supplied', () => {
  const catalogs = { services: [service], categories: [{ id: service.category }] };
  assert.equal(normalizeHolidaySale(sale({ scopeType: 'service_variant', targets: [{ targetId: 'massage', durationMinutes: 90 }] }), catalogs).targets.length, 1);
  for (const patch of [
    { scopeType: 'service', targets: [{ targetId: 'missing' }] },
    { scopeType: 'category', targets: [{ targetId: 'missing' }] },
    { scopeType: 'service_variant', targets: [{ targetId: 'massage', durationMinutes: 30 }] },
  ]) assert.throws(() => normalizeHolidaySale(sale(patch), catalogs), errorCode('HOLIDAY_SALE_INVALID'));
});

test('repricing distinguishes a lower total from the actual amount to refund', () => {
  for (const [paid, due, refund] of [[0, 800000, 0], [300000, 500000, 0], [1000000, 0, 200000]]) {
    const paymentRecords = paid ? [{ type: 'deposit', amount: paid }] : [];
    const result = calculateRescheduleAdjustment({ oldFinalPrice: 1000000, newFinalPrice: 800000, paymentRecords });
    assert.equal(result.priceDelta, -200000);
    assert.equal(result.netPaid, paid);
    assert.equal(result.amountDue, due);
    assert.equal(result.refundDue, refund);
  }
});

test('repricing respects earlier refunds, zero totals and amounts still owed after a price increase', () => {
  const paymentRecords = deepFreeze([{ type: 'deposit', amount: 300000 }, { type: 'payment', amount: 700000 }, { type: 'refund', amount: 100000 }]);
  assert.deepEqual(calculateRescheduleAdjustment({ oldFinalPrice: 1000000, newFinalPrice: 1200000, paymentRecords }), {
    oldFinalPrice: 1000000, newFinalPrice: 1200000, priceDelta: 200000,
    collected: 1000000, refunded: 100000, netPaid: 900000, amountDue: 300000, refundDue: 0,
  });
  assert.equal(calculateRescheduleAdjustment({ oldFinalPrice: 1000000, newFinalPrice: 0, paymentRecords }).refundDue, 900000);
});

test('invalid payment histories and unsafe money values cannot produce a settlement', () => {
  for (const paymentRecords of [null, [{ type: 'payment', amount: -1 }], [{ type: 'unknown', amount: 10 }], [{ type: 'refund', amount: 1 }]]) {
    assert.throws(() => calculateRescheduleAdjustment({ oldFinalPrice: 500000, newFinalPrice: 500000, paymentRecords }), errorCode('INVALID_PAYMENT_HISTORY'));
  }
  assert.throws(() => calculateRescheduleAdjustment({ oldFinalPrice: 1.5, newFinalPrice: 1 }), errorCode('INVALID_PRICE'));
});
