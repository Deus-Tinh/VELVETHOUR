import test from 'node:test';
import assert from 'node:assert/strict';
import { authService } from '../assets/js/services/authService.js';
import { apiClient } from '../assets/js/services/apiClient.js';
import { storage } from '../assets/js/core/storage.js';

const initialWindow = globalThis.window;
globalThis.window = {};
const { renderAuthPage } = await import('../assets/js/pages/authPage.js');
globalThis.window = initialWindow;

function createWindow(href) {
  let currentUrl = new URL(href);
  const location = {};
  for (const property of ['href', 'origin', 'pathname', 'search', 'hash']) {
    Object.defineProperty(location, property, { get: () => currentUrl[property] });
  }
  const history = {
    state: null,
    pushState(state, _title, url) { this.state = state; currentUrl = new URL(url, currentUrl); },
    replaceState(state, _title, url) { this.state = state; currentUrl = new URL(url, currentUrl); },
  };
  return { location, history, sessionStorage: { setItem() {}, removeItem() {} }, dispatchEvent() {} };
}

// An isolated form fixture: no browser, network requests, or application database.
function createDocument() {
  let elements = new Map();
  const document = { activeElement: null, getElementById: (id) => elements.get(id) || null };
  const makeElement = (id, attrs = {}) => {
    const classes = new Set();
    const listeners = new Map();
    return {
      id, value: '', textContent: '', disabled: false, style: {},
      dataset: { authMode: attrs['data-auth-mode'] },
      attributes: { ...attrs },
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      async dispatch(type) { return listeners.get(type)?.({ preventDefault() {} }); },
      focus() { document.activeElement = this; },
      querySelector(selector) {
        if (selector.startsWith('#')) return this.formElements.get(selector.slice(1)) || null;
        const field = selector.match(/^\[data-auth-error="(.+)"\]$/)?.[1];
        return [...this.formElements.values()].find((element) => element.attributes['data-auth-error'] === field) || null;
      },
      querySelectorAll() { return []; },
    };
  };
  const root = makeElement('appRoot');
  Object.defineProperty(root, 'innerHTML', {
    set(html) {
      elements = new Map([['appRoot', root]]);
      for (const tag of html.matchAll(/<(?:form|input|span|button|div)[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const attrs = Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [entry[1], entry[2]]));
        elements.set(tag[1], makeElement(tag[1], attrs));
      }
      for (const element of elements.values()) element.formElements = elements;
    },
  });
  elements.set('appRoot', root);
  return document;
}

test('Signup shows each validation error, preserves input, and allows correction', async () => {
  storage.useMemory();
  const originals = { document: globalThis.document, window: globalThis.window, online: apiClient.isOnline,
    register: apiClient.register, currentUser: authService.getCurrentUser };
  globalThis.document = createDocument();
  globalThis.window = createWindow('https://serenity.local/dang-ky?returnTo=booking');
  apiClient.isOnline = () => true;
  authService.getCurrentUser = () => null;
  let requests = 0;
  apiClient.register = async (profile) => {
    requests++;
    assert.equal(profile.role, undefined, 'Public signup does not send a privileged role');
    return { user: { id: 'isolated_signup', name: profile.name, email: profile.email, phone: profile.phone, role: 'customer', active: true } };
  };
  try {
    renderAuthPage('register', 'booking');
    const form = document.getElementById('authForm');
    const values = { authRegName: 'Khách kiểm thử', authRegPhone: '123', authEmail: 'invalid-email', authPassword: 'abcdefg!' };
    for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value;
    await form.dispatch('submit');
    assert.equal(requests, 0);
    for (const field of ['phone', 'email', 'password']) {
      const feedback = form.querySelector(`[data-auth-error="${field}"]`);
      assert.equal(feedback.style.display, 'block');
      assert.ok(feedback.textContent.length > 0);
    }
    assert.equal(document.activeElement.id, 'authRegPhone');
    for (const [id, value] of Object.entries(values)) assert.equal(document.getElementById(id).value, value);
    assert.equal(document.getElementById('authSubmitBtn').disabled, false);

    renderAuthPage('register', 'booking');
    assert.equal(document.getElementById('authRegPhone').value, values.authRegPhone, 'A data refresh preserves the current form draft');
    const corrected = { authRegPhone: '0934567890', authEmail: 'isolated-signup@example.com', authPassword: 'Example@123' };
    for (const [id, value] of Object.entries(corrected)) {
      document.getElementById(id).value = value;
      await document.getElementById(id).dispatch('input');
    }
    await document.getElementById('authForm').dispatch('submit');
    assert.equal(requests, 1);
    assert.equal(`${window.location.pathname}${window.location.search}`, '/dat-lich');
  } finally {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    apiClient.isOnline = originals.online;
    apiClient.register = originals.register;
    authService.getCurrentUser = originals.currentUser;
  }
});

test('Auth tabs update the route and pending signup cannot be submitted twice', async () => {
  const originals = { document: globalThis.document, window: globalThis.window, online: apiClient.isOnline,
    register: authService.register, currentUser: authService.getCurrentUser };
  globalThis.document = createDocument();
  globalThis.window = createWindow('https://serenity.local/dang-nhap?returnTo=booking');
  apiClient.isOnline = () => true;
  authService.getCurrentUser = () => null;
  let requests = 0;
  let finish;
  authService.register = () => {
    requests++;
    return new Promise((resolve) => { finish = resolve; });
  };
  try {
    renderAuthPage('login', 'booking');
    await document.getElementById('tabRegisterBtn').dispatch('click');
    assert.equal(`${window.location.pathname}${window.location.search}`, '/dang-ky?returnTo=booking');
    renderAuthPage('register', 'booking');
    const form = document.getElementById('authForm');
    const pending = form.dispatch('submit');
    await form.dispatch('submit');
    assert.equal(requests, 1);
    assert.equal(document.getElementById('authSubmitBtn').disabled, true);
    await document.getElementById('tabLoginBtn').dispatch('click');
    assert.equal(`${window.location.pathname}${window.location.search}`, '/dang-ky?returnTo=booking');
    finish({ name: 'Khách kiểm thử', role: 'customer' });
    await pending;
    assert.equal(`${window.location.pathname}${window.location.search}`, '/dat-lich');
  } finally {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    apiClient.isOnline = originals.online;
    authService.register = originals.register;
    authService.getCurrentUser = originals.currentUser;
  }
});
