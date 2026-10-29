function randomStrongPassword() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}!A1`;
}

export const TEST_PASSWORDS = Object.freeze({
  admin: randomStrongPassword(),
  staff: randomStrongPassword(),
  customer: randomStrongPassword(),
});

export const TEST_ACCOUNT_PASSWORDS = Object.freeze({
  'admin@example.invalid': TEST_PASSWORDS.admin,
  'linh@example.invalid': TEST_PASSWORDS.staff,
  'trang@example.invalid': TEST_PASSWORDS.staff,
  'khach@example.invalid': TEST_PASSWORDS.customer,
  'bao@example.invalid': TEST_PASSWORDS.customer,
});
