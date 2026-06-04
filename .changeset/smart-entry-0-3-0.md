---
"sententim": minor
---

`sententim` binary now auto-detects MCP mode — fixes the npx invocation gap.

Before, the Quick Start in the README told users to run
`claude mcp add sententim -- npx sententim-mcp`. That fails with HTTP 404 because
`npx <X>` resolves `<X>` as a **package name** in the npm registry, and there is
no package called `sententim-mcp` — only a binary alias inside the `sententim`
package. The workaround used to be `npx -y -p sententim sententim-mcp`, which is
ugly and undocumented in every other "use this MCP server" tutorial users
encounter.

The fix is to make the canonical binary smart:

- `sententim` (stdin is a pipe — typical when launched by an MCP client) →
  start the stdio JSON-RPC server.
- `sententim` (stdin is a TTY — interactive shell) → print help.
- `sententim mcp` → force MCP mode regardless of TTY (handy for testing).
- `sententim info`, `sententim verify <sygnatura>` → CLI as before.

Now `npx -y sententim` Just Works™ as an MCP entry, matching the convention of
every other published MCP server package.

Other changes shipped here:

- `serverInfo.version` returned by the MCP `initialize` response is now read
  dynamically from `package.json` at module load instead of being hard-coded
  (no more "0.2.0" leaking out of a 0.3.x build).
- The legacy `sententim-mcp` binary still points at `dist/index.js` and behaves
  exactly as before — kept for any consumer who pinned the old name.
- README quick-start sections rewritten to use `npx -y sententim`, with a
  short note explaining the npx-package-vs-binary gotcha for future readers.
