// Tes handleMessage: routing grup vs individual, dedup per tenant, ack/nack.
// Jalankan: npm test
process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';
process.env.EVOLUTION_API_URL = 'http://evolution.test';
process.env.EVOLUTION_INSTANCE = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

let calls = [];
let nextResponse = null; // null = sukses; fungsi (body) => throw error
axios.post = async (url, body) => {
  calls.push({ url, body });
  if (nextResponse) nextResponse(body);
  return { data: { ok: true } };
};

const db = require('../src/db');
const { handleMessage } = require('../src/notifications/subscriber');
const { formatGroupJid } = require('../src/evolution/sender');

function httpError(status, data) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status, data };
  return err;
}

function groupPayload(overrides = {}) {
  return {
    version: '1', channel: 'whatsapp', tenantId: 'acme',
    recipient: { employeeId: '', phone: '', groupId: '120363012345678901@g.us' },
    message: {
      title: 'Not clocked in yet — Wed, 11 Nov 2026',
      body: "2 employees haven't clocked in as of 08:31:\n\n1. Andi\n2. Budi Santoso",
      link: '',
    },
    source: {
      notificationId: '2026-11-11_attendance_missing_clockin_summary',
      type: 'attendance_missing_clockin_summary',
    },
    ...overrides,
  };
}

function individualPayload() {
  return {
    version: '1', channel: 'whatsapp', tenantId: 'acme',
    recipient: { employeeId: 'emp_123', phone: '+6281234567890' },
    message: { title: 'Action required', body: 'A request needs your review.', link: 'https://app.example.com/approvals' },
    source: { notificationId: 'ntf_test1', type: 'approval_required' },
  };
}

async function deliver(payload) {
  const result = { acked: false, nacked: false };
  await handleMessage({
    data: Buffer.from(JSON.stringify(payload)),
    ack: () => { result.acked = true; },
    nack: () => { result.nacked = true; },
  });
  return result;
}

test.beforeEach(() => {
  calls = [];
  nextResponse = null;
  db.exec('DELETE FROM notification_dedup');
});

test('group message: title, blank line, then list — sent to group JID', async () => {
  const r = await deliver(groupPayload());
  assert.equal(r.acked, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.number, '120363012345678901@g.us');
  assert.equal(
    calls[0].body.text,
    "*Not clocked in yet — Wed, 11 Nov 2026*\n\n2 employees haven't clocked in as of 08:31:\n\n1. Andi\n2. Budi Santoso"
  );
});

test('group message: same message again sends nothing (dedup)', async () => {
  await deliver(groupPayload());
  const r = await deliver(groupPayload());
  assert.equal(r.acked, true);
  assert.equal(calls.length, 1);
});

test('group message: same notificationId for another tenant IS sent', async () => {
  await deliver(groupPayload());
  const r = await deliver(groupPayload({ tenantId: 'other' }));
  assert.equal(r.acked, true);
  assert.equal(calls.length, 2);
});

test('group message: never falls through to phone, even if phone is set', async () => {
  const p = groupPayload();
  p.recipient.phone = '+6281234567890';
  await deliver(p);
  assert.equal(calls[0].body.number, '120363012345678901@g.us');
});

test('group message: long list is not truncated', async () => {
  const names = Array.from({ length: 500 }, (_, i) => `${i + 1}. Employee Number ${i + 1}`).join('\n');
  const p = groupPayload({ message: { title: 'T', body: `500 employees:\n\n${names}`, link: '' } });
  await deliver(p);
  assert.ok(calls[0].body.text.endsWith('500. Employee Number 500'));
});

test('group message: unknown type still routed by groupId', async () => {
  const p = groupPayload({ source: { notificationId: 'x1', type: 'some_future_group_type' } });
  const r = await deliver(p);
  assert.equal(r.acked, true);
  assert.equal(calls[0].body.number, '120363012345678901@g.us');
});

test('invalid groupId format: logged and acked, provider not called', async () => {
  const r = await deliver(groupPayload({ recipient: { employeeId: '', phone: '', groupId: 'https://chat.whatsapp.com/abc' } }));
  assert.deepEqual(r, { acked: true, nacked: false });
  assert.equal(calls.length, 0);
});

test('provider rejects group (4xx): acked, not retried', async () => {
  nextResponse = () => { throw httpError(400, { response: { message: [{ exists: false, jid: 'x@g.us' }] } }); };
  const r = await deliver(groupPayload());
  assert.deepEqual(r, { acked: true, nacked: false });
});

test('provider rejects group (500 not-authorized): acked, not retried forever', async () => {
  nextResponse = () => { throw httpError(500, { response: { message: 'Error: not-authorized' } }); };
  const r = await deliver(groupPayload());
  assert.deepEqual(r, { acked: true, nacked: false });
});

test('transient group failure (503): nacked for retry, not marked seen', async () => {
  nextResponse = () => { throw httpError(503, 'Service Unavailable'); };
  const r = await deliver(groupPayload());
  assert.deepEqual(r, { acked: false, nacked: true });
  nextResponse = null;
  calls = [];
  const r2 = await deliver(groupPayload());
  assert.equal(r2.acked, true);
  assert.equal(calls.length, 1);
});

test('individual message still delivered to phone with link', async () => {
  const r = await deliver(individualPayload());
  assert.equal(r.acked, true);
  assert.equal(calls[0].body.number, '6281234567890');
  assert.equal(calls[0].body.text, '*Action required*\n\nA request needs your review.\n\nhttps://app.example.com/approvals');
});

test('formatGroupJid normalizes pasted IDs', () => {
  assert.equal(formatGroupJid('120363012345678901@g.us'), '120363012345678901@g.us');
  assert.equal(formatGroupJid(' 120363012345678901 '), '120363012345678901@g.us');
  assert.equal(formatGroupJid('6281234567890-1600000000'), '6281234567890-1600000000@g.us');
  assert.equal(formatGroupJid('6281234567890@s.whatsapp.net'), null);
  assert.equal(formatGroupJid('abc'), null);
});
