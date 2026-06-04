import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { JudgmentsDb } from "./db.js";
import { runSearchJudgments, searchJudgmentsTool } from "./tools/search-judgments.js";
import { runVerifySignature, verifySignatureTool } from "./tools/verify-signature.js";

// Read the version once at module load.  Layout in the installed npm
// package: <pkg>/dist/server.js + <pkg>/package.json.  Same in dev (run
// via tsx from src/): <repo>/src/server.ts + <repo>/package.json.
const PKG_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface CreateServerOptions {
  dbPath?: string;
}

export function createServer(opts: CreateServerOptions = {}) {
  const db = new JudgmentsDb({ path: opts.dbPath });

  const server = new Server(
    { name: "sententim", version: PKG_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [verifySignatureTool, searchJudgmentsTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    let payload: unknown;
    switch (name) {
      case "verify_signature":
        // biome-ignore lint/suspicious/noExplicitAny: zod-validated inside runner
        payload = runVerifySignature(db, args as any);
        break;
      case "search_judgments":
        // biome-ignore lint/suspicious/noExplicitAny: zod-validated inside runner
        payload = runSearchJudgments(db, args as any);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });

  return { server, db };
}
