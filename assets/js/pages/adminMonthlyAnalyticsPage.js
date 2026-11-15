import { apiClient } from '../services/apiClient.js';
import { businessNow, formatVND, esc } from '../core/utils.js';
import { drawRevenueChart } from '../ui/canvasChart.js';

export function renderAdminMonthlyAnalytics(container) {
  const [yearNow, monthNow] = businessNow().date.split('-').map(Number);
  const options = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return `<option value="${month}" ${month === monthNow ? 'selected' : ''}>Tháng ${month}</option>`;
  }).join('');
  container.innerHTML = `
    <section class="monthly-analytics">
      <div class="monthly-analytics-head">
        <div>
          <h2>Tổng kết kinh doanh theo tháng</h2>
          <p>Dòng tiền tính theo thời điểm giao dịch tại Việt Nam; hoạt động dịch vụ tính theo ngày lịch hẹn.</p>
        </div>
        <form class="monthly-period-form">
          <label class="monthly-period-control" for="monthlyAnalyticsMonth">
            <span>Tháng</span>
            <select id="monthlyAnalyticsMonth" class="form-control">${options}</select>
          </label>
          <label class="monthly-period-control" for="monthlyAnalyticsYear">
            <span>Năm</span>
            <input id="monthlyAnalyticsYear" class="form-control" type="number" value="${yearNow}" min="2000" max="2100" required />
          </label>
          <button class="btn-outline btn-sm" type="submit">Xem báo cáo</button>
        </form>
      </div>
      <div id="monthlyAnalyticsResult" aria-live="polite"><p class="monthly-analytics-message">Đang tải số liệu…</p></div>
    </section>
  `;

  const form = container.querySelector('.monthly-period-form');
  const yearInput = container.querySelector('#monthlyAnalyticsYear');
  const monthInput = container.querySelector('#monthlyAnalyticsMonth');
  const result = container.querySelector('#monthlyAnalyticsResult');

  let requestVersion = 0;
  const load = async () => {
    const version = ++requestVersion;
    const year = Number(yearInput.value);
    const month = Number(monthInput.value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      result.innerHTML = '<p class="monthly-analytics-message is-error">Hãy chọn năm từ 2000 đến 2100.</p>';
      return;
    }
    result.innerHTML = '<p class="monthly-analytics-message">Đang tải số liệu…</p>';
    try {
      const { analytics } = await apiClient.getMonthlyAnalytics(year, month);
      if (version !== requestVersion || !result.isConnected) return;
      if (!analytics?.metrics || !Array.isArray(analytics.dailyCashFlow)) throw new Error('Báo cáo không hợp lệ');
      renderReport(result, analytics);
    } catch (error) {
      if (version !== requestVersion || !result.isConnected) return;
      const message = error.code === 'ANALYTICS_DATA_CONFLICT' || error.status === 401 || error.status === 403
        ? error.message
        : 'Không thể tải báo cáo tháng. Hãy kiểm tra kết nối rồi bấm “Xem báo cáo” để thử lại.';
      result.innerHTML = `<p class="monthly-analytics-message is-error" role="alert">${esc(message)}</p>`;
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); return load(); });
  return load();
}

function renderReport(root, report) {
  const metrics = report?.metrics || {};
  const monthLabel = `${String(report?.month || '').padStart(2, '0')}/${report?.year || ''}`;
  const services = Array.isArray(report?.topServices) ? report.topServices : [];
  const daily = report.dailyCashFlow;
  const empty = !metrics.collected && !metrics.refunded && !metrics.completedBookings && !metrics.cancelledBookings;
  root.innerHTML = `
    <p class="monthly-analytics-period-label">Kỳ báo cáo: <strong>${esc(monthLabel)}</strong> · Múi giờ ${esc(report?.timeZone || 'Asia/Ho_Chi_Minh')}</p>
    ${empty ? '<p class="monthly-analytics-message">Chưa có dữ liệu trong kỳ báo cáo này.</p>' : ''}
    <div class="kpi-grid monthly-analytics-kpis">
      <article class="kpi-card green"><div class="kpi-title">Đã thu hợp lệ</div><div class="kpi-value">${formatVND(metrics.collected || 0)}</div></article>
      <article class="kpi-card orange"><div class="kpi-title">Đã hoàn</div><div class="kpi-value">${formatVND(metrics.refunded || 0)}</div></article>
      <article class="kpi-card blue"><div class="kpi-title">Dòng tiền ròng</div><div class="kpi-value">${formatVND(metrics.netCashFlow || 0)}</div></article>
      <article class="kpi-card"><div class="kpi-title">Lịch hoàn tất / đã hủy</div><div class="kpi-value">${Number(metrics.completedBookings || 0)} / ${Number(metrics.cancelledBookings || 0)}</div></article>
      <article class="kpi-card"><div class="kpi-title">Khách đã phục vụ</div><div class="kpi-value">${Number(metrics.customersServed || 0)}</div></article>
      <article class="kpi-card"><div class="kpi-title">Giá trị lịch hoàn tất trung bình</div><div class="kpi-value">${formatVND(metrics.averageBookingValue || 0)}</div></article>
    </div>
    <section class="monthly-analytics-card">
      <h3>Dòng tiền ròng theo ngày</h3>
      <p>Thu trừ hoàn tiền ghi nhận trong ngày, theo múi giờ Việt Nam.</p>
      <div class="monthly-analytics-chart"><canvas id="monthlyAnalyticsCanvas" role="img" aria-label="Biểu đồ dòng tiền theo ngày trong tháng"></canvas></div>
    </section>
    <section class="monthly-analytics-card">
      <h3>TOP DỊCH VỤ TRONG THÁNG</h3>
      <p>Dựa trên lịch hoàn tất theo ngày hẹn. Số tiền gắn với dịch vụ là giao dịch hợp lệ ghi nhận trong tháng.</p>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Dịch vụ</th><th>Số lần</th><th>Tỷ trọng</th><th>Thu ròng gắn với dịch vụ</th></tr></thead>
          <tbody>${services.length ? services.map((service) => `
            <tr><td><strong>${esc(service.name || 'Dịch vụ đã xóa')}</strong></td>
              <td>${Number(service.count || 0)}</td><td>${Number(service.share || 0)}%</td>
              <td>${formatVND(service.revenue || 0)}</td></tr>
          `).join('') : '<tr><td colspan="4" class="monthly-analytics-empty">Chưa có lịch hoàn tất trong tháng này.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
  drawRevenueChart('monthlyAnalyticsCanvas', daily);
}
