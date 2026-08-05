import { buildApp } from "./app.js";
import { env } from "./env.js";
import { disconnectDb } from "./db.js";

const app = buildApp();
const server = app.listen(env.PORT, env.HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Valor API listening at http://${env.HOST}:${env.PORT}`);
});

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down…`);
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  // Force-exit if connections linger.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
