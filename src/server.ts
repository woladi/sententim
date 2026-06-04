import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { JudgmentsDb } from "./db.js";
import { runSearchJudgments, searchJudgmentsTool } from "./tools/search-judgments.js";
import { runVerifySignature, verifySignatureTool } from "./tools/verify-signature.js";

const PKG_VERSION = "0.2.0";

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
