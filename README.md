# Fight Night — Ledertalent gambling-side

En "gambling"-side til Ledertalent-presentasjonen. Publikum registrerer navnet sitt og tipper hvem som vinner hver UFC-kamp mellom de fire ledertypene:

- 🥊 Rita Relator
- 🥊 Morten Motivator
- 🥊 Petra Processor
- 🥊 Pål Producer

Du (presentasjonsholderen) styrer kvelden fra en egen admin-side, og publikum følger med og tipper fra mobilen sin.

## Kampoppsettet

1. **Kamp 1:** Rita Relator vs. Pål Producer → **Rita Relator vinner i runde 3**
2. **Kamp 2:** Petra Processor vs. Morten Motivator → **Petra Processor vinner i runde 3**

Resultatene ligger hardkodet i `server.js` (`MATCH_DEFS`) siden dette er en scriptet del av presentasjonen.

## Kom i gang

```bash
npm install
npm start
```

Serveren starter på `http://localhost:3000`. Admin-passordet skrives ut i terminalen når serveren starter (standard: `ledertalent` — bytt det, se under).

- **Publikumsside:** `http://localhost:3000/`
- **Adminpanel:** `http://localhost:3000/admin.html`

## Slik bruker du admin-panelet under presentasjonen

Åpne `/admin.html` på din egen enhet og logg inn med passordet. Der klikker du deg gjennom fasene i rekkefølge, i takt med at dere spiller ut kampene live:

1. **Lobby** – publikum ser de fire fighterne mens de venter
2. **Åpne Kamp 1** – tipping åpner for Rita vs. Pål
3. **Vis resultat Kamp 1** – avslører vinneren (konfetti!) og viser hvem som tippet riktig
4. **Åpne Kamp 2** – tipping åpner for Petra vs. Morten
5. **Vis resultat Kamp 2** – avslører vinneren
6. **Sluttresultat** – viser leaderboard over kveldens beste gamblere

Du kan alltid gå tilbake til en tidligere fase om noe går galt, og "Nullstill alt" sletter alle påmeldte/tips om du vil kjøre en generalprøve før selve presentasjonen.

## Slik får publikum tilgang fra mobilen

Nettsiden trenger en liten server (for at alle skal se samme tipping i sanntid), så en ren statisk fil holder ikke. Enkleste løsninger:

**Alternativ A — Samme WiFi (anbefalt for et rom):**
1. Kjør `npm start` på laptopen din, koblet til samme WiFi som publikum.
2. Finn din lokale IP (f.eks. `ipconfig` på Windows eller `ifconfig`/`ip a` på Mac/Linux — se etter noe som `192.168.x.x`).
3. Del lenken `http://192.168.x.x:3000` med publikum (skriv den på en slide eller lag en QR-kode).

**Alternativ B — Skyløsning (fungerer uansett nett):**
Deploy appen til en gratis Node-vert som f.eks. [Render](https://render.com) eller [Railway](https://railway.app):
- Push dette repoet dit, sett start-kommando til `npm start`.
- Sett miljøvariabelen `ADMIN_PASSWORD` til et eget passord.
- Del den offentlige URL-en med publikum.

## Konfigurasjon

- `ADMIN_PASSWORD` (miljøvariabel) — passord for adminpanelet. Standard er `ledertalent`.
- `PORT` (miljøvariabel) — hvilken port serveren kjører på. Standard er `3000`.

Tippingen lagres i `data/state.json` slik at ingenting går tapt om serveren restarter midt i presentasjonen.

## Teknisk

Enkel Node.js/Express-backend (in-memory + fil-persistert state) og en vanilla HTML/CSS/JS-frontend som poller status hvert 2,5 sekund — ingen bygg-steg, ingen databaseoppsett.
