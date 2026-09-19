'use strict';

function createStore(db) {
  const groups = db.collection('groups');
  const repositories = db.collection('groupRepositories');
  const legacyRepositories = db.collection('repositoryConfigs');
  const launchSessions = db.collection('miniAppSessions');
  const oauthSessions = db.collection('githubConnectSessions');
  const adminAccess = db.collection('groupAdminAccess');

  async function init() {
    await Promise.all([
      groups.createIndex({ chatId: 1 }, { unique: true }),
      repositories.createIndex({ chatId: 1, repositoryId: 1 }, { unique: true }),
      repositories.createIndex({ chatId: 1, installationId: 1 }),
      launchSessions.createIndex({ token: 1 }, { unique: true }),
      launchSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      oauthSessions.createIndex({ state: 1 }, { unique: true }),
      oauthSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      adminAccess.createIndex({ userId: 1, chatId: 1 }, { unique: true }),
    ]);
  }

  async function rememberGroup(chat, userId) {
    const now = new Date();
    const chatId = String(chat.id);
    await Promise.all([
      groups.updateOne(
        { chatId },
        {
          $set: { title: chat.title || chat.username || chatId, type: chat.type, updatedAt: now },
          $setOnInsert: { chatId, createdAt: now },
        },
        { upsert: true },
      ),
      adminAccess.updateOne(
        { userId: String(userId), chatId },
        { $set: { title: chat.title || chat.username || chatId, lastUsedAt: now } },
        { upsert: true },
      ),
    ]);
  }

  return {
    init,
    rememberGroup,
    listAdminGroups: (userId) => adminAccess
      .find({ userId: String(userId) })
      .sort({ lastUsedAt: -1 })
      .project({ _id: 0, chatId: 1, title: 1 })
      .toArray(),
    getGroup: (chatId) => groups.findOne({ chatId: String(chatId) }, { projection: { _id: 0 } }),
    listRepositories: (chatId) => repositories
      .find({ chatId: String(chatId) })
      .sort({ fullName: 1 })
      .project({ _id: 0 })
      .toArray(),
    async listRepositoriesForIssue(chatId, userId) {
      const shared = await repositories
        .find({ chatId: String(chatId) })
        .sort({ fullName: 1 })
        .project({ _id: 0 })
        .toArray();
      if (shared.length) return shared;

      const legacy = await legacyRepositories
        .find({ chatId: String(chatId), userId: String(userId) })
        .sort({ lastUsedAt: -1 })
        .toArray();
      return legacy.map((repo) => ({
        repositoryId: `legacy:${repo.alias}`,
        installationId: String(repo.installationId),
        owner: repo.owner,
        name: repo.name,
        fullName: `${repo.owner}/${repo.name}`,
        private: false,
        allowedLabels: [...new Set((repo.areas || []).flatMap((area) => area.labels || []))],
        legacy: true,
        legacyAlias: repo.alias,
        legacyAreas: repo.areas || [],
        legacyDefaultArea: repo.defaultArea || null,
      }));
    },
    getRepository: (chatId, repositoryId) => repositories.findOne(
      { chatId: String(chatId), repositoryId: String(repositoryId) },
      { projection: { _id: 0 } },
    ),
    async saveInstallationRepositories(chatId, installationId, selected) {
      const normalizedChatId = String(chatId);
      const normalizedInstallationId = String(installationId);
      const now = new Date();
      if (selected.length) {
        await repositories.bulkWrite(selected.map((repo) => ({
          updateOne: {
            filter: { chatId: normalizedChatId, repositoryId: String(repo.id) },
            update: {
              $set: {
                installationId: normalizedInstallationId,
                owner: repo.owner,
                name: repo.name,
                fullName: repo.fullName,
                private: Boolean(repo.private),
                allowedLabels: repo.allowedLabels || [],
                updatedAt: now,
              },
              $setOnInsert: {
                chatId: normalizedChatId,
                repositoryId: String(repo.id),
                createdAt: now,
              },
            },
            upsert: true,
          },
        })));
      }
      await repositories.deleteMany({
        chatId: normalizedChatId,
        installationId: normalizedInstallationId,
        repositoryId: { $nin: selected.map((repo) => String(repo.id)) },
      });
    },
    async updateRepositoryLabels(chatId, repositoryId, allowedLabels) {
      const result = await repositories.updateOne(
        { chatId: String(chatId), repositoryId: String(repositoryId) },
        { $set: { allowedLabels, updatedAt: new Date() } },
      );
      return result.matchedCount === 1;
    },
    async removeRepository(chatId, repositoryId) {
      const result = await repositories.deleteOne({
        chatId: String(chatId),
        repositoryId: String(repositoryId),
      });
      return result.deletedCount === 1;
    },
    createLaunchSession: (session) => launchSessions.insertOne(session),
    getLaunchSession: (token) => launchSessions.findOne({ token, expiresAt: { $gt: new Date() } }),
    touchLaunchSession: (token) => launchSessions.updateOne(
      { token },
      { $set: { lastUsedAt: new Date() } },
    ),
    createOAuthSession: (session) => oauthSessions.insertOne(session),
    getOAuthSession: (state) => oauthSessions.findOne({ state, expiresAt: { $gt: new Date() } }),
    updateOAuthSession: (state, update) => oauthSessions.updateOne(
      { state, expiresAt: { $gt: new Date() } },
      { $set: { ...update, updatedAt: new Date() } },
    ),
    consumeOAuthSession: (state) => oauthSessions.updateOne(
      { state, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date(), status: 'saved', updatedAt: new Date() } },
    ),
  };
}

module.exports = { createStore };
