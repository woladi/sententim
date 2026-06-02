/**
 * Small CLI wrapper for ad-hoc inspection without going through MCP.
 *
 *   sententim info
 *   sententim verify "II CSK 123/22"
 *   sententim search "RODO podstawa prawna"
 *   sententim latest SN 5
 */
import { RulingsDb } from "./db.js";
import { runDbInfo } from "./tools/db-info.js";

function help(): void {
  process.stdout.write(
    [
      "sententim · local case-law CLI",
      "",
      "Usage:",
      "  sententim info",
      "  sententim verify <citation>",
      "  sententim search <query> [--source SN|CJEU] [--limit N]",
      "  sententim latest <SN|CJEU> [N]",
      "",
      "Env:",
      "  SENTENTIM_DB_PATH  override the bundled DB location",
      "",
    ].join("\n"),
  );
}

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    help();
    return 0;
  }

  const db = new RulingsDb({ path: process.env.SENTENTIM_DB_PATH });

  try {
    switch (cmd) {
      case "info": {
        process.stdout.write(`${JSON.stringify(runDbInfo(db), null, 2)}\n`);
        return 0;
      }
      case "verify": {
        const citation = rest.filter((r) => !r.startsWith("--")).join(" ");
        if (!citation) {
          process.stderr.write("Usage: sententim verify <citation>\n");
          return 2;
        }
        const r = db.verify(citation);
        process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        return r.exists ? 0 : 1;
      }
      case "search": {
        const query = rest.filter((r) => !r.startsWith("--")).join(" ");
        if (!query) {
          process.stderr.write("Usage: sententim search <query>\n");
          return 2;
        }
        const source = arg("source") as "SN" | "CJEU" | undefined;
        const limit = Number(arg("limit", "10"));
        const hits = db.searchByTopic(query, { source, limit });
        process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
        return 0;
      }
      case "latest": {
        const source = rest[0] as "SN" | "CJEU" | undefined;
        const n = Number(rest[1] ?? 10);
        if (source !== "SN" && source !== "CJEU") {
          process.stderr.write("Usage: sententim latest <SN|CJEU> [N]\n");
          return 2;
        }
        const rows = db.latest(source, n);
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return 0;
      }
      default: {
        help();
        return 2;
      }
    }
  } finally {
    db.close();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`sententim · ${(err as Error).message}\n`);
  process.exit(1);
});
