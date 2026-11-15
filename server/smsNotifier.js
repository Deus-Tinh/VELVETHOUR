/**
 * SMS adapter boundary for admin alerts.
 * No provider is configured by default; callers must persist an in-app alert first.
 */
export function createSmsNotifier({ provider = null } = {}) {
  return async function sendAdminAlert(alert) {
    if (!provider || typeof provider.send !== 'function') {
      return { status: 'not_configured' };
    }

    try {
      const result = await provider.send(alert);
      return result?.ok ? { status: 'sent' } : { status: 'failed' };
    } catch {
      return { status: 'failed' };
    }
  };
}
