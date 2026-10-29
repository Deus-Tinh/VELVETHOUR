import { apiClient } from '../services/apiClient.js';
import { serviceService, categoryService } from '../services/serviceService.js';
import { esc, formatDate, formatVND, todayStr } from '../core/utils.js';

const requestId = () => crypto.randomUUID();

export function renderAdminHolidaySales(container) {
  const services = serviceService.list();
  const categories = categoryService.list();
  let editing = null;
  let targetsChanged = false;
  let sales = [];
  let pendingRequest = null;
  container.innerHTML = `
    <section class="holiday-admin-panel" aria-labelledby="holidaySaleTitle">
      <h3 id="holidaySaleTitle">Sale lễ tự động theo ngày hẹn</h3>
      <p>Khách đặt trước cho ngày lễ vẫn được áp dụng sale. Một sale phù hợp nhất được cộng dồn với voucher hợp lệ trên giá niêm yết.</p>
      <form data-sale-form class="holiday-sale-form">
        <label>Tên chương trình<input class="form-control" name="name" required maxlength="160" /></label>
        <label>Dịp lễ<input class="form-control" name="occasion" maxlength="160" placeholder="Ví dụ: 20/11" /></label>
        <label>Ngày sử dụng từ<input class="form-control" type="date" name="serviceDateFrom" value="${todayStr()}" required /></label>
        <label>Đến hết ngày<input class="form-control" type="date" name="serviceDateTo" value="${todayStr()}" required /></label>
        <label>Loại giảm<select class="form-control" name="discountType"><option value="percent">Phần trăm (%)</option><option value="fixed">Số tiền (VND)</option></select></label>
        <label>Mức giảm<input class="form-control" type="number" min="0.01" step="0.01" name="discountValue" value="15" required /></label>
        <label>Giảm tối đa (để trống nếu không giới hạn)<input class="form-control" type="number" min="1" step="1" name="maxDiscountVnd" /></label>
        <label>Phạm vi<select class="form-control" name="scopeType"><option value="all">Toàn bộ dịch vụ</option><option value="category">Danh mục</option><option value="service">Dịch vụ cụ thể</option><option value="service_variant">Dịch vụ và thời lượng</option></select></label>
        <label data-target-wrap hidden>Chọn dịch vụ/danh mục<select class="form-control" name="targetId"></select><small>Khi sửa chương trình có nhiều đối tượng, phạm vi cũ được giữ nếu bạn không đổi lựa chọn.</small></label>
        <label data-duration-wrap hidden>Thời lượng (phút)<input class="form-control" type="number" name="durationMinutes" min="15" max="480" step="5" value="60" /></label>
        <label><input type="checkbox" name="enabled" checked /> Bật chương trình</label>
        <div class="holiday-sale-actions"><button class="btn-primary" type="submit" data-save-sale>Tạo sale lễ</button><button class="btn-outline" type="button" data-reset-sale>Tạo chương trình khác</button></div>
      </form>
      <p data-sale-status role="status"></p>
      <div data-sale-list></div>
    </section>`;
  const form = container.querySelector('[data-sale-form]');
  const status = container.querySelector('[data-sale-status]');
  const list = container.querySelector('[data-sale-list]');
  const field = (name) => form.elements.namedItem(name);
  const saveButton = container.querySelector('[data-save-sale]');

  function fillTargets(selected = '') {
    const scope = field('scopeType').value;
    container.querySelector('[data-target-wrap]').hidden = scope === 'all';
    container.querySelector('[data-duration-wrap]').hidden = scope !== 'service_variant';
    const rows = scope === 'category' ? categories : services;
    field('targetId').innerHTML = rows.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(row.name)}</option>`).join('');
  }
  async function load() {
    const result = await apiClient.listHolidaySales();
    sales = result.sales;
    list.innerHTML = sales.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Chương trình</th><th>Ngày sử dụng</th><th>Ưu đãi</th><th>Trạng thái</th><th></th></tr></thead><tbody>${sales.map((sale) => `
      <tr><td>${esc(sale.name)}</td><td>${formatDate(sale.serviceDateFrom)} – ${formatDate(sale.serviceDateTo)}</td>
      <td>${sale.discountType === 'percent' ? `${sale.percentageBps / 100}%` : formatVND(sale.fixedAmountVnd)}${sale.maxDiscountVnd ? `<small> · tối đa ${formatVND(sale.maxDiscountVnd)}</small>` : ''}</td>
      <td>${!sale.enabled ? 'Đã tắt' : sale.serviceDateTo < todayStr() ? 'Đã kết thúc' : sale.serviceDateFrom > todayStr() ? 'Sắp diễn ra' : 'Đang áp dụng'}</td>
      <td><button class="btn-outline btn-sm" type="button" data-edit-sale="${esc(sale.id)}">Sửa</button> <button class="btn-outline btn-sm" type="button" data-toggle-sale="${esc(sale.id)}">${sale.enabled ? 'Tắt' : 'Bật'}</button></td></tr>`).join('')}</tbody></table></div>` : '<p>Chưa có sale lễ. Tạo chương trình bằng biểu mẫu hoặc tab Agent Spa.</p>';
  }
  function reset() {
    editing = null; targetsChanged = false; pendingRequest = null; form.reset(); fillTargets();
    saveButton.textContent = 'Tạo sale lễ';
  }
  field('scopeType').addEventListener('change', () => { targetsChanged = true; fillTargets(); });
  field('targetId').addEventListener('change', () => { targetsChanged = true; });
  field('durationMinutes').addEventListener('input', () => { targetsChanged = true; });
  container.querySelector('[data-reset-sale]').addEventListener('click', reset);
  list.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-sale]');
    const toggle = event.target.closest('[data-toggle-sale]');
    const sale = sales.find((row) => row.id === (edit?.dataset.editSale || toggle?.dataset.toggleSale));
    if (!sale) return;
    if (edit) {
      editing = sale; targetsChanged = false; pendingRequest = null;
      for (const name of ['name', 'occasion', 'serviceDateFrom', 'serviceDateTo', 'discountType', 'scopeType']) field(name).value = sale[name];
      field('discountValue').value = sale.discountType === 'percent' ? sale.percentageBps / 100 : sale.fixedAmountVnd;
      field('maxDiscountVnd').value = sale.maxDiscountVnd ?? '';
      field('enabled').checked = sale.enabled;
      field('durationMinutes').value = sale.targets[0]?.durationMinutes || 60;
      fillTargets(sale.targets[0]?.targetId);
      saveButton.textContent = 'Lưu thay đổi sale';
      field('name').focus();
      status.textContent = `Đang sửa ${sale.name}.`;
    } else {
      toggle.disabled = true;
      try {
        await apiClient.updateHolidaySale(sale.id, { enabled: !sale.enabled }, sale.revision, requestId());
        status.textContent = 'Đã cập nhật trạng thái và kiểm chứng trên máy chủ.';
        await load(); await apiClient.refresh();
      } catch (error) { status.textContent = error.message; toggle.disabled = false; }
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    const scope = field('scopeType').value;
    const value = Number(field('discountValue').value);
    const percentageBps = Math.round(value * 100);
    if (field('discountType').value === 'percent' && Math.abs(value * 100 - percentageBps) > 0.00001) {
      status.textContent = 'Phần trăm giảm hỗ trợ tối đa hai chữ số thập phân.'; return;
    }
    const sale = {
      name: field('name').value.trim(), occasion: field('occasion').value.trim(),
      serviceDateFrom: field('serviceDateFrom').value, serviceDateTo: field('serviceDateTo').value,
      enabled: field('enabled').checked, discountType: field('discountType').value,
      percentageBps: field('discountType').value === 'percent' ? percentageBps : null,
      fixedAmountVnd: field('discountType').value === 'fixed' ? value : null,
      maxDiscountVnd: field('maxDiscountVnd').value === '' ? null : Number(field('maxDiscountVnd').value), scopeType: scope,
      targets: editing && !targetsChanged ? editing.targets : scope === 'all' ? [] : [{ targetId: field('targetId').value, durationMinutes: scope === 'service_variant' ? Number(field('durationMinutes').value) : 0 }],
    };
    const fingerprint = JSON.stringify({ id: editing?.id, revision: editing?.revision, sale });
    if (pendingRequest?.fingerprint !== fingerprint) pendingRequest = { fingerprint, id: requestId() };
    saveButton.disabled = true;
    status.textContent = 'Đang lưu và kiểm chứng…';
    let saved = null;
    try {
      const result = editing ? await apiClient.updateHolidaySale(editing.id, sale, editing.revision, pendingRequest.id) : await apiClient.saveHolidaySale(sale, pendingRequest.id);
      saved = result.sale;
      status.textContent = `Đã lưu ${result.sale.name} và kiểm chứng dữ liệu trên máy chủ.`;
      reset(); await load(); await apiClient.refresh();
    } catch (error) { status.textContent = saved ? `Đã lưu ${saved.name}. Chưa tải lại được danh sách; hãy làm mới trang.` : error.message; }
    finally { saveButton.disabled = false; }
  });
  fillTargets();
  load().catch((error) => { status.textContent = error.message; });
}
