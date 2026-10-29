/**
 * Auth Service — Quản lý xác thực và phân quyền người dùng mô phỏng.
 * Vai trò: Guest, Customer, Staff, Admin.
 * Lưu trữ phiên hiện tại trong LocalStorage (serenity:v2:session).
 * Không lưu plaintext password; dùng SHA-256 có Salt (demo).
 */
import { userRepo } from '../data/repositories.js';
import { readJSON, writeJSON, removeKey } from '../core/storage.js';
import { hashPassword } from '../core/hash.js';
import { AppError } from '../core/errors.js';
import { validate, schemas, required, minLength, maxLength, email as emailRule, phoneVN, strongPassword } from '../core/validators.js';
import { emit } from '../core/events.js';
import { setState } from '../core/store.js';
import { apiClient } from './apiClient.js';

const SESSION_KEY = 'session';

export const authService = {
  /** Lấy thông tin người dùng đang đăng nhập trong phiên */
  getCurrentUser() {
    const session = readJSON(SESSION_KEY, null);
    if (!session || !session.userId) return null;
    const user = userRepo.getById(session.userId);
    if (!user || user.active === false) {
      this.logout();
      return null;
    }
    apiClient.setLocalRole(user.role);
    const { passwordHash: _p, salt: _s, ...safeUser } = user;
    return safeUser;
  },

  /** Đăng nhập */
  login({ email, password }) {
    const { valid, errors } = validate({ email, password }, schemas.login);
    if (!valid) throw new AppError('VALIDATION', 'Vui lòng kiểm tra email và mật khẩu.', errors);

    if (apiClient.isOnline()) {
      return apiClient.login({ email: String(email).trim(), password }).then(({ user }) => applyLogin(user));
    }

    const user = userRepo.findBy((u) => u.email.toLowerCase() === String(email).trim().toLowerCase())[0];
    if (!user || user.active === false) {
      throw new AppError('AUTH_FAILED', 'Gmail hoặc mật khẩu không chính xác. Vui lòng nhập lại.');
    }

    const testHash = hashPassword(password, user.salt);
    if (testHash !== user.passwordHash) {
      throw new AppError('AUTH_FAILED', 'Gmail hoặc mật khẩu không chính xác. Vui lòng nhập lại.');
    }

    return applyLogin(user);
  },

  /** Đăng ký tài khoản Customer mới */
  register({ name, email, phone, password }) {
    const { valid, errors } = validate({ name, email, phone, password }, schemas.register);
    if (!valid) throw new AppError('VALIDATION', 'Vui lòng kiểm tra lại thông tin đăng ký.', errors);

    if (apiClient.isOnline()) {
      return apiClient.register({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password })
        .then(({ user }) => applyLogin(user));
    }

    const emailDup = userRepo.findBy((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
    if (emailDup.length) throw new AppError('DUPLICATE_EMAIL', 'Email này đã được sử dụng.', { email: 'Email đã tồn tại' });

    const phoneDup = userRepo.findBy((u) => u.phone === String(phone).trim());
    if (phoneDup.length) throw new AppError('DUPLICATE_PHONE', 'Số điện thoại này đã được sử dụng.', { phone: 'SĐT đã tồn tại' });

    const salt = `salt_${Date.now()}`;
    const passwordHash = hashPassword(password, salt);

    const newUser = userRepo.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role: 'customer',
      salt,
      passwordHash,
      active: true,
      avatar: 'assets/images/staff-01.webp'
    });

    return this.login({ email, password });
  },

  /** Nhân viên chỉ kích hoạt tài khoản qua lời mời do admin cấp. */
  acceptStaffInvite({ token, phone, password }) {
    const { valid, errors } = validate({ phone }, { phone: [required('Vui lòng nhập số điện thoại'), phoneVN()] });
    if (!valid) throw new AppError('VALIDATION', 'Vui lòng kiểm tra số điện thoại.', errors);
    const passwordError = strongPassword()(password);
    if (passwordError) throw new AppError('VALIDATION', passwordError, { password: passwordError });
    if (!apiClient.isOnline()) throw new AppError('OFFLINE', 'Cần kết nối máy chủ ở cổng 3001 để kích hoạt lời mời.');
    return apiClient.acceptStaffInvite({ token, phone: phone.trim(), password }).then(({ user }) => applyLogin(user));
  },

  /** Đăng xuất */
  logout() {
    const pendingLogout = apiClient.isOnline()
      ? apiClient.logout().catch((error) => console.warn('[auth] Không thể kết thúc phiên trên máy chủ:', error.message))
      : Promise.resolve();
    removeKey(SESSION_KEY);
    setState({ currentUser: null });
    emit('auth:logout', null);
    return pendingLogout;
  },

  /** Cập nhật thông tin tài khoản */
  updateProfile(userId, { name, phone, email }) {
    const cur = userRepo.getById(userId);
    if (!cur) throw new AppError('NOT_FOUND', 'Không tìm thấy người dùng.');

    const actor = this.getCurrentUser();
    if (!actor || actor.id !== userId) throw new AppError('UNAUTHORIZED', 'Bạn chỉ có thể cập nhật hồ sơ của tài khoản đang đăng nhập.');

    const values = {
      name: name === undefined ? cur.name : name,
      phone: phone === undefined ? cur.phone : phone,
      email: email === undefined ? cur.email : email,
    };
    const { valid, errors } = validate(values, {
      name: [required('Vui lòng nhập họ tên'), minLength(2), maxLength(60)],
      phone: [required('Vui lòng nhập số điện thoại'), phoneVN()],
      email: [required('Vui lòng nhập email'), emailRule()],
    });
    if (!valid) throw new AppError('VALIDATION', 'Thông tin hồ sơ chưa hợp lệ.', errors);

    const normalizedEmail = values.email.trim().toLowerCase();
    if (userRepo.findBy((u) => u.id !== userId && u.email.toLowerCase() === normalizedEmail).length) {
      throw new AppError('DUPLICATE_EMAIL', 'Email này đã được sử dụng.', { email: 'Email đã tồn tại' });
    }
    const normalizedPhone = values.phone.trim();
    if (userRepo.findBy((u) => u.id !== userId && u.phone === normalizedPhone).length) {
      throw new AppError('DUPLICATE_PHONE', 'Số điện thoại này đã được sử dụng.', { phone: 'SĐT đã tồn tại' });
    }

    const patch = { name: values.name.trim(), phone: normalizedPhone, email: normalizedEmail };

    if (apiClient.isOnline()) {
      return apiClient.updateProfile(patch).then(({ user }) => {
        userRepo.update(userId, patch);
        writeJSON(SESSION_KEY, { userId, loggedInAt: new Date().toISOString() });
        setState({ currentUser: user });
        return user;
      });
    }

    const updated = userRepo.update(userId, patch);
    const { passwordHash: _p, salt: _s, ...safeUser } = updated;
    setState({ currentUser: safeUser });
    return safeUser;
  },

  /** Đổi mật khẩu */
  changePassword(userId, oldPassword, newPassword) {
    const user = userRepo.getById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'Người dùng không tồn tại.');
    const actor = this.getCurrentUser();
    if (!actor || actor.id !== userId) throw new AppError('UNAUTHORIZED', 'Bạn chỉ có thể đổi mật khẩu của tài khoản đang đăng nhập.');

    const passwordError = strongPassword()(newPassword);
    if (passwordError) throw new AppError('VALIDATION', passwordError);

    if (apiClient.isOnline()) return apiClient.changePassword({ oldPassword, newPassword }).then(() => true);

    if (hashPassword(oldPassword, user.salt) !== user.passwordHash) {
      throw new AppError('AUTH_FAILED', 'Mật khẩu hiện tại không chính xác.');
    }

    const salt = `salt_${Date.now()}`;
    userRepo.update(userId, {
      salt,
      passwordHash: hashPassword(newPassword, salt)
    });

    return true;
  }
};

function applyLogin(user) {
  if (!user) throw new AppError('AUTH_FAILED', 'Không thể thiết lập phiên đăng nhập.');
  if (!userRepo.getById(user.id)) userRepo.create(user);
  else userRepo.update(user.id, user);
  writeJSON(SESSION_KEY, { userId: user.id, loggedInAt: new Date().toISOString() });
  const { passwordHash: _hash, passwordSalt: _salt, salt: _oldSalt, ...safeUser } = user;
  setState({ currentUser: safeUser });
  emit('auth:login', safeUser);
  return safeUser;
}
