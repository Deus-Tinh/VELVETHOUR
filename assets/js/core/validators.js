/**
 * Validators dùng chung cho UI và Business layer.
 * Mỗi rule trả về chuỗi lỗi (string) hoặc null nếu hợp lệ.
 * validate(values, schema) → { valid, errors:{field:message} }
 */
import { isValidDateStr, isValidTimeStr, todayStr } from './utils.js';

const blank = (v) => v == null || String(v).trim() === '';

export const required = (msg = 'Trường này là bắt buộc') => (v) => (blank(v) ? msg : null);
export const text = (msg = 'Vui lòng nhập dữ liệu dạng văn bản') => (v) =>
  (v == null || typeof v === 'string' ? null : msg);
export const email = (msg = 'Email không hợp lệ') => (v) =>
  (blank(v) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()) ? null : msg);
/** SĐT Việt Nam: 0xxxxxxxxx (10 số) hoặc +84xxxxxxxxx; đầu số 3,5,7,8,9. */
export const phoneVN = (msg = 'Số điện thoại Việt Nam không hợp lệ') => (v) =>
  (blank(v) || /^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/.test(String(v).replace(/[\s.-]/g, '')) ? null : msg);
export const minLength = (n, msg) => (v) => (blank(v) || String(v).trim().length >= n ? null : msg || `Tối thiểu ${n} ký tự`);
export const maxLength = (n, msg) => (v) => (blank(v) || String(v).trim().length <= n ? null : msg || `Tối đa ${n} ký tự`);
export function isStrongPassword(value) {
  return typeof value === 'string' && value.length >= 8 && /[0-9]/.test(value) && /[\p{P}\p{S}]/u.test(value);
}
export const strongPassword = (msg = 'Mật khẩu cần tối thiểu 8 ký tự, có ít nhất 1 chữ số và 1 ký tự đặc biệt') =>
  (v) => (blank(v) || isStrongPassword(String(v)) ? null : msg);
export const positiveNumber = (msg = 'Phải là số lớn hơn 0') => (v) => {
  if (blank(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? null : msg;
};
export const date = (msg = 'Ngày không hợp lệ (YYYY-MM-DD)') => (v) => (blank(v) || isValidDateStr(v) ? null : msg);
export const time = (msg = 'Giờ không hợp lệ (HH:MM)') => (v) => (blank(v) || isValidTimeStr(v) ? null : msg);
export const futureOrToday = (msg = 'Ngày không được ở quá khứ') => (v) => (blank(v) || !isValidDateStr(v) || v >= todayStr() ? null : msg);
/** Giá VND: số nguyên ≥ 10.000 và ≤ 100 triệu. */
export const price = (msg = 'Giá phải là số nguyên từ 10.000₫ đến 100.000.000₫') => (v) => {
  if (blank(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 10000 && n <= 100000000 ? null : msg;
};
/** Thời lượng phút: số nguyên 15–480, bội số của 5. */
export const duration = (msg = 'Thời lượng 15–480 phút (bội số của 5)') => (v) => {
  if (blank(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 15 && n <= 480 && n % 5 === 0 ? null : msg;
};
export const oneOf = (list, msg = 'Giá trị không hợp lệ') => (v) => (blank(v) || list.includes(v) ? null : msg);
export const matches = (getOther, msg = 'Giá trị không khớp') => (v, all) => (v === getOther(all) ? null : msg);

/** Chạy schema { field: [rule, rule…] }; lỗi đầu tiên của mỗi field được giữ lại. */
export function validate(values, schema) {
  const errors = {};
  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules) {
      const err = rule(values?.[field], values);
      if (err) { errors[field] = err; break; }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/* ---------- Schema dùng lại ở nhiều nơi ---------- */
export const schemas = {
  customerInfo: {
    name: [required('Vui lòng nhập họ tên'), text(), minLength(2), maxLength(60)],
    phone: [required('Vui lòng nhập số điện thoại'), text(), phoneVN()],
    email: [text(), email()],
    note: [text(), maxLength(300)],
  },
  register: {
    name: [required('Vui lòng nhập họ tên'), minLength(2), maxLength(60)],
    email: [required('Vui lòng nhập email'), email()],
    phone: [required('Vui lòng nhập số điện thoại'), phoneVN()],
    password: [required('Vui lòng nhập mật khẩu'), strongPassword()],
  },
  login: { email: [required('Vui lòng nhập email'), email()], password: [required('Vui lòng nhập mật khẩu')] },
  contact: {
    name: [required('Vui lòng nhập họ tên'), minLength(2)],
    phone: [required('Vui lòng nhập số điện thoại'), phoneVN()],
    email: [email()],
    subject: [maxLength(100)],
    message: [required('Vui lòng nhập nội dung'), minLength(10, 'Nội dung tối thiểu 10 ký tự'), maxLength(1000)],
  },
  service: {
    name: [required('Vui lòng nhập tên dịch vụ'), minLength(3), maxLength(80)],
    category: [required('Vui lòng chọn danh mục')],
    price: [required('Vui lòng nhập giá'), price()],
    duration: [required('Vui lòng nhập thời lượng'), duration()],
    shortDesc: [required('Vui lòng nhập mô tả ngắn'), maxLength(200)],
  },
  promotion: {
    code: [required('Vui lòng nhập mã'), minLength(3), maxLength(20)],
    value: [required('Vui lòng nhập giá trị'), positiveNumber()],
    expiresAt: [required('Vui lòng chọn ngày hết hạn'), date()],
  },
  staff: {
    name: [required('Vui lòng nhập tên'), minLength(2)],
    title: [required('Vui lòng nhập chức danh')],
  },
  review: { rating: [required('Vui lòng chọn số sao'), oneOf(['1', '2', '3', '4', '5', 1, 2, 3, 4, 5], 'Số sao từ 1 đến 5')], comment: [maxLength(500)] },
};
