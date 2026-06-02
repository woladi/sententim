import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RulingsDb } from "./db.js";
import { dbInfoTool, runDbInfo } from "./tools/db-info.js";
import { getRulingTool, runGetRuling } from "./tools/get-ruling.js";
import { listLatestTool, runListLatest } from "./tools/list-latest.js";
import { runSearchByTopic, searchByTopicTool } from "./tools/search-by-topic.js";
import { runVerifySignature, verifySignatureTool } from "./tools/verify-signature.js";

const PKG_VERSION = "0.1.0"; // bumped by the release workflow

export interface CreateServerOptions {
  dbPath?: string;
}

export function createServer(opts: CreateServerOptions = {}) {
  const db = new RulingsDb({ path: opts.dbPath });

  const server = new Server(
    {
      name: "sententim",
      version: PKG_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      verifySignatureTool,
      searchByTopicTool,
      getRulingTool,
      listLatestTool,
      dbInfoTool,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const payload = await dispatch(name, args, db);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  });

  return { server, db };
}

async function dispatch(name: string, args: Record<string, unknown>, db: RulingsDb) {
  switch (name) {
    case "verify_signature":
      // biome-ignore lint/suspicious/noExplicitAny: args validated by zod inside the runner
      return runVerifySignature(db, args as any);
    case "search_by_topic":
      // biome-ignore lint/suspicious/noExplicitAny: args validated by zod inside the runner
      return runSearchByTopic(db, args as any);
    case "get_ruling":
      // biome-ignore lint/suspicious/noExplicitAny: args validated by zod inside the runner
      return runGetRuling(db, args as any);
    case "list_latest":
      // biome-ignore lint/suspicious/noExplicitAny: args validated by zod inside the runner
      return runListLatest(db, args as any);
    case "db_info":
      return runDbInfo(db);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
