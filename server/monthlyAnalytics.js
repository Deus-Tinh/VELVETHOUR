import { BUSINESS_TZ, isValidDateStr } from '../assets/js/core/utils.js';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const transactionTime = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

export class AnalyticsDataError extends Error {}

function validPeriod(year, month) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    && Number.isInteger(month) && month >= 1 && month <= 12;
}

export function businessYearMonth(timestamp = new Date()) {
  const parts = dateFormatter.formatToParts(timestamp);
  return {
    year: Number(parts.find((part) => part.type === 'year').value),
    month: Number(parts.find((part) => part.type === 'month').value),
  };
}

export function parseAnalyticsPeriod(params) {
  const years = params.getAll('year');
  const months = params.getAll('month');
  if (!years.length && !months.length) return businessYearMonth();
  if (years.length !== 1 || months.length !== 1 || !/^\d{4}$/.test(years[0]) || !/^\d{1,2}$/.test(months[0])) return null;
  const year = Number(years[0]);
  const month = Number(months[0]);
  return validPeriod(year, month) ? { year, month } : null;
}

function amountInVnd(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return 0;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function addVnd(total, amount) {
  const sum = total + amount;
  if (!Number.isSafeInteger(sum)) throw new AnalyticsDataError('Tổng số tiền vượt giới hạn tính toán của báo cáo.');
  return sum;
}

function serviceKey(booking) {
  if (booking.serviceId) return `id:${booking.serviceId}`;
  return booking.serviceName ? `name:${booking.serviceName}` : 'unknown';
}

function customerPhoneKey(booking) {
  const phone = String(booking.customerPhone || '').trim().replace(/[\s().-]/g, '').replace(/^\+?84(?=\d{9}$)/, '0');
  return /^0[35789]\d{8}$/.test(phone) ? phone : '';
}

function customerNameKey(booking) {
  return String(booking.customerName || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function accountsByBookingPhone(bookings) {
  const accounts = new Map();
  for (const booking of bookings) {
    if (!booking.userId) continue;
    const phone = customerPhoneKey(booking);
    if (!phone) continue;

    const contact = accounts.get(phone) || { userId: booking.userId, names: new Set(), shared: false };
    if (contact.userId !== booking.userId) contact.shared = true;
    const name = customerNameKey(booking);
    if (name) contact.names.add(name);
    accounts.set(phone, contact);
  }
  return accounts;
}

function customerKey(booking, accounts) {
  if (booking.userId) return `user:${booking.userId}`;
  const phone = customerPhoneKey(booking);
  if (!phone) return `booking:${booking.id}`;

  const name = customerNameKey(booking);
  const account = accounts.get(phone);
  if (account && !account.shared && (!name || !account.names.size || account.names.has(name))) {
    return `user:${account.userId}`;
  }
  return `guest:${phone}:${name}`;
}

function postedMovement(record) {
  if (!record || !['deposit', 'payment', 'refund'].includes(record.type)) return null;
  const refund = record.type === 'refund';
  if (!refund && record.refundable === false) return null;
  if (record.status != null && record.status !== 'completed' && (refund || record.status !== 'paid')) return null;
  const amount = amountInVnd(record.amount);
  if (!amount || typeof record.at !== 'string' || !transactionTime.test(record.at) || !isValidDateStr(record.at.slice(0, 10))) return null;
  const time = Date.parse(record.at);
  if (!Number.isFinite(time)) return null;

  // Always use the recorded transaction instant, never the server's local zone or the appointment date.
  const date = dateFormatter.format(new Date(time));
  return { id: String(record.id || '').trim(), time, date, amount, refund };
}

function collectMovements(bookings, monthPrefix) {
  const movements = new Map();
  for (const booking of bookings) {
    const service = serviceKey(booking);
    for (const record of Array.isArray(booking.paymentRecords) ? booking.paymentRecords : []) {
      const movement = postedMovement(record);
      if (!movement) continue;
      const inPeriod = movement.date.startsWith(monthPrefix);

      // The VietQR confirmation endpoint creates a new timestamp ID on every confirmation.
      // There is one initial manual confirmation per booking; later instalments use other record IDs.
      const manual = !movement.refund && movement.id.startsWith('pay_manual_');
      const key = manual
        ? JSON.stringify(['vietqr', booking.id])
        : movement.id
          ? JSON.stringify(['id', movement.id])
          : JSON.stringify(['legacy', booking.id, movement.time, movement.refund, movement.amount, record.method, record.reference]);
      const previous = movements.get(key);
      if (!previous) {
        movements.set(key, { ...movement, service, conflict: false, inPeriod });
        continue;
      }

      const disagreement = previous.refund !== movement.refund || previous.amount !== movement.amount
        || previous.service !== service || (!manual && previous.date !== movement.date);
      const flags = { conflict: previous.conflict || disagreement, inPeriod: previous.inPeriod || inPeriod };
      // Retain the first confirmed instant even if a retry happened in a later month.
      if (movement.time < previous.time) movements.set(key, { ...movement, service, ...flags });
      else Object.assign(previous, flags);
    }
  }
  return movements.values();
}

/** Aggregate cash movement and appointment activity without returning customer or payment details. */
export function aggregateMonthlyAnalytics({ bookings = [], year, month } = {}) {
  if (!validPeriod(year, month)) throw new RangeError('A valid year and month are required.');
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dailyCashFlow = Array.from({ length: daysInMonth }, (_, index) => {
    const label = String(index + 1).padStart(2, '0');
    return { date: prefix + label, label, revenue: 0, collected: 0, refunded: 0 };
  });
  const days = new Map(dailyCashFlow.map((row) => [row.date, row]));
  const customers = new Set();
  const serviceGroups = new Map();
  const cashByService = new Map();
  let completedBookings = 0;
  let cancelledBookings = 0;
  let completedValue = 0;
  let collected = 0;
  let refunded = 0;
  const bookingRows = bookings.filter((row) => row && typeof row === 'object');
  // Older bookings can reveal a shared contact number without adding customers to this month.
  const accounts = accountsByBookingPhone(bookingRows);

  for (const booking of bookingRows) {
    if (!days.has(booking.date)) continue;
    if (booking.status === 'Cancelled') cancelledBookings++;
    if (booking.status !== 'Completed') continue;

    completedBookings++;
    completedValue = addVnd(completedValue, amountInVnd(booking.finalPrice));
    customers.add(customerKey(booking, accounts));
    const key = serviceKey(booking);
    const group = serviceGroups.get(key) || {
      id: String(booking.serviceId || booking.serviceName || 'unknown'),
      name: String(booking.serviceName || booking.serviceId || 'Dịch vụ đã xóa'),
      count: 0,
    };
    group.count++;
    serviceGroups.set(key, group);
  }

  for (const movement of collectMovements(bookingRows, prefix)) {
    if (movement.conflict && movement.inPeriod) {
      throw new AnalyticsDataError('Có giao dịch trùng mã với thông tin không khớp trong kỳ. Hãy đối soát giao dịch trước khi sử dụng báo cáo.');
    }
    const daily = days.get(movement.date);
    if (!daily) continue;
    if (movement.refund) {
      refunded = addVnd(refunded, movement.amount);
      daily.refunded = addVnd(daily.refunded, movement.amount);
    } else {
      collected = addVnd(collected, movement.amount);
      daily.collected = addVnd(daily.collected, movement.amount);
    }
    daily.revenue = daily.collected - daily.refunded;
    const net = movement.refund ? -movement.amount : movement.amount;
    cashByService.set(movement.service, addVnd(cashByService.get(movement.service) || 0, net));
  }

  const topServices = [...serviceGroups]
    .map(([key, service]) => ({
      ...service,
      share: Math.round((service.count / completedBookings) * 1000) / 10,
      revenue: cashByService.get(key) || 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id))
    .slice(0, 5);

  return {
    year, month, timeZone: BUSINESS_TZ, startDate: dailyCashFlow[0].date, endDate: dailyCashFlow.at(-1).date,
    metrics: {
      collected, refunded, netCashFlow: collected - refunded,
      completedBookings, cancelledBookings, customersServed: customers.size,
      averageBookingValue: completedBookings ? Math.round(completedValue / completedBookings) : 0,
    },
    dailyCashFlow, topServices,
  };
}
