'use strict';

const { isTelegramAdmin, randomToken } = require('./security');

const DRAFT_TTL_MS = 30 * 60 * 1000;
const LABEL_PAGE_SIZE = 8;

const html = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const draftKey = (chatId, userId) => `${chatId}:${userId}`;

function command(message) {
  const match = message.text?.match(/^\/(start|help|settings|issue|connect|repo|area)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return match && { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

function markdownText(value) {
  return String(value).replace(/[\\`*_{}\[\]()#+.!|>-]/g, '\\$&');
}

function requesterNote(user) {
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown user';
  const username = user.username ? `, \`@${user.username}\`` : '';
  return `---\nRequested via Telegram by **${markdownText(displayName)}**${username} (user ID \`${user.id}\`).`;
}

function appendRequester(body, user) {
  return `${String(body).trim()}\n\n${requesterNote(user)}`;
}

function issueInput(repo, source) {
  if (!repo.legacy) return { source, selectedLabels: [], titlePrefix: '' };
  const words = source.split(/\s+/);
  if (words[0] === repo.legacyAlias) words.shift();
  let area = repo.legacyAreas?.find((candidate) => candidate.name === words[0]);
  if (area) words.shift();
  else area = repo.legacyAreas?.find((candidate) => candidate.name === repo.legacyDefaultArea);
  return {
    source: words.join(' ').trim() || source,
    selectedLabels: (area?.labels || []).filter((label) => repo.allowedLabels.includes(label)),
    titlePrefix: area?.prefix || '',
  };
}

function preview(draft) {
  const visibleLabels = draft.selectedLabels.slice(0, 5).map((label) => html(label)).join(', ');
  const moreLabels = draft.selectedLabels.length > 5 ? ` +${draft.selectedLabels.length - 5}` : '';
  const labels = draft.selectedLabels.length ? ` · ${visibleLabels}${moreLabels}` : '';
  return [
    '<b>GitHub issue draft</b>',
    `<i>${html(draft.repo.fullName)}${labels}</i>`,
    '',
    `<b>${html(draft.issue.title)}</b>`,
    '',
    html(draft.issue.body.slice(0, 2800)),
  ].join('\n');
}

function draftButtons(draftId, draft) {
  const rows = [];
  if (draft.repo.allowedLabels?.length) {
    rows.push([{ text: `Add labels (${draft.selectedLabels.length})`, callback_data: `labels:${draftId}:0` }]);
  }
  rows.push([
    { text: 'Edit', callback_data: `edit:${draftId}` },
    { text: 'Create issue', callback_data: `create:${draftId}` },
  ]);
  rows.push([{ text: 'Cancel', callback_data: `cancel:${draftId}` }]);
  return { inline_keyboard: rows };
}

function labelsButtons(draftId, draft, requestedPage) {
  const labels = draft.repo.allowedLabels || [];
  const pageCount = Math.max(1, Math.ceil(labels.length / LABEL_PAGE_SIZE));
  const page = Math.min(Math.max(Number(requestedPage) || 0, 0), pageCount - 1);
  const start = page * LABEL_PAGE_SIZE;
  const buttons = labels.slice(start, start + LABEL_PAGE_SIZE).map((label, offset) => {
    const selected = draft.selectedLabels.includes(label);
    return {
      text: `${selected ? '✓ ' : ''}${label}`.slice(0, 60),
      callback_data: `toggle:${draftId}:${start + offset}:${page}`,
    };
  });
  const rows = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  if (pageCount > 1) {
    rows.push([
      { text: '‹', callback_data: `labels:${draftId}:${Math.max(0, page - 1)}` },
      { text: `${page + 1}/${pageCount}`, callback_data: `labels:${draftId}:${page}` },
      { text: '›', callback_data: `labels:${draftId}:${Math.min(pageCount - 1, page + 1)}` },
    ]);
  }
  rows.push([{ text: 'Done', callback_data: `done:${draftId}` }]);
  return { inline_keyboard: rows };
}

function createBot({ config, github, model, store, telegram, logger = console }) {
  const drafts = new Map();
  const edits = new Map();
  const pendingIssues = new Map();
  let botUsername = '';
  let offset = 0;

  async function ensureAdmin(chat, userId) {
    if (!['group', 'supergroup'].includes(chat.type)) throw new Error('Run /settings in the Telegram group you want to configure.');
    const member = await telegram.getChatMember(chat.id, userId);
    if (!isTelegramAdmin(member)) throw new Error('Only group administrators can change settings.');
    await store.rememberGroup(chat, userId);
  }

  function mainMiniAppLink(token) {
    if (!botUsername || !config.miniAppShortName) {
      throw new Error('The Telegram Mini App is not configured yet.');
    }
    const base = `https://t.me/${botUsername}/${config.miniAppShortName}`;
    return token ? `${base}?startapp=${encodeURIComponent(token)}` : base;
  }

  async function createLaunch(chat, userId) {
    await ensureAdmin(chat, userId);
    const token = randomToken(18);
    await store.createLaunchSession({
      token,
      chatId: String(chat.id),
      userId: String(userId),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    return mainMiniAppLink(token);
  }

  async function sendSettings(message) {
    let url;
    if (['group', 'supergroup'].includes(message.chat.type)) {
      url = await createLaunch(message.chat, message.from.id);
    } else {
      url = mainMiniAppLink();
    }
    return telegram.call('sendMessage', {
      chat_id: message.chat.id,
      reply_to_message_id: message.message_id,
      text: message.chat.type === 'private'
        ? 'Open Settings to manage groups you have already connected. For first-time setup, run /settings inside the group.'
        : 'Group administrators can connect repositories and choose available labels here:',
      reply_markup: { inline_keyboard: [[{ text: 'Open settings', url }]] },
    });
  }

  async function sendGuide(message) {
    const rows = [];
    try {
      const url = ['group', 'supergroup'].includes(message.chat.type)
        ? await createLaunch(message.chat, message.from.id)
        : mainMiniAppLink();
      rows.push([{ text: 'Open settings', url }]);
    } catch (error) {
      if (!/Only group administrators/.test(error.message)) logger.warn(error.message);
    }
    return telegram.call('sendMessage', {
      chat_id: message.chat.id,
      reply_to_message_id: message.message_id,
      parse_mode: 'HTML',
      text: [
        '<b>GitHub Issues bot</b>',
        '',
        'Use <code>/issue &lt;description&gt;</code> to prepare an AI-written issue draft.',
        'If the group has several repositories, the bot asks you to choose one.',
        'You can optionally add administrator-approved labels, edit the draft, create it, or cancel.',
        '',
        'Group administrators configure repositories, labels, AI context, and issue language with <code>/settings</code>.',
      ].join('\n'),
      reply_markup: rows.length ? { inline_keyboard: rows } : undefined,
    });
  }

  async function generateDraft(message, source, repo, selectedLabels = [], titlePrefix = '') {
    const status = await telegram.call('sendMessage', {
      chat_id: message.chat.id,
      reply_to_message_id: message.message_id,
      text: 'Preparing the issue draft…',
    });
    try {
      const group = store.getGroup ? await store.getGroup(message.chat.id) : null;
      const generationSettings = {
        aiContext: group?.aiContext || '',
        issueLanguage: group?.issueLanguage || 'auto',
      };
      const issue = await model.generate({ source, repository: repo, ...generationSettings });
      if (titlePrefix && !issue.title.startsWith(titlePrefix)) {
        issue.title = `${titlePrefix} ${issue.title}`.slice(0, 240);
      }
      const draftId = randomToken(9);
      const draft = {
        chatId: message.chat.id,
        userId: message.from.id,
        requester: message.from,
        repo,
        issue,
        selectedLabels,
        titlePrefix,
        generationSettings,
        previewId: status.message_id,
        expiresAt: Date.now() + DRAFT_TTL_MS,
      };
      drafts.set(draftId, draft);
      await telegram.call('editMessageText', {
        chat_id: draft.chatId,
        message_id: draft.previewId,
        text: preview(draft),
        parse_mode: 'HTML',
        reply_markup: draftButtons(draftId, draft),
      });
    } catch (error) {
      logger.error(error);
      await telegram.call('editMessageText', {
        chat_id: message.chat.id,
        message_id: status.message_id,
        text: 'Could not prepare the issue draft. Please try again.',
      });
    }
  }

  async function issueCommand(message, source) {
    if (!['group', 'supergroup'].includes(message.chat.type)) {
      throw new Error('Use /issue inside a configured Telegram group.');
    }
    if (!source) throw new Error('Usage: /issue <task description>');
    const repositories = store.listRepositoriesForIssue
      ? await store.listRepositoriesForIssue(message.chat.id, message.from.id)
      : await store.listRepositories(message.chat.id);
    if (!repositories.length) throw new Error('This group has no repositories yet. Ask an administrator to run /settings.');
    const firstWord = source.split(/\s+/, 1)[0];
    const legacyMatch = repositories.find((repo) => repo.legacyAlias === firstWord);
    if (legacyMatch) {
      const input = issueInput(legacyMatch, source);
      return generateDraft(message, input.source, legacyMatch, input.selectedLabels, input.titlePrefix);
    }
    if (repositories.length === 1) {
      const input = issueInput(repositories[0], source);
      return generateDraft(message, input.source, repositories[0], input.selectedLabels, input.titlePrefix);
    }

    const pendingId = randomToken(8);
    pendingIssues.set(pendingId, {
      chatId: message.chat.id,
      userId: message.from.id,
      message,
      source,
      repositories,
      expiresAt: Date.now() + DRAFT_TTL_MS,
    });
    return telegram.call('sendMessage', {
      chat_id: message.chat.id,
      reply_to_message_id: message.message_id,
      text: 'Choose a repository:',
      reply_markup: {
        inline_keyboard: repositories.map((repo, index) => ([{
          text: repo.fullName.slice(0, 60),
          callback_data: `repo:${pendingId}:${index}`,
        }])),
      },
    });
  }

  async function handleEditMessage(message, draftId, draft) {
    const instruction = message.text?.trim();
    if (!instruction) return;
    try {
      const issue = await model.generate({
        currentIssue: draft.issue,
        instruction,
        repository: draft.repo,
        ...draft.generationSettings,
      });
      if (draft.titlePrefix && !issue.title.startsWith(draft.titlePrefix)) {
        issue.title = `${draft.titlePrefix} ${issue.title}`.slice(0, 240);
      }
      draft.issue = issue;
      draft.expiresAt = Date.now() + DRAFT_TTL_MS;
      edits.delete(draftKey(message.chat.id, message.from.id));
      await telegram.call('editMessageText', {
        chat_id: draft.chatId,
        message_id: draft.previewId,
        text: preview(draft),
        parse_mode: 'HTML',
        reply_markup: draftButtons(draftId, draft),
      });
      await telegram.call('sendMessage', {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text: 'Draft updated.',
      });
    } catch (error) {
      logger.error(error);
      await telegram.call('sendMessage', {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text: 'Could not update the draft. Send another instruction or press Cancel on the draft.',
      });
    }
  }

  async function handleMessage(message) {
    if (!message.from || message.from.is_bot) return;
    const editId = edits.get(draftKey(message.chat.id, message.from.id));
    if (editId) {
      const draft = drafts.get(editId);
      if (draft && draft.expiresAt >= Date.now()) return handleEditMessage(message, editId, draft);
      edits.delete(draftKey(message.chat.id, message.from.id));
    }

    const parsed = command(message);
    if (!parsed) return;
    try {
      if (parsed.name === 'start' || parsed.name === 'help') return await sendGuide(message);
      if (parsed.name === 'settings') return await sendSettings(message);
      if (['connect', 'repo', 'area'].includes(parsed.name)) {
        throw new Error('This command has been replaced by /settings.');
      }
      return await issueCommand(message, parsed.args);
    } catch (error) {
      return telegram.call('sendMessage', {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text: error.message,
      });
    }
  }

  async function answer(callback, payload = {}) {
    return telegram.call('answerCallbackQuery', { callback_query_id: callback.id, ...payload });
  }

  async function handleRepositoryChoice(callback, parts) {
    const pending = pendingIssues.get(parts[1]);
    const repo = pending?.repositories[Number(parts[2])];
    if (!pending || pending.expiresAt < Date.now() || !repo) {
      return answer(callback, { text: 'This request has expired.', show_alert: true });
    }
    if (callback.from.id !== pending.userId) {
      return answer(callback, { text: 'This request belongs to another user.', show_alert: true });
    }
    pendingIssues.delete(parts[1]);
    await answer(callback, { text: `Selected ${repo.fullName}` });
    await telegram.call('editMessageReplyMarkup', {
      chat_id: pending.chatId,
      message_id: callback.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    const input = issueInput(repo, pending.source);
    return generateDraft(pending.message, input.source, repo, input.selectedLabels, input.titlePrefix);
  }

  async function handleDraftCallback(callback, parts) {
    const [action, draftId] = parts;
    const draft = drafts.get(draftId);
    if (!draft || draft.expiresAt < Date.now()) {
      return answer(callback, { text: 'This draft has expired.', show_alert: true });
    }
    if (callback.from.id !== draft.userId) {
      return answer(callback, { text: 'This draft belongs to another user.', show_alert: true });
    }

    if (action === 'labels') {
      await answer(callback);
      return telegram.call('editMessageReplyMarkup', {
        chat_id: draft.chatId,
        message_id: callback.message.message_id,
        reply_markup: labelsButtons(draftId, draft, parts[2]),
      });
    }
    if (action === 'toggle') {
      const label = draft.repo.allowedLabels?.[Number(parts[2])];
      if (!label) return answer(callback, { text: 'Label not found.' });
      draft.selectedLabels = draft.selectedLabels.includes(label)
        ? draft.selectedLabels.filter((value) => value !== label)
        : [...draft.selectedLabels, label];
      await answer(callback, { text: draft.selectedLabels.includes(label) ? `Added ${label}` : `Removed ${label}` });
      return telegram.call('editMessageReplyMarkup', {
        chat_id: draft.chatId,
        message_id: callback.message.message_id,
        reply_markup: labelsButtons(draftId, draft, parts[3]),
      });
    }
    if (action === 'done') {
      await answer(callback);
      return telegram.call('editMessageText', {
        chat_id: draft.chatId,
        message_id: draft.previewId,
        text: preview(draft),
        parse_mode: 'HTML',
        reply_markup: draftButtons(draftId, draft),
      });
    }
    if (action === 'edit') {
      edits.set(draftKey(draft.chatId, draft.userId), draftId);
      await answer(callback, { text: 'Send your revision instruction.' });
      await telegram.call('editMessageReplyMarkup', {
        chat_id: draft.chatId,
        message_id: draft.previewId,
        reply_markup: { inline_keyboard: [[{ text: 'Cancel', callback_data: `cancel:${draftId}` }]] },
      });
      return telegram.call('sendMessage', {
        chat_id: draft.chatId,
        reply_to_message_id: draft.previewId,
        text: 'Send the change you want as your next message. Only the draft author can update it.',
      });
    }
    if (action === 'cancel') {
      drafts.delete(draftId);
      edits.delete(draftKey(draft.chatId, draft.userId));
      await answer(callback, { text: 'Cancelled.' });
      return telegram.call('editMessageReplyMarkup', {
        chat_id: draft.chatId,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    }
    if (action === 'create') {
      await answer(callback, { text: 'Creating the issue…' });
      try {
        const issue = await github.createIssue(draft.repo, {
          title: draft.issue.title,
          body: appendRequester(draft.issue.body, draft.requester),
          labels: draft.selectedLabels,
        });
        drafts.delete(draftId);
        edits.delete(draftKey(draft.chatId, draft.userId));
        return telegram.call('editMessageText', {
          chat_id: draft.chatId,
          message_id: callback.message.message_id,
          parse_mode: 'HTML',
          text: `✅ <a href="${html(issue.html_url)}">#${issue.number}: ${html(issue.title)}</a>`,
        });
      } catch (error) {
        logger.error(error);
        return telegram.call('sendMessage', {
          chat_id: draft.chatId,
          reply_to_message_id: callback.message.message_id,
          text: `Could not create the issue: ${error.message}`,
        });
      }
    }
  }

  async function handleCallback(callback) {
    const parts = (callback.data || '').split(':');
    if (parts[0] === 'repo') return handleRepositoryChoice(callback, parts);
    return handleDraftCallback(callback, parts);
  }

  async function processUpdate(update) {
    if (update.message) await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  }

  async function configure() {
    const me = await telegram.call('getMe');
    botUsername = me.username;
    await telegram.call('setMyCommands', {
      commands: [
        { command: 'issue', description: 'Create a GitHub issue draft' },
        { command: 'settings', description: 'Configure this group (admins)' },
        { command: 'help', description: 'Show the user guide' },
      ],
    });
    if (config.publicBaseUrl) {
      await telegram.call('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Settings',
          web_app: { url: config.publicBaseUrl },
        },
      });
    }
    return me;
  }

  async function run() {
    await telegram.call('deleteWebhook', { drop_pending_updates: false });
    const me = await configure();
    logger.log(`Started @${me.username}`);
    while (true) {
      try {
        const updates = await telegram.call('getUpdates', {
          offset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          await processUpdate(update);
        }
      } catch (error) {
        logger.error(error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  return { configure, processUpdate, run };
}

module.exports = {
  appendRequester,
  createBot,
  draftButtons,
  labelsButtons,
  requesterNote,
};
