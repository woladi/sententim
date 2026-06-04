/**
 * sententim — smart entry binary.
 *
 * Behaviour depends on how it was invoked:
 *
 *   sententim                  · stdin is a TTY  → print help
 *   sententim                  · stdin is piped  → start MCP stdio server
 *   sententim mcp              · force MCP mode regardless of TTY
 *   sententim info             · print bundled-DB manifest
 *   sententim verify <sygnatura> [--sad <name>] [--data <YYYY-MM-DD>]
 *   sententim --help | -h
 *
 * The "stdin not a TTY" branch is what `claude mcp add sententim -- npx sententim`
 * relies on: when an MCP client launches the binary, it pipes stdin/stdout so
 * `process.stdin.isTTY === false`, which is our signal to start the server.
 *
 * The legacy `sententim-mcp` binary (./dist/index.js) still works for
 * back-compat and is unaffected.
 */
import { JudgmentsDb } from "./db.js";
import { runVerifySignature } from "./tools/verify-signature.js";

function help(): void {
  process.stdout.write(
    [
      "sententim · deterministic Polish-law citation verifier",
      "",
      "Usage:",
      "  sententim                     start MCP stdio server (when invoked by an MCP client)",
      "  sententim mcp                 force MCP stdio server regardless of TTY",
      "  sententim info                print bundled-DB manifest",
      "  sententim verify <sygnatura>  [--sad <name>] [--data <YYYY-MM-DD>]",
      "",
      "Env:",
      "  SENTENTIM_DB_PATH             override the bundled DB location",
      "",
      "When invoked without arguments AND stdin is a pipe (not a TTY), the",
      "MCP stdio server is started. An interactive terminal session prints",
      "this help instead.",
      "",
    ].join("\n"),
  );
}

function flag(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function isFlagValue(rest: string[], v: string): boolean {
  const i = rest.indexOf(v);
  if (i <= 0) return false;
  return rest[i - 1]?.startsWith("--") ?? false;
}

async function runMcp(): Promise<void> {
  // Lazy imports — keep CLI startup time fast for the common case.
  const [{ createServer }, { StdioServerTransport }] = await Promise.all([
    import("./server.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
  ]);
  const { server } = createServer({ dbPath: process.env.SENTENTIM_DB_PATH });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stay alive — server.connect() returns once handshake completes; the
  // transport keeps the event loop busy on stdin.
  process.stderr.write("sententim · MCP server ready (stdio)\n");
}

async function runCli(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  const db = new JudgmentsDb({ path: process.env.SENTENTIM_DB_PATH });
  try {
    switch (cmd) {
      case "info": {
        const m = db.manifest();
        process.stdout.write(`${JSON.stringify(m, null, 2)}\n`);
        return 0;
      }
      case "verify": {
        const sygnatura = rest
          .filter((r) => !r.startsWith("--") && !isFlagValue(rest, r))
          .join(" ");
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

async function main(): Promise<number | undefined> {
  const [, , cmd] = process.argv;

  // Explicit help wins, regardless of TTY/pipe state.
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    help();
    return 0;
  }

  // Force-MCP escape hatch: `sententim mcp` always starts the server.
  if (cmd === "mcp") {
    await runMcp();
    return; // process stays alive on stdin transport
  }

  // No subcommand: decide between CLI-help and MCP-server based on stdio.
  if (!cmd) {
    if (process.stdin.isTTY) {
      help();
      return 0;
    }
    await runMcp();
    return;
  }

  // Any other subcommand is CLI territory.
  return runCli();
}

main()
  .then((code) => {
    if (typeof code === "number") process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`sententim · ${(err as Error).message}\n`);
    process.exit(1);
  });
