'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { appendRequester, createBot, labelsButtons } = require('../src/bot');

function fixture(repositories, group = { chatId: '-1001', title: 'Team', type: 'supergroup' }) {
  const calls = [];
  const issues = [];
  const modelRequests = [];
  let messageId = 100;
  const telegram = {
    async call(method, payload = {}) {
      calls.push({ method, payload });
      if (method === 'sendMessage') return { message_id: messageId++ };
      return true;
    },
    async getChatMember() {
      return { status: 'administrator' };
    },
  };
  const bot = createBot({
    config: { miniAppShortName: 'settings', publicBaseUrl: 'https://bot.example.test' },
    github: {
      async createIssue(repo, issue) {
        issues.push({ repo, issue });
        return { number: 7, title: issue.title, html_url: 'https://github.com/acme/app/issues/7' };
      },
    },
    model: {
      async generate(request) {
        modelRequests.push(request);
        return { title: 'Fix payment', body: '## Context\nBroken.' };
      },
    },
    store: {
      async getGroup() { return group; },
      async listRepositories() { return repositories; },
      async listRepositoriesForIssue() { return repositories; },
      async rememberGroup() {},
      async createLaunchSession() {},
    },
    telegram,
    logger: { log() {}, warn() {}, error(error) { throw error; } },
  });
  return { bot, calls, issues, modelRequests };
}

const message = {
  message_id: 1,
  text: '/issue Fix the payment screen',
  chat: { id: -1001, type: 'supergroup', title: 'Team' },
  from: { id: 42, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
};

test('uses the only group repository without asking the user to choose', async () => {
  const repo = {
    repositoryId: '1', installationId: '9', owner: 'acme', name: 'app', fullName: 'acme/app', allowedLabels: [],
  };
  const { bot, calls } = fixture([repo]);

  await bot.processUpdate({ message });

  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].payload.text, 'Preparing the issue draft…');
  assert.equal(calls[1].method, 'editMessageText');
  assert.match(calls[1].payload.text, /acme\/app/);
  assert.doesNotMatch(calls[0].payload.text, /Choose/);
});

test('uses the Telegram group AI context for drafting and editing', async () => {
  const repo = {
    repositoryId: '1', installationId: '9', owner: 'acme', name: 'app', fullName: 'acme/app', allowedLabels: [],
  };
  const group = {
    chatId: '-1001',
    title: 'Team',
    type: 'supergroup',
    aiContext: 'This is a mobile banking app. Never invent API endpoints.',
    issueLanguage: 'ru',
  };
  const { bot, calls, modelRequests } = fixture([repo], group);

  await bot.processUpdate({ message });
  const draftMessage = calls.find((call) => call.method === 'editMessageText');
  const editButton = draftMessage.payload.reply_markup.inline_keyboard.flat().find((item) => item.text === 'Edit');
  await bot.processUpdate({
    callback_query: {
      id: 'edit-callback',
      data: editButton.callback_data,
      from: message.from,
      message: { message_id: draftMessage.payload.message_id, chat: message.chat },
    },
  });
  await bot.processUpdate({
    message: { ...message, message_id: 2, text: 'Add a regression scenario' },
  });

  assert.equal(modelRequests[0].aiContext, group.aiContext);
  assert.equal(modelRequests[0].issueLanguage, 'ru');
  assert.equal(modelRequests[1].aiContext, group.aiContext);
  assert.equal(modelRequests[1].issueLanguage, 'ru');
});

test('creates the issue from a draft and adds the Telegram requester', async () => {
  const repo = {
    repositoryId: '1', installationId: '9', owner: 'acme', name: 'app', fullName: 'acme/app', allowedLabels: ['bug'],
  };
  const { bot, calls, issues } = fixture([repo]);
  await bot.processUpdate({ message });
  const draftMessage = calls.find((call) => call.method === 'editMessageText');
  const createButton = draftMessage.payload.reply_markup.inline_keyboard.flat().find((item) => item.text === 'Create issue');

  await bot.processUpdate({
    callback_query: {
      id: 'callback',
      data: createButton.callback_data,
      from: message.from,
      message: { message_id: draftMessage.payload.message_id, chat: message.chat },
    },
  });

  assert.equal(issues.length, 1);
  assert.match(issues[0].issue.body, /Requested via Telegram by \*\*Ada Lovelace\*\*/);
  assert.match(issues[0].issue.body, /`@ada`/);
  assert.deepEqual(issues[0].issue.labels, []);
});

test('asks for a repository and rejects another user callback', async () => {
  const repositories = [
    { repositoryId: '1', installationId: '9', owner: 'acme', name: 'app', fullName: 'acme/app', allowedLabels: [] },
    { repositoryId: '2', installationId: '9', owner: 'acme', name: 'api', fullName: 'acme/api', allowedLabels: [] },
  ];
  const { bot, calls } = fixture(repositories);
  await bot.processUpdate({ message });
  const chooser = calls.find((call) => call.payload.text === 'Choose a repository:');
  const choice = chooser.payload.reply_markup.inline_keyboard[0][0];

  await bot.processUpdate({
    callback_query: {
      id: 'foreign-callback',
      data: choice.callback_data,
      from: { id: 99, first_name: 'Grace' },
      message: { message_id: chooser.payload.message_id, chat: message.chat },
    },
  });

  const answer = calls.at(-1);
  assert.equal(answer.method, 'answerCallbackQuery');
  assert.equal(answer.payload.show_alert, true);
  assert.match(answer.payload.text, /another user/);
});

test('keeps the legacy alias and area syntax working during migration', async () => {
  const repo = {
    repositoryId: 'legacy:app',
    installationId: '9',
    owner: 'acme',
    name: 'app',
    fullName: 'acme/app',
    allowedLabels: ['mobile'],
    legacy: true,
    legacyAlias: 'app',
    legacyAreas: [{ name: 'ios', labels: ['mobile'], prefix: '[Mobile]' }],
    legacyDefaultArea: 'ios',
  };
  const { bot, calls, modelRequests } = fixture([repo]);

  await bot.processUpdate({ message: { ...message, text: '/issue app ios Fix the payment screen' } });

  assert.equal(modelRequests[0].source, 'Fix the payment screen');
  const draftMessage = calls.find((call) => call.method === 'editMessageText');
  assert.match(draftMessage.payload.text, /mobile/);
  assert.match(draftMessage.payload.text, /\[Mobile\] Fix payment/);
});

test('paginates configured labels and marks selected labels', () => {
  const draft = {
    repo: { allowedLabels: Array.from({ length: 10 }, (_, index) => `label-${index}`) },
    selectedLabels: ['label-8'],
  };
  const keyboard = labelsButtons('draft', draft, 1).inline_keyboard.flat();

  assert(keyboard.some((item) => item.text === '✓ label-8'));
  assert(keyboard.some((item) => item.text === '2/2'));
});

test('escapes Markdown in the requester display name', () => {
  const body = appendRequester('Body', { id: 1, first_name: 'A_*', username: 'ada' });
  assert.match(body, /A\\_\\\*/);
});
