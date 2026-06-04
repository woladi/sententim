---
"sententim": patch
---

Docs polish + supply-chain bookkeeping.

- LICENSE: strip the trailing "DATA REUSE NOTICE" so GitHub's Licensee
  gem correctly identifies the file as MIT. Move the notice to a
  standalone NOTICE file alongside (covers data sources + transitive
  licences). Fixes the "license not identifiable" badge on the repo.
- README: refresh badges (npm version, types, license-via-npm, node,
  CI, Sigstore provenance, MCP); drop the stale "v0.2 search_judgments
  is coming" note; document both tools in the headline; re-cast the
  "from code" example against the actual public exports.
- `src/index.ts`: re-export `runVerifySignature`, `runSearchJudgments`,
  their zod schemas, MCP tool definitions, `DISCLAIMER`, and the
  signature normalisation helpers so the README example actually
  compiles when run by a consumer of the npm package.
- CHANGELOG: switch to the Changesets-native one-section-per-version
  layout so future automated bumps don't shred the file.
- Layout / dev-section housekeeping (66 tests, 0.2 file tree,
  cross-ref + search-judgments paths).
