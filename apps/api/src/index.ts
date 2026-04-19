import "./sentry.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: "::" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
