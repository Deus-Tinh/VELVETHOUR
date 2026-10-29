export function createTestRunner() {
  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error?.message || String(error) });
    }
  }

  function expect(actual) {
    return {
      toBe(expected) {
        if (!Object.is(actual, expected)) throw new Error(`Expected ${String(actual)} to be ${String(expected)}`);
      },
      toEqual(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
        }
      },
      toBeTruthy() {
        if (!actual) throw new Error(`Expected ${String(actual)} to be truthy`);
      },
      toBeFalsy() {
        if (actual) throw new Error(`Expected ${String(actual)} to be falsy`);
      },
      toThrow() {
        if (typeof actual !== 'function') throw new TypeError('toThrow expects a function');
        let threw = false;
        try { actual(); } catch { threw = true; }
        if (!threw) throw new Error('Expected function to throw');
      },
    };
  }

  return { test, expect, results };
}
