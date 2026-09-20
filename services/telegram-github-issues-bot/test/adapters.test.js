'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeepSeekAdapter } = require('../src/adapters');

test('sends group context and an explicit fallback language to DeepSeek', async (t) => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"Test","body":"## Context\\nTest"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const adapter = createDeepSeekAdapter({
    deepseekUrl: 'https://deepseek.example.test',
    deepseekKey: 'secret',
    deepseekModel: 'deepseek-chat',
  });
  await adapter.generate({
    source: 'test',
    repository: { fullName: 'acme/app' },
    aiContext: 'Mobile app written in React Native.',
    issueLanguage: 'auto',
  });

  assert.match(request.messages[0].content, /language is ambiguous.*use English/i);
  assert.match(request.messages[0].content, /Never switch to Chinese/);
  assert.equal(request.messages[1].role, 'system');
  assert.match(request.messages[1].content, /Mobile app written in React Native/);
  assert.equal(request.messages.at(-1).role, 'user');
  assert.match(request.messages.at(-1).content, /Requester message: test/);
});
