/**
 * AppError — lỗi nghiệp vụ có mã (code) và chi tiết theo trường (fields).
 * UI hiển thị `message`, form dùng `fields` để tô đỏ từng ô nhập.
 */
export class AppError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fields = fields;
  }
}

/** Chuyển bất kỳ lỗi nào thành thông điệp thân thiện cho người dùng. */
export function toMessage(err) {
  if (err instanceof AppError) return err.message;
  console.error('[Unexpected error]', err);
  return 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
}
