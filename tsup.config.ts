import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    db: "src/db.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: false,
  treeshake: true,
  external: ["better-sqlite3"],
  banner: ({ format }) => {
    if (format === "esm") {
      return {
        js: "#!/usr/bin/env node",
      };
    }
    return {};
  },
});
