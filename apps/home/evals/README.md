# The eval suite

The offline sign-in regressions run with `pnpm test:auth` (also included in
`pnpm test:ai`). They use synthetic sessions and controlled bridge replies,
including the desktop saved-login path, password login and MFA. No native
files, real credentials, Wilma servers or AI services are used. Delayed replies
are released explicitly to check logout, reset and replacement sign-ins.

How well does the app read Wilma? Each case is a small made-up family on a
fixed day (messages, bulletins, teachers' lesson notes, exam marks) with the
answers a parent would call right.

The cases in `evals/cases` are made up. Some more were built from real school
messages: those stay on the developer's computer in `evals/private` (not in
git, since they'd tell which school and classes), and the runner reads them
too when they're there. The baseline scores stay there as well. The runner (`run.ts`) feeds a case
through the app's own code, the same question sets, prompts and calendar
code the app runs, then checks what the app would show:

- **triage**: needs-you as the app shows it (the decisions' first answer
  with the reading's look at the step), the kind and the scope;
- **step**: the guardian's step as read (words its sentence contains, its
  deadline), or none; separately labelled note checks retain a pupil's exam
  instruction without creating a guardian task;
- **tone**: a teacher's note is praise, neutral or a concern;
- **marks**: the mark as the Grades view shows it (kind, "24/25", the share);
- **calendar**: the events the app draws from the reading: events that
  must be there (date, time, kind, whose, in the calendar or only
  suggested), days that must stay empty (for everyone, or for one pupil),
  titles that mustn't appear, and how long an event may be.

## Configurations

A configuration is a way the app can read: who decides (the Decisions
endpoint, or Jev), which model reads and how hard it reasons, and the
strategy (one pass, or a Decisions gate first). They're named in
`configs.json`:

| Config | What |
| --- | --- |
| `luna-low` | Luna reads every item, low reasoning |
| `luna-medium` | Luna, medium reasoning, no extra checks |
| `gated` | a Decisions gate skips items with no date or step; Luna medium reads the rest |
| `gated-sol` | the same, and Sol reads the items the gate calls hard |
| `sol` | Sol 6.1 reads every item |
| `tiered` | the gate, Luna low, a critic, Luna medium when unsure |
| `jev-decides` | Jev decides instead of the Decisions endpoint (needs `JEV_API_KEY`) |
| `choices` | Luna medium; a date asked as a choice among nearby days (the decisions may move it), whose as one choice among the pupils, and "only for those who choose to join" asked on its own (a suggestion at most) |
| `fields` | Luna medium; the time, the step's deadline and the kind each checked on its own (a doubted time or deadline is cleared) |
| `cross` | Luna medium; each later item asked about earlier items' events: cancelled, moved, or the same event again |
| `checks-all` | all three: **the app's default** |

`"matrix": true` puts a config in `--matrix`. **A new model is a new
entry** (its id and prices in `READING_MODELS`, `src/luna/client.ts`), and
`decisionsModel` tries another model for the decisions. `"checks"` turns on
the experiments with more of the decisions (`Settings.lunaChecks`).

## Running

For the first Apple Silicon local profile, see [local intelligence](../docs/local-ai.md).
`pnpm eval:local --config clef-qwen4-q4,clef-qwen4-q4-fast --repeat 3`
downloads models into a private temporary store and deletes that store after the
run, including failures and cancellation. No API key is needed for these two
configs. Local configs are serialized rather than running competing models in
parallel. The helper preserves the installed Ollama service and its models.

`pnpm eval:local --config clef-qwen9-q8-q4 --repeat 1` selects the Medium
pack: Clef-flash Q8 and Qwen3.5 9B Q4, with the same 16K context and 512-token
native reasoning cap. The helper checks the pinned text blob hashes and sizes,
requires 20 GiB free temporary disk space, and removes this pack after the run.
Small and Medium must be evaluated in separate helper invocations. Reports retain
the case snapshot and its SHA-256 so later case edits do not erase the cohort.

The keys come from the environment, never from the repo. With the
1Password CLI, `evals/keys.env` (not in git) holds references, not keys:

```
OPENAI_API_KEY="op://<vault>/<item>/credential"
JEV_API_KEY="op://…"            # only for jev-decides
```

```bash
pnpm eval --check                                                              # the cases are well formed (no keys, no calls)
op run --env-file evals/keys.env -- pnpm eval                                  # luna-low
op run --env-file evals/keys.env -- pnpm eval --config gated --repeat 3        # one config, 3 runs
op run --env-file evals/keys.env -- pnpm eval --matrix --repeat 3              # every matrix config at once, side by side
op run --env-file evals/keys.env -- pnpm eval --only exam-marks,class-list     # some cases
op run --env-file evals/keys.env -- pnpm eval --tag whose,trap                 # the cases with a tag
op run --env-file evals/keys.env -- pnpm eval --model gpt-6.1-sol --effort medium --strategy gated   # ad hoc, no config
```

The models don't answer the same every time: compare with `--repeat 3` or
more. `--matrix` runs each config in its own process at once (a 3-run
matrix takes about as long as one config's 3 runs).

Reports go to `evals/results/` (not in git): `latest-<config>.md` with every
check (✓ every run, ~ some runs, ✗ none, with what the app showed when it
failed) and every event drawn; `latest-matrix.md` with the configs side by
side: pass rates by task and tag, cost a run, seconds a case (median and
90th percentile), the checks that tell the configs apart, and the checks
every config fails (often a case to look at again).

## Baselines: what changed when something changed

`baselines/<config>.json` (in git) holds each check's pass rate from a
run we accepted. Every later run of that config is compared with it: a
check passing clearly less often (by more than one run in three) is
**worse**, clearly more often **better**; the report lists both.

```bash
op run --env-file evals/keys.env -- pnpm eval --matrix --repeat 3 --save-baseline   # run, and accept these results
pnpm eval --matrix --accept                                                         # or accept the latest results afterwards (no calls)
op run --env-file evals/keys.env -- pnpm eval --matrix --repeat 3 --fail-on-regression --fail-under 0.95
```

`--fail-under 0.95` exits with 1 when a config passes fewer than 95 % of
its checks; `--fail-on-regression` when any check got worse than its
baseline. Save a new baseline after a change you've accepted, and commit
it with the change.

**Trying a new model:** add it to `READING_MODELS` and a config to
`configs.json`, run `--config <it> --repeat 3`, and read its report next
to `latest-matrix.md`: the pass rates by task and tag, the cost a run and
the time. Then the replay (below) for what a month of real mail costs.
**Changing a prompt or a question set:** run the matrix with
`--fail-on-regression`; the worse checks say what broke.

## Thresholds and calibration (no calls)

The results keep every reading and decision with its probabilities, so the
same answers can be scored again with other thresholds (`LUNA_THRESHOLDS`,
`src/data/model.ts`: where an event is sure, a suggestion or left out, and
where a later item's word removes one).

```bash
pnpm calibrate                                  # the newest results of every config
pnpm calibrate --config luna-medium,checks-all
```

The report (`results/calibration-latest.md`) tunes the thresholds on one
half of the cases and scores them on the other (only a gain that holds
there counts), and shows how often each probability band was right: an
event the cases call right or wrong, a step required or not, needs-you,
a later item removing an event.

## Replaying a real inbox

The cases are dense with dates on purpose. To see what a strategy costs and
how it routes on ordinary mail, `replay.ts` runs the reading over the
family's own material (the app's export, see below) with each strategy and
compares them with each other; there are no right answers there. The
report (`evals/results/replay-latest.md`) holds the family's subjects, so it
stays out of git.

```bash
op run --env-file evals/keys.env -- pnpm replay --classes Aino=9C,Veeti=7G                 # the matrix configs
op run --env-file evals/keys.env -- pnpm replay --classes Aino=9C,Veeti=7G --config gated  # some
```

It projects a single-pass month's cost from the family's last 30 days
(the reading and the decisions), compared with the app's recorded
monthly budget (default $2; adjustable from $1 to $5). Rereading and additional calls are excluded; this
benchmark does not establish typical monthly spending. User-facing
guidance is to plan for a few euros a month, depending on usage.

## Adding a case

**Every reading bug gets a case**, before or with its fix, so it stays
fixed. A case is one JSON file in `cases/`:

The `note-next-english-exam`, `note-next-exam-unconfirmed`,
`note-next-exam-guards` and `note-missed-exam-next-lesson` cases cover an exam instruction inside a neutral
pre-approved absence, including spelling errors (“englanin”, “tunilla”).
`expect.noteExam` checks that the instruction remains important, its
original words survive, it reaches home attention, and it does not become
a guardian's task. The missed-exam case also covers “ensi tunnilla”,
“seuraavalla tunnilla” and “ensi kerralla” across three absence categories,
without needing the subject repeated in the instruction. Its
`date` may be `null` (unconfirmed) or a date resolved from the pupil's
timetable; `originalExam` checks an unambiguous link to a Wilma exam ID.
`lesson` items provide that timetable with `pupil`, `date`, `start`, `end`,
`subject` and `subjectCode`. Calendar expectations check the derived exam
also reaches Exams and Today. Tone expectations stay independent.

```json
{
  "id": "makeup-exam-note",
  "added": "2026-10-08",
  "why": "What went wrong, or the pattern this guards (shown in the report).",
  "tags": ["note", "time", "whose"],
  "gap": "Optional: something known not to work yet (reported, not counted).",
  "today": "2026-10-08",
  "pupils": [{ "name": "Aino Esimerkki", "class": "9C" }],
  "items": [
    { "type": "message", "id": 1, "sent": "2026-10-02T14:00", "from": "…", "subject": "…", "text": "…", "pupils": [0] },
    { "type": "news", "id": 2, "published": "2026-09-28T09:00", "from": "…", "title": "…", "text": "…", "pupils": [0] },
    { "type": "note", "id": 3, "pupil": 0, "date": "2026-10-23", "start": "14:00", "end": "15:45", "subject": "Fysiikka", "kind": "Tiedoksi", "teacher": "…", "text": "…" },
    { "type": "mark", "id": 4, "pupil": 0, "date": "2026-09-24", "subject": "Ruotsin kieli, B1", "name": "Verbikoe 2", "grade": "24", "info": "Pisteet /25p." }
  ],
  "expect": {
    "triage": [{ "item": 1, "needs_action": true, "kind": ["event"], "scope": ["school", "group"] }],
    "action": [{ "item": 1, "quote": "Ilmoittauduthan", "deadline": "2026-10-16" }],
    "tone": [{ "item": 3, "tone": "neutral" }],
    "marks": [{ "item": 4, "kind": "points", "text": "24/25", "share": [0.95, 0.97] }],
    "calendar": {
      "events": [{ "date": "2026-10-23", "start": "15:20", "kind": "exam", "pupil": 0, "sure": true }],
      "not": [{ "date": "2026-10-09", "note": "a make-up day" }, { "date": "2026-10-21", "pupil": 1 }],
      "titlesNot": ["^Torstai$"],
      "maxDays": 7
    }
  }
}
```

- Write the texts like the school did, but **made up**: no real names, no
  children's details, the school and the people renamed. Keep the pattern
  that broke (the capital "Klo", the passive request, the table by class,
  the quoted older message). The app writes the family's own material to
  `~/Library/Application Support/ai.wilm.home/luna-material.json` (every
  item with what was read from it) to find such patterns; it stays there.
- Give pupils their class (`"class": "9C"`): the readers are told it, and
  "9. lk" or "8A" events depend on it.
- Expect only what a parent would call right; leave out what's a matter of
  taste (an optional concert may or may not be in the calendar).
- `not` days allow suggestions unless `"suggestions": false`; `sure: true`
  means in the calendar, not only suggested.
- A step's `quote` is matched as written: Finnish bends words ("lomake",
  "lomakkeen"), so pick a word as it stands in the text.
- Pupils are numbered from 0 in `pupils`; ids are any numbers unique in the
  case.
- A mark's `kind` can list the kinds a parent would accept (`["points",
  "scale"]` for "88 %"); a `not` day can name a kind (`"kind": "exam"`: no
  exam that day, other events allowed) and a time (`"start": "17:30"`: not
  at the old time); `atMost` (`{ "date", "max": 1, "pupil", "kind" }`)
  says the same event from two items shows once.
- Several items in a case are read as the app reads them, each alone, then
  together (`cross`): a later message can cancel, move or repeat an earlier
  item's event. Give them their own sending times.
- Tag it with what it tests, from the tags in use (`pnpm eval --check`
  lists them): dates (`relative-date`, `weekday-date`, `week-number`,
  `full-year`, `subject-date`, `year-boundary`, `range`, `time`, `list`,
  `table`), steps (`step`, `no-step`, `polite`, `deadline`, `optional`),
  `whose`, traps (`trap`, `past`, `quoted`, `recurring`), `note`, `tone`,
  `marks`, `holiday`, `newsletter`, `long`, `language`, `cross-item`,
  `duplicate`; `real-pattern`
  when the pattern came from a real inbox.
- Run `pnpm eval --check`, then the case with `--only <id> --repeat 3` on
  a config or two, then the matrix and `--accept` (the new checks have no
  baseline yet).
- When every config fails a new check, look at the case before the app:
  the results JSON keeps each case's readings (every event with its
  probabilities and whose it was judged to be).

## Reading the numbers

Compare runs of the same cases: a change to a prompt, a question set or a
model is better when it passes more checks without breaking others, at a
cost and a speed we can live with. The cases are dense with dates and
traps on purpose, so the share passed is a floor; the replay says what
ordinary mail costs. The in-app comparison (Settings → Compare with Jev)
is a third view: how often Luna answers like Jev did on the family's real
inbox, which needs no right answers but can't say who's right.
