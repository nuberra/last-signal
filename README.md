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

## 1b. Erweiterung 02 (Notizen, Zeichnungen, Foto-Orte)

Im SQL Editor einmal `supabase/migration-02.sql` ausführen. Bei einer neuen Datenbank ist sie in `schema.sql` schon enthalten.

## 1c. Erweiterung 03 (Akkustand, Funkstille-Alarm)

In `supabase/migration-03.sql` `<DEIN-PROJEKT>` durch die Vercel-Adresse ersetzen (z.B. `last-signal.vercel.app`) und im SQL Editor ausführen. Damit prüft Supabase alle 5 Minuten, ob ein Gejagter länger als 25 Minuten kein Signal gesendet hat, und schickt dann einen Push. Spielzeitraum und Öffnungszeiten stehen in `js/data.js` (`GAME_START`, `GAME_END`, `hours`).

## 2. Vercel (ca. 3 Min.)

1. Repo zu GitHub pushen, auf vercel.com **Add New → Project**, Repo wählen.
2. Framework Preset **Other**, Root Directory leer lassen, kein Build-Befehl. **Deploy**.
3. Alternativ per CLI im Repo-Ordner: `npx vercel --prod`.

## 3. Push für die Jäger und Standort im Hintergrund

Der VAPID-Public-Key steht schon in `js/config.js`. In Vercel unter **Settings → Environment Variables** zwei geheime Werte setzen, danach **Deployments → Redeploy**:

| Name | Wert |
| --- | --- |
| `VAPID_PRIVATE_KEY` | privater Push-Schlüssel (nie ins Repo) |
| `OWNTRACKS_PASSWORD` | frei gewähltes Passwort für OwnTracks |

Push kommt bei: jeder erledigten Aufgabe bzw. jedem Pflichttermin, und wenn ein Gejagter neu in den 500-m-Umkreis eines Orts kommt (alle Ebenen).

**Jäger:** Seite `/jaeger` öffnen, auf dem iPhone zuerst **Teilen → Zum Home-Bildschirm** und von dort öffnen (iOS 16.4+), dann oben **Push** tippen und erlauben. Android und Desktop-Chrome: direkt **Push** tippen.

**Gejagte — OwnTracks** (sendet auch bei gesperrtem Handy):
1. App **OwnTracks** installieren (App Store / Play Store, kostenlos).
2. Einstellungen / Preferences → Connection:
   - Mode: **HTTP**
   - URL: `https://<projekt>.vercel.app/api/owntracks`
   - Authentication an, UserID: `marvin` bzw. `julien`, Password: der Wert von `OWNTRACKS_PASSWORD`
   - Device ID: `handy`, Tracker ID: `MA` bzw. `JU`
3. Standort auf **Immer erlauben** stellen (iPhone: Einstellungen → OwnTracks → Standort → Immer, Genauer Standort an). Android: Akku-Optimierung für OwnTracks ausschalten.
4. Überwachungsmodus auf der Karte in OwnTracks auf **Significant** (sparsam) oder **Move** (laufend, mehr Akku) stellen. Im Spiel: Move, wenn der Akku reicht.
5. Testen: in OwnTracks **Publish** / Hochladen-Symbol tippen; der Punkt erscheint bei den Jägern.

## Testen vor dem Spiel

`https://<projekt>.vercel.app/test` (Jäger-Passwort) öffnet die Testzentrale: Systemcheck, Gejagte per Tipp auf die Karte simulieren, fertige Szenarien (Halt und S-Bahn-Fahrt, Annäherung mit Alarm, Funkstille, Aufgabe mit Foto), Test-Push, OwnTracks-Test, Abfahrten, Öffnungszeiten zu beliebigem Zeitpunkt, Testplan zum Abhaken und Aufräumen. Simulierte Signale sind als `test` markiert und lassen sich einzeln löschen; vor dem Spiel "Alles zurücksetzen".

## 4. Verteilen

- **Gejagte**: Link `/` schicken. Öffnen, MARVIN oder JULIEN wählen, Standort erlauben, dann **Zum Home-Bildschirm**. Im Spiel die Seite offen lassen und **Bildschirm wach** aktivieren: Browser senden keinen Standort, wenn das Handy gesperrt ist. **Jetzt senden** ist der Fallback.
- **Jäger**: Link `/jaeger` plus Passwort `Last Signal` getrennt schicken. Zum Home-Bildschirm hinzufügen, **Push** aktivieren, einmal auf **Ton aus** tippen, damit der Ton freigeschaltet ist.

## Hinweise

- Das Passwort ist eine Sperre im Browser, keine echte Absicherung: wer den anon-Schlüssel aus dem Quelltext liest, kann die Daten lesen. Für ein Spiel unter Freunden reicht das.
- Uploads bis 50 MB (Supabase Free). Fotos werden vorher auf 1920 px verkleinert, Videos nicht — lange Videos kürzen.
- Zeiten der Pflichttermine stehen in `js/data.js` (MEZ, Sommerzeit endet am 25.10.).
- Nach dem Spiel zurücksetzen: letzte Zeile in `supabase/schema.sql`.
- Lokal testen: `npx serve .`, dann `http://localhost:3000` und `/jaeger.html` in zwei Tabs.
