import { openrouterKey } from "./env";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./repo";

let _loaded = false;
function loadDotEnv() {
  if (_loaded) return;
  _loaded = true;
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, ...rest] = trimmed.split("=");
    const key = k.trim();
    let val = rest.join("=").trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

export function pulseKey(): string | null {
  loadDotEnv();
  return process.env.PULSE_API_KEY || null;
}

export { openrouterKey };
