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
  const file = configPath();
  if (!fs.existsSync(file)) {
    throw new Error("No config found. Run `notipo login` first.");
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Config;
}

export function writeConfig(config: Config): void {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}
