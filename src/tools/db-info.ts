import type { RulingsDb } from "../db.js";

export const dbInfoTool = {
  name: "db_info",
  title: "Inspect the bundled corpus",
  description: [
    "Return the metadata of the bundled corpus: version, build date, total rulings,",
    "per-source counts, and the latest judgment date in each source.",
    "Use this to honestly tell the user the coverage limits.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {},
  },
} as const;

export function runDbInfo(db: RulingsDb) {
  const m = db.manifest();
  return {
    package_version: m.version,
    built_at: m.builtAt,
    schema_version: m.schemaVersion,
    coverage: {
      total: m.totalRulings,
      sn: {
        count: m.snCount,
        latest_date: m.snLatestDate,
        note: m.snLatestDate
          ? `SN coverage ends ${m.snLatestDate}. SAOS upstream froze SN ingestion at 2016-06-22; later judgments require Phase-2 sn.pl scraper.`
          : null,
      },
      cjeu: {
        count: m.cjeuCount,
        latest_date: m.cjeuLatestDate,
        note: "CJEU updated weekly from CELLAR (Publications Office of the EU).",
      },
    },
  };
}
