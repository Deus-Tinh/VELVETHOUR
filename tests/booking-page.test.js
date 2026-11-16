import test from 'node:test';
import assert from 'node:assert/strict';
import { authService } from '../assets/js/services/authService.js';
import { bookingService } from '../assets/js/services/bookingService.js';
import { serviceService } from '../assets/js/services/serviceService.js';
import { staffService } from '../assets/js/services/staffSettingsPromoService.js';
import { addDays, todayStr } from '../assets/js/core/utils.js';

const initialWindow = globalThis.window;
globalThis.window = {};
const { filterServicesWithEligibleStaff, renderBookingPage } = await import('../assets/js/pages/bookingPage.js');
if (initialWindow === undefined) delete globalThis.window;
else globalThis.window = initialWindow;

const services = [
  { id: 'no-staff', kind: 'therapy', name: 'Treatment Without Staff', category: 'body-massages', duration: 60, price: 300000, variants: [{ duration: 60, price: 300000 }], imageId: 'massage-01' },
  { id: 'available', kind: 'therapy', name: 'Available Treatment', category: 'body-massages', duration: 60, price: 350000, variants: [{ duration: 60, price: 350000 }], imageId: 'massage-01' },
];

function mockElement() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    listeners: new Map(),
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    removeAttribute() {},
  };
}

function createBookingDocument() {
  const nodes = new Map([
    ['#serviceSelectGrid', mockElement()],
    ['#bookingCatalogCount', mockElement()],
    ['#bookingCatalogPagination', mockElement()],
    ['#bookingCatalogSearch', mockElement()],
  ]);
  const container = {
    markup: '',
    set innerHTML(value) { this.markup = value; },
    get innerHTML() { return this.markup; },
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll() { return []; },
  };
  const nextButton = mockElement();
  let rootMarkup = '';
  const root = {
    querySelector(selector) { return selector === '#wizardContentArea' && rootMarkup.includes('id="wizardContentArea"') ? container : null; },
    set innerHTML(value) { rootMarkup = value; },
    get innerHTML() { return rootMarkup; },
  };
  const document = {
    getElementById(id) {
      if (id === 'appRoot') return root;
      if (id === 'wizardContentArea' && rootMarkup.includes('id="wizardContentArea"')) return container;
      if (id === 'step1NextBtn' && container.markup.includes('id="step1NextBtn"')) return nextButton;
      return null;
    },
    querySelectorAll() { return []; },
  };
  return { document, root, container, grid: nodes.get('#serviceSelectGrid') };
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

test('booking availability filtering keeps only services with a suitable active specialist', () => {
  const bookable = filterServicesWithEligibleStaff(services, (serviceId) => serviceId === 'available' ? [{ id: 'staff-1' }] : []);
  assert.deepEqual(bookable, [services[1]]);
});

test('booking page explains when no service can be booked and offers a contact route', () => {
  const originals = {
    document: globalThis.document,
    getCurrentUser: authService.getCurrentUser,
    listActive: serviceService.listActive,
    forService: staffService.forService,
  };
  const root = { innerHTML: '' };
  globalThis.document = { getElementById: (id) => id === 'appRoot' ? root : null };
  authService.getCurrentUser = () => ({ id: 'booking-test-customer', role: 'customer' });
  serviceService.listActive = () => services;
  staffService.forService = () => [];
  try {
    renderBookingPage();
    assert.match(root.innerHTML, /Đặt lịch trực tuyến tạm thời chưa khả dụng/);
    assert.match(root.innerHTML, /href="#\/contact"/);
    assert.doesNotMatch(root.innerHTML, /step1NextBtn/);
  } finally {
    restoreGlobal('document', originals.document);
    authService.getCurrentUser = originals.getCurrentUser;
    serviceService.listActive = originals.listActive;
    staffService.forService = originals.forService;
  }
});

test('booking catalog disables services without a suitable specialist and selects an available one', () => {
  const originals = {
    document: globalThis.document,
    getCurrentUser: authService.getCurrentUser,
    listActive: serviceService.listActive,
    getService: serviceService.get,
    componentServices: serviceService.componentServices,
    forService: staffService.forService,
  };
  const ui = createBookingDocument();
  globalThis.document = ui.document;
  authService.getCurrentUser = () => ({ id: 'partial-roster-test', role: 'customer' });
  serviceService.listActive = () => services;
  serviceService.get = (id) => services.find((service) => service.id === id);
  serviceService.componentServices = () => [];
  staffService.forService = (id) => id === 'available' ? [{ id: 'staff-1' }] : [];
  try {
    renderBookingPage();
    assert.match(ui.grid.innerHTML, /data-svc-id="no-staff"[^>]*disabled aria-disabled="true"/);
    assert.match(ui.grid.innerHTML, /data-svc-id="available"[^>]*aria-pressed="true"/);
    assert.doesNotMatch(ui.grid.innerHTML, /data-svc-id="available"[^>]*disabled/);
    assert.match(ui.container.markup, /1 liệu trình hoặc gói hiện chưa có chuyên viên phù hợp/);
    assert.match(ui.container.markup, /href="#\/contact"/);
  } finally {
    restoreGlobal('document', originals.document);
    authService.getCurrentUser = originals.getCurrentUser;
    serviceService.listActive = originals.listActive;
    serviceService.get = originals.getService;
    serviceService.componentServices = originals.componentServices;
    staffService.forService = originals.forService;
  }
});

test('approved days off show gray staff columns with no selectable slots, including when all staff are off', (t) => {
  const ui = createBookingDocument();
  const previousDocument = globalThis.document;
  globalThis.document = ui.document;
  t.after(() => restoreGlobal('document', previousDocument));
  const date = addDays(todayStr(), 2);
  const endDate = addDays(date, 1);
  const service = services[1];
  const staff = [
    { id: 'staff-off', name: 'Chuyên viên nghỉ', daysOff: [date, endDate] },
    { id: 'staff-working', name: 'Chuyên viên làm việc', daysOff: [] },
  ];
  t.mock.method(authService, 'getCurrentUser', () => ({ id: 'leave-schedule-test', role: 'customer' }));
  t.mock.method(serviceService, 'listActive', () => [service]);
  t.mock.method(serviceService, 'get', () => service);
  t.mock.method(staffService, 'forService', () => staff);
  t.mock.method(bookingService, 'getAvailableSlots', () => [{ time: '10:00', endTime: '11:00', available: true }]);

  const selectDate = (selectedDate) => {
    renderBookingPage(service.id, 60, { date: selectedDate });
    ui.document.getElementById('step1NextBtn').listeners.get('click')();
  };
  selectDate(date);
  assert.match(ui.container.markup, /schedule-person-head is-day-off[^>]*>[\s\S]*?Chuyên viên nghỉ/);
  assert.match(ui.container.markup, /class="schedule-cell-off"[^>]*>[\s\S]*?NGHỈ/);
  assert.doesNotMatch(ui.container.markup, /data-staff-id="staff-off"/);
  assert.match(ui.container.markup, /data-staff-id="staff-working"/);

  staff[1].daysOff = [endDate];
  selectDate(endDate);
  assert.equal((ui.container.markup.match(/class="schedule-cell-off"/g) || []).length, 2);
  assert.doesNotMatch(ui.container.markup, /data-staff-id=/);

  selectDate(addDays(endDate, 1));
  assert.doesNotMatch(ui.container.markup, /class="schedule-cell-off"/);
  assert.match(ui.container.markup, /data-staff-id="staff-off"/);
});
