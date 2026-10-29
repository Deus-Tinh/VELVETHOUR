/**
 * Store trạng thái giao diện: getState / setState / subscribe / unsubscribe.
 * Dữ liệu nghiệp vụ nằm ở repositories; store chỉ giữ trạng thái "đang thao tác" của UI.
 */
const initial = {
  currentUser: null,
  selectedService: null,
  selectedVariant: null,
  selectedStaff: null,
  selectedDate: null,
  selectedTime: null,
  bookingDraft: null,
  searchQuery: '',
  filters: { category: 'all', status: 'active', minPrice: '', maxPrice: '', duration: 'all' },
  sort: 'featured',
  pagination: { page: 1, pageSize: 6 },
  modalState: { open: false, type: null, payload: null },
  toastState: [],
};

let state = structuredClone(initial);
const listeners = new Set();

export const getState = () => state;

/** Chấp nhận object hoặc hàm (prev)=>partial. Chỉ thông báo khi key thật sự đổi. */
export function setState(partial) {
  const patch = typeof partial === 'function' ? partial(state) : partial;
  const changedKeys = Object.keys(patch).filter((k) => state[k] !== patch[k]);
  if (!changedKeys.length) return;
  const prev = state;
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    if (!l.keys || l.keys.some((k) => changedKeys.includes(k))) l.fn(state, prev, changedKeys);
  });
}

/** subscribe(fn) hoặc subscribe(['filters','sort'], fn). Trả về hàm hủy đăng ký. */
export function subscribe(keysOrFn, maybeFn) {
  const entry = typeof keysOrFn === 'function' ? { keys: null, fn: keysOrFn } : { keys: keysOrFn, fn: maybeFn };
  listeners.add(entry);
  return () => listeners.delete(entry);
}
export function unsubscribe(unsub) { if (typeof unsub === 'function') unsub(); }

export function resetState(keys) {
  const fresh = structuredClone(initial);
  const patch = {};
  (keys || Object.keys(initial)).forEach((k) => { patch[k] = fresh[k]; });
  state = { ...state, ...patch };
  listeners.forEach((l) => l.fn(state, state, Object.keys(patch)));
}
