import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface Config {
  url: string;
  apiKey: string;
}

export function configPath(): string {
  return path.join(os.homedir(), ".notipo", "config.json");
}

export function readConfig(): Config {
  // Env vars take priority — agents set these
  const url = process.env.NOTIPO_URL;
  const apiKey = process.env.NOTIPO_API_KEY;
  if (url && apiKey) return { url, apiKey };

  // Fall back to config file (written by interactive login wrapper)
  const file = configPath();
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Config;
  }

  throw new Error("No config found. Set NOTIPO_URL and NOTIPO_API_KEY environment variables.");
}

export function writeConfig(config: Config): void {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}
