# LAST SIGNAL — City Hunt Stuttgart

Statische Web-App (PWA) für zwei Ansichten, Echtzeit über Supabase, Hosting auf Vercel.

| Ansicht | Link | Schutz |
| --- | --- | --- |
| Gejagte (Bandits) | `https://<projekt>.vercel.app/` | keiner |
| Jäger (Detectives) | `https://<projekt>.vercel.app/jaeger` | Passwort `Last Signal` |

Die Jäger-Ansicht schaltet ab 1024 px Fensterbreite auf die Desktop-Fassung um: Karte links fest, rechts eine Seitenleiste mit Bandits (inkl. Alarm-Log und Signal-Verlauf), Aufgaben und Export. Gleicher Link, kein eigener Deploy.

Ohne Supabase-Daten in `js/config.js` läuft die App im **Demo-Modus** (Daten nur im Browser, Sync nur zwischen Tabs desselben Geräts).

## 1. Supabase (ca. 5 Min.)

1. Auf supabase.com ein kostenloses Projekt anlegen (Region Frankfurt).
2. **SQL Editor → New query**, Inhalt von `supabase/schema.sql` einfügen, **Run**. Damit gibt es Tabellen, Echtzeit und den Speicher-Bucket `proofs`.
3. **Project Settings → API**: `Project URL` und den `anon public`-Schlüssel in `js/config.js` eintragen (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

## 2. Vercel (ca. 3 Min.)

1. Repo zu GitHub pushen, auf vercel.com **Add New → Project**, Repo wählen.
2. Framework Preset **Other**, Root Directory leer lassen, kein Build-Befehl. **Deploy**.
3. Alternativ per CLI im Repo-Ordner: `npx vercel --prod`.

## 3. Push für die Jäger (optional, empfohlen)

Ohne Push gibt es Live-Meldung, Ton und Vibration nur bei offener Jäger-Seite.

1. `npx web-push generate-vapid-keys` ausführen.
2. Public Key in `js/config.js` bei `VAPID_PUBLIC_KEY` eintragen.
3. In Vercel unter **Settings → Environment Variables** setzen:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (z.B. `mailto:du@example.com`),
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role, **geheim**, nur hier).
4. Neu deployen. Auf der Jäger-Seite oben **Push** tippen und erlauben.
   iPhone: Push geht nur, wenn die Seite vorher über **Teilen → Zum Home-Bildschirm** installiert und von dort geöffnet wurde (iOS 16.4+).

## 4. Verteilen

- **Gejagte**: Link `/` schicken. Öffnen, Platz (BANDIT 01 / 02) und Vorname wählen, Standort erlauben, dann **Zum Home-Bildschirm**. Im Spiel die Seite offen lassen und **Bildschirm wach** aktivieren: Browser senden keinen Standort, wenn das Handy gesperrt ist. **Jetzt senden** ist der Fallback.
- **Jäger**: Link `/jaeger` plus Passwort `Last Signal` getrennt schicken. Zum Home-Bildschirm hinzufügen, **Push** aktivieren, einmal auf **Ton aus** tippen, damit der Ton freigeschaltet ist.

## Hinweise

- Das Passwort ist eine Sperre im Browser, keine echte Absicherung: wer den anon-Schlüssel aus dem Quelltext liest, kann die Daten lesen. Für ein Spiel unter Freunden reicht das.
- Uploads bis 50 MB (Supabase Free). Fotos werden vorher auf 1920 px verkleinert, Videos nicht — lange Videos kürzen.
- Zeiten der Pflichttermine stehen in `js/data.js` (MEZ, Sommerzeit endet am 25.10.).
- Nach dem Spiel zurücksetzen: letzte Zeile in `supabase/schema.sql`.
- Lokal testen: `npx serve .`, dann `http://localhost:3000` und `/jaeger.html` in zwei Tabs.
