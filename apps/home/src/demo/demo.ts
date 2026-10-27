/*
 * A made-up family for trying the app without signing in (and for
 * screenshots without real children's data). Dates follow today.
 */
import type { ExamGrade, LessonNote, PastExam, ScheduleLesson, UpcomingExam } from "@wilma-client/src/core";
import { addDays, isoWeek, mondayOf, today, weekday } from "../data/dates";
import { finnishTime } from "@wilma-client/src/finnish-time";
import type { Contacts, MessageRec, NewsRec, Snapshot } from "../data/model";
import type { InvitationSlot as InviteSlot } from "@wilma-client/src/core";

const KIIA = "1001";
const OTSO = "1002";

function at(iso: string, hhmm: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return finnishTime(y, m, d, h, min);
}

const fi = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.`;
};
const FI_DAY = ["ma", "ti", "ke", "to", "pe", "la", "su"];
const fiDay = (iso: string) => `${FI_DAY[weekday(iso)]} ${fi(iso)}`;

/** The next date on or after `from` that falls on weekday `day` (0 = Monday). */
function next(from: string, day: number, skip = 0): string {
  const d = addDays(from, (day - weekday(from) + 7) % 7);
  return addDays(d, skip * 7);
}

type Slot = [start: string, end: string, subject: string, code: string, teacher: string, teacherCode: string, room: string];

const KIIA_WEEK: Slot[][] = [
  [["08:15", "09:00", "Matematiikka", "MA", "Jussi Korhonen", "KOJ", "B204"], ["09:10", "10:40", "Englanti", "ENA", "Anna Nieminen", "NIA", "A112"], ["11:15", "12:45", "Kuvataide", "KU", "Eeva Lindholm", "LIE", "C01"], ["13:00", "14:30", "Historia", "HI", "Pekka Salo", "SAP", "A210"]],
  [["09:10", "10:40", "Ruotsi", "RUB", "Maria Holm", "HOM", "A114"], ["11:15", "12:45", "Liikunta", "LI", "Mikko Lehtonen", "LEM", "Sali"], ["13:00", "14:30", "Äidinkieli", "ÄI", "Sanna Koivisto", "KOS", "A201"]],
  [["08:15", "09:45", "Fysiikka", "FY", "Jussi Korhonen", "KOJ", "B110"], ["10:00", "11:30", "Englanti", "ENA", "Anna Nieminen", "NIA", "A112"], ["12:15", "13:45", "Matematiikka", "MA", "Jussi Korhonen", "KOJ", "B204"]],
  [["08:15", "09:45", "Äidinkieli", "ÄI", "Sanna Koivisto", "KOS", "A201"], ["10:00", "11:30", "Biologia", "BI", "Leena Aho", "AHL", "B112"], ["12:15", "13:45", "Musiikki", "MU", "Ville Rinne", "RIV", "M1"], ["14:00", "15:30", "Matematiikka", "MA", "Jussi Korhonen", "KOJ", "B204"]],
  [["09:10", "10:40", "Ruotsi", "RUB", "Maria Holm", "HOM", "A114"], ["11:15", "12:45", "Kotitalous", "KO", "Riikka Aalto", "AAR", "Keittiö"]],
];

const OTSO_WEEK: Slot[][] = [
  [["08:15", "09:00", "Äidinkieli", "ÄI", "Laura Mäkinen", "MÄL", "3B"], ["09:00", "09:45", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:00", "Ympäristöoppi", "YM", "Laura Mäkinen", "MÄL", "3B"], ["12:00", "12:45", "Liikunta", "LI", "Mikko Lehtonen", "LEM", "Sali"]],
  [["08:15", "09:00", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"], ["09:00", "09:45", "Englanti", "ENA", "Anna Nieminen", "NIA", "A110"], ["10:15", "11:00", "Musiikki", "MU", "Ville Rinne", "RIV", "M1"], ["12:00", "13:30", "Käsityö", "KÄ", "Tuula Ranta", "RAT", "Pajaluokka"]],
  [["08:15", "09:45", "Äidinkieli", "ÄI", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:00", "Uskonto", "UE", "Laura Mäkinen", "MÄL", "3B"], ["12:00", "12:45", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"]],
  [["08:15", "09:00", "Englanti", "ENA", "Anna Nieminen", "NIA", "A110"], ["09:00", "09:45", "Ympäristöoppi", "YM", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:45", "Kuvataide", "KU", "Eeva Lindholm", "LIE", "C01"], ["12:30", "13:15", "Liikunta", "LI", "Mikko Lehtonen", "LEM", "Sali"]],
  [["08:15", "09:00", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"], ["09:00", "09:45", "Äidinkieli", "ÄI", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:00", "Ympäristöoppi", "YM", "Laura Mäkinen", "MÄL", "3B"]],
];

/** Who the sample family can write to: each child's teachers from the timetable, the class teacher first. */
export function demoContacts(child: string): Contacts {
  const kiia = child === KIIA;
  const path = (query: string) => `/!${child}/messages/compose?${query}`;
  const teachers = new Map<string, string>();
  for (const [, , , , teacher, code] of (kiia ? KIIA_WEEK : OTSO_WEEK).flat()) {
    const [first, last] = teacher.split(" ");
    teachers.set(code, `${last} ${first} (${code})`);
  }
  const ids = [...teachers.keys()];
  const teacher = (code: string, group: string) => ({ name: teachers.get(code)!, group, school: null, kind: "teacher" as const, composePath: path(`r_teacher=${3000 + ids.indexOf(code)}`) });
  const classTeacher = kiia ? "KOJ" : "MÄL";
  return {
    details: {
      name: kiia ? "Kiia Virtanen" : "Otso Virtanen",
      className: kiia ? "7B" : "3B",
      supervisors: [{ name: teachers.get(classTeacher)!.replace(/\s*\(.*\)$/, ""), role: "Ryhmänohjaaja/Luokanvalvoja", recipient: teacher(classTeacher, "Huollettavasi tiedot") }],
      messageGroups: [{ name: "Lähetä viesti opiskelijan kaikille opettajille", group: "Huollettavasi tiedot", school: null, kind: "group", composePath: path(`r_ownteachers=${child}`) }],
    },
    recipients: [
      { name: "Virtanen Mikko", group: "Muut huoltajat", school: null, kind: "guardian", composePath: path("r_guardian=1") },
      { name: "Kaikki", group: "Omat opettajat", school: null, kind: "group", composePath: path(`r_ownteachers=${child}`) },
      ...ids.map((code) => teacher(code, "Omat opettajat")),
      { name: "Virtanen Sari (terveydenhoitaja)", group: "Henkilökunta", school: "Esimerkkikoulu", kind: "staff", composePath: path("r_personnel=2001") },
      { name: "Salo Pekka (rehtori)", group: "Henkilökunta", school: "Esimerkkikoulu", kind: "staff", composePath: path("r_personnel=2002") },
    ],
    fetchedAt: new Date(),
  };
}

function lessons(week: Slot[][], monday: string, shift?: { date: string; from: string }): ScheduleLesson[] {
  const out: ScheduleLesson[] = [];
  for (let w = 0; w < 2; w += 1) {
    week.forEach((day, i) => {
      const date = addDays(monday, w * 7 + i);
      for (const [start, end, subject, code, teacher, teacherCode, room] of day) {
        if (shift && date === shift.date && start < shift.from) continue;
        out.push({ date, dayOfWeek: i + 1, start, end, subject, subjectCode: code, teacher, teacherCode, groupId: 0, room });
      }
    });
  }
  return out;
}

export function demoSnapshot(): Snapshot {
  const now = today();
  const monday = mondayOf(now);
  const tomorrow = addDays(now, 1);
  const d = (days: number) => addDays(now, days);
  const fri = next(d(1), 4);
  const wed = next(d(1), 2);
  const mathExam = next(d(2), 3, 1);
  const parentsEvening = next(d(3), 1);
  const lastMonday = addDays(monday, weekday(now) === 0 ? -7 : 0);
  const autumnBreak = next(d(7), 0);

  // Past exams over two school years (a school day near each offset), the newest without a grade yet.
  const schoolDay = (days: number) => {
    let date = d(days);
    const [y, m, day] = date.split("-").map(Number);
    // Not in the Christmas or summer holidays.
    if ((m === 12 && day >= 20) || (m === 1 && day <= 7)) date = `${m === 12 ? y : y - 1}-12-17`;
    if ((m === 6 && day > 0) || m === 7 || (m === 8 && day < 12)) date = `${y}-05-27`;
    return weekday(date) > 4 ? addDays(date, 4 - weekday(date)) : date;
  };
  const TEACHERS: Record<string, [string, string]> = {
    MA: ["Jussi Korhonen", "KOJ"], ÄI: ["Liisa Lehtonen", "LEL"], ENA1: ["Anna Nieminen", "NIA"], RUB1: ["Maria Holm", "HOM"], HI: ["Pekka Salo", "SAP"], BI: ["Sanna Aalto", "AAS"],
  };
  const SUBJECTS: Record<string, string> = { MA: "Matematiikka", ÄI: "Suomen kieli ja kirjallisuus", ENA1: "Englanti, A1", RUB1: "Ruotsin kieli, B1", HI: "Historia", BI: "Biologia" };
  const pastExam = (days: number, family: string, course: string, name: string, grade: string | null, info: string | null = null, seen = true): PastExam => {
    const date = schoolDay(days);
    const [teacher, teacherCode] = TEACHERS[family];
    return { date, name, subject: SUBJECTS[family], subjectCode: `${family}_${course}`, grade, verbalGrade: null, info, teacher, teacherCode, seen: grade && seen ? addDays(date, 3) : null };
  };
  const kiiaPast: PastExam[] = [
    pastExam(-1, "BI", "81", "Solu ja perinnöllisyys", null, "Kirjan luvut 1–5 ja vihkotehtävät."),
    pastExam(-5, "HI", "81", "Ranskan vallankumous", "9-", "Luvut 6–9, käsitteet ja aikajana.", false),
    pastExam(-9, "ENA1", "81", "Unit 1–2", "9"),
    pastExam(-12, "RUB1", "81", "Verbikoe 2", "8½", "Epäsäännölliset verbit, lista 2."),
    pastExam(-14, "ENA1", "81", "Verbikoe 2", "24", "Pisteet /25p."),
    pastExam(-16, "MA", "81", "Murtoluvut ja desimaaliluvut", "8+", "Kirjan kappaleet 1–6.\nKertaa myös vihon tehtävät."),
    pastExam(-26, "ÄI", "81", "Mielipidekirjoitus", "K", "Arviointi T-H-K"),
    pastExam(-23, "RUB1", "81", "Sanakoe kpl 3", "7½"),
    pastExam(-30, "ÄI", "81", "Kielioppi: lauseenjäsenet", "9"),
    pastExam(-136, "MA", "7LV", "Geometria", "9"),
    pastExam(-142, "ENA1", "7LV", "Units 7–9", "10-"),
    pastExam(-149, "BI", "7LV", "Ekosysteemit", "8"),
    pastExam(-156, "RUB1", "7LV", "Kappaleet 7–9", "8-"),
    pastExam(-163, "ÄI", "7LV", "Romaanin analyysi", "9+"),
    pastExam(-170, "ÄI", "7LV", "Työskentely kevään tunneilla", "4", "Arviointi 1-5\n5 = työskentely on esimerkillistä\n3 = työskentely on pääsääntöisesti sujuvaa\n1 = työskentelyssä on paljon parannettavaa"),
    pastExam(-176, "HI", "7LV", "Teollistuminen", "9"),
    pastExam(-190, "MA", "7LV", "Yhtälöt", "9½"),
    pastExam(-204, "ENA1", "7LV", "Units 4–6", "10"),
    pastExam(-218, "RUB1", "7LV", "Verbikoe 1", "8"),
    pastExam(-246, "MA", "71", "Prosenttilaskut", "8½"),
    pastExam(-260, "ÄI", "71", "Kielioppi: sijamuodot", "9"),
    pastExam(-267, "BI", "71", "Kasvit", "8+"),
    pastExam(-281, "ENA1", "71", "Units 1–3", "9+"),
    pastExam(-295, "RUB1", "71", "Sanakoe kpl 2", "7"),
    pastExam(-302, "HI", "71", "Uuden ajan alku", "8+"),
    pastExam(-316, "MA", "71", "Lausekkeet", "8"),
    pastExam(-330, "ÄI", "71", "Tekstitaidot", "9-"),
  ];
  const kiiaFront: ExamGrade[] = kiiaPast
    .filter((e) => e.grade && e.date >= d(-40))
    .map((e, i) => ({ examId: 91 + i, date: e.date, name: e.name, subject: e.subject, subjectCode: e.subjectCode, grade: e.grade!, verbalGrade: null, info: e.info, teacher: e.teacher, teacherCode: e.teacherCode, seen: e.seen }));
  const otsoPast: PastExam[] = [
    { date: schoolDay(-6), name: "Kertotaulut 2–5", subject: "Matematiikka", subjectCode: "MA_3B", grade: "9+", verbalGrade: "Kertotaulut sujuvat hienosti!", info: null, teacher: "Laura Mäkinen", teacherCode: "MÄL", seen: addDays(schoolDay(-6), 2) },
    { date: schoolDay(-20), name: "Sanelu", subject: "Äidinkieli", subjectCode: "ÄI_3B", grade: "8", verbalGrade: null, info: "Isot alkukirjaimet ja pisteet.", teacher: "Laura Mäkinen", teacherCode: "MÄL", seen: addDays(schoolDay(-20), 2) },
  ];

  let id = 41000;
  const message = (m: Omit<MessageRec, "id" | "replyCount"> & { replyCount?: number }): MessageRec => ({
    id: ++id,
    replyCount: m.thread?.replies.length ?? m.replyCount ?? 0,
    ...m,
  });
  const thread = (content: string, extra: Partial<NonNullable<MessageRec["thread"]>> = {}) => ({
    content,
    recipients: null,
    replies: [],
    collated: false,
    fetchedAt: new Date(),
    ...extra,
  });

  const messages: MessageRec[] = [
    message({
      subject: `Huomenna koulu alkaa klo 10.15`,
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(now, "07:45"),
      unreadInWilma: true,
      children: [OTSO],
      thread: thread(
        `Hei!\n\nOpettajien koulutuspäivän vuoksi 3B:n koulupäivä alkaa huomenna ${fiDay(tomorrow)} vasta klo 10.15. Aamupäiväkerho on auki normaalisti klo 7.30 alkaen.\n\nLaura`
      ),
    }),
    message({
      subject: `Poissaolon selvitys`,
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-1), "16:20"),
      unreadInWilma: true,
      children: [KIIA],
      thread: thread(
        `Hei,\n\nKiialla on merkitty selvittämätön poissaolo ${fiDay(lastMonday)} klo 11.15–12.45 (kuvataide). Voisitteko kuitata poissaolon Wilmassa tai vastata tähän viestiin? Kiitos!\n\nJussi Korhonen\n8C:n luokanvalvoja`
      ),
    }),
    message({
      subject: `Metsäretki Nuuksioon ${fiDay(fri)}`,
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(d(-1), "15:12"),
      unreadInWilma: false,
      children: [OTSO],
      thread: thread(
        `Hei 3B:n huoltajat!\n\nLähdemme perjantaina ${fi(fri)} metsäretkelle Nuuksioon. Lähtö koululta klo 8.30 ja paluu noin klo 14.00.\n\nMukaan:\n- reilut eväät ja juomapullo\n- sään mukainen vaatetus ja kumisaappaat\n- pieni reppu\n\nPalauttakaa retkilupa allekirjoitettuna ${fiDay(wed)} mennessä tai vastatkaa tähän viestiin, että lapsenne saa osallistua.\n\nTerveisin\nLaura`
      ),
    }),
    message({
      subject: `Matematiikan koe ${fiDay(mathExam)}`,
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-2), "09:40"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        `Hei!\n\n8C:n matematiikan koe on ${fiDay(mathExam)} klo 8.15. Kokeen aiheina yhtälöt ja verrannollisuus (kirjan kappaleet 1–9). Kertauspaketti on Classroomissa. Laskin mukaan.\n\nJussi`
      ),
    }),
    message({
      subject: `Kiitos Kiialle!`,
      sender: "Nieminen Anna (NIA)",
      sentAt: at(d(-3), "14:05"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        `Hei!\n\nHalusin kertoa, että Kiia piti tänään englannin tunnilla todella hyvän esitelmän Skotlannista. Hän oli valmistautunut huolella ja puhui rohkeasti koko luokan edessä. Hienoa työtä!\n\nTerveisin\nAnna Nieminen`
      ),
    }),
    message({
      subject: `Vanhempainilta ${fiDay(parentsEvening)} klo 18.00`,
      sender: "Salo Pekka (rehtori)",
      sentAt: at(d(-4), "12:00"),
      unreadInWilma: false,
      children: [KIIA, OTSO],
      thread: thread(
        `Hyvät huoltajat,\n\ntervetuloa koulun vanhempainiltaan ${fiDay(parentsEvening)} klo 18.00 koulun auditorioon. Illan aiheina ovat koulun hyvinvointisuunnitelma ja syksyn tapahtumat. Lopuksi luokkakohtaiset tapaamiset omien luokanopettajien ja -valvojien kanssa.\n\nIlmoittauduttehan Wilman lomakkeella ${fiDay(fri)} mennessä, jotta osaamme varata kahvia riittävästi.\n\nPekka Salo\nrehtori`
      ),
    }),
    message({
      subject: `8C:n luokkaretkikassa – ideoita varainkeruuseen?`,
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-5), "19:30"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        `Hei 8C:n huoltajat!\n\nOppilaat toivovat keväälle luokkaretkeä. Kerätään yhdessä ideoita varainkeruuseen: kahvio vanhempainillassa, talkoot, arpajaiset…\n\nTämä on avoin keskustelu, eli kaikki näkevät vastaukset. Kertokaa myös, jos voitte olla mukana järjestämässä.\n\nJussi`,
        {
          collated: true,
          replies: [
            { id: 1, sentAt: at(d(-5), "20:12"), senderName: "Rantanen Tiina (huoltaja)", content: "Kahvio vanhempainillassa kuulostaa hyvältä! Voin leipoa ja olla myymässä." },
            { id: 2, sentAt: at(d(-4), "07:58"), senderName: "Hakala Jari (huoltaja)", content: "Ehdotan myös joulukorttimyyntiä. Meillä on kotona painokone, voin auttaa kuvien kanssa." },
          ],
        }
      ),
    }),
    message({
      subject: `Kotitalouden ryhmätyö: leivonnaiset myyjäisiin`,
      sender: "Aalto Riikka (AAR)",
      sentAt: at(d(-6), "14:10"),
      unreadInWilma: false,
      children: [KIIA],
      // A longer thread: the reader folds the earlier messages so the newest shows first.
      thread: thread(
        `Hei 8C:n huoltajat!\n\nKotitalouden tunneilla valmistamme ryhmissä leivonnaisia koulun joulumyyjäisiin. Jokainen ryhmä suunnittelee oman reseptinsä ja laskee sille kustannusarvion. Koulu hankkii raaka-aineet.\n\nKertokaa minulle, jos lapsellanne on ruoka-aineallergioita, jotka meidän pitää huomioida ryhmien suunnittelussa.\n\nRiikka Aalto\nkotitalous`,
        {
          replies: [
            { id: 1, sentAt: at(d(-6), "18:40"), senderName: "Virtanen Mikko (Kiia Virtanen, 8C)", content: "Hei! Kiialla on pähkinäallergia, joten toivoisimme, ettei hänen ryhmänsä käytä pähkinöitä. Voiko hän tuoda omat ainekset, jos resepti vaatii jotain korvaavaa?" },
            { id: 2, sentAt: at(d(-5), "08:05"), senderName: "Aalto Riikka (AAR)", content: "Kiitos tiedosta! Huomioimme allergian kaikissa ryhmissä, eli pähkinöitä ei käytetä tällä kertaa ollenkaan. Omia aineksia ei tarvitse tuoda, korvaavat hankitaan koulun puolesta." },
            { id: 3, sentAt: at(d(-4), "20:15"), senderName: "Virtanen Mikko (Kiia Virtanen, 8C)", content: "Hienoa, kiitos! Kiia kertoi, että hänen ryhmänsä tekee kaurakeksejä. Tarvitaanko myyjäisiin vanhempia avuksi?" },
            { id: 4, sentAt: at(d(-1), "15:30"), senderName: "Aalto Riikka (AAR)", content: "Apu on tervetullutta! Tarvitsemme kaksi aikuista myyntipöytään klo 17–18. Kerron tarkemmin ensi viikolla, kun aikataulu on vahvistunut." },
          ],
        }
      ),
    }),
    message({
      subject: `Liikunta ulkona koko lokakuun`,
      sender: "Lehtonen Mikko (LEM)",
      sentAt: at(d(-6), "10:02"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        `Hei!\n\nLokakuun liikuntatunnit pidetään ulkona säällä kuin säällä. Huolehdittehan, että mukana on lämmin ja sateenkestävä vaatetus sekä ulkokengät.\n\nMikko Lehtonen`
      ),
    }),
    message({
      subject: `Terveystarkastukset 3. ja 8. luokille`,
      sender: "Virtanen Sari (terveydenhoitaja)",
      sentAt: at(d(-8), "13:30"),
      unreadInWilma: false,
      children: [KIIA, OTSO],
      thread: thread(
        `Hyvät huoltajat,\n\nlaajat terveystarkastukset 3. ja 8. luokille alkavat ${fi(next(d(1), 0, 1))}. Saatte kutsun ja ajan erikseen. Täyttäkää ennen tarkastusta esitietolomake, jonka lähetän Wilmaan lomakkeena.\n\nYstävällisin terveisin\nSari Virtanen, kouluterveydenhoitaja`
      ),
    }),
    // Sent by the family, not answered yet: only in Wilma's Sent folder.
    message({
      subject: "Hammaslääkäri torstaina",
      sender: null,
      sentAt: at(d(-1), "19:05"),
      unreadInWilma: false,
      children: [KIIA],
      sent: true,
      thread: thread(`Hei,\n\nKiialla on hammaslääkäri torstaiaamuna, joten hän tulee kouluun vasta toiselle tunnille.\n\nTerveisin\nMikko Virtanen`, {
        recipients: ["Korhonen Jussi (KOJ)"],
      }),
    }),
    message({
      subject: `Viikkokirje vk ${isoWeek(now) - 1}`,
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(addDays(monday, -3), "14:45"),
      unreadInWilma: false,
      children: [OTSO],
      thread: thread(
        `Hei!\n\nTällä viikolla opettelimme kertotauluja 6 ja 7, luimme yhteistä kirjaa ja ympäristöopissa tutkimme sieniä. Ensi viikolla jatkamme kertotauluja ja aloitamme syksyn taideprojektin.\n\nKiitos kaikille aktiivisesta yhteistyöstä!\n\nLaura`
      ),
    }),
  ];

  const slot = (id: string, date: string, start: string, end: string, extra: Partial<InviteSlot> = {}): InviteSlot => ({
    id,
    start: at(date, start),
    end: at(date, end),
    enrollStart: at(d(-1), "08:00"),
    enrollEnd: at(next(d(1), 0), "16:00"),
    cancelUntil: at(date, "08:00"),
    info: "",
    subject: "",
    maxPeople: 1,
    peopleCount: 0,
    selected: false,
    selectedByOther: null,
    wilmaState: "available",
    canDecline: true,
    declined: false,
    ...extra,
  });
  const talkDay = next(d(7), 1);
  const party = next(d(8), 2);
  messages.push(
    message({
      subject: "Kutsu oppimiskeskusteluun",
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-1), "09:20"),
      unreadInWilma: false,
      children: [KIIA],
      invite: { status: null, extra: null },
      thread: thread(
        `Hei!\n\nKutsun teidät Kiian oppimiskeskusteluun. Keskustelu kestää 25 minuuttia ja pidetään luokassa B204 tai Teamsissa, kumpi teille sopii paremmin.\n\nValitkaa sopiva aika alta.\n\nJussi Korhonen`,
        {
          invite: {
            mustApply: true,
            canDecline: true,
            declined: false,
            slots: [
              slot("1", talkDay, "14:00", "14:25", { peopleCount: 1, wilmaState: "full" }),
              slot("2", talkDay, "14:30", "14:55"),
              slot("3", talkDay, "15:00", "15:25"),
              slot("4", addDays(talkDay, 1), "15:30", "15:55"),
            ],
          },
        }
      ),
    }),
    message({
      subject: `3B:n syysjuhla ${fiDay(party)} – ilmoittautuminen`,
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(d(-6), "12:30"),
      unreadInWilma: false,
      children: [OTSO],
      invite: { status: "Applied", extra: null },
      thread: thread(`Tervetuloa 3B:n syysjuhlaan! Oppilaat esittävät laulun ja näytelmän, ja vanhempainyhdistys järjestää kahvion.\n\nIlmoittautukaa alta.\n\nLaura`, {
        invite: {
          mustApply: true,
          canDecline: true,
          declined: false,
          slots: [slot("1", party, "17:30", "19:00", { maxPeople: 0, peopleCount: 14, selected: true, wilmaState: "selected-cancellable", cancelUntil: at(addDays(party, -1), "12:00") })],
        },
      }),
    })
  );

  const news: NewsRec[] = [
    {
      id: 900,
      title: `Syysloma viikolla ${isoWeek(autumnBreak)}`,
      subtitle: "Koulu on suljettuna syysloman ajan.",
      author: "Rehtori Pekka Salo",
      published: at(d(-12), "09:00"),
      pinned: false,
      children: [KIIA, OTSO],
      detail: { content: `Syysloma on ${fi(autumnBreak)}–${fi(addDays(autumnBreak, 4))}. Koulu alkaa jälleen maanantaina ${fi(addDays(autumnBreak, 7))} lukujärjestyksen mukaan. Iltapäiväkerho on suljettu loman ajan.`, resources: [], fetchedAt: new Date() },
    },
    {
      id: 901,
      title: "Lokakuun ruokalista",
      subtitle: "Kouluruokalan ruokalista ja erityisruokavaliot",
      author: "Ruokapalvelut",
      published: at(d(-7), "08:00"),
      pinned: false,
      children: [KIIA, OTSO],
      detail: { content: "Lokakuun ruokalista on julkaistu koulun verkkosivuilla. Erityisruokavaliot ilmoitetaan terveydenhoitajalle lomakkeella.", resources: [], fetchedAt: new Date() },
    },
    {
      id: 902,
      title: "Lukudiplomi alkaa",
      subtitle: "Kaikille luokille 1–9",
      author: "Kirjasto",
      published: at(d(-15), "12:00"),
      pinned: false,
      children: [KIIA, OTSO],
      detail: { content: "Lukudiplomin kirjalistat on päivitetty. Diplomin voi suorittaa koko lukuvuoden ajan; kirjat löytyvät koulun kirjastosta.", resources: [], fetchedAt: new Date() },
    },
  ];

  const note = (date: string, start: string, end: string, subject: string, typeLabel: string, teacher: string, text?: string): LessonNote => ({
    date,
    start,
    end,
    subject,
    typeLabel,
    typeClass: "",
    teacher,
    note: text ?? null,
  });

  // Today's note, or the last school day's at a weekend: Today shows the recent ones.
  const lastSchoolDay = weekday(now) > 4 ? addDays(now, 4 - weekday(now)) : now;
  const kiiaNotes = [
    note(lastSchoolDay, "08:15", "09:45", "Fysiikka", "Sinulta puuttui opiskeluvälineitä", "Jussi Korhonen", "Laskin jäi kotiin."),
    note(d(-3), "09:10", "10:40", "Englanti", "Positiivinen palaute", "Anna Nieminen", "Erinomainen esitelmä Skotlannista – selkeä ja rohkea esitys!"),
    note(lastMonday, "11:15", "12:45", "Kuvataide", "Selvittämätön poissaolo", "Eeva Lindholm"),
    note(d(-9), "08:15", "09:00", "Matematiikka", "Myöhästyminen", "Jussi Korhonen"),
    // A note on a coming lesson: the calendar reads it (a make-up exam).
    note(addDays(monday, 9), "08:15", "09:45", "Fysiikka", "Tiedoksi", "Jussi Korhonen", "Fysiikan rästikoe tunnin lopussa klo 9.15. Tuo laskin."),
  ];
  const otsoNotes = [
    note(d(-2), "09:00", "09:45", "Matematiikka", "Kotitehtävä tekemättä", "Laura Mäkinen", "Kirjan sivu 34 jäi tekemättä."),
    note(d(-6), "10:15", "11:00", "Ympäristöoppi", "Hyvää työskentelyä", "Laura Mäkinen", "Otso auttoi muita ryhmätyössä ja keksi hienon tavan mitata puun korkeuden."),
  ];

  const exam = (examId: number, date: string, time: string, subject: string, code: string, topic: string, teacher: string, teacherCode: string): UpcomingExam => ({
    examId,
    date,
    time,
    // "Matematiikan koe", "Ruotsin koe": Finnish bends the subject's name.
    name: `${{ Matematiikka: "Matematiikan" }[subject] ?? `${subject}n`} koe`,
    subject,
    subjectCode: code,
    topic,
    teacher,
    teacherCode,
  });

  const kiiaLessons = lessons(KIIA_WEEK, monday);
  const otsoLessons = lessons(OTSO_WEEK, monday, { date: tomorrow, from: "10:00" });

  return {
    version: 1,
    account: { baseUrl: "https://example.inschool.fi", username: "demo", tenantName: "Esimerkkikoulu (sample family)", via: "demo" },
    children: [
      { number: KIIA, name: "Kiia Virtanen", first: "Kiia", color: 0 },
      { number: OTSO, name: "Otso Virtanen", first: "Otso", color: 1 },
    ],
    perChild: {
      [KIIA]: {
        overview: {
          schedule: [],
          upcomingExams: [],
          grades: kiiaFront,
          homework: [
            { date: d(-1), subject: "Matematiikka", subjectCode: "MA_81", homework: "Kertauspaketti s. 1–4", teacher: "Jussi Korhonen", teacherCode: "KOJ" },
            { date: d(-1), subject: "Englanti", subjectCode: "ENA_81", homework: "Unit 3: sanat ja tekstin käännös", teacher: "Anna Nieminen", teacherCode: "NIA" },
            { date: d(-2), subject: "Ruotsi", subjectCode: "RUB_81", homework: "Kpl 5 sanat, kuulustelu torstaina", teacher: "Maria Holm", teacherCode: "HOM" },
          ],
          fetchedAt: new Date(),
        },
        gradebook: {
          fetchedAt: new Date(),
          entries: [
            ["Matematiikka", "MA", "9", ["8+", "9", "9-", "9"]],
            ["Suomen kieli ja kirjallisuus", "ÄI", "9", ["9", "9", "9+", "9"]],
            ["Englanti, A1", "ENA1", "10", ["9", "9+", "10", "10"]],
            ["Ruotsi, B1", "RUB1", "8", ["8", "8+", "8-", "8"]],
            ["Historia", "HI", "9", ["8", "9"]],
            ["Biologia", "BI", "8", ["9", "8"]],
            ["Kuvataide", "KU", "S", ["S", "S"]],
          ].map(([name, code, grade, courses]) => ({
            name: name as string,
            code: null,
            grade: grade as string,
            credits: null,
            date: null,
            children: (courses as string[]).map((c, i) => ({ name: name as string, code: `${code}_${["61", "6LV", "71", "7LV"][i + (4 - (courses as string[]).length)]}`, grade: c, credits: null, date: ["2024-12-20", "2025-05-31", "2025-12-19", "2026-05-29"][i + (4 - (courses as string[]).length)], children: [] })),
          })),
        },
        pastExams: { exams: kiiaPast, fetchedAt: new Date(), v: 2 },
        lessons: kiiaLessons,
        notes: kiiaNotes,
        exams: [
          exam(1, mathExam, "08:15", "Matematiikka", "MA", "Koealue:\nkpl 1–4 Yhtälöt ja niiden ratkaiseminen s. 8–41\nkpl 5–7 Verrannollisuus ja kääntäen verrannollisuus s. 42–66\nkpl 8–9 Prosenttilaskut s. 67–80\nKertaa myös vihon tehtävät ja kertauspaketti s. 1–4.", "Jussi Korhonen", "KOJ"),
          exam(2, next(d(3), 4, 1), "09:10", "Ruotsi", "RUB", "Kappaleet 1–6, sanasto ja preesens", "Maria Holm", "HOM"),
        ],
        syncedAt: new Date(),
      },
      [OTSO]: {
        overview: {
          schedule: [],
          upcomingExams: [],
          grades: [],
          homework: [
            { date: d(-1), subject: "Matematiikka", subjectCode: "MA_3B", homework: "Kertotaulut 6 ja 7, s. 36", teacher: "Laura Mäkinen", teacherCode: "MÄL" },
            { date: d(-1), subject: "Äidinkieli", subjectCode: "ÄI_3B", homework: "Lue kirjasta luku 4 ääneen", teacher: "Laura Mäkinen", teacherCode: "MÄL" },
          ],
          fetchedAt: new Date(),
        },
        pastExams: { exams: otsoPast, fetchedAt: new Date(), v: 2 },
        lessons: otsoLessons,
        notes: otsoNotes,
        exams: [],
        syncedAt: new Date(),
      },
    },
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
    news: Object.fromEntries(news.map((n) => [n.id, n])),
    syncedAt: new Date(),
    firstSyncAt: at(d(-2), "12:00").getTime(),
  };
}
