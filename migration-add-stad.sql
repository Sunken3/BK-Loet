-- Migrering: lägg till kolumnen `stad` i en BEFINTLIG databas.
-- Kör detta EN gång i D1-konsolen om din databas skapades innan stad-fältet
-- fanns. (Nya databaser som körs med schema.sql har redan kolumnen.)

ALTER TABLE medlemmar ADD COLUMN stad TEXT NOT NULL DEFAULT '';
