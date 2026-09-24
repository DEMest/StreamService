'use strict';

const { MongoClient } = require('mongodb');
const { createDeepSeekAdapter, createGitHubAdapter, createTelegramAdapter } = require('./adapters');
const { createBot } = require('./bot');
const { readConfig } = require('./config');
const { createStore } = require('./store');
const { createWebModule } = require('./web');

async function main() {
  const config = readConfig();
  const mongo = new MongoClient(config.mongoUri);
  await mongo.connect();

  const store = createStore(mongo.db(config.mongoDb));
  await store.init();

  const telegram = createTelegramAdapter(config);
  const github = createGitHubAdapter(config);
  const model = createDeepSeekAdapter(config);
  const bot = createBot({ config, github, model, store, telegram });
  const web = createWebModule({ config, github, store, telegram });
  await web.configure();

  const server = web.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.httpPort, '0.0.0.0', resolve);
  });
  console.log(`Mini App HTTP server listening on port ${config.httpPort}; MongoDB connected`);

  const shutdown = () => {
    server.close();
    mongo.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await bot.run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
