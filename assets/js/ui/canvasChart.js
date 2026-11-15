/**
 * Canvas Chart — Vẽ biểu đồ doanh thu & số lượng lịch hẹn 7 ngày bằng Canvas API thuần.
 * Không phụ thuộc thư viện bên ngoài (Chart.js, etc).
 */
export function drawRevenueChart(canvasId, dailyStats = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 40;

  ctx.clearRect(0, 0, w, h);

  if (!dailyStats.length) {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chưa có dữ liệu thống kê', w / 2, h / 2);
    return;
  }

  const revenue = dailyStats.map((row) => Number(row.revenue) || 0);
  const maxRev = Math.max(...revenue, 1000000);
  const minRev = Math.min(...revenue, 0);
  const range = maxRev - minRev;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  const valueY = (value) => padTop + ((maxRev - value) / range) * chartH;
  const zeroY = valueY(0);

  // Vẽ lưới ngang
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = padTop + (chartH / gridLines) * i;
    const val = maxRev - (range / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - padRight, y);
    ctx.stroke();

    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(val / 1000)}k`, padLeft - 8, y + 3);
  }

  if (minRev < 0) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.moveTo(padLeft, zeroY);
    ctx.lineTo(w - padRight, zeroY);
    ctx.stroke();
  }

  // Tọa độ các điểm
  const points = dailyStats.map((d, idx) => {
    const x = padLeft + (chartW / (dailyStats.length - 1 || 1)) * idx;
    const y = valueY(revenue[idx]);
    return { ...d, x, y };
  });

  // Vẽ vùng gradient bên dưới đường
  const grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
  grad.addColorStop(0, 'rgba(102, 204, 112, 0.4)');
  grad.addColorStop(1, 'rgba(102, 204, 112, 0.0)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, zeroY);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, zeroY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Vẽ đường nối các điểm
  ctx.beginPath();
  ctx.strokeStyle = '#66CC70';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  points.forEach((p, idx) => {
    if (idx === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  // Vẽ các chấm điểm và nhãn ngày
  const labelStep = Math.max(1, Math.ceil((points.length * 25) / Math.max(1, chartW)));
  points.forEach((p, index) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#A67020';
    ctx.lineWidth = 2;
    ctx.stroke();

    const last = points.length - 1;
    if (index !== last && (index % labelStep !== 0 || points[last].x - p.x < 25)) return;
    // Nhãn ngày trục X
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.label, p.x, h - padBottom + 18);

    // Hiển thị số lượng booking bên dưới nhãn ngày
    ctx.fillStyle = '#999';
    ctx.font = '9px sans-serif';
    if (Number.isFinite(p.count)) ctx.fillText(`${p.count} lịch`, p.x, h - padBottom + 30);
  });
}
