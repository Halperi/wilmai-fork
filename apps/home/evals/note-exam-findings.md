# Exams inside neutral absence notes

A note like “Kappaleiden 1–3 koe, tee se seuraavalla englanin tunnilla.” contains a
required pupil exam despite its “Ennalta anottu vapaa” category and neutral
tone. Previously the reading returned no guardian action and no dated
event, so neither the feed nor calendar retained the instruction. Tone
alone was never a test of importance.

The note reader now preserves a quoted `nextLessonExam` independently of
guardian action. A Decisions question verifies that the exam is assigned
to this pupil at the next lesson of the note's subject, excluding
cancellation, optional practice and a different subject. The app resolves
the date from that pupil's timetable and requires coverage between the
source lesson and the candidate. Without enough timetable data, the
instruction remains visible with an unconfirmed date and no calendar
entry. The front page and Notes show the instruction; a known date also
reaches Calendar, Exams and Today's glance. A unique original exam of the
same pupil, subject and original day is linked. Later cancellation checks
include the derived dated exam. Previous schedule weeks are retained at
sync rollover so the date does not become unknown on Monday.

This supports the next lesson of the note's own subject. It does not
resolve arbitrary relative expressions or use a different subject's
timetable. The school's category and the note's tone remain unchanged.

## Eval coverage

Three fictional cases were added, with spelling errors in the instruction:

- `note-next-english-exam`: retain the pupil instruction, keep a neutral
  tone and no guardian task, find the next English lesson rather than
  mathematics or a sibling's lesson, link the original exam, and show one
  derived exam consistently across views.
- `note-next-exam-unconfirmed`: retain the same instruction without a
  timetable and avoid guessing a date.
- `note-next-exam-guards`: ordinary absence, a cancelled exam, optional
  practice, and a subject mismatch stay out of this required exam flow.

`expect.noteExam` scores retention and the original words under separately
labelled step checks, plus the absence of a guardian task. Date resolution
and original-exam binding are calendar checks. These extend the previous
guardian-step, tone and calendar checks; a neutral tone is still correct.

Seven deterministic tests cover incomplete week caches, double lessons,
ambiguous originals, changed quotes, confidence filtering, timetable
changes without an AI reread, deduplication with Wilma's exam list, week
rollover, extraction/verification and a later cancellation reaching both
the feed and calendar.

## Results, 9 October 2026

These runs used the cases' earlier wording, reworded on 27 October 2026.

Before the change, all six cloud configurations failed to retain the two
positive instructions. Each passed 21 of 30 checks (70%) on the three new
cases. After the change, each passed all 93 checks across three repetitions
(100%). The additional check confirms that the successfully derived exam
also reaches Exams and Today. No failures are marked as known gaps.

A full one-run matrix covered all 74 cases:

| Configuration | Passed | Note checks | Worse than accepted baseline |
| --- | ---: | ---: | ---: |
| luna-low | 304/313 | 58/58 | 1 |
| luna-medium | 303/313 | 58/58 | 1 |
| gated | 305/313 | 58/58 | 1 |
| gated-sol | 303/313 | 58/58 | 1 |
| sol | 304/313 | 58/58 | 0 |
| checks-all, app default | 311/313 (99.4%) | 58/58 | 0 |

The full matrix exited with a regression failure in alternate configs.
The flagged parents' evening, two-grades bulletin and camp-payment cases
were repeated three times. The low and medium configs then had no baseline
regressions on that subset. Both gated configs continued to fail the
camp-date range check (0/3, versus 2/3 in the accepted baseline).
Those three cases contain only messages or bulletins; their extraction
prompt and schema are byte-for-byte unchanged by this feature. The
remaining gated failure warrants separate investigation; this run does
not establish that it was introduced by the note change.

The app default's remaining full-suite failures are the existing
`full-year-date` calendar check and `tet-week-and-contract` guardian-action
check. Its accepted-baseline comparison reports no regression. Accepted
baselines were preserved.

Detailed generated reports remain in ignored `evals/results/`:
`note-exam-before/`, `note-exam-after/`, `note-exam-full/` and
`note-exam-recheck/`. The root latest matrix is the complete 74-case run.

All 24 deterministic AI tests, the production build and validation of the
74 cases passed. Browser verification used fictional data and confirmed
the source-note link, Finnish/English labels, the original-exam label and
the undated instruction on the front page.

## Cost and rollout

The before/after experiments, full matrix and focused repeats together
used an estimated $0.53 of OpenAI API calls. CLI eval usage is separate from
the installed app's local monthly counter.

The default config used about $0.001 per run of the three new cases and
$0.045 for the full suite. These are test measurements, not monthly cost
forecasts. An instruction adds a verification question in the note's
existing verification call. Ordinary notes use the additional extraction
field but no new verification question when it is null. Timetable date
changes are resolved locally. Cross-item checking may add questions for
derived exams, as it does for other dated events.

Only note reading hashes change for rollout; message and bulletin reading
hashes are preserved. Existing notes will be reread once under the user's
normal budget. The source changes have been built and verified; the
installed desktop binary has not been rebuilt for this change. Live local
model accuracy was not evaluated in this experiment.

## Home attention and wording coverage, 10 October 2026

Outstanding pupil exams now contribute to the home summary's attention
count and appear under “Exams needing attention” / “Huomiota tarvitsevat
kokeet”. “All caught up” is hidden while such an exam is outstanding. This
keeps parent attention independent of a task assigned to the guardian.
The home selection keeps unconfirmed dates, respects the child filter,
orders confirmed dates chronologically and excludes completed or past
dated instructions. Every `expect.noteExam` now also checks home attention.

`note-missed-exam-next-lesson` adds three fictional missed-exam instructions:
“Tee koe ensi tunnilla”, “Teet sen seuraavalla tunnilla” and “Tee se ensi
kerralla”. They cover illness, explained absence and pre-approved leave,
with the subject taken from the source lesson. Each must resolve to that
pupil's first matching lesson and reach Calendar, Exams and Today. An
original entry in Wilma's exam list is not required.

All 25 deterministic AI tests, the production build and validation of all
75 cases pass. Browser checks with fictional verified readings confirmed
the home attention count, the absence of the caught-up message, the same
three dated exams in Calendar and Upcoming Exams, and Finnish unconfirmed
date labels when the timetable is missing. No extraction prompt, question
or schema changed in this follow-up.

Two attempts to run the four exam-note cases through the six-config live
matrix stopped at a 1Password CLI authorization timeout before starting
the eval runner. The new wording case has therefore not been scored with
fresh model outputs. The 9 October results above apply to the original
three cases; they are not measurements of the new wording case. Rescoring
stored outputs from the original three cases with the new home checks
passed all 37 checks for each of the six configs, without new AI calls;
the report is `evals/results/note-exam-home-recheck.json`. No new
baselines were accepted and the installed desktop binary remains unchanged.

## Calendar day panel, 10 October 2026

The calendar included “Fysiikan rästikoe klo 15.20”, but opening it showed
only timetable lessons and Wilma's official exam entries. The day panel
now also reads the calendar's quoted exams, showing their title, exact
time and original instruction above the timetable, with a link to the
teacher's note, message or bulletin. This works after the school day ends,
without a matching subject lesson, and without any timetable lessons.
Uncertain exams retain a suggestion label; dismissed exams remain hidden.

An exam read from an instruction opens its actual exam day, including a
next-lesson date resolved from a different source day. Official exams keep
their existing timetable lesson selection. Two deterministic regression
tests cover future notes absent from the feed, after-school times, pupil
filtering, suggestions and dismissal, original-source links, resolved-day
navigation and official lesson anchors. All 29 AI tests and the production
build passed. Browser verification confirmed the Finnish and English
panel, source-note navigation and the no-lessons case with fictional data.
No AI prompt, question or cache version changed for this display fix.
