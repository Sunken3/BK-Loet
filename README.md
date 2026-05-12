# BK Loet — Hemsida

Detta är hemsidan för BK Loet. All text och alla siffror som ändras under säsongen ligger i **`data.json`**. Du redigerar bara den filen — aldrig `index.html`.

## Filerna

| Fil | Vad den gör | Redigerar du? |
|-----|-------------|---------------|
| `index.html` | Själva sidan (struktur + design) | Nej, lämna ifred |
| `data.json` | Allt redigerbart innehåll | **Ja, här ändrar du** |
| `README.md` | Denna fil | Vid behov |

## Hur du uppdaterar sidan

### Lägga till en ny spelare

Öppna `data.json` och hitta sektionen `"spelare"`. Kopiera en befintlig rad och fyll i nya värden:

```json
{ "namn": "Sara K.", "initialer": "SK", "nummer": 22, "roll": "Spelare", "snitt": 196, "matcher": 4 }
```

Glöm inte kommatecknet efter raden ovanför! Den sista spelaren i listan ska **inte** ha kommatecken efter sig.

### Lägga till en ny sponsor

Hitta `"sponsorer"` i `data.json`. Lägg till:

```json
{
  "namn": "Företagets namn",
  "niva": "Silversponsor",
  "beskrivning": "Kort beskrivning av sponsorskapet.",
  "lank": "https://foretaget.se"
}
```

Giltiga nivåer (skriv exakt så här):
- `"Huvudsponsor"` — visas störst, en per rad
- `"Guldsponsor"` — visas stora
- `"Silversponsor"` — visas mellan
- `"Bronssponsor"` — visas små

Om sponsorn inte har en webbplats, sätt `"lank": "#"`.

### Uppdatera tabellen

Hitta `"tabell"` → `"lag"`. Lagen visas i den ordning de står i listan — alltså sortera dem efter placering från första till sista. Glöm inte att uppdatera `"uppdaterad"`-fältet med dagens datum.

### Ändra klubbinfo, kontaktuppgifter eller priser

Allt sådant ligger högst upp i `data.json` under `"klubb"`, `"kontakt"`, `"medlemskap"` osv. Bara byt ut texten mellan citationstecknen.

## Viktiga regler för JSON

JSON är strikt — ett enda fel och sidan slutar fungera. Tre saker att hålla koll på:

1. **Citationstecken runt all text:** `"Sara K."` — aldrig utan citationstecken
2. **Kommatecken mellan element**, men **inte efter det sista** i en lista
3. **Siffror utan citationstecken:** `198`, inte `"198"`

Om sidan visar "Kunde inte ladda sidan" har JSON-filen ett fel. Klistra in innehållet i [jsonlint.com](https://jsonlint.com) — den pekar ut raden där felet ligger.

## Testa lokalt på din dator

Du kan **inte** bara dubbelklicka på `index.html` — webbläsaren blockerar `data.json` av säkerhetsskäl. Du måste köra en liten lokal server:

**Alternativ A — Python** (om du har Python installerat):
1. Öppna terminalen i mappen där `index.html` ligger
2. Kör: `python3 -m http.server 8000`
3. Öppna `http://localhost:8000` i webbläsaren

**Alternativ B — VS Code med tillägget "Live Server"**:
1. Installera VS Code (gratis)
2. Installera tillägget "Live Server" från Ras Mou (i VS Code)
3. Högerklicka på `index.html` → "Open with Live Server"

Sidan uppdateras automatiskt varje gång du sparar `data.json`.

## Publicera på internet (GitHub + Cloudflare Pages)

När du är redo att lägga ut sidan på en riktig adress, kommer vi göra detta steg för steg:

1. Skapa konto på [GitHub](https://github.com)
2. Skapa ett nytt repo, ladda upp dina filer
3. Skapa konto på [Cloudflare](https://cloudflare.com)
4. I Cloudflare Pages → koppla till GitHub-reposet
5. Klart — sidan ligger på `<något>.pages.dev` (och kan kopplas till `bkloet.se` om ni köper domänen)

Efter setup: varje gång du redigerar `data.json` på GitHub uppdateras sidan automatiskt inom ~30 sekunder.
