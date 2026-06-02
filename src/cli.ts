/**
 * sententim CLI — `info` + `verify` only in MVP-1.
 *
 *   sententim info
 *   sententim verify "II CSK 750/15"
 *   sententim verify "I C 822/22" --sad "Olsztyn"
 *   sententim verify "I C 822/22" --data 2022-09-15
 */
import { JudgmentsDb } from "./db.js";
import { runVerifySignature } from "./tools/verify-signature.js";

function help(): void {
  process.stdout.write(
    [
      "sententim · deterministic Polish-law citation verifier",
      "",
      "Usage:",
      "  sententim info",
      "  sententim verify <sygnatura> [--sad <name>] [--data <YYYY-MM-DD>]",
      "",
      "Env:",
      "  SENTENTIM_DB_PATH  override the bundled DB location",
      "",
    ].join("\n"),
  );
}

function flag(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    help();
    return 0;
  }

  const db = new JudgmentsDb({ path: process.env.SENTENTIM_DB_PATH });

  try {
    switch (cmd) {
      case "info": {
        const m = db.manifest();
        process.stdout.write(`${JSON.stringify(m, null, 2)}\n`);
        return 0;
      }
      case "verify": {
        const sygnatura = rest.filter((r) => !r.startsWith("--") && !isFlagValue(rest, r)).join(" ");
        if (!sygnatura) {
          process.stderr.write("Usage: sententim verify <sygnatura> [--sad …] [--data …]\n");
          return 2;
        }
        const result = runVerifySignature(db, {
          sygnatura,
          sad: flag("sad"),
          data: flag("data"),
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.status === "FOUND" ? 0 : result.status === "AMBIGUOUS" ? 0 : 1;
      }
      default:
        help();
        return 2;
    }
  } finally {
    db.close();
  }
}

function isFlagValue(rest: string[], v: string): boolean {
  const i = rest.indexOf(v);
  if (i <= 0) return false;
  return rest[i - 1]?.startsWith("--") ?? false;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`sententim · ${(err as Error).message}\n`);
    process.exit(1);
  });
