'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { createPkce, isTelegramAdmin, randomToken, validateTelegramInitData } = require('./security');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_AI_CONTEXT_LENGTH = 8000;
const ISSUE_LANGUAGES = new Set(['auto', 'en', 'ru']);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function writeJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function writeHtml(response, statusCode, title, message, returnUrl = '') {
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const button = returnUrl ? `<p><a class="button" href="${escape(returnUrl)}">Return to Telegram</a></p>` : '';
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui;margin:0;background:#0f172a;color:#e2e8f0;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;margin:1rem;padding:2rem;border-radius:1rem;background:#1e293b;box-shadow:0 20px 60px #0005}.button{display:inline-block;padding:.8rem 1rem;border-radius:.7rem;background:#38bdf8;color:#082f49;text-decoration:none;font-weight:700}</style><main class="card"><h1>${escape(title)}</h1><p>${escape(message)}</p>${button}</main></html>`);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function createWebModule({ config, github, store, telegram, logger = console }) {
  let botUsername = '';

  function authenticate(body) {
    try {
      return validateTelegramInitData(body.initData, config.telegramToken);
    } catch (error) {
      throw new HttpError(401, error.message);
    }
  }

  async function ensureAdmin(user, chatId) {
    if (!chatId) throw new HttpError(400, 'Select a Telegram group.');
    let member;
    try {
      member = await telegram.getChatMember(chatId, user.id);
    } catch {
      throw new HttpError(403, 'The bot cannot verify your role in this group.');
    }
    if (!isTelegramAdmin(member)) throw new HttpError(403, 'Only group administrators can change settings.');

    let group = await store.getGroup(chatId);
    if (!group) {
      const chat = await telegram.call('getChat', { chat_id: chatId });
      await store.rememberGroup(chat, user.id);
      group = await store.getGroup(chatId);
    } else {
      await store.rememberGroup({ id: group.chatId, title: group.title, type: group.type }, user.id);
    }
    return group;
  }

  async function context(body, { requireChat = true } = {}) {
    const auth = authenticate(body);
    let chatId = body.chatId ? String(body.chatId) : '';
    let launch = null;
    if (body.startParam) {
      launch = await store.getLaunchSession(body.startParam);
      if (!launch || launch.userId !== String(auth.user.id)) {
        throw new HttpError(401, 'This Settings link has expired. Run /settings again.');
      }
      chatId = launch.chatId;
      await store.touchLaunchSession(body.startParam);
    }
    const group = chatId ? await ensureAdmin(auth.user, chatId) : null;
    if (requireChat && !group) throw new HttpError(400, 'Select a Telegram group.');
    return { ...auth, chatId, group, launch };
  }

  async function bootstrap(body) {
    const ctx = await context(body, { requireChat: false });
    const groups = await store.listAdminGroups(ctx.user.id);
    const repositories = ctx.chatId ? await store.listRepositories(ctx.chatId) : [];
    return {
      user: {
        id: ctx.user.id,
        firstName: ctx.user.first_name,
        lastName: ctx.user.last_name || '',
        username: ctx.user.username || '',
      },
      selectedChatId: ctx.chatId || null,
      groups,
      group: ctx.group,
      repositories,
      resumeConnectionState: ctx.launch?.connectState || null,
      githubConnectionReady: Boolean(
        config.publicBaseUrl
        && config.miniAppShortName
        && config.githubInstallUrl
        && config.githubClientId
        && config.githubClientSecret
      ),
    };
  }

  function buildAuthorizeUrl(state, codeChallenge) {
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', config.githubClientId);
    authorizeUrl.searchParams.set('redirect_uri', `${config.publicBaseUrl}/github/callback`);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    return authorizeUrl.toString();
  }

  function buildInstallUrl(state) {
    const installUrl = new URL(config.githubInstallUrl);
    installUrl.searchParams.set('state', state);
    return installUrl.toString();
  }

  async function connectGitHub(body) {
    const ctx = await context(body);
    if (!config.publicBaseUrl || !config.miniAppShortName || !config.githubInstallUrl || !config.githubClientId || !config.githubClientSecret) {
      throw new HttpError(503, 'GitHub connection is not configured on the server yet.');
    }
    try {
      new URL(config.githubInstallUrl);
    } catch {
      throw new HttpError(503, 'The GitHub installation URL is invalid.');
    }
    const state = randomToken(24);
    const returnToken = randomToken(18);
    const pkce = createPkce();
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
    await Promise.all([
      store.createOAuthSession({
        state,
        chatId: ctx.chatId,
        userId: String(ctx.user.id),
        codeVerifier: pkce.verifier,
        codeChallenge: pkce.challenge,
        returnToken,
        status: 'awaiting_authorization',
        createdAt: new Date(),
        expiresAt,
      }),
      store.createLaunchSession({
        token: returnToken,
        chatId: ctx.chatId,
        userId: String(ctx.user.id),
        connectState: state,
        createdAt: new Date(),
        expiresAt,
      }),
    ]);
    return { state, url: buildAuthorizeUrl(state, pkce.challenge) };
  }

  async function githubSetup(url, response) {
    const state = url.searchParams.get('state') || '';
    const installationId = url.searchParams.get('installation_id') || '';
    const session = await store.getOAuthSession(state);
    if (!session || session.status !== 'awaiting_installation' || !/^\d+$/.test(installationId)) {
      return writeHtml(response, 400, 'Connection failed', 'The GitHub connection session is invalid or has expired.');
    }
    try {
      const installation = await github.getInstallation(installationId);
      await store.updateOAuthSession(state, {
        installationId: String(installationId),
        installationAccount: installation.account?.login || '',
        status: 'awaiting_authorization',
      });
      response.writeHead(302, { location: buildAuthorizeUrl(state, session.codeChallenge), 'cache-control': 'no-store' });
      response.end();
    } catch (error) {
      logger.error(error);
      writeHtml(response, 400, 'Connection failed', 'GitHub did not return a valid installation.');
    }
  }

  function returnMiniAppUrl(token) {
    if (!botUsername || !config.miniAppShortName) return '';
    return `https://t.me/${botUsername}/${config.miniAppShortName}?startapp=${encodeURIComponent(token)}`;
  }

  async function githubCallback(url, response) {
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const session = await store.getOAuthSession(state);
    const returnUrl = session ? returnMiniAppUrl(session.returnToken) : '';
    if (!session || session.status !== 'awaiting_authorization' || !code) {
      return writeHtml(response, 400, 'Connection failed', 'The GitHub authorization session is invalid or has expired.', returnUrl);
    }
    try {
      const token = await github.exchangeOAuthCode(code, session.codeVerifier);
      if (!token.access_token) throw new Error(token.error_description || token.error || 'GitHub did not return an access token.');
      let installations = await github.listUserInstallations(token.access_token);
      if (!installations.length && session.installationId) {
        installations = [{ id: String(session.installationId), account: session.installationAccount || '', manageUrl: '' }];
      }
      if (!installations.length) {
        await store.updateOAuthSession(state, { status: 'awaiting_installation' });
        response.writeHead(302, { location: buildInstallUrl(state), 'cache-control': 'no-store' });
        response.end();
        return;
      }
      const repositories = [];
      for (const installation of installations) {
        const found = await github.listUserInstallationRepositories(token.access_token, installation.id);
        repositories.push(...found.map((repo) => ({ ...repo, installationId: installation.id })));
      }
      await store.updateOAuthSession(state, {
        installations,
        availableRepositories: repositories,
        status: 'ready',
      });
      writeHtml(
        response,
        200,
        'GitHub connected',
        `${repositories.length} repositories are ready to configure. Return to Telegram to finish setup.`,
        returnUrl,
      );
    } catch (error) {
      logger.error(error);
      await store.updateOAuthSession(state, { status: 'failed', error: error.message });
      writeHtml(response, 400, 'Connection failed', error.message, returnUrl);
    }
  }

  async function getConnectionStatus(body) {
    const auth = authenticate(body);
    const session = await store.getOAuthSession(body.state || '');
    const chatId = String(body.chatId || '');
    if (!session || session.userId !== String(auth.user.id) || session.chatId !== chatId) {
      throw new HttpError(404, 'Connection session not found.');
    }
    const connected = await store.listRepositories(chatId);
    const selectedIds = new Set(connected.map((repo) => repo.repositoryId));
    return {
      status: session.status,
      error: session.error || null,
      installations: (session.installations || []).map(({ account, manageUrl }) => ({ account, manageUrl })),
      repositories: (session.availableRepositories || []).map((repo) => ({
        ...repo,
        selected: selectedIds.has(repo.id),
      })),
    };
  }

  async function prepareRepositories(body) {
    const ctx = await context(body);
    const session = await store.getOAuthSession(body.state || '');
    if (!session || session.userId !== String(ctx.user.id) || session.chatId !== ctx.chatId || session.status !== 'ready') {
      throw new HttpError(404, 'Connection session not found.');
    }
    const requestedIds = new Set((body.repositoryIds || []).map(String));
    const selected = (session.availableRepositories || []).filter((repo) => requestedIds.has(repo.id));
    if (!selected.length) throw new HttpError(400, 'Select at least one repository.');
    if (selected.length !== requestedIds.size) throw new HttpError(400, 'One or more repositories are not available.');

    const current = await store.listRepositories(ctx.chatId);
    const currentById = new Map(current.map((repo) => [repo.repositoryId, repo]));
    const prepared = await Promise.all(selected.map(async (repo) => ({
      ...repo,
      labels: await github.listLabels(repo.installationId || session.installationId, repo.owner, repo.name),
      allowedLabels: currentById.get(repo.id)?.allowedLabels || [],
    })));
    await store.updateOAuthSession(session.state, { preparedRepositories: prepared });
    return { repositories: prepared };
  }

  async function saveRepositories(body) {
    const ctx = await context(body);
    const session = await store.getOAuthSession(body.state || '');
    if (!session || session.userId !== String(ctx.user.id) || session.chatId !== ctx.chatId || !session.preparedRepositories) {
      throw new HttpError(404, 'Connection session not found.');
    }
    const input = Array.isArray(body.repositories) ? body.repositories : [];
    const inputById = new Map(input.map((repo) => [String(repo.repositoryId), repo]));
    if (!input.length || input.length !== session.preparedRepositories.length) {
      throw new HttpError(400, 'Repository selection is incomplete.');
    }
    const selected = session.preparedRepositories.map((repo) => {
      const requested = inputById.get(repo.id);
      if (!requested) throw new HttpError(400, 'Repository selection is invalid.');
      const available = new Set(repo.labels.map((label) => label.name));
      const allowedLabels = [...new Set((requested.allowedLabels || []).map(String))];
      if (allowedLabels.some((label) => !available.has(label))) throw new HttpError(400, `A label for ${repo.fullName} is not available.`);
      return { ...repo, allowedLabels };
    });
    const installationIds = new Set((session.installations || []).map((installation) => installation.id));
    if (session.installationId) installationIds.add(String(session.installationId));
    for (const installationId of installationIds) {
      await store.saveInstallationRepositories(
        ctx.chatId,
        installationId,
        selected.filter((repo) => String(repo.installationId || session.installationId) === installationId),
      );
    }
    await store.consumeOAuthSession(session.state);
    return { repositories: await store.listRepositories(ctx.chatId) };
  }

  async function repositoryLabels(body) {
    const ctx = await context(body);
    const repo = await store.getRepository(ctx.chatId, body.repositoryId);
    if (!repo) throw new HttpError(404, 'Repository not found.');
    return {
      repository: repo,
      labels: await github.listLabels(repo.installationId, repo.owner, repo.name),
    };
  }

  async function saveRepositoryLabels(body) {
    const ctx = await context(body);
    const repo = await store.getRepository(ctx.chatId, body.repositoryId);
    if (!repo) throw new HttpError(404, 'Repository not found.');
    const labels = await github.listLabels(repo.installationId, repo.owner, repo.name);
    const available = new Set(labels.map((label) => label.name));
    const allowedLabels = [...new Set((body.allowedLabels || []).map(String))];
    if (allowedLabels.some((label) => !available.has(label))) throw new HttpError(400, 'One or more labels are not available.');
    await store.updateRepositoryLabels(ctx.chatId, repo.repositoryId, allowedLabels);
    return { repositories: await store.listRepositories(ctx.chatId) };
  }

  async function removeRepository(body) {
    const ctx = await context(body);
    const removed = await store.removeRepository(ctx.chatId, body.repositoryId);
    if (!removed) throw new HttpError(404, 'Repository not found.');
    return { repositories: await store.listRepositories(ctx.chatId) };
  }

  async function saveGroupAiSettings(body) {
    const ctx = await context(body);
    if (typeof body.aiContext !== 'string') throw new HttpError(400, 'AI context must be text.');
    const aiContext = body.aiContext.trim();
    if (aiContext.length > MAX_AI_CONTEXT_LENGTH) {
      throw new HttpError(400, `AI context must be ${MAX_AI_CONTEXT_LENGTH} characters or fewer.`);
    }
    const issueLanguage = String(body.issueLanguage || 'auto');
    if (!ISSUE_LANGUAGES.has(issueLanguage)) throw new HttpError(400, 'Issue language is not supported.');
    const updated = await store.updateGroupAiSettings(ctx.chatId, { aiContext, issueLanguage });
    if (!updated) throw new HttpError(404, 'Telegram group not found.');
    return { group: await store.getGroup(ctx.chatId) };
  }

  const apiRoutes = new Map([
    ['/api/bootstrap', bootstrap],
    ['/api/github/connect', connectGitHub],
    ['/api/github/status', getConnectionStatus],
    ['/api/github/prepare', prepareRepositories],
    ['/api/github/save', saveRepositories],
    ['/api/repository/labels', repositoryLabels],
    ['/api/repository/labels/save', saveRepositoryLabels],
    ['/api/repository/remove', removeRepository],
    ['/api/group/ai-settings/save', saveGroupAiSettings],
  ]);

  async function serveStatic(url, response) {
    const files = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
      '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
      '/telegram-web-app.js': ['telegram-web-app.js', 'application/javascript; charset=utf-8'],
    };
    const entry = files[url.pathname];
    if (!entry) return false;
    const content = await fs.readFile(path.join(PUBLIC_DIR, entry[0]));
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': entry[1],
      'content-security-policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    response.end(content);
    return true;
  }

  async function handle(request, response) {
    const url = new URL(request.url, config.publicBaseUrl || 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') return writeJson(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/github/setup') return githubSetup(url, response);
    if (request.method === 'GET' && url.pathname === '/github/callback') return githubCallback(url, response);
    if (request.method === 'GET' && await serveStatic(url, response)) return;
    if (request.method === 'POST' && apiRoutes.has(url.pathname)) {
      const body = await readBody(request);
      const result = await apiRoutes.get(url.pathname)(body);
      return writeJson(response, 200, result);
    }
    throw new HttpError(404, 'Not found.');
  }

  function createServer() {
    return http.createServer((request, response) => {
      handle(request, response).catch((error) => {
        if (!(error instanceof HttpError)) logger.error(error);
        writeJson(response, error.statusCode || 500, {
          error: error.statusCode ? error.message : 'Internal server error.',
        });
      });
    });
  }

  async function configure() {
    const me = await telegram.call('getMe');
    botUsername = me.username;
  }

  return { configure, createServer };
}

module.exports = { HttpError, createWebModule, readBody };
