'use strict';

function required(env, names) {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

function readConfig(env = process.env) {
  required(env, [
    'TELEGRAM_BOT_TOKEN',
    'DEEPSEEK_API_KEY',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY_BASE64',
  ]);

  const publicBaseUrl = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

  return {
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    deepseekKey: env.DEEPSEEK_API_KEY,
    deepseekUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-chat',
    githubAppId: env.GITHUB_APP_ID,
    githubPrivateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    githubInstallUrl: env.GITHUB_APP_INSTALL_URL || '',
    githubClientId: env.GITHUB_CLIENT_ID || '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
    miniAppShortName: env.TELEGRAM_MINI_APP_SHORT_NAME || '',
    publicBaseUrl,
    httpPort: Number(env.HTTP_PORT || 3000),
    mongoUri: env.MONGODB_URI || 'mongodb://mongo:27017/telegram-github-issues-bot',
    mongoDb: env.MONGODB_DATABASE || 'telegram-github-issues-bot',
    proxyUrl: env.HTTPS_PROXY || env.HTTP_PROXY || '',
  };
}

module.exports = { readConfig };
