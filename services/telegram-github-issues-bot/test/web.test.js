'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createWebModule } = require('../src/web');

function signedInitData(botToken, user) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

async function withServer(status, callback) {
  const group = { chatId: '-1001', title: 'Team', type: 'supergroup' };
  const telegram = {
    async call(method) {
      if (method === 'getMe') return { username: 'issues_bot' };
      throw new Error(`Unexpected Telegram call: ${method}`);
    },
    async getChatMember() { return { status }; },
  };
  const store = {
    async getGroup() { return group; },
    async rememberGroup() {},
    async listAdminGroups() { return [{ chatId: group.chatId, title: group.title }]; },
    async listRepositories() { return []; },
  };
  const module = createWebModule({
    config: {
      telegramToken: 'bot-token',
      publicBaseUrl: 'https://bot.example.test',
      githubInstallUrl: 'https://github.com/apps/example/installations/new',
      githubClientId: 'client-id',
      githubClientSecret: 'secret',
      miniAppShortName: 'settings',
    },
    github: {},
    store,
    telegram,
    logger: { error() {} },
  });
  await module.configure();
  const server = module.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('returns shared group settings to a current Telegram administrator', async () => {
  await withServer('administrator', async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: '-1001',
        initData: signedInitData('bot-token', { id: 42, first_name: 'Ada' }),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.selectedChatId, '-1001');
    assert.equal(body.group.title, 'Team');
    assert.deepEqual(body.repositories, []);
  });
});

test('rejects Mini App settings for a non-admin group member', async () => {
  await withServer('member', async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: '-1001',
        initData: signedInitData('bot-token', { id: 42, first_name: 'Ada' }),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.match(body.error, /Only group administrators/);
  });
});
