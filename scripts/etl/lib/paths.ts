import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..", "..");
export const DATA_DIR = join(REPO_ROOT, "data");
export const SEED_DIR = join(DATA_DIR, "seed");
export const RAW_DIR = join(DATA_DIR, "raw");
export const STAGING_DIR = join(DATA_DIR, "staging");
export const DB_PATH = join(DATA_DIR, "rulings.db");
export const MANIFEST_PATH = join(DATA_DIR, "manifest.json");
export const SCHEMA_PATH = join(DATA_DIR, "schema.sql");

export function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function rawJsonl(source: "saos" | "cjeu", suffix = ""): string {
  ensureDir(RAW_DIR);
  const tag = suffix ? `-${suffix}` : "";
  return join(RAW_DIR, `${source}${tag}.jsonl`);
}

export function stagedJsonl(source: "sn" | "cjeu"): string {
  ensureDir(STAGING_DIR);
  return join(STAGING_DIR, `${source}.jsonl`);
}
