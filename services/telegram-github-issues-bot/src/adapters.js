'use strict';

const crypto = require('node:crypto');
const { ProxyAgent } = require('undici');

async function requestJson(url, options, name) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`${name} returned an invalid response.`);
  }
  if (!response.ok) {
    const message = data?.message || data?.error_description || body.slice(0, 300);
    throw new Error(`${name}: HTTP ${response.status}: ${message}`);
  }
  return data;
}

function createTelegramAdapter(config) {
  const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined;

  async function call(method, payload = {}) {
    const data = await requestJson(
      `https://api.telegram.org/bot${config.telegramToken}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        dispatcher,
      },
      'Telegram',
    );
    if (!data.ok) throw new Error(data.description || 'Telegram request failed.');
    return data.result;
  }

  return {
    call,
    getChatMember: (chatId, userId) => call('getChatMember', { chat_id: chatId, user_id: userId }),
  };
}

function createGitHubAdapter(config) {
  const tokens = new Map();
  const headers = (authorization, extra = {}) => ({
    accept: 'application/vnd.github+json',
    authorization,
    'x-github-api-version': '2022-11-28',
    ...extra,
  });

  function appJwt() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.githubAppId })).toString('base64url');
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), config.githubPrivateKey)
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  async function installationToken(installationId) {
    const cached = tokens.get(String(installationId));
    if (cached?.expiresAt > Date.now() + 60_000) return cached.token;
    const data = await requestJson(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      { method: 'POST', headers: headers(`Bearer ${appJwt()}`) },
      'GitHub App',
    );
    tokens.set(String(installationId), {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });
    return data.token;
  }

  async function asInstallation(installationId, path, options = {}) {
    return requestJson(
      `https://api.github.com${path}`,
      {
        ...options,
        headers: headers(`Bearer ${await installationToken(installationId)}`, options.headers),
      },
      'GitHub',
    );
  }

  async function listUserInstallationRepositories(userToken, installationId) {
    const repositories = [];
    let page = 1;
    while (true) {
      const data = await requestJson(
        `https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
        { headers: headers(`Bearer ${userToken}`) },
        'GitHub',
      );
      repositories.push(...(data.repositories || []));
      if (repositories.length >= data.total_count || !data.repositories?.length) break;
      page += 1;
    }
    return repositories.map((repo) => ({
      id: String(repo.id),
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      private: Boolean(repo.private),
    }));
  }

  async function listLabels(installationId, owner, name) {
    const labels = [];
    let page = 1;
    while (true) {
      const data = await asInstallation(
        installationId,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/labels?per_page=100&page=${page}`,
      );
      labels.push(...data.map((label) => ({ name: label.name, color: label.color })));
      if (data.length < 100) break;
      page += 1;
    }
    return labels;
  }

  return {
    createIssue: (repo, issue) => asInstallation(
      repo.installationId,
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(issue),
      },
    ),
    exchangeOAuthCode: (code, verifier) => {
      const form = new URLSearchParams({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        redirect_uri: `${config.publicBaseUrl}/github/callback`,
        code_verifier: verifier,
      });
      return requestJson(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        },
        'GitHub OAuth',
      );
    },
    getInstallation: (installationId) => requestJson(
      `https://api.github.com/app/installations/${installationId}`,
      { headers: headers(`Bearer ${appJwt()}`) },
      'GitHub App',
    ),
    listLabels,
    listUserInstallationRepositories,
  };
}

function createDeepSeekAdapter(config) {
  async function generate({ source, currentIssue, instruction, repository }) {
    const editing = Boolean(currentIssue);
    const system = [
      editing ? 'Revise an existing GitHub issue using the requester instruction.' : 'Write a precise GitHub issue from the requester message.',
      'Return only JSON in the form {"title":"...","body":"..."}.',
      editing ? 'Keep the current issue language unless the requester explicitly asks to change it.' : 'Use the same language as the requester.',
      'The body must contain clear Context, Work required, and Acceptance criteria sections translated to that language.',
      'Do not invent facts, implementation details, or acceptance criteria not supported by the request.',
    ].join(' ');
    const user = editing
      ? `Repository: ${repository.fullName}\nCurrent issue: ${JSON.stringify(currentIssue)}\nRevision instruction: ${instruction.slice(0, 8000)}`
      : `Repository: ${repository.fullName}\nRequester message: ${source.slice(0, 8000)}`;
    const data = await requestJson(
      `${config.deepseekUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${config.deepseekKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.deepseekModel,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      },
      'DeepSeek',
    );
    let result;
    try {
      result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch {
      throw new Error('DeepSeek returned invalid JSON.');
    }
    if (!result.title || !result.body) throw new Error('DeepSeek did not return a title and body.');
    return { title: String(result.title).slice(0, 240), body: String(result.body).slice(0, 60_000) };
  }

  return { generate };
}

module.exports = { createDeepSeekAdapter, createGitHubAdapter, createTelegramAdapter, requestJson };
