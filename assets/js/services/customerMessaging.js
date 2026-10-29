function dateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value || 'ngày hẹn';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long', timeZone: 'Asia/Ho_Chi_Minh' })
    .format(new Date(Date.UTC(year, month - 1, day, 5)));
}

function normalizePhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('84')) phone = `0${phone.slice(2)}`;
  return phone;
}

export function bookingMessage(booking, kind = 'confirmation', settings = {}) {
  const spaName = settings.spaName || 'Serenity Spa & Wellness';
  const greeting = `Chào ${booking.customerName || 'Quý khách'},`;
  const details = [
    `Mã lịch: ${booking.code}`,
    `Dịch vụ: ${booking.serviceName}`,
    `Thời gian: ${booking.startTime} ngày ${dateLabel(booking.date)}`,
    `Chuyên viên: ${booking.staffName}`,
    ...(booking.roomNumber ? [`Phòng: ${booking.roomNumber}`] : []),
  ].join('\n');
  if (kind === 'reminder') {
    return `${spaName} xin nhắc ${booking.customerName || 'Quý khách'} về lịch hẹn sắp tới:\n${details}\nSpa mong được đón tiếp quý khách. Nếu cần đổi lịch, vui lòng liên hệ ${settings.phone || 'spa'}.`;
  }
  const pendingText = booking.status === 'Pending' ? 'đã nhận yêu cầu đặt lịch và sẽ sớm liên hệ xác nhận' : 'xác nhận lịch hẹn của quý khách';
  return `${spaName} ${pendingText}.\n${greeting}\n${details}\nTổng dịch vụ: ${new Intl.NumberFormat('vi-VN').format(Number(booking.finalPrice) || 0)}đ\nCảm ơn quý khách đã chọn ${spaName}. Cần hỗ trợ, vui lòng gọi ${settings.phone || 'spa'}.`;
}

export function rebookingMessage(customer, settings = {}) {
  const name = customer.name || 'Quý khách';
  const spaName = settings.spaName || 'Serenity Spa & Wellness';
  const lastService = customer.lastService ? ` Lần trước bạn đã trải nghiệm ${customer.lastService}.` : '';
  return `${spaName} thân chào ${name}!${lastService} Khi muốn thư giãn hoặc chăm sóc sức khỏe, hãy nhắn lại để spa tư vấn và giữ lịch phù hợp nhé. Hotline: ${settings.phone || 'liên hệ spa'}.`;
}

export function customerChannelLinks({ phone, email, message }) {
  const normalizedPhone = normalizePhone(phone);
  const safeEmail = String(email || '').trim();
  return {
    zalo: normalizedPhone ? `https://zalo.me/${normalizedPhone}` : '',
    sms: normalizedPhone ? `sms:${normalizedPhone}?body=${encodeURIComponent(message)}` : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail) ? `mailto:${encodeURI(safeEmail)}?subject=${encodeURIComponent('Serenity Spa & Wellness')}&body=${encodeURIComponent(message)}` : '',
  };
}
