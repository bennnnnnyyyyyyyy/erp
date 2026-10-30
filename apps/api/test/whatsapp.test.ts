import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { makeWhatsAppAdapter } from '../src/lib/channels/whatsapp';
import type { OutboxMessage } from '../src/lib/channels';
import { replyFor } from '../src/lib/whatsappInbound';
import { parseWebhook, sendText, toGraphNumber, verifySignature } from '../src/lib/whatsapp';

// Unit tests for the WhatsApp code. They do NOT talk to Meta: they check the signature rule, the payload parsing, the
// request we would send and the refusal paths. Real delivery needs the Meta credentials and is checked by hand.

const SECRET = 'test-app-secret';
const baseEnv = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const cfgEnv = { ...baseEnv, WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me' };

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => vi.unstubAllGlobals());

describe('signature', () => {
  it('accepts a correct signature and rejects wrong, missing, malformed and tampered ones', async () => {
    const body = '{"entry":[]}';
    expect(await verifySignature(body, await sign(body), SECRET)).toBe(true);
    expect(await verifySignature(body, await sign(body, 'other'), SECRET)).toBe(false);
    expect(await verifySignature(body, null, SECRET)).toBe(false);
    expect(await verifySignature(body, 'sha256=zz', SECRET)).toBe(false);
    expect(await verifySignature(body + ' ', await sign(body), SECRET)).toBe(false);
    expect(await verifySignature(body, await sign(body), '')).toBe(false);
  });
});

describe('parseWebhook', () => {
  const payload = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });
  it('extracts plain text messages and ignores everything else', () => {
    const got = parseWebhook(payload([
      { from: '201001234567', id: 'wamid.1', type: 'text', text: { body: 'APPROVE ABC234' } },
      { from: '201001234567', id: 'wamid.2', type: 'audio', audio: { id: 'x' } },
      { from: 5, id: 'wamid.3', type: 'text', text: { body: 'bad sender' } },
      { from: '201001234567', id: 'wamid.4', type: 'text', text: {} },
    ]));
    expect(got).toEqual([{ from: '201001234567', id: 'wamid.1', text: 'APPROVE ABC234' }]);
  });
  it('copes with status updates and malformed payloads', () => {
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: 'nope' })).toEqual([]);
    expect(parseWebhook({ entry: [null, { changes: [null] }] })).toEqual([]);
  });
  it('limits very long text', () => {
    expect(parseWebhook(payload([{ from: '1', id: 'a', type: 'text', text: { body: 'x'.repeat(5000) } }]))[0]?.text.length).toBe(500);
  });
});

describe('webhook route', () => {
  it('answers the verification handshake only with the right token', async () => {
    const ok = await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345', {}, cfgEnv);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    const bad = await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345', {}, cfgEnv);
    expect(bad.status).toBe(403);
    const none = await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1', {}, baseEnv);
    expect(none.status).toBe(503);
  });
  it('refuses a POST without a valid signature and when not configured', async () => {
    const body = JSON.stringify({ entry: [] });
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body }, cfgEnv)).status).toBe(401);
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body, headers: { 'X-Hub-Signature-256': await sign(body, 'wrong') } }, cfgEnv)).status).toBe(401);
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body, headers: { 'X-Hub-Signature-256': await sign(body) } }, baseEnv)).status).toBe(503);
  });
  it('accepts a signed payload with nothing to handle', async () => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] });
    const res = await app.request('/webhooks/whatsapp', { method: 'POST', body, headers: { 'X-Hub-Signature-256': await sign(body) } }, cfgEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { handled: 0 } });
  });
  it('rejects an oversized body before doing any work', async () => {
    const body = 'x'.repeat(100_001);
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body, headers: { 'X-Hub-Signature-256': await sign(body) } }, cfgEnv)).status).toBe(413);
  });
});

describe('sending', () => {
  const message: OutboxMessage = { id: 'm1', org_id: 'o1', recipient_id: 'u1', channel: 'whatsapp', kind: 'approval_request', subject: 'OUT-0001 needs your approval', body: 'Reply in WhatsApp', entity_type: 'stock_request', entity_id: 'r1', secret_body: 'Reply APPROVE ABC234 to approve', attempts: 1 };

  it('formats the number and sends the secret text, with the token only in the Authorization header', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await makeWhatsAppAdapter(async () => '+201001234567').send(message, cfgEnv);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/123/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ messaging_product: 'whatsapp', to: '201001234567', type: 'text', text: { body: 'Reply APPROVE ABC234 to approve' } });
    expect(String(init.body)).not.toContain('tok');
  });
  it('falls back to the template when Meta refuses free text and a template is configured', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Re-engagement message', code: 131047 } }), { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendText({ ...cfgEnv, WHATSAPP_TEMPLATE_NAME: 'approval_request' }, '+201001234567', 'hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toMatchObject({ type: 'template', template: { name: 'approval_request' } });
  });
  it('fails visibly: no number, not configured, Meta refuses', async () => {
    await expect(makeWhatsAppAdapter(async () => null).send(message, cfgEnv)).rejects.toThrow('no verified WhatsApp number');
    await expect(sendText(baseEnv, '+201001234567', 'x')).rejects.toThrow('not configured');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Recipient not in allowed list', code: 131030 } }), { status: 400 })));
    await expect(sendText(cfgEnv, '+201001234567', 'x')).rejects.toThrow('Recipient not in allowed list');
  });
  it('converts numbers', () => expect(toGraphNumber('+201001234567')).toBe('201001234567'));
});

describe('replies to people', () => {
  it('confirms accepted decisions and task updates, explains refusals, and stays silent for unknown senders and free text', () => {
    expect(replyFor({ ok: true, code: 'OK', decision: 'approved' }, 'decision')).toContain('approved');
    expect(replyFor({ ok: true, code: 'OK', status: 'done' }, 'task')).toContain('completed');
    expect(replyFor({ ok: false, code: 'TOKEN_USED' }, 'decision')).toContain('already used');
    expect(replyFor({ ok: false, code: 'AMBIGUOUS', tasks: [{ ref: '1A2B', title: 'Count aisle 4' }] }, 'task')).toContain('1A2B');
    expect(replyFor({ ok: false, code: 'UNKNOWN_IDENTITY' }, 'decision')).toBeNull();
    expect(replyFor({ ok: false, code: 'NOT_A_TASK_REPLY' }, 'task')).toBeNull();
  });
});
