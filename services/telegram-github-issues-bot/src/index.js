'use strict';

const { ProxyAgent } = require('undici');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

// Production host reaches Telegram only through its existing outbound proxy.
const telegramProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const telegramDispatcher = telegramProxyUrl ? new ProxyAgent(telegramProxyUrl) : undefined;

const cfg = config();
const mongo = new MongoClient(cfg.mongoUri);
const drafts = new Map();
const edits = new Map();
const tokens = new Map();
let collection;
let offset = 0;

function config() {
  const required = ['TELEGRAM_BOT_TOKEN', 'DEEPSEEK_API_KEY', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY_BASE64'];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    deepseekKey: process.env.DEEPSEEK_API_KEY,
    deepseekUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    appId: process.env.GITHUB_APP_ID,
    privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    installUrl: process.env.GITHUB_APP_INSTALL_URL || '',
    mongoUri: process.env.MONGODB_URI || 'mongodb://mongo:27017/telegram-github-issues-bot',
    mongoDb: process.env.MONGODB_DATABASE || 'telegram-github-issues-bot',
    allowed: new Set((process.env.ALLOWED_TELEGRAM_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)),
  };
}

const html = (text) => String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const allowed = (id) => !cfg.allowed.size || cfg.allowed.has(String(id));
const key = (chatId, userId) => `${chatId}:${userId}`;
const alias = (value) => /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value || '');
const id = () => crypto.randomBytes(9).toString('base64url');

async function json(url, options, name) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data; try { data = body ? JSON.parse(body) : null; } catch { throw new Error(`${name}: некорректный ответ`); }
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${body.slice(0, 300)}`);
  return data;
}
async function telegram(method, payload) {
  const data = await json(`https://api.telegram.org/bot${cfg.telegramToken}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), dispatcher: telegramDispatcher }, 'Telegram');
  if (!data.ok) throw new Error(data.description || 'Telegram error');
  return data.result;
}
function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: cfg.appId })).toString('base64url');
  return `${header}.${payload}.${crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), cfg.privateKey).toString('base64url')}`;
}
async function installationToken(installationId) {
  const cached = tokens.get(String(installationId));
  if (cached?.expires > Date.now() + 60_000) return cached.token;
  const data = await json(`https://api.github.com/app/installations/${installationId}/access_tokens`, { method: 'POST', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${appJwt()}` } }, 'GitHub App');
  tokens.set(String(installationId), { token: data.token, expires: new Date(data.expires_at).getTime() });
  return data.token;
}
async function github(installationId, path, options = {}) {
  return json(`https://api.github.com${path}`, { ...options, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${await installationToken(installationId)}`, ...(options.headers || {}) } }, 'GitHub');
}
function command(message) {
  const match = message.text?.match(/^\/(start|help|connect|repo|area|issue)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return match && { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}
async function configs(chatId, userId) { return collection.find({ chatId: String(chatId), userId: String(userId) }).sort({ lastUsedAt: -1 }).toArray(); }
function defaultArea(repo, name) { return (repo.areas || []).find((area) => area.name === (name || repo.defaultArea)); }
function buttons(draftId) { return { inline_keyboard: [[{ text: 'Создать issue', callback_data: `create:${draftId}` }, { text: 'Изменить', callback_data: `edit:${draftId}` }, { text: 'Отмена', callback_data: `cancel:${draftId}` }]] }; }
function prefix(issue, area) { if (area?.prefix && !issue.title.startsWith(area.prefix)) issue.title = `${area.prefix} ${issue.title}`.slice(0, 240); return issue; }
async function deepseek(messages) {
  const data = await json(`${cfg.deepseekUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${cfg.deepseekKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.deepseekModel, temperature: 0.2, response_format: { type: 'json_object' }, messages }) }, 'DeepSeek');
  const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (!result.title || !result.body) throw new Error('DeepSeek не вернул title и body');
  return { title: String(result.title).slice(0, 240), body: String(result.body).slice(0, 60_000) };
}
function prompt(editing) { return `${editing ? 'Редактируй существующую GitHub задачу по инструкции автора.' : 'Составь точную GitHub задачу по запросу.'} Верни только JSON {"title":"...","body":"..."}. Текст на русском; body содержит разделы Контекст, Что нужно сделать, Критерии готовности. Не выдумывай факты.`; }
function preview(draft) { return `<b>Черновик GitHub Issue</b>\n<i>${html(draft.repo.owner)}/${html(draft.repo.name)}${draft.area ? ` · ${html(draft.area.name)}` : ''}</i>\n\n<b>${html(draft.issue.title)}</b>\n\n${html(draft.issue.body.slice(0, 2800))}`; }

async function repoCommand(message, args) {
  const [action, repoAlias, fullName, installationId] = args.split(/\s+/);
  if (action === 'list') { const all = await configs(message.chat.id, message.from.id); return telegram('sendMessage', { chat_id: message.chat.id, reply_to_message_id: message.message_id, parse_mode: 'HTML', text: all.length ? all.map((repo) => `• <code>${html(repo.alias)}</code> → ${html(repo.owner)}/${html(repo.name)}`).join('\n') : 'Репозитории ещё не настроены.' }); }
  if (action === 'use') { const repo = await collection.findOne({ chatId: String(message.chat.id), userId: String(message.from.id), alias: repoAlias }); if (!repo) throw new Error('Репозиторий не найден'); await collection.updateOne({ _id: repo._id }, { $set: { lastUsedAt: new Date() } }); return telegram('sendMessage', { chat_id: message.chat.id, text: `По умолчанию: ${repoAlias}`, reply_to_message_id: message.message_id }); }
  if (action !== 'add' || !alias(repoAlias) || !/^[\w.-]+\/[\w.-]+$/.test(fullName || '') || !/^\d+$/.test(installationId || '')) throw new Error('Формат: /repo add <псевдоним> <owner/repo> <installation_id>');
  const [owner, name] = fullName.split('/');
  await github(installationId, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  await collection.updateOne({ chatId: String(message.chat.id), userId: String(message.from.id), alias: repoAlias }, { $set: { owner, name, installationId, lastUsedAt: new Date(), updatedAt: new Date() }, $setOnInsert: { chatId: String(message.chat.id), userId: String(message.from.id), alias: repoAlias, areas: [], defaultArea: null, createdAt: new Date() } }, { upsert: true });
  return telegram('sendMessage', { chat_id: message.chat.id, parse_mode: 'HTML', text: `Сохранено: <code>${html(repoAlias)}</code> → ${html(fullName)}`, reply_to_message_id: message.message_id });
}
async function areaCommand(message, args) {
  const [action, repoAlias, areaName, ...options] = args.split(/\s+/);
  const repo = await collection.findOne({ chatId: String(message.chat.id), userId: String(message.from.id), alias: repoAlias });
  if (!repo) throw new Error('Репозиторий не найден. Используйте /repo list.');
  if (action === 'list') return telegram('sendMessage', { chat_id: message.chat.id, parse_mode: 'HTML', text: repo.areas?.length ? repo.areas.map((area) => `• <code>${html(area.name)}</code> · ${html(area.labels.join(', ') || 'без labels')} · ${html(area.prefix || 'без prefix')}`).join('\n') : 'Направления ещё не настроены.', reply_to_message_id: message.message_id });
  if (action === 'use' && defaultArea(repo, areaName)) { await collection.updateOne({ _id: repo._id }, { $set: { defaultArea: areaName, lastUsedAt: new Date() } }); return telegram('sendMessage', { chat_id: message.chat.id, text: `Направление по умолчанию: ${areaName}`, reply_to_message_id: message.message_id }); }
  if (action !== 'add' || !alias(areaName)) throw new Error('Формат: /area add <репо> <направление> --labels=mobile,ios --prefix="[Mobile]"');
  const labels = (options.find((option) => option.startsWith('--labels=')) || '').slice(9).split(',').map((x) => x.trim()).filter(Boolean);
  const area = { name: areaName, labels, prefix: (options.find((option) => option.startsWith('--prefix=')) || '').slice(9).replace(/^['"]|['"]$/g, '') };
  await collection.updateOne({ _id: repo._id }, { $pull: { areas: { name: areaName } } });
  await collection.updateOne({ _id: repo._id }, { $push: { areas: area }, $set: { defaultArea: repo.defaultArea || areaName, lastUsedAt: new Date() } });
  return telegram('sendMessage', { chat_id: message.chat.id, text: `Направление ${areaName} сохранено.`, reply_to_message_id: message.message_id });
}
async function issueCommand(message, source) {
  const all = await configs(message.chat.id, message.from.id); let words = source.split(/\s+/); let repo = all.find((item) => item.alias === words[0]) || all[0]; if (!repo) throw new Error('Сначала подключите репозиторий через /connect и /repo add.'); if (repo.alias === words[0]) words.shift(); let area = defaultArea(repo, words[0]); if (area) words.shift(); else area = defaultArea(repo); const text = words.join(' ').trim(); if (!text) throw new Error('Формат: /issue [репо] [направление] описание задачи');
  await collection.updateOne({ _id: repo._id }, { $set: { lastUsedAt: new Date() } });
  const status = await telegram('sendMessage', { chat_id: message.chat.id, text: 'Готовлю черновик…', reply_to_message_id: message.message_id });
  try { const issue = prefix(await deepseek([{ role: 'system', content: prompt(false) }, { role: 'user', content: `Репозиторий ${repo.owner}/${repo.name}; направление ${area?.name || 'не задано'}; запрос: ${text.slice(0, 8000)}` }]), area); const draftId = id(); const draft = { chatId: message.chat.id, userId: message.from.id, repo, area, issue, expires: Date.now() + 1_800_000 }; drafts.set(draftId, draft); await telegram('editMessageText', { chat_id: message.chat.id, message_id: status.message_id, text: preview(draft), parse_mode: 'HTML', reply_markup: buttons(draftId) }); } catch (error) { console.error(error); await telegram('editMessageText', { chat_id: message.chat.id, message_id: status.message_id, text: 'Не удалось подготовить черновик.' }); }
}
async function handleMessage(message) {
  if (!allowed(message.from?.id)) return;
  const pending = edits.get(key(message.chat.id, message.from.id));
  if (pending) { const draft = drafts.get(pending); const instruction = message.text?.trim(); if (!draft || !instruction) return; try { draft.issue = prefix(await deepseek([{ role: 'system', content: prompt(true) }, { role: 'user', content: `Черновик: ${JSON.stringify(draft.issue)}\nИнструкция: ${instruction.slice(0, 8000)}` }]), draft.area); draft.expires = Date.now() + 1_800_000; edits.delete(key(message.chat.id, message.from.id)); await telegram('editMessageText', { chat_id: draft.chatId, message_id: draft.previewId, text: preview(draft), parse_mode: 'HTML', reply_markup: buttons(pending) }); } catch (error) { console.error(error); } return; }
  const parsed = command(message); if (!parsed) return;
  try { if (parsed.name === 'start' || parsed.name === 'help') await telegram('sendMessage', { chat_id: message.chat.id, parse_mode: 'HTML', reply_to_message_id: message.message_id, text: `<b>GitHub Issues bot</b>\n1. <code>/connect</code> — установить GitHub App.\n2. <code>/repo add app org/repo installation_id</code>\n3. <code>/area add app mobile --labels=mobile,ios --prefix="[Mobile]"</code>\n4. <code>/issue app mobile Исправить экран оплаты</code>\nБез псевдонима бот берёт последний репозиторий; без направления — default.` }); else if (parsed.name === 'connect') await telegram('sendMessage', { chat_id: message.chat.id, text: cfg.installUrl ? `Установите GitHub App: ${cfg.installUrl}\nЗатем: /repo add app owner/repo installation_id` : 'Администратор не задал GITHUB_APP_INSTALL_URL.', reply_to_message_id: message.message_id, disable_web_page_preview: true }); else if (parsed.name === 'repo') await repoCommand(message, parsed.args); else if (parsed.name === 'area') await areaCommand(message, parsed.args); else await issueCommand(message, parsed.args); } catch (error) { await telegram('sendMessage', { chat_id: message.chat.id, text: error.message, reply_to_message_id: message.message_id }); }
}
async function handleCallback(callback) {
  const [action, draftId] = (callback.data || '').split(':'); const draft = drafts.get(draftId); if (!draft || draft.expires < Date.now()) return telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Черновик устарел.' }); if (callback.from.id !== draft.userId) return telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Это черновик другого пользователя.', show_alert: true });
  if (action === 'edit') { draft.previewId = callback.message.message_id; edits.set(key(draft.chatId, draft.userId), draftId); await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Жду инструкцию.' }); return telegram('editMessageText', { chat_id: draft.chatId, message_id: draft.previewId, text: 'Напишите следующим сообщением, что изменить. Инструкция принимается только от автора.' }); }
  if (action === 'cancel') { drafts.delete(draftId); return telegram('editMessageReplyMarkup', { chat_id: draft.chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } }); }
  if (action !== 'create') return;
  await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Создаю issue…' }); const issue = await github(draft.repo.installationId, `/repos/${encodeURIComponent(draft.repo.owner)}/${encodeURIComponent(draft.repo.name)}/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: draft.issue.title, body: draft.issue.body, labels: draft.area?.labels || [] }) }); drafts.delete(draftId); return telegram('editMessageText', { chat_id: draft.chatId, message_id: callback.message.message_id, parse_mode: 'HTML', text: `✅ <a href="${html(issue.html_url)}">#${issue.number}: ${html(issue.title)}</a>` });
}
async function run() { await mongo.connect(); collection = mongo.db(cfg.mongoDb).collection('repositoryConfigs'); await collection.createIndex({ chatId: 1, userId: 1, alias: 1 }, { unique: true }); await telegram('deleteWebhook', { drop_pending_updates: false }); const me = await telegram('getMe', {}); console.log(`Started @${me.username}; MongoDB connected`); while (true) { try { const updates = await telegram('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }); for (const update of updates) { offset = update.update_id + 1; if (update.message) await handleMessage(update.message); if (update.callback_query) await handleCallback(update.callback_query); } } catch (error) { console.error(error); await new Promise((resolve) => setTimeout(resolve, 5000)); } } }
run().catch((error) => { console.error(error); process.exit(1); });
