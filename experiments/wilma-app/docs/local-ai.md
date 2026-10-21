# Local intelligence: opt-in Apple Silicon pack

Home can run all intelligence locally: sorting, tone, marks, action and calendar
extraction, field verification and cross-item changes. The first model profile is
Clef-flash Q4_K_M plus Qwen3.5 4B Q4_K_M. It is experimental; the 16 GB memory
target needs measurements on a 16 GB Mac, not just a larger development machine.

## Settings and data

Settings → WilmAI Intelligence offers **No AI**, **OpenAI** (recommended) and
**Local AI**. On a computer that can't run it (not an Apple Silicon Mac with
16 GB of memory, or a Windows/Linux build), Local AI is greyed out with the
reason. Existing users with a saved OpenAI key retain
OpenAI until they choose another mode. No AI disables new automatic sorting,
actions/deadlines, dates from text, tone and grade interpretation; ordinary Wilma
features and earlier cached AI results remain available.

The consumer app offers only Small: Clef-flash 9B Q4_K_M and Qwen3.5 4B Q4_K_M.
Medium remains an evaluation profile, not a Settings option: its 1.8 percentage
point gain on shared checks did not justify a 42% slower median. Large is excluded.
The evals measured about 90% versus 99% shared check pass rates and 36 versus 4 second
median processing on the 48 GB MacBook; Settings and the website only say it's slower
and makes more mistakes, dates especially. These are single-pass, preliminary results
on 71 shared cases, with changed prompts between runs. Calendar dates and deadlines
show the largest gap. The 16 GB Mini remains untested.

**Download models and turn on** is the only download trigger. The app bundles
llama.cpp b11535, its Metal libraries and the pinned Qwen template; end users need
no Ollama, Homebrew, Python or Node. Models total 9,135,041,504 bytes and live in
`~/Library/Application Support/ai.wilm.home/local-ai`, outside the app bundle.
Progress and disk-space checks precede enablement. Interrupted transfers resume
on retry; pinned sizes and SHA-256 hashes must pass before atomic completion.
Cancellation removes an unfinished installation; a completed pack stays until
**Remove models** is clicked. Removal touches only Home's owned model directory,
never the user's Ollama store. Leaving Settings does not interrupt setup.
On app restart, incomplete setup requires another explicit setup click.

Synthetic decision and schema-constrained extraction probes must pass before
school-data inference is enabled. Cancellation, account changes or selecting a
different provider cannot enable a late setup result. OpenAI and local control both
model roles, with no mixed routing or cloud fallback. A saved OpenAI key stays on
the device and is never passed to the local runtime. Downloads contain no school
material; inference stays on an authenticated loopback worker. Wilma still connects
to the school normally.

The native backend adapts the Ollama-shaped internal contract directly to the
bundled native decision and chat endpoints. `http://127.0.0.1:0` is a reserved IPC
origin, never an HTTP destination. Historical isolated evals retain an external
Ollama-compatible transport. Both transports restrict local origins/routes and
bypass proxies and redirects for inference. Runtime/model digests, endpoint,
thinking mode, context and provider are part of cache identity. Changing providers
reprocesses items instead of reusing another model's probabilities.

OpenAI guidance is "usually tens of cents a month" for a family, from Antti's own
use (tens of cents a month even while testing constantly). The 74-case Luna pass cost $0.04495; live re-reading and larger histories
can increase spending. The $0.50–$3 monthly pause limit (default $1) and 80%
warning remain. Current [GPT-6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
is $0.10 input, $0.01 cached input and $0.50 output per million tokens;
Decisions uses input-only billing.

Every local inference request shares one queue. Sorting runs first, then exam
maximum extraction, then all message extraction, then all field verification and
cross-item decisions. Switching models explicitly unloads the previous Home model;
finishing a reading releases the final model. The worker is killed on disable/removal/normal exit, and a private parent guard
also kills and reaps it when the app crashes. Unverified readings are not published.

Decision questions are batched at 64 questions or 60 KiB, whichever comes first.
Choices have 1–26 options; scores have 2–10 levels. One question that cannot fit
fails explicitly. Extraction uses schema-constrained
JSON, checks the schema again, limits output, and conservatively rejects inputs
that could exceed the bounded context rather than silently dropping text. Existing
quote grounding and calendar validation remain in use.

## Evaluating without leaving model downloads behind

Run from `experiments/wilma-app`:

```sh
pnpm test:ai
pnpm eval --check
pnpm eval:local --config clef-qwen4-q4,clef-qwen4-q4-fast --repeat 3
```

`eval:local` creates its own random loopback port and temporary model directory.
On Apple Silicon it downloads a pinned test runtime: Ollama 0.40.2 with upstream
llama.cpp b11535 (`f39148a95`), verifying the release archives' SHA-256 hashes.
The test supervisor calls llama.cpp's native `/v1/systemone` for Clef and native
`/v1/chat/completions` for Qwen, translating the latter to the app's Ollama-shaped
contract. Ollama only downloads models and supplies metadata. The supervisor
does not swap libraries inside the user's Ollama app. It waits for a worker to
exit before loading the other model, omits unused vision projectors, disables
the prompt RAM cache and context shifting, and uses Qwen prompt batches of
2048/512 tokens. Qwen uses its official Jinja template from commit
`851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`, verified with SHA-256
`a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715`.
Thinking is bounded to 512 tokens within the 4096-token total output budget;
disabling thinking skips that phase. The runtime, template and budget belong to
the result's fingerprint, since changing them can change accuracy.
It disables Ollama cloud inference, limits resident models and parallel requests
to one, downloads the selected pack's weights and creates the Qwen alias there. It never calls the
installed Ollama service or modifies its model store. Success, failure, SIGINT
and SIGTERM stop child processes and remove the entire temporary directory,
including this downloaded runtime. Local evals also save an atomic
`progress-<configuration>.json` checkpoint after every case, so completed
readings and decisions survive an interruption. The final checkpoint is marked
complete after the full report has been written.
Existing user models are preserved. A forced kill or power loss can leave a
`wilmai-local-eval-*` directory in the system temp directory; remove that directory
only after its private Ollama process has stopped.

An optional runtime passed with `--runtime /path/to/ollama` belongs to the caller and is not deleted by
the helper. If downloading a runtime just for testing, remove that runtime folder
afterwards too. Do not update the user's installed application just to run evals.

Reports remain in git-ignored `evals/results/`. They record model digests, runtime
version, checks, latency and calibration inputs. `local-hardware-latest.json`
records host RAM, peak combined runtime process-tree RSS, peak runtime-reported
loaded model bytes, number of loaded models, swap before/after, and successful cleanup.
Native worker entries report weight-file bytes, excluding KV and compute
buffers. RSS can double-count shared
mappings; neither metric alone proves a 16 GB fit. Measure
memory pressure and responsiveness on the Mini before declaring it supported.

The supervisor lifecycle test uses a tiny fake executable, without downloading
models. It checks that native extraction carries the schema and reasoning
budget, that context shifting and the RAM cache are disabled, that a conflicting
model cannot be loaded, and that unloading waits for process exit before a
replacement starts. The real eval then checks this contract against both models.

Configurations:

- `clef-qwen4-q4`: all local, thinking enabled.
- `clef-qwen4-q4-fast`: all local, thinking disabled.
- `clef-qwen9-q8-q4`: Medium, Clef-flash Q8 and Qwen3.5 9B Q4, bounded thinking.

The isolated helper selects the pack from the configuration and verifies its
exact text blob hashes and sizes. Medium needs at least 20 GiB free temporary
disk space. Each helper invocation serves one pack and writes a profile-specific
hardware report (`local-hardware-small.json` or `local-hardware-medium.json`) in
addition to the latest hardware report. Eval artifacts retain the case snapshot
and its SHA-256. Both Qwen sizes use the same verified official template bytes;
each download URL is pinned to its model repository's revision.

The provider is an exclusive choice: fully local or fully cloud. Per-role model
fields cannot select local inference while the other role uses cloud inference,
and the eval runner rejects mixed-provider configurations. Local configurations
need no `OPENAI_API_KEY` and run serially, including when several are requested. Compare against the
Luna `checks-all` baseline; do not accept a new baseline automatically. JSON
validity is not extraction accuracy, and Clef probabilities require independent
calibration on the Wilma cases.

Keep confidence and probability distinct. The native choice confidence is the
TypeSafe formula `(p_max - 1/n) / (1 - 1/n)`, floored at zero; it is not simply
the top option's probability ([upstream implementation](https://github.com/ggml-org/llama.cpp/blob/b11535/tools/server/server-decision.cpp)).
For example, the initial fast run chose `pass_fail` for the swimming mark `S`
with probability 0.565 but confidence 0.493. The app's 0.5 confidence gate then
displayed the original mark without classifying it. Distinguish this conservative
display choice from a wrong winning option when investigating accuracy. Preserve
the API's confidence rather than replacing it with a probability to improve a
few eval checks; tune any display policy on held-out cases.

## Runtime compatibility

Ollama's decision API requires 0.35.1 or later. Metadata checks alone do not establish that
the selected runtime can load a model: Home also runs synthetic decision and JSON
extraction probes before enabling local AI. In initial testing, Ollama 0.40.2
failed to load both the Clef alias and original GGUF: its bundled llama.cpp
reported an unknown `clef` architecture. Ollama 0.35.1 also failed with the alias.
Simply replacing Ollama's engine also fails because its older scoring interface
differs from upstream's native decision interface. The isolated test supervisor
therefore uses the native System One endpoint for Clef. Its results must be
identified as that test pack, not stock Ollama compatibility. These setup
failures are not model accuracy results. The application checks capabilities
and actually probes inference rather than trusting version numbers alone.

## MacBook results, 9 October 2026

Test host: Apple M4 Pro, 48 GiB RAM. Both local runs used a fixed 71-case
snapshot, once per case, with Q4_K_M weights and every field/cross-item check.
The checkout subsequently gained three next-lesson-exam cases and updated note
instructions; these benchmark results do not cover those newer cases or prompts.
Before the Medium run, the source passed 27 AI tests and validated all 75 case files offline.

| Profile | All checks | Calendar | Median / p90 per case | Runtime errors |
| --- | ---: | ---: | ---: | ---: |
| Clef native + Qwen Ollama, thinking off | 243/276 (88.0%) | 123/147 (83.7%) | 19.1 / 35.2 s | 0 |
| Both native, reasoning budget 512 | 250/278 (89.9%) | 128/149 (85.9%) | 36.3 / 56.2 s | 0 |
| Luna `checks-all` baseline, 8 October | 794/801 (99.1%) | 410/414 (99.0%) | 4.9 / 8.0 s | 0 |

The Luna baseline is 70 cases × 3 runs, rather than the local 71 × 1. Some
display checks are conditional on retaining an event, so the check counts also
differ. These are preliminary results, not a matched release comparison. Both
local profiles incurred zero cloud API cost. On 273 shared check labels, the
native bounded profile improved 11 and regressed 6 relative to the initial fast
profile. The Qwen engine and template changed along with thinking; this does
not isolate the effect of reasoning alone.

Native bounded reasoning fixed the exam-week list, tomorrow's delayed start,
the photo-permission deadline and the trip's permission step. It still missed
several calendar items, misread a photo timetable, and assigned an optional
club offer a required step. Finnish mark classification and one concern tone
also remained below the cloud baseline. Simply retuning the fast run's calendar
thresholds gave no held-out gain (+0 in one half, -1 in the other); no thresholds
were changed and no new baseline was accepted.

Stock Ollama thinking exhausted the 4096-token output limit on the first case,
including a retry. That run was stopped, so it has a diagnostic rather than an
accuracy score. The subsequent native 512-token profile completed all cases.

The final native run measured a peak combined runtime process-tree RSS of
13,019,955,200 bytes (12.1 GiB), with at most one resident model. Machine-wide
swap usage was unchanged at 4311.94 MiB; it was already in use before this run.
RSS includes shared mappings and excludes the frontend and evaluation process;
it does not establish a 16 GiB Mac Mini fit. Mini testing is deferred until the
user has prepared that machine.

Cleanup was verified: no test runtime processes or temporary model directories
remain, and both pre-existing DeepSeek models in the installed Ollama service
retain their original digests and sizes. Only source, screenshots and reports
remain. Saved evidence is in `evals/results/` (git-ignored):

- `2026-10-09-19-32-clef-qwen4-q4-fast.json` and `.md`
- `2026-10-09-20-13-clef-qwen4-q4.json` and `.md`
- `local-thinking-ollama-diagnostic.json`
- `local-hardware-latest.json` and `local-cleanup-audit.json`
- `calibration-latest.md`

The Settings opt-in and provider plumbing are a source prototype, not a
published one-click local installation. Keep this profile experimental. Before
delivery, compare native fast and bounded reasoning on the same current
snapshot with repeated runs, investigate the remaining reader errors and Clef
calibration on held-out cases, then measure actual Mini memory pressure.

The next delivery phase is an app-managed, signed llama.cpp sidecar with pinned,
verified model downloads, progress, cancellation and removal controls. Keep the
provider contract independent of Ollama so this can reuse the same business logic
and eval cases.

## Accuracy gaps and recommended packs, 10 October 2026

Medium completed one 75-case pass: 318/342 checks (93.0%), no runtime errors,
and no cloud API calls. It uses Clef-flash 9B Q8_0 with Qwen3.5 9B Q4_K_M,
native llama.cpp b11535, 16,384-token context, 512 reasoning tokens within a
4096-token total output limit, and one resident worker.

The saved Small run covers 71 cases and passes 250/278 (89.9%). The newer Luna
run covers 74 cases and passes 311/313 (99.4%); the accepted 70-case, three-run
Luna baseline remains 99.1%. These full totals have different denominators.
The following comparison uses 276 shared check labels across 71 common cases:

| Task | Small | Medium | Luna |
| --- | ---: | ---: | ---: |
| Sorting / needs attention | 49/51 (96.1%) | 50/51 (98.0%) | 50/51 (98.0%) |
| Required action / deadline | 46/48 (95.8%) | 45/48 (93.8%) | 48/48 (100%) |
| Teacher tone | 13/14 (92.9%) | 13/14 (92.9%) | 14/14 (100%) |
| Marks | 14/16 (87.5%) | 15/16 (93.8%) | 16/16 (100%) |
| Calendar | 126/147 (85.7%) | 130/147 (88.4%) | 146/147 (99.3%) |
| All shared checks | 248/276 (89.9%) | 253/276 (91.7%) | 274/276 (99.3%) |
| Shared-case median / p90 | 36.3 / 56.2 s | 51.7 / 82.1 s | 4.3 / 7.6 s |

Each compared run is one pass. Historical runs used different case snapshots and
note instructions; this is not an identical-prompt, model-only comparison.
Some event-display checks are conditional, so full check counts differ. Shared
labels omit conditional checks absent from a run. These samples measure app eval
checks, not expected accuracy on ordinary family mail.

Medium improved 10 shared checks and regressed 5: a net gain of five checks,
or 1.8 percentage points, for a 42% higher median case time. Gains include the
weekday-only deadline, relative departure time, holiday, TET, week-number and
Finnish `S` mark checks. Regressions include booking/reply deadlines, the
Christmas event and retaining the old time after an update. A form-action quote
also failed the expected wording check. Higher Clef precision and the larger
reader changed together; their individual effects were not isolated.

The remaining errors have two sources:

- **Reading:** Medium still resolves weekday exams one week too late. Its two
  photo timetable candidates are dropped, leaving neither expected class slot.
  This differs from Small's incorrect shared date/time range.
- **Decisions and display policy:** Medium reads the booking deadline correctly,
  but verification at probability 0.422 removes the date. It reads the new
  parents' evening time correctly too, but marks the messages as the same event
  (0.826) instead of moved (0.129), retaining the old time. Correct class-list
  and subject-date events remain suggestions. Optional club equipment is still
  treated as required, an event is assigned to the wrong grade, `T+` is still
  classified as other, and one concern tone remains neutral.

The new missed-exam case passes 25/26 strict checks. Its remaining failure is
an evaluator title-pattern limitation: `Englanti-koe` has the correct date, time
and pupil, but does not match `englannin|english`. Original scores and case
expectations were retained; this is not a scheduling error.

Recommended initial catalog, with all inference local and no cloud fallback:

| Pack | Decision model | Reasoning / extraction model | Text download | RAM target | Evidence |
| --- | --- | --- | ---: | --- | --- |
| Small | Clef-flash 9B Q4_K_M | Qwen3.5 4B Q4_K_M | 9.1 GB | 16 GB, pending Mini test | 89.9% on shared checks |
| Medium | Clef-flash 9B Q8_0 | Qwen3.5 9B Q4_K_M | 15.3 GB | 32 GB suggested; 24 GB unverified | 91.7% on shared checks |

Small and Medium have eval profiles. The consumer installer and Settings offer
only Small. Large is
excluded from the launch lineup and testing because its download and compute
requirements are too high for the intended use.

Medium peaked at 16,083,091,456 bytes (15.0 GiB) combined runtime RSS, with one
resident model, versus Small's 12.1 GiB. Machine-wide swap grew from 4303.94 MiB
to 10834.12 MiB during the run; this includes other applications and cannot be
attributed entirely to inference. Both measurements came from the 48 GiB
MacBook. Medium is not a 16 GB recommendation. Recommend only Small; prioritize local decision/verification errors before
increasing model sizes further. Medium remains comparison evidence.

[Clef-flash](https://huggingface.co/Cloudflare/clef-flash) is the 9B Jev-compatible
decision model. Qwen's published [9B results](https://huggingface.co/Qwen/Qwen3.5-9B)
support investigating a larger reader, but vendor benchmarks do not predict
percentages against Luna on Finnish Wilma content. Keep the native runtime,
pinned weights/template, constrained JSON and bounded reasoning used here.
Readiness verifies the appropriate quantization for each pack.

The Medium text download is 15,286,369,312 bytes, excluding unused vision
projectors, runtimes and temporary upgrade files. Tested blobs:

- Clef-flash Q8: 9,657,260,192 bytes; SHA-256
  `d7c352faf1bdd9ea24d0b9347e8eb1eb4bbadeff6c02383bf750215a74f2f1f1`.
- Qwen3.5 9B Q4: 5,629,109,120 bytes; SHA-256
  `02d45dc1cf451ba2475ac33b301c2dd8f985abe4c182ce04a1f2f5bf0260278d`.

Cleanup was audited after both the interrupted attempt and the completed rerun:
temporary weights and runtimes are gone, no owned worker remains, and the two
installed DeepSeek models retain their original digests and sizes. Evidence is
in `evals/results/medium-comparison.md`, `medium-comparison.json`,
`local-hardware-medium.json`, and `medium-cleanup-audit.json`. The earlier attempt
was interrupted while reducing its repeat count; final accuracy uses only the
completed single-pass rerun. No baseline was accepted.

The installed Ollama version is 0.40.2, matching the release already tested in
isolation. The HF Clef pack needed the native decision runtime; updating Ollama
alone does not prove stock compatibility. Consumer delivery now supervises the native worker from the app and downloads
Small after Settings opt-in.
The provider remains an exclusive OpenAI/local choice.

## Consumer installation implementation

- `src-tauri/resources/local-ai-pack.json` pins model URLs, digests and sizes,
  runtime archive and the Qwen chat template.
- `scripts/prepare-local-runtime.ts` downloads/verifies/signs build assets only;
  Tauri bundles them as resources. No model weights enter the app bundle.
- `src-tauri/src/local_ai.rs` owns resumable downloads, checksums, private storage,
  cancellation/removal and an authenticated worker with bounded context/reasoning.
  One worker is resident at a time. Its process group is stopped before switching;
  a parent guard handles app crashes. Inference logs and school text are not saved.
- `src/ai/managed.ts` owns setup independently of the mounted Settings screen,
  probes both roles, guards stale completions, and enables only after success.
- `LocalAISetup.tsx` presents disk usage, progress, retry/cancel/removal and the
  accuracy/privacy tradeoff in English and Finnish. It is disabled in browsers
  and on unsupported hardware.

All verification boundaries are checked separately: UI choice/response states,
mocked native IPC and stale setup results, native download/resume/hash/removal,
worker crash cleanup, live native model requests, and the signed app's resources.
The live smoke test uses a disposable model directory and deletes it even on
assertion failure; it does not repeat the full benchmark.

```sh
pnpm test:ai
cargo test --manifest-path src-tauri/Cargo.toml --lib
# Explicit smoke test: downloads 9.1 GB, tests both roles, removes owned weights.
cargo test --manifest-path src-tauri/Cargo.toml --lib local_ai::tests::live_small_setup_and_inference -- --ignored --nocapture
pnpm build:app --bundles app
```

Both [Clef-flash](https://huggingface.co/Cloudflare/clef-flash) and
[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) have Apache-2.0 model licenses;
include their notices in the pack. Download text weights only for this feature;
the Ollama test pulls also include vision projectors that Home does not use.
Keep the downloaded models outside the app bundle so updating Home does not
duplicate the pack. The tested text GGUFs total 9,135,041,504 bytes (about 9.1 GB),
versus 10.4 GB for the Ollama tags with unused vision components. Account for
temporary downloads and runtime overhead in the disk-space check. The 16 GB
release gate is a completed Mini eval
with memory pressure and responsiveness checked, followed by repeated accuracy
and calibration runs against the cloud baseline.

Pinned text weights observed in the MacBook test (Ollama verified these blob
digests while downloading):

| Model | Bytes | SHA-256 | Direct download |
| --- | ---: | --- | --- |
| Clef-flash Q4_K_M | 6,486,448,288 | `fd3e90605e8103307dca37cb5a8cdb036267e2fe3cb2d908d80a8ceb9ec0638c` | [GGUF at a pinned revision](https://huggingface.co/ggml-org/Clef-Flash-GGUF/resolve/4a192915ef971886004b5b13294f2b4c7a7fc39d/Clef-Flash-Q4_K_M.gguf) |
| Qwen3.5 4B Q4_K_M | 2,648,593,216 | `a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50` | [Ollama content-addressed blob](https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50) |

The downloader verifies every completed file before marking the pack installed.
The pinned Qwen template and model license notices are bundled with the runtime.
The runtime also needs the [llama.cpp MIT license](https://github.com/ggml-org/llama.cpp/blob/b11535/LICENSE)
and its included third-party notices.

## Tauri delivery status and remaining release work

The development app now bundles the pinned Metal runtime and downloads Small
through Settings. The first prototype's estimated 3–5 engineering days covered
that implementation; the earlier 6–10 day estimate also included release work.
These were planning estimates, not measured elapsed time.

The local development bundle uses ad-hoc signing (`signingIdentity: "-"`). It
builds without Apple credentials. Public distribution still needs
[Developer ID signing and notarization](https://v2.tauri.app/distribute/sign/macos/),
including the nested runtime and libraries; the preparation script uses the
configured `APPLE_SIGNING_IDENTITY` for those binaries. No public release has
been published by this implementation.

Remaining release gates are clean-install/restart/upgrade verification on another
Mac, the deferred 16 GB Mini test for memory pressure/responsiveness, and release
signing/notarization. The model pack remains experimental until those pass.
There is no consumer pack selector or large-model launch plan.

The MacBook installer smoke test passed in 245 seconds including the 9.1 GB
transfer. It checked pinned hashes, Clef's Finnish predicate, Qwen's exact
consumer setup request (thinking off), rejection of an unauthenticated native
request, worker unload, and removal of all temporary weights. The user's two
pre-existing DeepSeek Ollama models retained their names and digests. An earlier
ad hoc thinking-enabled maximum prompt returned `24/25` instead of `25`; the
exact setup probe passed on rerun. This checks installation/runtime conformance,
not additional accuracy or improvements to the 89.9% benchmark.
Verification evidence is saved in `evals/results/native-installer-smoke.json`.

