-- sententim · ruling database schema
-- Optimised for sub-10ms reads against a bundled, read-only SQLite file.
-- FTS5 with unicode61 + remove_diacritics=2 gives us proper Polish
-- accent-insensitive search ("sąd najwyższy" matches "sad najwyzszy").

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

-- ────────────────────────────────────────────────────────────────────────
-- rulings · canonical store
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rulings (
  -- Stable internal id, e.g. 'sn-II_CSK_123-22' or 'cjeu-C-123-22'
  id                   TEXT PRIMARY KEY,

  -- 'SN' (Sąd Najwyższy) | 'CJEU' (Court of Justice of the EU)
  source               TEXT NOT NULL CHECK (source IN ('SN', 'CJEU')),

  -- European Case Law Identifier — globally unique, our primary lookup key
  -- ECLI:PL:SN:2023:II.CSK.123.22.1 | ECLI:EU:C:2023:123
  ecli                 TEXT UNIQUE,

  -- Original signature as displayed: 'II CSK 123/22' / 'C-123/22'
  signature            TEXT NOT NULL,

  -- Normalised form for fuzzy lookup: 'II_CSK_123_22' / 'C_123_22'
  -- Built by: uppercase → strip diacritics → spaces & slashes → '_'
  signature_normalised TEXT NOT NULL,

  -- Court display name: 'Sąd Najwyższy' / 'Trybunał Sprawiedliwości UE'
  court                TEXT NOT NULL,

  -- Chamber / Izba: 'Izba Cywilna' / 'Grand Chamber'
  chamber              TEXT,

  -- ISO-8601 date of judgment (YYYY-MM-DD)
  date                 TEXT NOT NULL,

  -- 'wyrok' | 'postanowienie' | 'uchwała' | 'judgment' | 'order' | 'opinion'
  type                 TEXT NOT NULL,

  -- BCP-47 language tag of the summary (always 'pl' in v1)
  language             TEXT NOT NULL DEFAULT 'pl',

  -- 2-sentence LLM-generated essence of the ruling.
  -- This is the field LLMs actually consume to ground their answers.
  summary              TEXT NOT NULL,

  -- JSON array of normalised tags / keywords / EUROVOC concepts
  -- ["GDPR", "ochrona danych osobowych", "art. 6 ust. 1 lit. f RODO"]
  tags                 TEXT NOT NULL DEFAULT '[]',

  -- JSON array of cited acts: [{"act": "kc", "article": "415"}, ...]
  legal_basis          TEXT NOT NULL DEFAULT '[]',

  -- Public URL where the full text can be read
  source_url           TEXT NOT NULL,

  -- When the upstream source last modified the record (ISO timestamp)
  source_updated_at    TEXT,

  -- When we ingested it (ISO timestamp)
  ingested_at          TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_rulings_signature_normalised
  ON rulings(signature_normalised);

CREATE INDEX IF NOT EXISTS idx_rulings_source_date
  ON rulings(source, date DESC);

CREATE INDEX IF NOT EXISTS idx_rulings_date
  ON rulings(date DESC);

-- ────────────────────────────────────────────────────────────────────────
-- rulings_fts · full-text index over searchable fields
-- ────────────────────────────────────────────────────────────────────────
-- remove_diacritics=2 strips Polish ą/ć/ę/ł/ń/ó/ś/ź/ż for accent-insensitive
-- search.  We use 'external content' mode pointing at `rulings` so we don't
-- duplicate text.
CREATE VIRTUAL TABLE IF NOT EXISTS rulings_fts USING fts5(
  signature,
  signature_normalised,
  summary,
  tags,
  court,
  chamber,
  content='rulings',
  content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2 categories 'L* N* Co'"
);

-- Triggers to keep FTS index synchronised with the base table
CREATE TRIGGER IF NOT EXISTS rulings_after_insert AFTER INSERT ON rulings BEGIN
  INSERT INTO rulings_fts(rowid, signature, signature_normalised, summary, tags, court, chamber)
  VALUES (new.rowid, new.signature, new.signature_normalised, new.summary, new.tags, new.court, new.chamber);
END;

CREATE TRIGGER IF NOT EXISTS rulings_after_delete AFTER DELETE ON rulings BEGIN
  INSERT INTO rulings_fts(rulings_fts, rowid, signature, signature_normalised, summary, tags, court, chamber)
  VALUES ('delete', old.rowid, old.signature, old.signature_normalised, old.summary, old.tags, old.court, old.chamber);
END;

CREATE TRIGGER IF NOT EXISTS rulings_after_update AFTER UPDATE ON rulings BEGIN
  INSERT INTO rulings_fts(rulings_fts, rowid, signature, signature_normalised, summary, tags, court, chamber)
  VALUES ('delete', old.rowid, old.signature, old.signature_normalised, old.summary, old.tags, old.court, old.chamber);
  INSERT INTO rulings_fts(rowid, signature, signature_normalised, summary, tags, court, chamber)
  VALUES (new.rowid, new.signature, new.signature_normalised, new.summary, new.tags, new.court, new.chamber);
END;

-- ────────────────────────────────────────────────────────────────────────
-- manifest · build metadata embedded in the published DB
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manifest (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Seeded on every build:
--   version, built_at, total_rulings, sn_count, cjeu_count,
--   sn_latest_date, cjeu_latest_date, schema_version
