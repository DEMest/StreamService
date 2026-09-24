'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { validateTelegramInitData } = require('../src/security');

function signedInitData(botToken, values) {
  const params = new URLSearchParams(values);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

test('validates signed Telegram Mini App data', () => {
  const now = new Date('2026-09-19T10:00:00Z').getTime();
  const raw = signedInitData('bot-token', {
    auth_date: String(Math.floor(now / 1000) - 10),
    query_id: 'query',
    signature: 'telegram-signature',
    user: JSON.stringify({ id: 42, first_name: 'Ada' }),
  });

  assert.deepEqual(
    validateTelegramInitData(raw, 'bot-token', { now: () => now }),
    { user: { id: 42, first_name: 'Ada' }, queryId: 'query' },
  );
});

test('rejects tampered and expired Telegram Mini App data', () => {
  const now = new Date('2026-09-19T10:00:00Z').getTime();
  const raw = signedInitData('bot-token', {
    auth_date: String(Math.floor(now / 1000) - 4000),
    user: JSON.stringify({ id: 42, first_name: 'Ada' }),
  });

  assert.throws(
    () => validateTelegramInitData(raw, 'bot-token', { now: () => now }),
    /expired/,
  );
  assert.throws(
    () => validateTelegramInitData(raw.replace('Ada', 'Eve'), 'bot-token', { now: () => now }),
    /invalid/,
  );
});
