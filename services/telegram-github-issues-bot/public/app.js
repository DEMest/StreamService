'use strict';

const tg = window.Telegram?.WebApp;
const dom = {
  app: document.querySelector('#app'),
  connect: document.querySelector('#connect-button'),
  empty: document.querySelector('#empty-state'),
  groupPicker: document.querySelector('#group-picker'),
  groupSelect: document.querySelector('#group-select'),
  groupTitle: document.querySelector('#group-title'),
  loading: document.querySelector('#loading'),
  notice: document.querySelector('#notice'),
  repositoryList: document.querySelector('#repository-list'),
  setupContent: document.querySelector('#setup-content'),
  setupPanel: document.querySelector('#setup-panel'),
  setupTitle: document.querySelector('#setup-title'),
};

const state = {
  chatId: '',
  connectState: '',
  initData: tg?.initData || '',
  repositories: [],
  startParam: tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '',
};

function showNotice(message, success = false) {
  dom.notice.textContent = message;
  dom.notice.classList.toggle('success', success);
  dom.notice.classList.remove('hidden');
}

function clearNotice() {
  dom.notice.classList.add('hidden');
}

async function api(endpoint, payload = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      initData: state.initData,
      startParam: state.startParam,
      chatId: state.chatId,
      ...payload,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function button(text, className, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  element.addEventListener('click', handler);
  return element;
}

function renderLabels(container, names) {
  container.replaceChildren();
  if (!names?.length) {
    const none = document.createElement('span');
    none.className = 'repo-meta';
    none.textContent = 'No labels enabled';
    container.append(none);
    return;
  }
  for (const name of names) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = name;
    container.append(label);
  }
}

function renderRepositories(repositories) {
  state.repositories = repositories;
  dom.repositoryList.replaceChildren();
  dom.empty.classList.toggle('hidden', repositories.length > 0);
  for (const repo of repositories) {
    const card = document.createElement('article');
    card.className = 'repo-card';
    const row = document.createElement('div');
    row.className = 'repo-row';
    const heading = document.createElement('div');
    const name = document.createElement('p');
    name.className = 'repo-name';
    name.textContent = repo.fullName;
    const meta = document.createElement('p');
    meta.className = 'repo-meta';
    meta.textContent = repo.private ? 'Private repository' : 'Public repository';
    heading.append(name, meta);
    row.append(heading);
    const labelList = document.createElement('div');
    labelList.className = 'labels';
    renderLabels(labelList, repo.allowedLabels);
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Edit labels', 'secondary', () => editLabels(repo)),
      button('Remove', 'danger', () => confirmRemove(repo)),
    );
    card.append(row, labelList, actions);
    dom.repositoryList.append(card);
  }
}

function renderGroupPicker(groups, selectedChatId) {
  dom.groupSelect.replaceChildren();
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.chatId;
    option.textContent = group.title;
    option.selected = group.chatId === selectedChatId;
    dom.groupSelect.append(option);
  }
  dom.groupPicker.classList.toggle('hidden', groups.length < 2);
}

async function bootstrap(chatId = '') {
  clearNotice();
  if (chatId) state.chatId = chatId;
  const data = await api('/api/bootstrap');
  state.startParam = '';
  state.chatId = data.selectedChatId || state.chatId || data.groups[0]?.chatId || '';
  if (!data.selectedChatId && state.chatId) return bootstrap(state.chatId);
  renderGroupPicker(data.groups, state.chatId);
  dom.groupTitle.textContent = data.group?.title || 'Select a group';
  dom.connect.disabled = !state.chatId || !data.githubConnectionReady;
  dom.connect.title = data.githubConnectionReady ? '' : 'GitHub connection is not configured on the server yet.';
  renderRepositories(data.repositories || []);
  dom.loading.classList.add('hidden');
  dom.app.classList.remove('hidden');
  if (!state.chatId) {
    showNotice('Run /settings inside a Telegram group to add it here.');
  } else if (!data.githubConnectionReady) {
    showNotice('GitHub connection is not configured on the server yet.');
  }
  if (data.resumeConnectionState) {
    state.connectState = data.resumeConnectionState;
    await checkConnection(true);
  }
}

function repositoryChoices(repositories) {
  dom.setupTitle.textContent = 'Choose repositories';
  dom.setupContent.replaceChildren();
  const help = document.createElement('p');
  help.className = 'muted';
  help.textContent = 'Select every repository this Telegram group should be able to use.';
  const list = document.createElement('div');
  list.className = 'choice-list';
  for (const repo of repositories) {
    const choice = document.createElement('label');
    choice.className = 'choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = repo.id;
    input.checked = repo.selected;
    const text = document.createElement('span');
    text.textContent = repo.fullName;
    choice.append(input, text);
    list.append(choice);
  }
  const actions = document.createElement('div');
  actions.className = 'setup-actions';
  actions.append(
    button('Cancel', 'secondary', closeSetup),
    button('Continue', 'primary', async (event) => {
      const ids = [...list.querySelectorAll('input:checked')].map((input) => input.value);
      event.currentTarget.disabled = true;
      try {
        const data = await api('/api/github/prepare', { state: state.connectState, repositoryIds: ids });
        renderLabelSetup(data.repositories, true);
      } catch (error) {
        showNotice(error.message);
        event.currentTarget.disabled = false;
      }
    }),
  );
  dom.setupContent.append(help, list, actions);
  dom.setupPanel.classList.remove('hidden');
  dom.setupPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function labelChoices(repo) {
  const card = document.createElement('article');
  card.className = 'repo-card';
  card.dataset.repositoryId = repo.id || repo.repositoryId;
  const title = document.createElement('p');
  title.className = 'repo-name';
  title.textContent = repo.fullName;
  const hint = document.createElement('p');
  hint.className = 'repo-meta';
  hint.textContent = 'Optional: members will only see the labels selected here.';
  const list = document.createElement('div');
  list.className = 'choice-list label-grid';
  for (const label of repo.labels) {
    const choice = document.createElement('label');
    choice.className = 'choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = label.name;
    input.checked = repo.allowedLabels?.includes(label.name);
    const text = document.createElement('span');
    text.textContent = label.name;
    choice.append(input, text);
    list.append(choice);
  }
  if (!repo.labels.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'This repository has no labels.';
    list.append(empty);
  }
  card.append(title, hint, list);
  return card;
}

function renderLabelSetup(repositories, isConnection) {
  dom.setupTitle.textContent = isConnection ? 'Choose allowed labels' : `Labels for ${repositories[0].fullName}`;
  dom.setupContent.replaceChildren();
  const list = document.createElement('div');
  list.className = 'repository-list';
  repositories.forEach((repo) => list.append(labelChoices(repo)));
  const actions = document.createElement('div');
  actions.className = 'setup-actions';
  const save = button('Save', 'primary', async (event) => {
    event.currentTarget.disabled = true;
    const values = [...list.querySelectorAll('.repo-card')].map((card) => ({
      repositoryId: card.dataset.repositoryId,
      allowedLabels: [...card.querySelectorAll('input:checked')].map((input) => input.value),
    }));
    try {
      const data = isConnection
        ? await api('/api/github/save', { state: state.connectState, repositories: values })
        : await api('/api/repository/labels/save', values[0]);
      renderRepositories(data.repositories);
      closeSetup();
      showNotice('Settings saved.', true);
      tg?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      showNotice(error.message);
      event.currentTarget.disabled = false;
    }
  });
  actions.append(button('Cancel', 'secondary', closeSetup), save);
  dom.setupContent.append(list, actions);
  dom.setupPanel.classList.remove('hidden');
  dom.setupPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function editLabels(repo) {
  clearNotice();
  try {
    const data = await api('/api/repository/labels', { repositoryId: repo.repositoryId });
    renderLabelSetup([{ ...data.repository, id: data.repository.repositoryId, labels: data.labels }], false);
  } catch (error) {
    showNotice(error.message);
  }
}

function closeSetup() {
  dom.setupPanel.classList.add('hidden');
  dom.setupContent.replaceChildren();
}

function askConfirmation(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

async function confirmRemove(repo) {
  if (!await askConfirmation(`Remove ${repo.fullName} from this group?`)) return;
  try {
    const data = await api('/api/repository/remove', { repositoryId: repo.repositoryId });
    renderRepositories(data.repositories);
    showNotice('Repository removed.', true);
  } catch (error) {
    showNotice(error.message);
  }
}

async function checkConnection(resumed = false) {
  try {
    const data = await api('/api/github/status', { state: state.connectState });
    if (data.status === 'ready') {
      repositoryChoices(data.repositories);
      return true;
    }
    if (data.status === 'failed') throw new Error(data.error || 'GitHub connection failed.');
    if (resumed) showNotice('Finish GitHub authorization, then return here.');
    return false;
  } catch (error) {
    showNotice(error.message);
    return false;
  }
}

async function connectGitHub() {
  clearNotice();
  dom.connect.disabled = true;
  try {
    const data = await api('/api/github/connect');
    state.connectState = data.state;
    showNotice('Complete installation and authorization on GitHub, then return here.', true);
    tg?.openLink ? tg.openLink(data.url) : window.open(data.url, '_blank', 'noopener');
    const poll = window.setInterval(async () => {
      if (await checkConnection()) window.clearInterval(poll);
    }, 2500);
    window.setTimeout(() => window.clearInterval(poll), 20 * 60 * 1000);
  } catch (error) {
    showNotice(error.message);
  } finally {
    dom.connect.disabled = false;
  }
}

dom.connect.addEventListener('click', connectGitHub);
dom.groupSelect.addEventListener('change', () => {
  closeSetup();
  bootstrap(dom.groupSelect.value).catch((error) => showNotice(error.message));
});

async function start() {
  tg?.ready();
  tg?.expand();
  if (!state.initData) {
    dom.loading.classList.add('hidden');
    showNotice('Open this page from the bot in Telegram.');
    return;
  }
  try {
    await bootstrap();
  } catch (error) {
    dom.loading.classList.add('hidden');
    showNotice(error.message);
  }
}

start();
