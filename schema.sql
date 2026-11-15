-- Databas-schema för stödmedlemmar (Cloudflare D1).
-- Kör detta EN gång i D1-konsolen (se MEDLEMSKAP-SETUP.md).
--
-- En rad skapas när besökaren trycker "Swisha" och är obekräftad
-- (betald IS NULL) tills någon trycker "Bekräfta" på /admin.
-- `referens` (t.ex. "L-4827") skriver besökaren i Swish-meddelandet.
-- `medlemsnummer` delas ut vid bekräftelsen: första bekräftade medlemmen
-- får 1 (visas som "001"), nästa 2, osv. `nummer` är bara ett internt id.

CREATE TABLE IF NOT EXISTS medlemmar (
  nummer          INTEGER PRIMARY KEY AUTOINCREMENT,
  fornamn         TEXT    NOT NULL,
  efternamn       TEXT    NOT NULL,
  epost           TEXT    NOT NULL,
  stad            TEXT    NOT NULL DEFAULT '',
  visa_pa_webben  INTEGER NOT NULL DEFAULT 0,
  skapad          TEXT    NOT NULL,
  referens        TEXT,
  betald          TEXT,
  medlemsnummer   INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS medlemmar_referens ON medlemmar (referens);
CREATE UNIQUE INDEX IF NOT EXISTS medlemmar_medlemsnummer ON medlemmar (medlemsnummer);
