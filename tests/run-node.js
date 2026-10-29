/**
 * Node.js Test Runner — Thực thi toàn bộ business test suite qua dòng lệnh.
 */
import { runAllTests } from './tests.js';

async function main() {
  console.log('====================================================');
  console.log(' SERENITY SPA & WELLNESS — AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  try {
    const results = await runAllTests();
    let passed = 0;
    let failed = 0;

    results.forEach((r, idx) => {
      if (r.passed) {
        passed++;
        console.log(`[PASS] ${r.name}`);
      } else {
        failed++;
        console.error(`[FAIL] ${r.name}`);
        console.error(`       Error: ${r.error}`);
      }
    });

    console.log('\n----------------------------------------------------');
    console.log(`Tong ket: ${passed}/${results.length} PASS | ${failed} FAIL`);
    console.log('----------------------------------------------------');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
  }
}

main();
