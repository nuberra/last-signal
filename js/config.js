/* LAST SIGNAL — Konfiguration. Nur diese Datei muss vor dem Deploy angepasst werden.
   Leere SUPABASE_URL = Demo-Modus: alles bleibt im Browser, Synchronisation nur
   zwischen Tabs desselben Geräts. Gut zum Ausprobieren, nicht für das Spiel. */
export const CONFIG = {
  SUPABASE_URL: 'https://wptcoucdhxgwvbjtwtra.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwdGNvdWNkaHhnd3ZianR3dHJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NDQwNDAsImV4cCI6MjEwNzMyMDA0MH0.gIitSYHNNUzm6H-x5vinnvlp0UO57C_OScdpDL-Qvqg', // anon public
  VAPID_PUBLIC_KEY: '',    // optional, für Push. Siehe README.

  /* Passwort der Jäger-Ansicht. Reine Zugangssperre im Browser. */
  HUNTER_PASSWORD: 'Last Signal',

  /* Standortversand der Gejagten in Sekunden, solange die Seite offen ist. */
  LOCATION_INTERVAL_S: 90,

  /* Die zwei Gejagten-Plaetze. Der Name wird beim ersten Start eingegeben. */
  BANDITS: [
    { id: 'b1', label: 'BANDIT 01', color: '#FF4D0F' },
    { id: 'b2', label: 'BANDIT 02', color: '#F0EBE1' },
  ],
};
