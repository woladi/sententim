-- sententim · MVP-1 schema
-- Deterministic citation verifier. Every column either comes verbatim from
-- the source API or is derived by a regex/parser whose input is preserved
-- (sha256 + zrodlo_url + data_pobrania).  NO LLM-generated fields.
--
-- Field names are Polish on purpose — this is a Polish-law tool and the
-- domain language is the right one to think in.

PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;

-- ────────────────────────────────────────────────────────────────────────
-- judgments · canonical store
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS judgments (
  id              INTEGER PRIMARY KEY,

  -- Oryginalna sygnatura, taka jak w źródle: "II CSK 750/15"
  sygnatura       TEXT NOT NULL,

  -- Znormalizowana do matchowania: upper-case, kolaps whitespace,
  -- usunięte kropki w skrótach typu "C.S.K.", strip-diacritics.
  -- To pole jest indeksowane i FTS-owane.
  sygnatura_norm  TEXT NOT NULL,

  -- Pełna nazwa sądu: "Sąd Rejonowy w Olsztynie", "Sąd Najwyższy".
  sad             TEXT NOT NULL,

  -- Skrócona instancja:  SR · SO · SA · SN · NSA · WSA · TK · TSUE
  instancja       TEXT NOT NULL CHECK (instancja IN
                    ('SR','SO','SA','SN','NSA','WSA','TK','TSUE')),

  -- ISO YYYY-MM-DD
  data_orzeczenia TEXT NOT NULL,

  -- Outcome class extracted by regex from sentencja:
  --   oddala · uwzglednia · uchyla_przekazuje · zmienia · umarza · inne
  -- NULL gdy parser nie potrafi sklasyfikować (świadomy NULL, nie zgaduj).
  sentencja_typ   TEXT CHECK (sentencja_typ IN
                    ('oddala','uwzglednia','uchyla_przekazuje','zmienia','umarza','inne')),

  -- 0/1/NULL.  NULL w MVP-1 — wymaga cross-ref pass z apelacją (v0.2).
  prawomocny      INTEGER CHECK (prawomocny IN (0,1)),

  -- Sygnatura instancji odwoławczej która uchyliła ten wyrok.
  -- NULL w MVP-1 (cross-ref pass dopiero w v0.2).
  uchylony_przez  TEXT,

  -- JSON array, posortowany, unique:
  --   ["art. 45 ukk", "art. 75c pr.bank", "art. 5 k.c."]
  podstawa_prawna TEXT NOT NULL DEFAULT '[]',

  -- Publiczny URL źródła (SAOS, sn.pl, EUR-Lex).
  zrodlo_url      TEXT NOT NULL,

  -- Kiedy pobraliśmy ten rekord (ISO timestamp).
  data_pobrania   TEXT NOT NULL,

  -- sha256 surowego tekstu źródłowego (SAOS-owy textContent przed naszą
  -- normalizacją).  Audyt: pozwala wykryć, że źródło się zmieniło.
  sha256          TEXT NOT NULL,

  UNIQUE(sygnatura_norm, sad, data_orzeczenia)
);

CREATE INDEX IF NOT EXISTS idx_sygn_norm ON judgments(sygnatura_norm);
CREATE INDEX IF NOT EXISTS idx_sad       ON judgments(sad);
CREATE INDEX IF NOT EXISTS idx_data      ON judgments(data_orzeczenia);

-- ────────────────────────────────────────────────────────────────────────
-- judgments_fts · prepared for v0.2 search_judgments tool
-- ────────────────────────────────────────────────────────────────────────
-- MVP-1 nie używa FTS w runtime, ale tworzymy ją przy seedzie żeby
-- aktywacja search_judgments była zero-migration.
CREATE VIRTUAL TABLE IF NOT EXISTS judgments_fts USING fts5(
  sygnatura,
  sygnatura_norm,
  podstawa_prawna,
  sad,
  content='judgments',
  content_rowid='id',
  tokenize="unicode61 remove_diacritics 2 categories 'L* N* Co'"
);

CREATE TRIGGER IF NOT EXISTS judgments_after_insert AFTER INSERT ON judgments BEGIN
  INSERT INTO judgments_fts(rowid, sygnatura, sygnatura_norm, podstawa_prawna, sad)
  VALUES (new.id, new.sygnatura, new.sygnatura_norm, new.podstawa_prawna, new.sad);
END;

CREATE TRIGGER IF NOT EXISTS judgments_after_delete AFTER DELETE ON judgments BEGIN
  INSERT INTO judgments_fts(judgments_fts, rowid, sygnatura, sygnatura_norm, podstawa_prawna, sad)
  VALUES ('delete', old.id, old.sygnatura, old.sygnatura_norm, old.podstawa_prawna, old.sad);
END;

CREATE TRIGGER IF NOT EXISTS judgments_after_update AFTER UPDATE ON judgments BEGIN
  INSERT INTO judgments_fts(judgments_fts, rowid, sygnatura, sygnatura_norm, podstawa_prawna, sad)
  VALUES ('delete', old.id, old.sygnatura, old.sygnatura_norm, old.podstawa_prawna, old.sad);
  INSERT INTO judgments_fts(rowid, sygnatura, sygnatura_norm, podstawa_prawna, sad)
  VALUES (new.id, new.sygnatura, new.sygnatura_norm, new.podstawa_prawna, new.sad);
END;

-- ────────────────────────────────────────────────────────────────────────
-- manifest · build metadata embedded in the published DB
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manifest (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
-- Populated by build-db.ts:
--   version, built_at, schema_version, total, source,
--   legal_domain, seed_query_count, last_seed_at
