---
"sententim": patch
---

Switch the release pipeline to **npm Trusted Publishing (OIDC)**.

- `release.yml` no longer references `NPM_TOKEN`. The npm CLI exchanges
  the GitHub-issued OIDC token for a short-lived publish token at the
  moment of `npm publish`, scoped to this package + version.
- Sigstore provenance is attached automatically — every release tarball
  is verifiably built from the commit it claims to be built from, and
  the attestation surfaces on the npm package page.
- Align `pnpm/action-setup` with the local lockfile version (9 → 11) in
  both `release.yml` and `ci.yml`. Add `--config.dangerouslyAllowAllBuilds=true`
  so pnpm 11 compiles `better-sqlite3`'s native binding in CI.

No runtime change. Drop-in upgrade in the supply-chain story:
fewer long-lived secrets to rotate, cryptographic provenance on every
published version.
