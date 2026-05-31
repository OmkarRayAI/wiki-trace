import path from "node:path";

export const REPO_ROOT = path.resolve(process.cwd(), "..");
export const TRACE_DIR = path.join(REPO_ROOT, ".wikitrace");
export const WIKI_DIR = path.join(REPO_ROOT, "wiki");
export const RAW_DIR = path.join(REPO_ROOT, "raw");
