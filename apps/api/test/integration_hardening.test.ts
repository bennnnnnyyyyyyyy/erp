import { describe, expect, it } from 'vitest';
import { withoutUrls } from '../src/lib/integrationChecks';
import { TEAMS_WEBHOOK_URL } from '../src/modules/core/integrationRoutes';

// Security review of the integrations code, 11 Nov 2026 (sql/083).

describe('Teams webhook URLs', () => {
  it("accepts Microsoft's Teams and Power Automate hosts", () => {
    for (const url of [
      'https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/xyz',
      'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x',
      'https://default123.ab.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc',
    ])
      expect(TEAMS_WEBHOOK_URL.test(url), url).toBe(true);
  });

  it('refuses any other host, including look-alikes', () => {
    for (const url of [
      'https://attacker.example.com/hook',
      'https://evil.com/webhook.office.com/x',
      'https://webhook.office.com.evil.com/x',
      'http://contoso.webhook.office.com/webhookb2/abc',
      'https://contoso.webhookXoffice.com/x',
    ])
      expect(TEAMS_WEBHOOK_URL.test(url), url).toBe(false);
  });
});

describe('error text never carries a web address', () => {
  it('replaces every URL', () => {
    expect(withoutUrls('Fetch API cannot load: https://hooks.slack.com/services/T0/B0/secret')).toBe('Fetch API cannot load: [address]');
    expect(withoutUrls('a https://x.io/a and wss://y.io/b')).toBe('a [address] and [address]');
    expect(withoutUrls('connection reset')).toBe('connection reset');
  });
});
