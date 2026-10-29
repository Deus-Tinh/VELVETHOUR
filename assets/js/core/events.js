/**
 * Event bus dựa trên EventTarget. Repository phát 'data:changed' mỗi khi ghi dữ liệu
 * để các trang đang mở (dashboard, danh sách) render lại — nguồn dữ liệu duy nhất.
 */
export const bus = new EventTarget();

export function emit(name, detail = {}) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, handler) {
  const wrapped = (e) => handler(e.detail);
  bus.addEventListener(name, wrapped);
  return () => bus.removeEventListener(name, wrapped);
}
