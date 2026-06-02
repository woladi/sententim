import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { JudgmentsDb } from "./db.js";
import { runVerifySignature, verifySignatureTool } from "./tools/verify-signature.js";

const PKG_VERSION = "0.1.0";

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
    tools: [verifySignatureTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    if (name !== "verify_signature") {
      throw new Error(`Unknown tool: ${name}`);
    }
    // biome-ignore lint/suspicious/noExplicitAny: zod-validated inside runner
    const payload = runVerifySignature(db, args as any);
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });

  return { server, db };
}
