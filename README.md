# Fight Night — Ledertalent gambling-side

En "gambling"-side til Ledertalent-presentasjonen. Publikum registrerer navnet sitt, får **2 000 kr i fiktive penger** og spiller på UFC-kampene mellom de fire ledertypene:

- 🥊 Rita Relator
- 🥊 Morten Motivator
- 🥊 Petra Processor
- 🥊 Pål Producer

Du (presentasjonsholderen) styrer kvelden fra en egen admin-side, publikum spiller fra mobilen sin, og en storskjerm-visning projiseres i rommet for den store, felles avsløringen.

- **Publikumsside** (`/`) — registrering, lommebok, odds, spillebong, "Mine bonger" og toppliste. Når en kamp avgjøres, spretter det opp en annonsering med vinneren, hvordan det gikk med bongene dine og ny saldo, pluss konfetti.
- **Storskjerm** (`/skjerm.html`) — en ren visningsside uten registrering, laget for å projiseres. Viser hvor pengene i salen ligger, hvilken runde som pågår, vinner-avsløringer med rundevinnere og topplisten til slutt.
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
- Rundevinner i runde 1, 2 og 3
- Vinnermetode per fighter: KO, TKO eller poeng

**Odds** — admin velger oddsprofil per kamp og kan overstyre enkeltodds:

| Marked | Jevn kamp | Favoritt | Underdog |
|---|---|---|---|
| Kampvinner / rundevinner | 1,87 | 1,55 | 2,35 |
| Vinner på poeng | 3,75 | 3,10 | 4,25 |
| Vinner på TKO | 6,25 | 5,20 | 8,50 |
| Vinner på KO | 9,50 | 7,80 | 13,00 |

**Bonger**
- Ett valg = singel (gevinst = innsats × odds). Flere valg = kombinasjon: oddsen ganges sammen, og alle valgene må treffe.
- Motstridende eller overlappende valg blokkeres på samme bong: begge fighterne i samme marked, kampvinner og vinnermetode i samme kamp, eller KO/TKO og rundevinner i runde 3 i samme kamp (KO og TKO skjer alltid i runde 3).
- Oddsen låses på bongen når den leveres. Endrer admin oddsen etterpå, gjelder det bare nye bonger.
- **Låsing:** kampvinner og vinnermetode stenger når runde 1 starter. Hvert rundemarked stenger når den runden starter. Alt stenger når resultatet er registrert.

**Avgjøring**
- Admin registrerer vinneren av runde 1, 2 og 3, kampvinner og metode. Bongene avgjøres automatisk.
- Ved KO eller TKO må kampvinneren også ha vunnet runde 3. Adminskjemaet fyller det ut automatisk.
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

**Før start:** Velg oddsprofil for hver kamp under "Odds for Kamp X" (jevn kamp, eller hvem som er favoritt). Her kan du også overstyre enkeltodds.

**Under kvelden:**
1. **Lobby** – publikum registrerer seg og kan allerede spille.
2. **Kamp 1 i fokus** – storskjermen viser Rita vs. Pål og hvor pengene ligger.
3. Trykk **Runde 1**, **Runde 2** og **Runde 3** under "Kampforløp" etter hvert som rundene starter. Det låser markedene.
4. Når runde 3 er ferdig: fyll inn **Resultat** (vinner av hver runde, kampvinner og KO/TKO/poeng) og trykk "Lagre resultat og avgjør bonger". Bongene avgjøres, og storskjerm og mobiler viser avsløringen automatisk.
5. Gjør det samme for **Kamp 2**.
6. **Sluttresultat** – topplisten vises. Den med høyest saldo vinner.

Blir et resultat registrert feil, retter du det i samme skjema ("Lagre rettet resultat"). "Fjern resultat" åpner bongene igjen. "Nullstill alt" sletter alle påmeldte, bonger, odds og resultater, for eksempel etter en generalprøve.

## Slik får publikum tilgang fra mobilen

Nettsiden trenger en liten server (for at alle skal se samme status i sanntid), så en ren statisk fil holder ikke. Enkleste løsninger:

**Alternativ A — Samme WiFi (anbefalt for et rom):**
1. Kjør `npm start` på laptopen din, koblet til samme WiFi som publikum.
2. Finn din lokale IP (f.eks. `ipconfig` på Windows eller `ifconfig`/`ip a` på Mac/Linux — se etter noe som `192.168.x.x`).
3. Del lenken `http://192.168.x.x:3000` med publikum (skriv den på en slide eller lag en QR-kode).

**Alternativ B — Skyløsning (fungerer uansett nett):**
Deploy appen til en Node-vert som f.eks. [Railway](https://railway.app) eller [Render](https://render.com):
- Push dette repoet dit, sett start-kommando til `npm start`.
- Sett miljøvariabelen `ADMIN_PASSWORD` til et eget passord.
- Del den offentlige URL-en med publikum.

## Konfigurasjon

- `ADMIN_PASSWORD` (miljøvariabel) — passord for adminpanelet. Standard er `ledertalent`.
- `PORT` (miljøvariabel) — hvilken port serveren kjører på. Standard er `3000`.

Alt lagres i `data/state.json`, så ingenting går tapt om serveren restarter midt i presentasjonen. På Railway og lignende tjenester blir filen borte ved ny deploy, med mindre du kobler på et volum. Ikke deploy midt i leken.

## Teknisk

Enkel Node.js/Express-backend (fil-persistert state) og en vanilla HTML/CSS/JS-frontend som poller status hvert 2–3 sekund. Ingen bygg-steg og ingen database.

- `betting.js` — all spillogikk: odds, markeder, bonger, låsing, avgjøring, lommebok og toppliste. Alle beløp lagres i hele øre. Saldoen regnes alltid ut fra bongene, så den kan ikke komme ut av synk.
- `server.js` — API og lagring.
- `public/` — publikumsside, storskjerm og admin.
