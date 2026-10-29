/* LAST SIGNAL — Spieldaten Staffel 01, Stuttgart, Fr 30.10. 09:00 bis So 01.11.2026 15:00.
   Koordinaten wie recherchiert uebernommen. */

/* proof: 'photo' | 'video' | 'photo+video' | 'none' */
export const TASKS = [
  { id: 't01', n: 1, title: 'Foto vor dem Neuen Schloss', proof: 'photo' },
  { id: 't02', n: 2, title: 'Foto im Mercedes-Benz Museum', proof: 'photo' },
  { id: 't03', n: 3, title: 'Foto vor dem Porsche Museum', proof: 'photo' },
  { id: 't04', n: 4, title: 'Foto vor dem Schweinemuseum', proof: 'photo' },
  { id: 't05', n: 5, title: 'Foto vor dem Stadion', proof: 'photo' },
  { id: 't06', n: 6, title: 'Foto vor dem Max-Eyth-See', proof: 'photo' },
  { id: 't07', n: 7, title: 'Foto vor dem Fernsehturm', proof: 'photo' },
  { id: 't08', n: 8, title: 'Am Fernsehturm ein Bild mit 10 Unterschriften', proof: 'photo' },
  { id: 't09', n: 9, title: 'Foto mit VfB-Trikot-Träger', proof: 'photo' },
  { id: 't10', n: 10, title: 'Foto mit einem Strassenmusiker', proof: 'photo' },
  { id: 't11', n: 11, title: 'Foto mit drei verkleideten Personen', proof: 'photo' },
  { id: 't12', n: 12, title: 'Ein Bild von den Jägern', proof: 'photo' },
  { id: 't13', n: 13, title: 'VfB-Graffiti abfotografieren', proof: 'photo' },
  { id: 't14', n: 14, title: 'Stuttgarter Hauptbahnhof, Gleis 9', proof: 'photo' },
  { id: 't15', n: 15, title: 'Video am Slot-Automaten im Casino', proof: 'video' },
  { id: 't16', n: 16, title: "Ein komplettes Menü essen bei McDonald's", proof: 'photo' },
  { id: 't17', n: 17, title: 'Eine traditionelle Maultasche essen in einem Café', proof: 'photo' },
  { id: 't18', n: 18, title: 'Im Café zwei Gipfeli und zwei Kaffee konsumieren', proof: 'photo' },
  { id: 't19', n: 19, title: 'In ein Gym gehen und eine Hantel in der Hand haben', proof: 'photo' },
  { id: 't20', n: 20, title: 'An einem Spielplatz 40 Klimmzüge machen, beide Gejagte zusammen gezählt', proof: 'photo+video' },
  { id: 't21', n: 21, title: 'Videocall 10 Minuten, Tom-Holland-Workout von irgendwo', proof: 'none' },
  { id: 't22', n: 22, title: 'Ein schwäbisches Wort erklären lassen', proof: 'video' },
  { id: 't23', n: 23, title: 'Im Lego Store ein grünes Auto zusammenbauen', proof: 'photo' },
  { id: 't24', n: 24, title: 'In einer Mall vier Produkte kaufen: Gummiball, Emmentaler Käse, Werbeflyer aus der Apotheke, Donald-Duck-Buch', proof: 'photo' },
];

/* Zeiten als lokale Zeit Europe/Berlin. Am 25.10.2026 endet die Sommerzeit,
   das ganze Spiel liegt also in MEZ (UTC+01:00). */
export const APPOINTMENTS = [
  {
    id: 'a1', n: 1, place: 'Höhenpark Killesberg', lat: 48.80412, lng: 9.17375,
    day: 'FR 30.10.', window: '16:00 BIS 18:00', note: '20 Min. Aufenthalt', stay: 20,
    start: '2026-10-30T16:00:00+01:00', end: '2026-10-30T18:00:00+01:00',
  },
  {
    id: 'a2', n: 2, place: 'Starbucks Königstrasse 28', lat: 48.77876, lng: 9.17782,
    day: 'SA 31.10.', window: '12:00', note: '30 Min. Treffen, 10 Min. Vorlauf für die Gejagten', stay: 30,
    start: '2026-10-31T11:50:00+01:00', end: '2026-10-31T12:30:00+01:00',
  },
  {
    id: 'a3', n: 3, place: 'Mittlerer Schlossgarten', lat: 48.78574, lng: 9.18732,
    day: 'SO 01.11.', window: '10:00 BIS 12:00', note: '20 Min. Aufenthalt', stay: 20,
    start: '2026-11-01T10:00:00+01:00', end: '2026-11-01T12:00:00+01:00',
  },
];

/* Oeffnungszeiten: pro Wochentag (0 = Sonntag) Liste von [auf, zu] als 'HH:MM'.
   zu > 24:00 bedeutet ueber Mitternacht. null = ganztags zu. Fehlt hours: immer zugaenglich.
   Recherchiert Oktober 2026, ohne Gewaehr. 01.11.2026 ist Sonntag (Allerheiligen). */
const WEEK = (mo, sa, so) => [so, mo, mo, mo, mo, mo, sa];
const H = {
  museum: WEEK([['09:00', '18:00']], [['09:00', '18:00']], [['09:00', '18:00']]),
  schwein: WEEK([['10:00', '18:30']], [['10:00', '18:30']], [['10:00', '18:30']]),
  casino: WEEK([['15:00', '27:00']], [['15:00', '27:00']], [['15:00', '27:00']]),
  mall: WEEK([['10:00', '20:00']], [['09:30', '20:00']], null),
  lego: WEEK([['10:00', '20:00']], [['10:00', '20:00']], null),
  turm: WEEK([['10:00', '21:30']], [['10:00', '21:30']], [['10:00', '21:30']]),
};
H.museum[1] = null; // Montag Ruhetag

/* Feste Orte. tag = Kurzwort auf der Karte, tasks = Aufgaben, die dort erledigt werden.
   Sind alle Aufgaben eines Orts erledigt, wird er auf der Karte zurueckgenommen. */
export const POI_CATEGORIES = [
  { id: 'termine', label: 'Pflichttermine', tag: 'TERMIN', items: APPOINTMENTS.map((a) => ({ name: a.place, lat: a.lat, lng: a.lng, tasks: [a.id], code: 'T' + a.n })) },
  { id: 'museen', label: 'Museen', tag: 'MUSEUM', items: [
    { name: 'Mercedes-Benz Museum', lat: 48.78815, lng: 9.23398, tasks: ['t02'], hours: H.museum },
    { name: 'Porsche Museum', lat: 48.83421, lng: 9.15255, tasks: ['t03'], hours: H.museum },
    { name: 'SchweineMuseum', lat: 48.78581, lng: 9.21999, tasks: ['t04'], hours: H.schwein },
  ] },
  { id: 'casino', label: 'Casino', tag: 'CASINO', items: [
    { name: 'Spielbank Stuttgart', lat: 48.72286, lng: 9.16055, tasks: ['t15'], hours: H.casino },
  ] },
  { id: 'malls', label: 'Einkaufszentren', tag: 'MALL', items: [
    { name: 'Milaneo', lat: 48.79122, lng: 9.18320, tasks: ['t24'], hours: H.mall },
    { name: 'Das Gerber', lat: 48.77236, lng: 9.17231, tasks: ['t24'], hours: H.mall },
  ] },
  { id: 'mcd', label: "McDonald's", tag: 'MCD', items: [
    { name: "McDonald's Königstrasse 17", lat: 48.77723, lng: 9.17733, tasks: ['t16'] },
    { name: "McDonald's Marienstrasse 12", lat: 48.77342, lng: 9.17316, tasks: ['t16'] },
    { name: "McDonald's Bahnhofstrasse 30 (Bad Cannstatt)", lat: 48.80176, lng: 9.21736, tasks: ['t16'] },
    { name: "McDonald's Mailänder Platz 7", lat: 48.79086, lng: 9.18382, tasks: ['t16'] },
  ] },
  { id: 'lego', label: 'Lego Store', tag: 'LEGO', items: [
    { name: 'Lego Store Königstrasse 43B', lat: 48.77438, lng: 9.17482, tasks: ['t23'], hours: H.lego },
  ] },
  { id: 'foto', label: 'Fotopunkte', tag: 'FOTO', items: [
    { name: 'Neues Schloss', lat: 48.77797, lng: 9.18187, tasks: ['t01'] },
    { name: 'Fernsehturm', lat: 48.75586, lng: 9.19011, tasks: ['t07', 't08'], hours: H.turm },
    { name: 'Hauptbahnhof Gleis 9', lat: 48.78417, lng: 9.17892, tasks: ['t14'] },
    { name: 'Max-Eyth-See', lat: 48.83510, lng: 9.21687, tasks: ['t06'] },
    { name: 'MHP Arena (Stadion)', lat: 48.79226, lng: 9.23208, tasks: ['t05'] },
  ] },
];

/* Live aus OpenStreetMap (Overpass) geladene Ebenen. Viele Punkte, daher ohne Alarm
   und erst ab Zoomstufe minZoom sichtbar. */
export const BBOX = [48.690, 9.030, 48.870, 9.320];
export const LIVE_LAYERS = [
  { id: 'oepnv', label: 'S-Bahn / Stadtbahn', tag: 'S/U', minZoom: 12, tasks: [] },
  { id: 'gym', label: 'Gyms', tag: 'GYM', minZoom: 13, tasks: ['t19'] },
  { id: 'spielplatz', label: 'Spielplätze', tag: 'SPIEL', minZoom: 14, tasks: ['t20'] },
  { id: 'cafe', label: 'Cafés', tag: 'CAFE', minZoom: 15, tasks: ['t17', 't18'] },
  { id: 'apotheke', label: 'Apotheken', tag: 'APO', minZoom: 15, tasks: ['t24'] },
];

export const ALERT_RADIUS_M = 500;

/* Spielzeitraum: fuer Funkstille-Alarm und "letzte Chance" der Aufgaben. */
export const GAME_START = '2026-10-30T09:00:00+01:00';
export const GAME_END = '2026-11-01T15:00:00+01:00';

/* Jagdzeit pro Tag (Ortszeit Stuttgart): Signale der Gejagten werden nur von 09:00 bis
   22:00 freigegeben, im Takt von CONFIG.REVEAL_MIN. Ausserhalb gibt es keine Freigabe,
   keinen Push und keine Funkstille; um 09:00 erscheint der neueste Punkt der Nacht.
   Nach Spielende wird nichts mehr freigegeben. */
export const HUNT_FROM_MIN = 9 * 60;
export const HUNT_TO_MIN = 22 * 60;
const berlinFmt = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/* Minuten seit Mitternacht in Stuttgart */
export const localMin = (t) => { const [h, m] = berlinFmt.format(new Date(t)).split(':').map(Number); return h * 60 + m; };
/* Vor Spielbeginn offen (zum Testen), nach Spielende (So 15:00) nicht mehr. */
export const huntOpen = (t) => { const m = localMin(t); return m >= HUNT_FROM_MIN && m <= HUNT_TO_MIN && +new Date(t) <= Date.parse(GAME_END); };
