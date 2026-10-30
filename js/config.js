/* LAST SIGNAL — Konfiguration. Nur diese Datei muss vor dem Deploy angepasst werden.
   Leere SUPABASE_URL = Demo-Modus: alles bleibt im Browser, Synchronisation nur
   zwischen Tabs desselben Geräts. Gut zum Ausprobieren, nicht für das Spiel. */
export const CONFIG = {
  SUPABASE_URL: 'https://wptcoucdhxgwvbjtwtra.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwdGNvdWNkaHhnd3ZianR3dHJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NDQwNDAsImV4cCI6MjEwNzMyMDA0MH0.gIitSYHNNUzm6H-x5vinnvlp0UO57C_OScdpDL-Qvqg', // anon public
  VAPID_PUBLIC_KEY: 'BAbwpP1RxvGDGuy0Ax5hVK02SqvHA6RZTF54V-YyY6P1TPRjCyaNr1ACy0n7qUUIVXX1mNKvzgKWa5tjKQn1ZNc', // Push; privater Schluessel nur in Vercel

  /* Passwort der Jäger-Ansicht. Reine Zugangssperre im Browser. */
  HUNTER_PASSWORD: 'Last Signal',

  /* Standortversand der Gejagten in Sekunden, solange die Seite offen ist.
     Zusaetzlich wird bei jeder abgehakten Aufgabe sofort gesendet. */
  LOCATION_INTERVAL_S: 9 * 60,

  /* Die zwei Gejagten, fest vergeben. Beim ersten Start waehlt jedes Handy seinen Namen. */
  BANDITS: [
    { id: 'b1', name: 'MARVIN', label: 'BANDIT 01', color: '#FF4D0F' },
    { id: 'b2', name: 'JULIEN', label: 'BANDIT 02', color: '#F0EBE1' },
  ],

  /* Fairness: Jaeger sehen Positionen der Gejagten nur im Takt (Minuten, ab :00).
     Sofort sichtbar bleiben Signale beim Abhaken ('task') und "Jetzt senden" ('manual'). */
  REVEAL_MIN: 9,

  /* Testkanal fuer OwnTracks (Admin-Handy). Erscheint auf der Jaeger-Karte als TEST,
     loest keinen Funkstille-Alarm aus und wird mit "Alle Daten loeschen" entfernt. */
  TEST_TRACKER: { id: 'tst', name: 'TEST', label: 'TESTGERÄT', color: '#7A7A74' },
};
