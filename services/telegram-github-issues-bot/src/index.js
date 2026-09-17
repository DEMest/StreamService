'use strict';

const TELEGRAM_API = 'https://api.telegram.org';
const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_SOURCE_LENGTH = 8_000;

const config = loadConfig();
const drafts = new Map();
const editRequests = new Map();
let updateOffset = 0;

function loadConfig() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'ALLOWED_TELEGRAM_USER_IDS',
    'DEEPSEEK_API_KEY',
    'GITHUB_TOKEN',
    'GITHUB_OWNER',
    'GITHUB_REPO',
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const allowedUserIds = new Set(
    process.env.ALLOWED_TELEGRAM_USER_IDS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedUserIds.size) {
    throw new Error('ALLOWED_TELEGRAM_USER_IDS must contain at least one numeric Telegram user ID');
  }

  return {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    allowedUserIds,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,
    defaultLabels: (process.env.DEFAULT_GITHUB_LABELS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`Invalid JSON response from ${url}: ${body.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${body.slice(0, 500)}`);
  }
  return data;
}

async function telegram(method, payload) {
  const data = await requestJson(`${TELEGRAM_API}/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description || 'unknown error'}`);
  return data.result;
}

function isAllowed(userId) {
  return userId && config.allowedUserIds.has(String(userId));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}

function randomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function editRequestKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function draftButtons(draftId) {
  return {
    inline_keyboard: [[
      { text: 'Создать issue', callback_data: `create:${draftId}` },
      { text: 'Изменить', callback_data: `edit:${draftId}` },
      { text: 'Отмена', callback_data: `cancel:${draftId}` },
    ]],
  };
}

function extractIssueSource(message) {
  const command = message.text?.match(/^\/issue(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!command) return null;
  const text = command[1]?.trim() || message.reply_to_message?.text?.trim() || '';
  return text.slice(0, MAX_SOURCE_LENGTH);
}

function parseModelJson(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed.title || !parsed.body) throw new Error('The model response lacks title or body');
  return {
    title: String(parsed.title).slice(0, 240),
    body: String(parsed.body).slice(0, 60_000),
    labels: Array.isArray(parsed.labels)
      ? parsed.labels.map(String).map((label) => label.slice(0, 50)).filter(Boolean).slice(0, 10)
      : [],
  };
}

async function draftIssue(source) {
  const system = [
    'You turn a Telegram request into a precise GitHub issue.',
    'Return ONLY valid JSON with this exact schema:',
    '{"title":"short imperative title","body":"Markdown description in Russian","labels":["optional-label"]}.',
    'The body must include sections: Контекст, Что нужно сделать, Критерии готовности.',
    'Do not invent technical facts. If details are missing, write concise assumptions or questions in the issue.',
  ].join(' ');

  const response = await requestJson(`${config.deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.deepseekApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Запрос из Telegram:\n${source}` },
      ],
    }),
  });
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no completion');
  return parseModelJson(content);
}

async function reviseIssue(issue, instruction) {
  const system = [
    'You edit an existing GitHub issue according to the author instruction.',
    'Return ONLY valid JSON with this exact schema:',
    '{"title":"short imperative title","body":"Markdown description in Russian","labels":["optional-label"]}.',
    'Keep useful information from the current issue, apply the instruction, and do not invent technical facts.',
    'The body must include sections: Контекст, Что нужно сделать, Критерии готовности.',
  ].join(' ');

  const response = await requestJson(`${config.deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.deepseekApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Текущий черновик:\n${JSON.stringify(issue)}\n\nИнструкция автора:\n${instruction}`,
        },
      ],
    }),
  });
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no completion');
  return parseModelJson(content);
}

function previewText(issue) {
  const body = issue.body.length > 2_800 ? `${issue.body.slice(0, 2_800)}\n\n…` : issue.body;
  return `<b>Черновик GitHub Issue</b>\n\n<b>${escapeHtml(issue.title)}</b>\n\n${escapeHtml(body)}`;
}

async function createGithubIssue(issue) {
  const labels = [...new Set([...config.defaultLabels, ...issue.labels])];
  const data = await requestJson(
    `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/issues`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${config.githubToken}`,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: issue.title, body: issue.body, labels }),
    },
  );
  return data;
}

async function handleMessage(message) {
  const pendingEdit = editRequests.get(editRequestKey(message.chat.id, message.from?.id));
  if (pendingEdit) {
    await handleEditInstruction(message, pendingEdit);
    return;
  }

  const source = extractIssueSource(message);
  if (source === null) return;

  if (!isAllowed(message.from?.id)) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'У вас нет прав на создание задач через этого бота.',
      reply_to_message_id: message.message_id,
    });
    return;
  }

  if (!source || source.toLowerCase() === 'help') {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Использование: <code>/issue описание задачи</code>\n\nМожно также ответить командой <code>/issue</code> на сообщение с описанием.',
      parse_mode: 'HTML',
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const status = await telegram('sendMessage', {
    chat_id: message.chat.id,
    text: 'Готовлю черновик задачи…',
    reply_to_message_id: message.message_id,
  });
  try {
    const issue = await draftIssue(source);
    const draftId = randomId();
    drafts.set(draftId, {
      issue,
      chatId: message.chat.id,
      ownerId: message.from.id,
      expiresAt: Date.now() + DRAFT_TTL_MS,
    });
    await telegram('editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: previewText(issue),
      parse_mode: 'HTML',
      reply_markup: {
        ...draftButtons(draftId),
      },
    });
  } catch (error) {
    console.error('Draft generation failed', error);
    await telegram('editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: 'Не удалось подготовить черновик. Проверьте настройки DeepSeek и попробуйте ещё раз.',
    });
  }
}

async function handleEditInstruction(message, pendingEdit) {
  const key = editRequestKey(message.chat.id, message.from?.id);
  const draft = drafts.get(pendingEdit.draftId);
  if (!draft || draft.expiresAt < Date.now()) {
    editRequests.delete(key);
    drafts.delete(pendingEdit.draftId);
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Черновик устарел. Создайте новый через /issue.',
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const instruction = message.text?.trim();
  if (!instruction) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Нужна текстовая инструкция: например, «добавь критерий готовности и убери упоминание мобильной версии».',
      reply_to_message_id: message.message_id,
    });
    return;
  }

  try {
    const issue = await reviseIssue(draft.issue, instruction.slice(0, MAX_SOURCE_LENGTH));
    draft.issue = issue;
    draft.expiresAt = Date.now() + DRAFT_TTL_MS;
    editRequests.delete(key);
    await telegram('editMessageText', {
      chat_id: draft.chatId,
      message_id: pendingEdit.previewMessageId,
      text: previewText(issue),
      parse_mode: 'HTML',
      reply_markup: draftButtons(pendingEdit.draftId),
    });
  } catch (error) {
    console.error('Draft revision failed', error);
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Не удалось применить правку. Попробуйте сформулировать её иначе.',
      reply_to_message_id: message.message_id,
    });
  }
}

async function handleCallback(callback) {
  const [action, draftId] = (callback.data || '').split(':');
  const draft = drafts.get(draftId);
  if (!draft || draft.expiresAt < Date.now()) {
    drafts.delete(draftId);
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Черновик устарел. Создайте новый.' });
    return;
  }
  if (!isAllowed(callback.from?.id) || callback.from.id !== draft.ownerId) {
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Подтвердить может только автор запроса.', show_alert: true });
    return;
  }

  if (action === 'cancel') {
    drafts.delete(draftId);
    editRequests.delete(editRequestKey(draft.chatId, draft.ownerId));
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Черновик отменён.' });
    await telegram('editMessageReplyMarkup', { chat_id: draft.chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
    return;
  }
  if (action === 'edit') {
    editRequests.set(editRequestKey(draft.chatId, draft.ownerId), {
      draftId,
      previewMessageId: callback.message.message_id,
    });
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Жду инструкцию по правке.' });
    await telegram('editMessageText', {
      chat_id: draft.chatId,
      message_id: callback.message.message_id,
      text: 'Напишите следующим сообщением, что нужно изменить в черновике. Бот примет инструкцию только от автора запроса.',
    });
    return;
  }
  if (action !== 'create') return;

  await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Создаю issue…' });
  try {
    const issue = await createGithubIssue(draft.issue);
    drafts.delete(draftId);
    await telegram('editMessageText', {
      chat_id: draft.chatId,
      message_id: callback.message.message_id,
      text: `✅ Создана задача <a href="${escapeHtml(issue.html_url)}">#${issue.number}: ${escapeHtml(issue.title)}</a>`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error('GitHub issue creation failed', error);
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'GitHub не принял задачу. Проверьте токен и логи.', show_alert: true });
  }
}

async function handleUpdate(update) {
  if (update.message) await handleMessage(update.message);
  if (update.callback_query) await handleCallback(update.callback_query);
}

async function run() {
  // Prevent Telegram from keeping a stale webhook when switching to polling.
  await telegram('deleteWebhook', { drop_pending_updates: false });
  const me = await telegram('getMe', {});
  console.log(`Started @${me.username}; allowed users: ${config.allowedUserIds.size}`);

  while (true) {
    try {
      const updates = await telegram('getUpdates', {
        offset: updateOffset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const update of updates) {
        updateOffset = update.update_id + 1;
        await handleUpdate(update);
      }
      for (const [id, draft] of drafts) if (draft.expiresAt < Date.now()) drafts.delete(id);
      for (const [key, pendingEdit] of editRequests) {
        if (!drafts.has(pendingEdit.draftId)) editRequests.delete(key);
      }
    } catch (error) {
      console.error('Polling error; retrying in 5 seconds', error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

run().catch((error) => {
  console.error('Bot failed to start', error);
  process.exit(1);
});
