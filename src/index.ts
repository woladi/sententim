import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

export { createServer } from "./server.js";
export { JudgmentsDb } from "./db.js";
export type * from "./types.js";

/**
 * MCP server entry point — stdio transport.
 *
 *   claude mcp add sententim -- npx sententim-mcp
 */
async function main(): Promise<void> {
  const { server } = createServer({
    dbPath: process.env.SENTENTIM_DB_PATH,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("sententim · MCP server ready (stdio)\n");
}

const isDirect =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (isDirect) {
  main().catch((err) => {
    process.stderr.write(`sententim · fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
