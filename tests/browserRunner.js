import { runAllTests } from './tests.js';

const runButton = document.getElementById('runBtn');
const listElement = document.getElementById('testList');
const summaryElement = document.getElementById('summary');
let running = false;

async function execute() {
  if (running) return;
  running = true;
  runButton.disabled = true;
  listElement.textContent = 'Đang khởi chạy kiểm thử nghiệp vụ...';
  summaryElement.textContent = '';

  try {
    const results = await runAllTests();
    let passed = 0;
    let failed = 0;
    listElement.replaceChildren();

    results.forEach((result) => {
      const row = document.createElement('div');
      row.className = 'test-item';
      const name = document.createElement('span');
      name.textContent = result.name;
      const badge = document.createElement('span');
      badge.className = `badge ${result.passed ? 'badge-pass' : 'badge-fail'}`;
      badge.textContent = result.passed ? 'PASS' : 'FAIL';
      row.append(name, badge);
      listElement.appendChild(row);

      if (result.passed) passed += 1;
      else {
        failed += 1;
        const detail = document.createElement('pre');
        detail.className = 'failure-detail';
        detail.textContent = result.error || 'Unknown test failure';
        listElement.appendChild(detail);
      }
    });

    summaryElement.textContent = `TOTAL ${results.length} | PASSED ${passed} | FAILED ${failed}`;
    summaryElement.style.color = failed ? '#fca5a5' : '#10b981';
  } catch (error) {
    listElement.textContent = 'Không thể chạy test suite.';
    summaryElement.textContent = error?.stack || error?.message || String(error);
    summaryElement.style.color = '#fca5a5';
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', execute);
execute();
