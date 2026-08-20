# Stödmedlem-flödet — engångsuppsättning i Cloudflare

Formuläret "Bli stödmedlem" på startsidan sparar varje ny medlem i en
Cloudflare **D1**-databas och delar ut löpande medlemsnummer (001, 002, …).

Din sajt körs som en **Cloudflare Worker med statiska filer** (adressen slutar
på `.workers.dev`). Koden finns redan i repot:

- `worker/index.js` — serverar sidorna och hanterar `/api/medlem` och `/admin`
- `wrangler.jsonc` — konfigurationen som gör sajten till en "riktig" Worker
- `schema.sql` — databastabellen

> **Därför fick du felet "Variables cannot be added…":** sajten hade tidigare
> bara statiska filer och ingen Worker-kod, så Cloudflare vägrade lägga till
> variabler. Så fort `wrangler.jsonc` + `worker/` finns i `main` blir den en
> Worker med kod, och då går det att lägga till lösenordet.

Gör stegen nedan i tur och ordning.

## 1. Skapa databasen och kopiera dess ID

1. Logga in på <https://dash.cloudflare.com> → **Storage & Databases** → **D1 SQL Database**.
2. **Create database**. Namn: `bkloet`. Skapa.
3. Öppna databasen → fliken **Console**, klistra in hela `schema.sql` och kör.
   Nu finns tabellen `medlemmar`.
4. På databasens översiktssida: kopiera **Database ID** (en lång sträng).

## 2. Klistra in Database ID i wrangler.jsonc

Öppna `wrangler.jsonc` och byt ut platshållaren:

```jsonc
"database_id": "KLISTRA_IN_DATABASE_ID_HÄR"
```

mot ditt riktiga ID, t.ex. `"database_id": "a1b2c3d4-...."`.
Spara, committa och pusha till `main`. (Be Claude göra det om du vill.)

Detta är ofarligt att ha i repot — Database ID är inte ett lösenord.

## 3. Låt den deploya

Pushen i steg 2 gör att Cloudflare bygger om sajten som en **Worker med kod**
(inte längre "bara statiska filer"). Vänta tills deployen är klar
(**Workers & Pages → bkloet → Deployments**).

> Om deployen inte startar av sig själv: kolla **bkloet → Settings → Build**
> att deploy-kommandot är `npx wrangler deploy`.

## 4. Sätt admin-lösenordet (nu funkar det!)

1. **Workers & Pages** → **bkloet** → **Settings** → **Variables and Secrets**.
2. **Add** →
   - Type: **Secret**
   - Name: `ADMIN_PASSWORD`
   - Value: valfritt lösenord (välj ett bra)
3. Spara. Gör sedan en ny deploy så lösenordet slår igenom:
   **Deployments → … → Retry deployment** (eller pusha valfri commit).

## 5. Lägg till Swish-QR-koden (när du har den)

1. Spara QR-bilden som `images/swish-qr.png` och pusha.
   (Annat filnamn? Ändra `swish.qr_bild` i `data.json`.)
2. Vill du visa ett Swish-nummer i rutan: fyll i `swish.nummer` i `data.json`,
   t.ex. `"nummer": "123 456 78 90"`. Lämna tomt för att dölja det.
3. Belopp styrs av `swish.belopp` i `data.json` (standard `"300"`).

Innan bilden finns visar rutan "QR-koden läggs till inom kort." —
resten av flödet fungerar ändå.

## Se vilka som blivit medlemmar

Gå till **`https://bkloet.anton-sandberg99.workers.dev/admin`**.
Webbläsaren frågar efter inloggning:

- Användarnamn: valfritt (t.ex. `admin`)
- Lösenord: det du satte i `ADMIN_PASSWORD`

Du får en tabell med nummer, namn, e-post, om personen vill synas på webben
och datum — plus knappen **Exportera CSV** (öppnas i Excel).

## Bra att veta

- **Betalning verifieras inte.** Sajten kan inte se om en Swish-betalning
  faktiskt gick igenom — en person sparas när de klickar "Jag har swishat".
  Stäm av mot dina riktiga Swish-transaktioner. Numret delas ut i det ögonblicket.
- **Numren återanvänds aldrig.** Tar du bort en rad hoppar nästa medlem ändå
  till nästa lediga nummer.
- **Ta bort en felregistrering:** D1 → Console →
  `DELETE FROM medlemmar WHERE nummer = 3;` (byt ut numret).

## Köra/testa lokalt (valfritt, för utvecklare)

```bash
npx wrangler d1 execute bkloet --local --file=./schema.sql   # skapar lokal tabell
echo "ADMIN_PASSWORD=test" > .dev.vars                        # lokalt lösenord
npx wrangler dev                                              # startar på localhost:8787
```

`.wrangler/` och `.dev.vars` är gitignorerade och ska inte checkas in.
