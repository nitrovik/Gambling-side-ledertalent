# Fight Night — Ledertalent gambling-side

En "gambling"-side til Ledertalent-presentasjonen. Publikum registrerer navnet sitt, får **2 000 kr i fiktive penger** og spiller på UFC-kampene mellom de fire ledertypene:

- 🥊 Rita Relator
- 🥊 Morten Motivator
- 🥊 Petra Processor
- 🥊 Pål Producer

Du (presentasjonsholderen) styrer kvelden fra en egen admin-side, publikum spiller fra mobilen sin, og en storskjerm-visning projiseres i rommet for den store, felles avsløringen.

- **Publikumsside** (`/`) — registrering, lommebok, odds, spillebong, "Mine bonger" og toppliste. Under "Spill" velger man kamp, og hvert marked (kampvinner og vinnermetode) er en meny man trykker frem. Bongen dukker opp nederst på skjermen ved første valg, kan minimeres, og viser odds, innsats, saldo etter bong og mulig gevinst. Når en kamp avgjøres, spretter det opp en annonsering med vinneren, hvordan det gikk med bongene dine og ny saldo, pluss konfetti.
- **Storskjerm** (`/skjerm.html`) — en ren visningsside uten registrering, laget for å projiseres. Viser hvor pengene i salen ligger, hvilken runde som pågår, vinner-avsløringer og topplisten til slutt.
- **Admin** (`/admin.html`) — styrer fasene, kampforløpet (runde for runde), odds og resultater.

## Kampoppsettet

1. **Kamp 1:** Rita Relator vs. Pål Producer
2. **Kamp 2:** Petra Processor vs. Morten Motivator

Hver kamp går alltid alle 3 runder, og vinneren avgjøres i runde 3 (på KO, TKO eller poeng). Resultatet registreres av admin under presentasjonen (det er ikke lenger hardkodet), så dere kan spille ut kampene slik dere vil.

## Spillsystemet

**Lommebok**
- Alle starter med 2 000 kr (fiktive penger). Minsteinnsats er 10 kr, og man kan aldri satse mer enn saldoen.
- Innsatsen trekkes når bongen leveres. Gevinster kommer automatisk inn når bongene avgjøres.

**Markeder per kamp**
- Kampvinner
- Vinnermetode per fighter: KO, TKO eller poeng

**Kveldens odds** (standard, satt i `MATCH_DEFS` i `server.js`):

| Fighter | Vinner | Poeng | TKO | KO |
|---|---|---|---|---|
| Rita Relator | 3,75 | 7,50 | 12,50 | 19,00 |
| Pål Producer | 1,87 | 3,75 | 6,25 | 9,50 |
| Petra Processor | 1,75 | 3,50 | 5,85 | 8,90 |
| Morten Motivator | 2,05 | 4,10 | 6,85 | 10,40 |

Vinneroddsen er fordelt på metodene (ca. 50 % poeng, 30 % TKO, 20 % KO), så de henger sammen.

I adminpanelet kan du bytte til en generell profil per kamp og overstyre enkeltodds:

| Marked | Jevn kamp | Favoritt | Underdog |
|---|---|---|---|
| Kampvinner | 1,87 | 1,55 | 2,35 |
| Vinner på poeng | 3,75 | 3,10 | 4,25 |
| Vinner på TKO | 6,25 | 5,20 | 8,50 |
| Vinner på KO | 9,50 | 7,80 | 13,00 |

**Bonger**
- Ett valg = singel (gevinst = innsats × odds). Flere valg = kombinasjon: oddsen ganges sammen, og alle valgene må treffe.
- Kampvinner og vinnermetode kan stackes på samme bong, for eksempel "Rita vinner kampen" + "Rita vinner på KO", i begge kampene.
- Bare valg som ikke kan skje samtidig blokkeres: begge fighterne i samme marked, eller kampvinner og vinnermetode for hver sin fighter.
- Oddsen låses på bongen når den leveres. Endrer admin oddsen etterpå, gjelder det bare nye bonger.
- **Låsing:** spillet på en kamp stenger når runde 1 starter. Når resultatet lagres, stenger hele kampen for godt. Å rette eller fjerne resultatet åpner den ikke igjen, siden alle har sett utfallet. Valg på en stengt kamp fjernes automatisk fra bongen på mobilen.

**Avgjøring**
- Admin registrerer kampvinner og metode (KO, TKO eller poeng). Bongene avgjøres automatisk.
- Admin kan rette et feil resultat. Alle bonger avgjøres da på nytt, og ingen bong kan bli utbetalt to ganger. Hvis en deltaker allerede har brukt en gevinst som trekkes tilbake, går saldoen ikke under 0. Differansen trekkes fra neste gevinst i stedet.

**Toppliste** — sortert på saldo, med avkastning i kr og %, antall bonger, treffprosent og største gevinst. Høyest saldo når leken avsluttes vinner.

## Kom i gang

```bash
npm install
npm start
```

Serveren starter på `http://localhost:3000`. Admin-passordet skrives ut i terminalen når serveren starter (standard: `ledertalent` — bytt det, se under).

- **Publikumsside:** `http://localhost:3000/`
- **Storskjerm:** `http://localhost:3000/skjerm.html`
- **Adminpanel:** `http://localhost:3000/admin.html`

### Tester

```bash
npm test
```

Testene (Node sin innebygde test-runner, ingen ekstra avhengigheter) dekker oddsberegning, kombinasjonsbonger, motstridende valg, låsing, saldo, avgjøring, retting av resultat og API-et. De ligger i `test/`.

## Slik bruker du admin-panelet under presentasjonen

Åpne `/admin.html` på din egen enhet og logg inn med passordet.

**Oversikt:** Under hver kamp ser du "Hva salen har spilt på": hvert valg med antall bonger og hvor mye penger som ligger på det, og vinnervalgene markert når resultatet er inne. Under "Alle bonger" ser du hver eneste bong (hvem, valg, innsats, odds, status/gevinst), og kan søke på navn. Topplisten viser også hvor mye hver deltaker har i aktive bonger.

**Før start:** Velg oddsprofil for hver kamp under "Odds for Kamp X" (jevn kamp, eller hvem som er favoritt). Her kan du også overstyre enkeltodds.

**Under kvelden:**
1. **Lobby** – publikum registrerer seg og kan allerede spille.
2. **Kamp 1 i fokus** – storskjermen viser Rita vs. Pål og hvor pengene ligger.
3. Trykk **Runde 1** under "Kampforløp" når kampen starter. Da stenger spillet på kampen. **Runde 2** og **Runde 3** viser bare hvilken runde som pågår på storskjermen.
4. Når runde 3 er ferdig: fyll inn **Resultat** (kampvinner og KO/TKO/poeng) og trykk "Lagre resultat og avgjør bonger". Bongene avgjøres, og storskjerm og mobiler viser avsløringen automatisk.
5. Gjør det samme for **Kamp 2**.
6. **Sluttresultat** – topplisten vises. Den med høyest saldo vinner.

Blir et resultat registrert feil, retter du det i samme skjema ("Lagre rettet resultat"). "Fjern resultat" åpner bongene igjen. "Nullstill alt" sletter alle påmeldte, bonger, odds og resultater, for eksempel etter en generalprøve.

## QR-kode

Storskjermen viser en QR-kode nede i hjørnet i lobbyen og mens spillet på en kamp er åpent. Publikum scanner den med kameraet på mobilen og havner rett på siden. Koden peker automatisk på adressen storskjermen er åpnet på, så den stemmer både på Railway og på lokal WiFi.

Vil du ha QR-koden på en slide, finner du den i adminpanelet under "QR-kode til publikum" (PNG eller SVG). Den kan også hentes direkte på `/qr.png` og `/qr.svg`.

## Slik får publikum tilgang fra mobilen

Nettsiden trenger en liten server (for at alle skal se samme status i sanntid), så en ren statisk fil holder ikke. Enkleste løsninger:

**Alternativ A — Samme WiFi (anbefalt for et rom):**
1. Kjør `npm start` på laptopen din, koblet til samme WiFi som publikum.
2. Finn din lokale IP (f.eks. `ipconfig` på Windows eller `ifconfig`/`ip a` på Mac/Linux — se etter noe som `192.168.x.x`).
3. Åpne storskjermen på `http://192.168.x.x:3000/skjerm.html`. QR-koden der peker da på riktig adresse.

**Alternativ B — Skyløsning (fungerer uansett nett):**
Deploy appen til en Node-vert som f.eks. [Railway](https://railway.app) eller [Render](https://render.com):
- Push dette repoet dit, sett start-kommando til `npm start`.
- Sett miljøvariabelen `ADMIN_PASSWORD` til et eget passord.
- Del den offentlige URL-en med publikum.

## Konfigurasjon

- `ADMIN_PASSWORD` (miljøvariabel) — passord for adminpanelet. Standard er `ledertalent`.
- `PORT` (miljøvariabel) — hvilken port serveren kjører på. Standard er `3000`.
- `PUBLIC_URL` (miljøvariabel, valgfri) — adressen QR-koden skal peke på, hvis den skal være en annen enn den storskjermen er åpnet på (f.eks. et eget domene).

Alt lagres i `data/state.json`, så ingenting går tapt om serveren restarter midt i presentasjonen. På Railway og lignende tjenester blir filen borte ved ny deploy, med mindre du kobler på et volum. Ikke deploy midt i leken.

## Teknisk

Enkel Node.js/Express-backend (fil-persistert state) og en vanilla HTML/CSS/JS-frontend som poller status hvert 2–3 sekund. Ingen bygg-steg og ingen database.

- `betting.js` — all spillogikk: odds, markeder, bonger, låsing, avgjøring, lommebok og toppliste. Alle beløp lagres i hele øre. Saldoen regnes alltid ut fra bongene, så den kan ikke komme ut av synk.
- `server.js` — API og lagring.
- `public/` — publikumsside, storskjerm og admin.
