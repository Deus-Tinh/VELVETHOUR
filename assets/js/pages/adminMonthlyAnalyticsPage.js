import { apiClient } from '../services/apiClient.js';
import { businessNow } from '../core/utils.js';
import { formatVND, esc } from '../core/utils.js';
import { drawRevenueChart } from '../ui/canvasChart.js';

function monthValue() {
  return businessNow().date.slice(0, 7);
}

export function renderAdminMonthlyAnalytics(container) {
  const initialMonth = monthValue();
  container.innerHTML = `
    <section class="monthly-analytics">
      <div class="monthly-analytics-head">
        <div>
          <h2>Tổng kết kinh doanh theo tháng</h2>
          <p>Dòng tiền tính theo thời điểm giao dịch tại Việt Nam; hoạt động dịch vụ tính theo ngày lịch hẹn.</p>
        </div>
        <label class="monthly-period-control" for="monthlyAnalyticsPeriod">
          <span>Tháng / năm</span>
          <input id="monthlyAnalyticsPeriod" class="form-control" type="month" value="${esc(initialMonth)}" min="2000-01" max="2100-12" />
        </label>
      </div>
      <div id="monthlyAnalyticsResult" aria-live="polite"><p class="monthly-analytics-message">Đang tải số liệu…</p></div>
    </section>
  `;

  const periodInput = container.querySelector('#monthlyAnalyticsPeriod');
  const result = container.querySelector('#monthlyAnalyticsResult');
  if (!periodInput || !result) return;

  let requestVersion = 0;
  const load = async () => {
    const version = ++requestVersion;
    if (!apiClient.isOnline()) {
      result.innerHTML = '<p class="monthly-analytics-message">Báo cáo tháng cần kết nối máy chủ để lấy số liệu giao dịch đầy đủ.</p>';
      return;
    }
    const [yearText, monthText] = periodInput.value.split('-');
    if (!/^\d{4}$/.test(yearText || '') || !/^\d{2}$/.test(monthText || '')) {
      result.innerHTML = '<p class="monthly-analytics-message">Hãy chọn tháng và năm hợp lệ.</p>';
      return;
    }
    result.innerHTML = '<p class="monthly-analytics-message">Đang tải số liệu…</p>';
    try {
      const { analytics } = await apiClient.getMonthlyAnalytics(Number(yearText), Number(monthText));
      if (version !== requestVersion || !result.isConnected) return;
      renderReport(result, analytics);
    } catch (error) {
      if (version !== requestVersion || !result.isConnected) return;
      result.innerHTML = `<p class="monthly-analytics-message is-error">${esc(error.message || 'Không thể tải báo cáo tháng.')}</p>`;
    }
  };
  periodInput.addEventListener('change', load);
  load();
}

function renderReport(root, report) {
  const metrics = report?.metrics || {};
  const monthLabel = `${String(report?.month || '').padStart(2, '0')}/${report?.year || ''}`;
  const services = Array.isArray(report?.topServices) ? report.topServices : [];
  const daily = Array.isArray(report?.dailyCashFlow) ? report.dailyCashFlow : [];
  root.innerHTML = `
    <p class="monthly-analytics-period-label">Kỳ báo cáo: <strong>${esc(monthLabel)}</strong> · Múi giờ ${esc(report?.timeZone || 'Asia/Ho_Chi_Minh')}</p>
    <div class="kpi-grid monthly-analytics-kpis">
      <article class="kpi-card green"><div class="kpi-title">Đã thu hợp lệ</div><div class="kpi-value">${formatVND(metrics.collected || 0)}</div></article>
      <article class="kpi-card orange"><div class="kpi-title">Đã hoàn</div><div class="kpi-value">${formatVND(metrics.refunded || 0)}</div></article>
      <article class="kpi-card blue"><div class="kpi-title">Dòng tiền vào ròng</div><div class="kpi-value">${formatVND(metrics.netCashFlow || 0)}</div></article>
      <article class="kpi-card"><div class="kpi-title">Lịch hoàn tất / đã hủy</div><div class="kpi-value">${Number(metrics.completedBookings || 0)} / ${Number(metrics.cancelledBookings || 0)}</div></article>
      <article class="kpi-card"><div class="kpi-title">Khách đã phục vụ</div><div class="kpi-value">${Number(metrics.customersServed || 0)}</div></article>
      <article class="kpi-card"><div class="kpi-title">Giá trị lịch hoàn tất trung bình</div><div class="kpi-value">${formatVND(metrics.averageBookingValue || 0)}</div></article>
    </div>
    <section class="monthly-analytics-card">
      <h3>Dòng tiền vào ròng theo ngày</h3>
      <p>Thu trừ hoàn tiền ghi nhận trong ngày, theo múi giờ Việt Nam.</p>
      <div class="monthly-analytics-chart"><canvas id="monthlyAnalyticsCanvas" aria-label="Biểu đồ dòng tiền theo ngày trong tháng"></canvas></div>
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
