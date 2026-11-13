const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function businessDate(timestamp) {
  const value = Date.parse(timestamp || '');
  if (!Number.isFinite(value)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function safeAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function businessMonthParts(year, month) {
  const firstDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { firstDate, lastDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`, daysInMonth };
}

/** Aggregate monthly cash movement and service activity without returning booking/customer PII. */
export function aggregateMonthlyAnalytics({ bookings = [], year, month } = {}) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('A valid year and month are required.');
  }
  const { firstDate, lastDate, daysInMonth } = businessMonthParts(year, month);
  const prefix = firstDate.slice(0, 7);
  const dailyCashFlow = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    const date = `${prefix}-${day}`;
    return { date, label: day, revenue: 0, collected: 0, refunded: 0 };
  });
  const dayIndex = new Map(dailyCashFlow.map((row, index) => [row.date, index]));
  const completed = [];
  let cancelledBookings = 0;
  const serviceGroups = new Map();
  const cashByService = new Map();
  let collected = 0;
  let refunded = 0;

  for (const booking of Array.isArray(bookings) ? bookings : []) {
    if (!booking || typeof booking !== 'object') continue;
    const bookingDate = isValidDate(booking.date) ? booking.date : '';
    if (bookingDate.startsWith(prefix)) {
      if (booking.status === 'Completed') {
        completed.push(booking);
        const serviceId = String(booking.serviceId || booking.serviceName || 'unknown').slice(0, 200);
        const current = serviceGroups.get(serviceId) || {
          id: serviceId,
          name: String(booking.serviceName || booking.serviceId || 'Dịch vụ đã xóa').slice(0, 200),
          count: 0,
          revenue: 0,
        };
        current.count += 1;
        serviceGroups.set(serviceId, current);
      } else if (booking.status === 'Cancelled') cancelledBookings += 1;
    }

    const serviceId = String(booking.serviceId || booking.serviceName || 'unknown').slice(0, 200);
    for (const record of Array.isArray(booking.paymentRecords) ? booking.paymentRecords : []) {
      if (!record || typeof record !== 'object') continue;
      const amount = safeAmount(record.amount);
      if (!amount) continue;
      const date = businessDate(record.at);
      const index = dayIndex.get(date);
      if (index === undefined) continue;
      const daily = dailyCashFlow[index];
      if (record.type === 'refund') {
        refunded += amount;
        daily.refunded += amount;
        daily.revenue -= amount;
        cashByService.set(serviceId, (cashByService.get(serviceId) || 0) - amount);
      } else if (['deposit', 'payment'].includes(record.type) && record.refundable !== false) {
        collected += amount;
        daily.collected += amount;
        daily.revenue += amount;
        cashByService.set(serviceId, (cashByService.get(serviceId) || 0) + amount);
      }
    }
  }

  const uniqueCustomers = new Set(completed.map((booking) => {
    if (booking.userId) return `user:${String(booking.userId)}`;
    const phone = String(booking.customerPhone || '').replace(/\D/g, '');
    if (phone) return `phone:${phone}`;
    return `booking:${String(booking.id || '')}`;
  }));
  const completedValue = completed.reduce((sum, booking) => {
    const value = Number(booking.finalPrice);
    return sum + (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  }, 0);
  const topServices = [...serviceGroups.values()]
    .map((service) => ({
      ...service,
      share: completed.length ? Math.round((service.count / completed.length) * 1000) / 10 : 0,
      revenue: cashByService.get(service.id) || 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'))
    .slice(0, 5);

  return {
    year, month, timeZone: BUSINESS_TIME_ZONE, startDate: firstDate, endDate: lastDate,
    metrics: {
      collected, refunded, netCashFlow: collected - refunded,
      completedBookings: completed.length, cancelledBookings,
      customersServed: uniqueCustomers.size,
      averageBookingValue: completed.length ? Math.round(completedValue / completed.length) : 0,
    },
    dailyCashFlow,
    topServices,
  };
}

export function businessYearMonth(timestamp = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit',
  }).formatToParts(timestamp);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
  };
}
