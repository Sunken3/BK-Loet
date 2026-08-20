-- Databas-schema för stödmedlemmar (Cloudflare D1).
-- Kör detta EN gång i D1-konsolen (se MEDLEMSKAP-SETUP.md).
-- `nummer` är AUTOINCREMENT: första medlemmen får 1 (visas som "001"),
-- nästa 2, osv. Numren återanvänds aldrig även om en rad tas bort.

CREATE TABLE IF NOT EXISTS medlemmar (
  nummer          INTEGER PRIMARY KEY AUTOINCREMENT,
  fornamn         TEXT    NOT NULL,
  efternamn       TEXT    NOT NULL,
  epost           TEXT    NOT NULL,
  stad            TEXT    NOT NULL DEFAULT '',
  visa_pa_webben  INTEGER NOT NULL DEFAULT 0,
  skapad          TEXT    NOT NULL
);
