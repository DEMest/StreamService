'use strict';

const crypto = require('node:crypto');

function validateTelegramInitData(raw, botToken, options = {}) {
  if (!raw) throw new Error('Open Settings from Telegram.');

  const params = new URLSearchParams(raw);
  const actualHash = params.get('hash') || '';
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Telegram authorization is invalid.');
  }

  const nowSeconds = Math.floor((options.now?.() || Date.now()) / 1000);
  const authDate = Number(params.get('auth_date'));
  const maxAgeSeconds = options.maxAgeSeconds || 3600;
  if (!Number.isFinite(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new Error('Telegram authorization has expired. Reopen Settings.');
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    throw new Error('Telegram user data is invalid.');
  }
  if (!user?.id) throw new Error('Telegram user data is missing.');

  return { user, queryId: params.get('query_id') || null };
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createPkce() {
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function isTelegramAdmin(member) {
  return member?.status === 'creator' || member?.status === 'administrator';
}

module.exports = { createPkce, isTelegramAdmin, randomToken, validateTelegramInitData };
