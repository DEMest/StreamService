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

async function withConnectFlow({ installations, repositories }, callback) {
  const group = { chatId: '-1001', title: 'Team', type: 'supergroup' };
  const sessions = new Map();
  const saved = [];
  const store = {
    async getGroup() { return group; },
    async rememberGroup() {},
    async listAdminGroups() { return [{ chatId: group.chatId, title: group.title }]; },
    async listRepositories() { return []; },
    async createOAuthSession(session) { sessions.set(session.state, { ...session }); },
    async createLaunchSession() {},
    async getOAuthSession(state) { return sessions.get(state) || null; },
    async updateOAuthSession(state, update) { Object.assign(sessions.get(state), update); },
    async consumeOAuthSession(state) { sessions.get(state).status = 'saved'; },
    async saveInstallationRepositories(chatId, installationId, selected) {
      saved.push({ chatId, installationId, ids: selected.map((repo) => repo.id) });
    },
  };
  const github = {
    async exchangeOAuthCode() { return { access_token: 'user-token' }; },
    async listUserInstallations() { return installations; },
    async listUserInstallationRepositories(token, installationId) { return repositories[installationId] || []; },
    async listLabels() { return [{ name: 'bug', color: 'd73a4a' }]; },
  };
  const telegram = {
    async call(method) {
      if (method === 'getMe') return { username: 'issues_bot' };
      throw new Error(`Unexpected Telegram call: ${method}`);
    },
    async getChatMember() { return { status: 'administrator' }; },
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
    github,
    store,
    telegram,
    logger: { error() {} },
  });
  await module.configure();
  const server = module.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const initData = signedInitData('bot-token', { id: 42, first_name: 'Ada' });
  const post = async (endpoint, payload = {}) => {
    const response = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: '-1001', initData, ...payload }),
    });
    return { status: response.status, body: await response.json() };
  };
  const get = (endpoint) => fetch(`${base}${endpoint}`, { redirect: 'manual' });
  try {
    await callback({ get, post, saved, sessions });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('starts the GitHub connection with OAuth instead of a fresh installation', async () => {
  await withConnectFlow({ installations: [], repositories: {} }, async ({ post, sessions }) => {
    const { status, body } = await post('/api/github/connect');
    const url = new URL(body.url);

    assert.equal(status, 200);
    assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('state'), body.state);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://bot.example.test/github/callback');
    assert.equal(sessions.get(body.state).status, 'awaiting_authorization');
  });
});

test('uses an existing GitHub App installation without a Setup URL redirect', async () => {
  const installations = [{ id: '7', account: 'acme', manageUrl: 'https://github.com/settings/installations/7' }];
  const repositories = { 7: [{ id: '10', owner: 'acme', name: 'api', fullName: 'acme/api', private: true }] };
  await withConnectFlow({ installations, repositories }, async ({ get, post }) => {
    const { body: connect } = await post('/api/github/connect');
    const callback = await get(`/github/callback?state=${connect.state}&code=abc`);
    const status = await post('/api/github/status', { state: connect.state });

    assert.equal(callback.status, 200);
    assert.equal(status.body.status, 'ready');
    assert.deepEqual(status.body.repositories.map((repo) => [repo.fullName, repo.installationId]), [['acme/api', '7']]);
    assert.deepEqual(status.body.installations, [{ account: 'acme', manageUrl: 'https://github.com/settings/installations/7' }]);
  });
});

test('sends a user without any installation to the GitHub App install page', async () => {
  await withConnectFlow({ installations: [], repositories: {} }, async ({ get, post, sessions }) => {
    const { body: connect } = await post('/api/github/connect');
    const callback = await get(`/github/callback?state=${connect.state}&code=abc`);
    const location = new URL(callback.headers.get('location'));

    assert.equal(callback.status, 302);
    assert.equal(location.origin + location.pathname, 'https://github.com/apps/example/installations/new');
    assert.equal(location.searchParams.get('state'), connect.state);
    assert.equal(sessions.get(connect.state).status, 'awaiting_installation');
  });
});

test('saves repositories separately for every installation the user can access', async () => {
  const installations = [
    { id: '7', account: 'acme', manageUrl: '' },
    { id: '8', account: 'other', manageUrl: '' },
  ];
  const repositories = {
    7: [{ id: '10', owner: 'acme', name: 'api', fullName: 'acme/api', private: true }],
    8: [
      { id: '20', owner: 'other', name: 'web', fullName: 'other/web', private: false },
      { id: '21', owner: 'other', name: 'docs', fullName: 'other/docs', private: false },
    ],
  };
  await withConnectFlow({ installations, repositories }, async ({ get, post, saved }) => {
    const { body: connect } = await post('/api/github/connect');
    await get(`/github/callback?state=${connect.state}&code=abc`);
    const prepared = await post('/api/github/prepare', { state: connect.state, repositoryIds: ['10', '20'] });
    const result = await post('/api/github/save', {
      state: connect.state,
      repositories: [
        { repositoryId: '10', allowedLabels: ['bug'] },
        { repositoryId: '20', allowedLabels: [] },
      ],
    });

    assert.equal(prepared.status, 200);
    assert.equal(result.status, 200);
    assert.deepEqual(saved, [
      { chatId: '-1001', installationId: '7', ids: ['10'] },
      { chatId: '-1001', installationId: '8', ids: ['20'] },
    ]);
  });
});
