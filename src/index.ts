import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// Public API — what consumers get when they `import { … } from "sententim"`.
//
// MCP transport entrypoint:
export { createServer } from "./server.js";
// Database wrapper (open, query, close):
export { JudgmentsDb } from "./db.js";
// Both tool runners + their zod schemas — useful when you want to call
// the same logic programmatically without going through stdio JSON-RPC.
export {
  runVerifySignature,
  verifySignatureSchema,
  verifySignatureTool,
  DISCLAIMER,
} from "./tools/verify-signature.js";
export {
  runSearchJudgments,
  searchJudgmentsSchema,
  searchJudgmentsTool,
} from "./tools/search-judgments.js";
// Helpers most callers won't need but we expose for completeness:
export {
  displaySignature,
  normaliseSignature,
  signaturesMatch,
  stemPolishPhrase,
  stemPolishWord,
  stripDiacritics,
} from "./normalize.js";
export { detectLikelyInstancja } from "./instancja-pattern.js";
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
