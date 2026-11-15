-- Migrering: bekräftade betalningar.
-- Kör detta EN gång i D1-konsolen (efter migration-add-stad.sql).
--
-- En anmälan sparas nu direkt när besökaren trycker "Swisha". Den är obekräftad
-- (betald IS NULL) tills någon trycker "Bekräfta" på /admin — först då får den
-- ett medlemsnummer och syns på webben. `nummer` är bara ett internt id.

ALTER TABLE medlemmar ADD COLUMN betald TEXT;
ALTER TABLE medlemmar ADD COLUMN medlemsnummer INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS medlemmar_medlemsnummer ON medlemmar (medlemsnummer);
