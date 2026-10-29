/*
 * Test Wilmas, for trying the family's Wilmas (data/logins.ts) by hand in a development build: two pretend schools
 * in the school search ("testi"), answered here in memory with wilma-client's anonymised real pages. Nothing goes to
 * the network, and their sessions aren't saved in WilmAI's shared session file. Release builds leave this out.
 *
 *   Testikoulu Pohjoinen: huoltaja / testi — Aino (listed twice: a new school's profile and the old one's) and Veeti;
 *                         oppilas / testi — Aino's own login (a student's)
 *   Testikoulu Etelä:     huoltaja / testi — Eino
 *
 * Each login has one live session, as in Wilma: signing in again ends the last one. Writing (messages, absence
 * reports, sign-ups) isn't answered.
 */
import type { WilmaTransport } from "@wilma-client/src/core";
import overview from "@wilma-client/test/fixtures/real/overview.json?raw";
import timetable from "@wilma-client/test/fixtures/real/timetable.json?raw";
import messagesList from "@wilma-client/test/fixtures/real/messages-list.json?raw";
import appointments from "@wilma-client/test/fixtures/real/appointments-list.json?raw";
import messageThread from "@wilma-client/test/fixtures/real/message-thread.json?raw";
import newsList from "@wilma-client/test/fixtures/real/news-list.html?raw";
import newsDetail from "@wilma-client/test/fixtures/real/news-detail.html?raw";
import attendance from "@wilma-client/test/fixtures/real/attendance.html?raw";
import examsCalendar from "@wilma-client/test/fixtures/real/exams-calendar.html?raw";
import studentHome from "@wilma-client/test/fixtures/real/student-home.html?raw";

type Request = Parameters<WilmaTransport>[0];
type Answer = Awaited<ReturnType<WilmaTransport>>;

interface TestLogin {
  password: string;
  role: "guardian" | "student";
  children: { number: string; name: string }[];
}

const SCHOOLS: Record<string, { name: string; logins: Record<string, TestLogin> }> = {
  "pohjoinen.wilmai.test": {
    name: "Testikoulu Pohjoinen",
    logins: {
      huoltaja: {
        password: "testi",
        role: "guardian",
        children: [
          { number: "1001", name: "Aino Esimerkki" },
          { number: "1003", name: "Aino Esimerkki" },
          { number: "1002", name: "Veeti Esimerkki" },
        ],
      },
      oppilas: { password: "testi", role: "student", children: [{ number: "1001", name: "Aino Esimerkki" }] },
    },
  },
  "etela.wilmai.test": {
    name: "Testikoulu Etelä",
    logins: { huoltaja: { password: "testi", role: "guardian", children: [{ number: "2001", name: "Eino Esimerkki" }] } },
  },
};

/** The live session of each login, by school and username. */
const alive = new Map<string, { sid: string; user: string }>();
let sids = 0;

const answer = (status: number, body = "", headers: Record<string, string> = {}, setCookies: string[] = []): Answer => ({ status, headers: new Headers(headers), setCookies, body });
const json = (text: string) => answer(200, text, { "content-type": "application/json" });

/** The timetable's week moved to the weeks asked for, on the same weekdays. */
function timetableFor(from: string | null, to: string | null): string {
  const data = JSON.parse(timetable) as { payload: { dates: string[] }[] };
  if (!from || !to) return timetable;
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const weekday = (iso: string) => (day(iso).getUTCDay() + 6) % 7;
  const monday = day(from);
  monday.setUTCDate(monday.getUTCDate() - weekday(from));
  for (const lesson of data.payload) {
    const dates: string[] = [];
    for (const old of lesson.dates) {
      for (let week = new Date(monday); iso(week) <= to; week.setUTCDate(week.getUTCDate() + 7)) {
        const date = new Date(week);
        date.setUTCDate(date.getUTCDate() + weekday(old));
        if (iso(date) >= from && iso(date) <= to) dates.push(iso(date));
      }
    }
    lesson.dates = dates;
  }
  return JSON.stringify(data);
}

/** One exchange with a test Wilma. */
export async function testWilma(req: Request): Promise<Answer> {
  const url = new URL(req.url);
  const school = SCHOOLS[url.hostname];
  if (!school) return answer(404);
  if (url.pathname === "/login" && req.method === "GET") return answer(200, '<input type="hidden" name="SESSIONID" value="s">');
  if (url.pathname === "/login") {
    const form = new URLSearchParams(req.body ?? "");
    const user = (form.get("Login") ?? "").toLowerCase();
    const login = school.logins[user];
    if (!login || login.password !== form.get("Password")) return answer(303, "", { location: "/?loginfailed" });
    const sid = `test-${(sids += 1)}`;
    alive.set(`${url.hostname}|${user}`, { sid, user });
    return answer(303, "", { location: "/" }, [`Wilma2SID=${sid}; Path=/; HttpOnly`]);
  }
  const sid = /Wilma2SID=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  const session = [...alive].find(([key, s]) => key.startsWith(`${url.hostname}|`) && s.sid === sid);
  if (!session) return answer(302, "", { location: "/login" });
  const [key, { user }] = session;
  const login = school.logins[user];
  if (url.pathname === "/logout") {
    alive.delete(key);
    return answer(303, "", { location: "/" });
  }
  const front = '<html><form id="logout-form" action="/logout"><input name="formkey" value="test"></form></html>';
  if (url.pathname === "/") return answer(200, front, { "content-type": "text/html" });
  if (url.pathname === "/api/v1/accounts/me/roles") return json(JSON.stringify({ payload: login.children.map((c) => ({ type: login.role, slug: `!${c.number}`, name: c.name })) }));
  const page = url.pathname.replace(/^\/![^/]+/, "");
  if (page === "/overview") return json(overview);
  if (page === "/api/v1/schedules/timetable") return json(timetableFor(url.searchParams.get("startdate"), url.searchParams.get("enddate")));
  if (page === "/messages/list") return json(messagesList);
  if (page === "/messages/list/outbox") return json('{"Messages":[]}');
  if (page === "/messages/list/appointments") return json(appointments);
  if (/^\/messages\/\d+$/.test(page)) return json(messageThread);
  if (page === "/news") return answer(200, newsList, { "content-type": "text/html" });
  if (/^\/news\/\d+$/.test(page)) return answer(200, newsDetail, { "content-type": "text/html" });
  if (page === "/attendance/view") return answer(200, attendance, { "content-type": "text/html" });
  if (page.startsWith("/exams/calendar")) return answer(200, examsCalendar, { "content-type": "text/html" });
  if (page === "/" || page === "") return answer(200, studentHome, { "content-type": "text/html" });
  return answer(404);
}
