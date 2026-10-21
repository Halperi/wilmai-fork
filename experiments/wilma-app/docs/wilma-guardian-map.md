# Wilma for guardians: what's there (Helsinki, 6 Oct 2026)

Read with a guardian session, without opening unread messages or submitting
anything. `<n>` is a student number or an id. Every page is per child
(`/!<n>/…`), and the child is switched from a menu in the top right.

## Front page per child (`/!<n>/`)

Messages ("no new messages" + write new), notices (Ilmoitukset), a month
calendar, today's timetable with rooms, **current courses with each course's
latest homework** and a message-the-teachers link, upcoming exams, the
child's class and supervisors with message links ("message all supervisors",
"message all the child's teachers"), recent bulletins in full, school links.
Data: `POST /!<n>/overview` (JSON), the rest server-rendered.

## Menu

| Section | Path | Use | In the app |
| --- | --- | --- | --- |
| Viestit (messages) | `/messages` + tabs: archive, outbox, drafts, **appointments** (Tapahtumakutsut) | daily | inbox yes; appointments, sent: no |
| Uusi viesti | `/messages/compose?r_teacher=<id>` / `r_groupteachers` / `r_ownteachers` | weekly | no (reply only) |
| Työjärjestys | `/schedule?date=…` (+ printable) | daily | yes |
| Tuntimerkinnät: Selvitä | `/attendance`: lists only notes still needing a reason | when it happens | link out |
| Tuntimerkinnät: Tarkastele | `/attendance/view?range=…` | weekly | yes |
| Tuntimerkinnät: **Ilmoita poissaolosta** | `/attendance/report` | often (sick days) | no |
| Kokeet | `/exams/calendar`; past: `/exams/calendar/past?range=-3&first=d.m.yyyy&last=d.m.yyyy` (default: this school year; reaches back as far as the school keeps exams) | weekly | upcoming in Exams; past with grades in Grades |
| Suoritukset | `/gradebook` | a few times a year | Grades |
| Arviointikeskustelut | `/assessments` | once or twice a year | leave in Wilma |
| Tuki | `/specedu` (support plans) | rare, sensitive | leave in Wilma |
| Hakemukset ja päätökset | `/decisions`, forms `/forms/<id>/new?sid=<n>` (e.g. short leave from school, school-trip support) | a few times a year | link out |
| Tulosteet | `/printouts` (PDF) | rare | leave in Wilma |
| Kyselyt | `/feedback` | rare | leave in Wilma |
| Tiedotteet | `/news` (pinned + older) | weekly | yes |
| Opettajat / Henkilökunta / Huoneet | `/profiles/…` with compose links | occasional | recipients for new messages |
| Lomakkeet | `/forms` (basic info and consents, diet, contacts, computer terms…) | rare | leave in Wilma |
| Ilmoitusasetukset | `/preferences/communication` (e-mail/SMS: immediate or collected) | once | leave in Wilma |

## Write flows seen (structure only)

- **Reply**: open discussion `POST /!<n>/messages/collatedreply/<id>`
  (`formkey`, `wysiwyg`, `quickbtn`, `bodytext`); private answer
  `POST /!<n>/messages/compose` (`formkey`, `wysiwyg`, `replyid`, `Subject`,
  `r_teacher`, `BodyText`, `addsavebtn`).
- **New message**: `GET /!<n>/messages/compose?r_teacher=<id>` gives the form
  with the recipient filled in; fields `formkey`, `wysiwyg`, `Subject`,
  `BodyText`, `ShowRecipients`, `CollatedReplies`, send `addsavebtn`
  (never `draftbtn`/`cancelbtn`).
- **Absence report**: `POST /!<n>/attendance/savereport` with `formkey`,
  `ReportDate` (day number Wilma fills in: today until 12:00, tomorrow after),
  `type` (reason; Helsinki offers one: `83` = Terveydellinen syy), `text`
  (details), `savebtn`. "The report is shown to teachers in Wilma."
- **Explaining absences**: on `/attendance`; its form only appears when
  something needs a reason (not seen yet). The empty page says only "Miksi
  tämä sivu on tyhjä?" (no marker to read).

## Seen 7 Oct 2026 (for wilma-client 1.7)

- Message forms say `wysiwyg=ckeditor`: Wilma's editor posts the body as
  HTML. The compose form also has a `select_recipients` button (no type, so
  a submit button) and shows recipients as `.recipient-item` (hidden `r_…`
  input + name). ShowRecipients/CollatedReplies are unchecked unless the
  link says `showrecipients=1&collatedreplies=1`.
- A private message's page links "Vastaa viestin lähettäjälle"
  (`compose?replyid=<id>`) next to "Välitä viesti edelleen"
  (`…&forward`). Message JSON has `AllowReply` and `AllowForward`.
- Front page "Huollettavasi tiedot": name, class, class teacher
  (Ryhmänohjaaja/Luokanvalvoja) and other supervisors with
  `compose?r_teacher=` links, plus "message all supervisors"
  (`r_teacher` repeated) and "all the child's teachers" (`r_ownteachers`).
- `/messages/recipients` is a fragment for a dialog: `button.recipient-block`
  with the compose link in `data-source`, per panel (the child `r_student`,
  other guardians `r_guardian`, own teachers `r_ownteachers`; per school tab
  staff `r_personnel` and teachers `r_teacher`). Own teachers one by one load
  from `/messages/recipients/ownteachers/<id>`.
- Invitation slots: State `selected`, `selected-other` (SelectedOther names
  the other guardian) or `expired`; EventData is sometimes an object, not a
  string. The invitation page's form key is in `#msg-action-form`.
- Form keys are per child (and one for the account pages), the same in
  every form on a page.
- **Event invitations** (`/messages/list/appointments`, JSON like the inbox):
  e.g. a parents' evening "(ilmoittautuminen)" with a date and time.

## How Wilma presents it

Every list is a flat table of equal rows (60+ messages, newest first), and
city webinars sit next to a teacher's note about your child. One child at a
time. Course codes ("MT_ Maantieto MT_7LV") everywhere. Write actions sit in
separate tabs and pages. A cookie banner on every visit.
