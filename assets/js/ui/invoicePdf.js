import { apiClient } from '../services/apiClient.js';
import { formatDate, formatDateTime, formatVND } from '../core/utils.js';

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;

function text(context, value, x, y, options = {}) {
  context.font = options.font || '400 24px Arial, sans-serif';
  context.fillStyle = options.color || '#29251f';
  context.textAlign = options.align || 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(String(value ?? ''), x, y);
}

function wrappedText(context, value, x, y, maxWidth, lineHeight, options = {}) {
  context.font = options.font || '400 24px Arial, sans-serif';
  context.fillStyle = options.color || '#29251f';
  context.textAlign = options.align || 'left';
  context.textBaseline = 'alphabetic';
  const words = String(value ?? '').split(/\s+/);
  let line = '';
  let lineY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else line = candidate;
  }
  if (line) context.fillText(line, x, lineY);
  return lineY;
}

function divider(context, y, x = 96, width = PAGE_WIDTH - 192) {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.strokeStyle = '#e8e0d5';
  context.lineWidth = 2;
  context.stroke();
}

function formatPaidAt(value) {
  if (!value) return '—';
  return formatDateTime(value);
}

function drawInvoice(invoice) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không thể tạo nội dung hóa đơn.');

  const margin = 96;
  const contentWidth = PAGE_WIDTH - margin * 2;
  const merchant = invoice.merchant || {};
  const customer = invoice.customer || {};
  const booking = invoice.booking || {};
  const payment = invoice.payment || {};

  context.fillStyle = '#fbf9f5';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = '#ffffff';
  context.fillRect(42, 42, PAGE_WIDTH - 84, PAGE_HEIGHT - 84);
  context.fillStyle = '#855b42';
  context.fillRect(42, 42, PAGE_WIDTH - 84, 14);

  context.fillStyle = '#855b42';
  context.beginPath();
  context.roundRect(margin, 92, 70, 70, 16);
  context.fill();
  text(context, 'S', margin + 35, 143, { font: '700 43px Georgia, serif', color: '#ffffff', align: 'center' });
  text(context, merchant.name || 'Serenity Spa & Wellness', margin + 94, 120, { font: '700 29px Arial, sans-serif', color: '#33281f' });
  text(context, merchant.address || '', margin + 94, 158, { font: '400 18px Arial, sans-serif', color: '#756b61' });
  text(context, [merchant.phone, merchant.email].filter(Boolean).join(' · '), margin + 94, 190,
    { font: '400 18px Arial, sans-serif', color: '#756b61' });

  text(context, 'HÓA ĐƠN', PAGE_WIDTH - margin, 117, { font: '700 43px Arial, sans-serif', color: '#33281f', align: 'right' });
  text(context, 'THANH TOÁN DỊCH VỤ', PAGE_WIDTH - margin, 153, { font: '600 18px Arial, sans-serif', color: '#855b42', align: 'right' });
  context.fillStyle = '#e9f4ee';
  context.beginPath();
  context.roundRect(PAGE_WIDTH - margin - 166, 171, 166, 40, 20);
  context.fill();
  text(context, 'ĐÃ THANH TOÁN', PAGE_WIDTH - margin - 83, 198, { font: '700 15px Arial, sans-serif', color: '#18745c', align: 'center' });
  divider(context, 244);

  text(context, 'THÔNG TIN KHÁCH HÀNG', margin, 294, { font: '700 17px Arial, sans-serif', color: '#855b42' });
  text(context, customer.name || 'Khách hàng', margin, 336, { font: '700 27px Arial, sans-serif', color: '#29251f' });
  text(context, `Điện thoại: ${customer.phone || '—'}`, margin, 372, { font: '400 20px Arial, sans-serif', color: '#5b544d' });
  text(context, `Email: ${customer.email || '—'}`, margin, 405, { font: '400 20px Arial, sans-serif', color: '#5b544d' });

  const rightX = PAGE_WIDTH - margin;
  text(context, 'MÃ HÓA ĐƠN', rightX, 294, { font: '700 17px Arial, sans-serif', color: '#855b42', align: 'right' });
  text(context, invoice.number || `SER-${booking.code || ''}`, rightX, 336, { font: '700 24px Arial, sans-serif', color: '#29251f', align: 'right' });
  text(context, `Ngày phát hành: ${formatPaidAt(invoice.issuedAt || payment.paidAt)}`, rightX, 372, { font: '400 19px Arial, sans-serif', color: '#5b544d', align: 'right' });
  text(context, `Mã đặt lịch: ${booking.code || '—'}`, rightX, 405, { font: '400 19px Arial, sans-serif', color: '#5b544d', align: 'right' });
  divider(context, 450);

  text(context, 'CHI TIẾT DỊCH VỤ', margin, 500, { font: '700 17px Arial, sans-serif', color: '#855b42' });
  context.fillStyle = '#f5f1eb';
  context.fillRect(margin, 526, contentWidth, 58);
  text(context, 'DỊCH VỤ / LỊCH HẸN', margin + 22, 563, { font: '700 16px Arial, sans-serif', color: '#62574e' });
  text(context, 'THÀNH TIỀN', rightX - 22, 563, { font: '700 16px Arial, sans-serif', color: '#62574e', align: 'right' });

  wrappedText(context, booking.serviceName || 'Dịch vụ spa', margin + 22, 630, contentWidth - 260, 31,
    { font: '700 24px Arial, sans-serif', color: '#29251f' });
  const time = [booking.date ? formatDate(booking.date) : '', booking.startTime && booking.endTime ? `${booking.startTime}–${booking.endTime}` : booking.startTime]
    .filter(Boolean).join(' · ');
  text(context, `Mã lịch ${booking.code || '—'}${time ? ` · ${time}` : ''}`, margin + 22, 675,
    { font: '400 18px Arial, sans-serif', color: '#756b61' });
  text(context, booking.duration ? `${booking.duration} phút${booking.staffName ? ` · ${booking.staffName}` : ''}` : (booking.staffName || ''), margin + 22, 707,
    { font: '400 18px Arial, sans-serif', color: '#756b61' });
  text(context, formatVND(booking.originalPrice || booking.total || payment.amount), rightX - 22, 644,
    { font: '600 21px Arial, sans-serif', color: '#29251f', align: 'right' });
  divider(context, 748);

  let amountY = 805;
  text(context, 'Giá dịch vụ', PAGE_WIDTH - margin - 330, amountY, { font: '400 20px Arial, sans-serif', color: '#62574e' });
  text(context, formatVND(booking.originalPrice || booking.total || payment.amount), rightX, amountY,
    { font: '400 20px Arial, sans-serif', color: '#29251f', align: 'right' });
  amountY += 48;
  if (Number(booking.discountAmount) > 0) {
    text(context, 'Ưu đãi', PAGE_WIDTH - margin - 330, amountY, { font: '400 20px Arial, sans-serif', color: '#18745c' });
    text(context, `− ${formatVND(booking.discountAmount)}`, rightX, amountY,
      { font: '400 20px Arial, sans-serif', color: '#18745c', align: 'right' });
    amountY += 48;
  }
  divider(context, amountY - 16, PAGE_WIDTH - margin - 390, 390);
  amountY += 35;
  text(context, 'TỔNG THANH TOÁN', PAGE_WIDTH - margin - 390, amountY, { font: '700 19px Arial, sans-serif', color: '#33281f' });
  text(context, formatVND(payment.amount || booking.total), rightX, amountY,
    { font: '700 28px Arial, sans-serif', color: '#855b42', align: 'right' });

  context.fillStyle = '#f8f5f0';
  context.beginPath();
  context.roundRect(margin, 1010, contentWidth, 174, 16);
  context.fill();
  text(context, 'THÔNG TIN THANH TOÁN', margin + 26, 1054, { font: '700 17px Arial, sans-serif', color: '#855b42' });
  text(context, `Phương thức: ${payment.method || 'Chuyển khoản ngân hàng'}`, margin + 26, 1098,
    { font: '400 20px Arial, sans-serif', color: '#514a43' });
  text(context, `Thời gian: ${formatPaidAt(payment.paidAt || invoice.issuedAt)}`, margin + 26, 1136,
    { font: '400 20px Arial, sans-serif', color: '#514a43' });
  wrappedText(context, `Mã giao dịch: ${payment.reference || '—'}`, margin + 26, 1172, contentWidth - 52, 28,
    { font: '400 18px Arial, sans-serif', color: '#514a43' });

  divider(context, 1532);
  text(context, 'Cảm ơn Quý khách đã lựa chọn Serenity Spa & Wellness.', PAGE_WIDTH / 2, 1582,
    { font: '600 22px Arial, sans-serif', color: '#855b42', align: 'center' });
  text(context, 'Chứng từ ghi nhận khoản thanh toán cho dịch vụ đặt lịch.', PAGE_WIDTH / 2, 1622,
    { font: '400 17px Arial, sans-serif', color: '#756b61', align: 'center' });
  text(context, `Địa chỉ: ${merchant.address || 'Serenity Spa & Wellness'}`, PAGE_WIDTH / 2, 1658,
    { font: '400 16px Arial, sans-serif', color: '#8b8178', align: 'center' });
  return canvas;
}

function combineBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function makePdf(jpegBytes) {
  const encoder = new TextEncoder();
  const ascii = (value) => encoder.encode(value);
  const content = ascii('q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n');
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    combineBytes([ascii(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`), jpegBytes, ascii('\nendstream')]),
    combineBytes([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('endstream')]),
  ];
  const parts = [ascii('%PDF-1.4\n% Serenity invoice\n')];
  const offsets = [0];
  let position = parts[0].length;
  for (let index = 0; index < objects.length; index += 1) {
    const object = combineBytes([ascii(`${index + 1} 0 obj\n`), objects[index], ascii('\nendobj\n')]);
    offsets.push(position);
    parts.push(object);
    position += object.length;
  }
  const xrefOffset = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(ascii(xref));
  return combineBytes(parts);
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Không thể kết xuất hóa đơn PDF.')), 'image/jpeg', 0.94);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function downloadBookingInvoice(bookingId) {
  const result = await apiClient.getBookingInvoice(bookingId);
  if (!result.invoice) throw new Error('Chưa có dữ liệu hóa đơn cho lịch hẹn này.');
  const canvas = drawInvoice(result.invoice);
  const pdf = makePdf(await canvasToJpeg(canvas));
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const link = document.createElement('a');
  const safeNumber = String(result.invoice.number || result.invoice.booking?.code || 'serenity-invoice').replace(/[^a-z0-9_-]/gi, '-');
  link.href = url;
  link.download = `${safeNumber}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return link.download;
}

export function bindInvoiceDownloadButtons(container) {
  container?.querySelectorAll('[data-download-invoice]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = 'Đang tạo PDF…';
      try {
        await downloadBookingInvoice(button.dataset.downloadInvoice);
        button.textContent = 'Đã tải hóa đơn PDF';
      } catch (error) {
        button.textContent = 'Thử tải lại hóa đơn';
        button.title = error.message || 'Không tải được hóa đơn PDF.';
      } finally {
        setTimeout(() => {
          if (!button.isConnected) return;
          button.disabled = false;
          button.textContent = originalLabel;
        }, 2200);
      }
    });
  });
}
