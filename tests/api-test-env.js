// Functional suites call mocked APIs in tight loops. Real limiter behavior is tested
// separately in http-protection.test.js with an explicit low budget and controlled clock.
import { TEST_PASSWORDS } from './testAccounts.js';

process.env.SERENITY_API_RATE_LIMIT = '10000';
process.env.SERENITY_SEED_DEMO_DATA = 'true';
process.env.SERENITY_TEST_ADMIN_PASSWORD = TEST_PASSWORDS.admin;
process.env.SERENITY_TEST_STAFF_PASSWORD = TEST_PASSWORDS.staff;
process.env.SERENITY_TEST_CUSTOMER_PASSWORD = TEST_PASSWORDS.customer;

// Fake bank details are used only by isolated local test processes; they are not
// live credentials and no test sends a real transfer or contacts SePay.
process.env.SEPAY_ENABLED = 'true';
process.env.SEPAY_BANK_NAME = 'Techcombank';
process.env.SEPAY_ACCOUNT_NUMBER = '1234567890';
process.env.SEPAY_ACCOUNT_HOLDER = 'SERENITY TEST';
process.env.SEPAY_WEBHOOK_API_KEY = 'test-only-serenity-sepay-key-not-real';
