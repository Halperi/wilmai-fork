/*
 * Replay a real inbox through the reading, to see what a strategy costs and
 * how it routes on a family's ordinary mail (the eval cases are dense with
 * dates on purpose; a real inbox isn't). There are no right answers here:
 * the strategies are compared with each other.
 *
 * The material is the app's own export of the family's items
 * (~/Library/Application Support/ai.wilm.home/luna-material.json, written by
 * luna/compare.ts). It goes to OpenAI with the key from the environment, as
 * the app sends it; the report stays in evals/results/ (not in git).
 *
 *   op run --env-file evals/keys.env -- pnpm replay --classes Aino=9C,Veeti=7G                 # the matrix configs
 *   op run --env-file evals/keys.env -- pnpm replay --classes Aino=9C,Veeti=7G --config gated  # some (evals/configs.json)
 *
 * The monthly projection assumes one read per item. It excludes rereading
 * and is compared with the app's recorded monthly pause limit in USD.
 */
import { RealDate, setNow } from "./shim.ts";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const classes = Object.fromEntries(
  (args.includes("--classes") ? args[args.indexOf("--classes") + 1] : "")
    .split(",")
    .filter(Boolean)
    .map((pair) => pair.split("="))
);
const file = args.includes("--material") ? args[args.indexOf("--material") + 1] : join(homedir(), "Library/Application Support/ai.wilm.home/luna-material.json");

const { overrideBridge } = await import("../src/wilma/transport.ts");
const store = await import("../src/data/store.ts");
const { DEFAULT_SETTINGS, LUNA_THRESHOLDS: T } = await import("../src/data/model.ts");
const { runLuna } = await import("../src/luna/events.ts");
const { costOf, totalUsage, readingTotal, monthlyLimit } = await import("../src/luna/client.ts");
type Snapshot = import("../src/data/model.ts").Snapshot;
type LunaRecord = import("../src/data/model.ts").LunaRecord;

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY isn't set (op run --env-file evals/keys.env -- pnpm replay)");
overrideBridge(async (path, init) => {
  if (path !== "openai") return { error: `The replay has no route ${path}`, status: 404 };
  const resp = await fetch(`https://api.openai.com${init.headers?.["x-openai-path"]}`, {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(init.body),
  });
  return { status: resp.status, retryAfter: resp.headers.get("retry-after"), body: await resp.text() };
});

interface Material {
  at: string;
  children: string[];
  messages: { key: string; sent: string; from: string | null; subject: string; pupils: string[]; text: string | null }[];
  news: { key: string; published: string | null; from: string | null; title: string; pupils: string[]; text: string | null }[];
  notes: { key: string; pupil: string; date: string; start: string | null; end: string | null; subjects: string[]; kind: string; text: string }[];
}
const material = JSON.parse(readFileSync(file, "utf8")) as Material;
setNow(RealDate.parse(material.at));

function snapshotOf(m: Material): Snapshot {
  const children = m.children.map((first, i) => ({ number: String(3001 + i), name: first, first, color: i }));
  const num = (first: string) => children.find((c) => c.first === first)?.number ?? children[0].number;
  const snap: Snapshot = {
    version: 1,
    account: { baseUrl: "https://replay.inschool.fi", username: "replay", tenantName: "Replay", via: "demo" },
    children,
    perChild: Object.fromEntries(children.map((c) => [c.number, { lessons: [], notes: [], exams: [], className: { value: classes[c.first] ?? null, fetchedAt: new RealDate() } }])),
    messages: {},
    news: {},
    firstSyncAt: 0,
  };
  for (const msg of m.messages) {
    if (!msg.text) continue;
    const id = Number(msg.key.slice(2));
    const sentAt = new RealDate(msg.sent);
    snap.messages[id] = {
      id,
      subject: msg.subject,
      sender: msg.from,
      sentAt,
      unreadInWilma: false,
      replyCount: 0,
      children: msg.pupils.map(num),
      thread: { content: msg.text, recipients: null, replies: [], collated: false, invite: null, fetchedAt: sentAt },
    };
  }
  for (const n of m.news) {
    if (!n.text) continue;
    const id = Number(n.key.slice(2));
    const published = n.published ? new RealDate(n.published) : null;
    snap.news[id] = { id, title: n.title, subtitle: null, author: n.from, published, pinned: false, children: n.pupils.map(num), detail: { content: n.text, resources: [], fetchedAt: new RealDate(), v: 2 } };
  }
  for (const note of m.notes) {
    for (const subject of note.subjects)
      snap.perChild[num(note.pupil)].notes.push({ date: note.date, start: note.start, end: note.end, subject, typeLabel: note.kind, typeClass: "", teacher: "", note: note.text });
  }
  return snap;
}

// The ways to read, from the suite's named configs (the matrix ones unless --config names some).
interface EvalConfig {
  label: string;
  readingStrategy: "fixed" | "gated" | "tiered";
  readingModel: string;
  readingEffort?: "low" | "medium" | "high";
  escalateToSol?: boolean;
  checks?: { choices?: boolean; fields?: boolean; crossItem?: boolean };
  decider?: string;
  matrix?: boolean;
}
const configsFile = JSON.parse(readFileSync(join(here, "configs.json"), "utf8")) as Record<string, EvalConfig | string>;
const named = Object.entries(configsFile).filter((e): e is [string, EvalConfig] => typeof e[1] === "object" && e[1].decider !== "jev");
const asked = (args.includes("--config") ? args[args.indexOf("--config") + 1] : "").split(",").filter(Boolean);
const strategies = (asked.length ? named.filter(([name]) => asked.includes(name)) : named.filter(([, c]) => c.matrix)).map(([name, c]) => ({
  name,
  label: c.label,
  settings: { readingStrategy: c.readingStrategy, readingModel: c.readingModel, readingEffort: c.readingEffort ?? "low", escalateToSol: Boolean(c.escalateToSol), lunaChecks: c.checks },
}));
if (!strategies.length) throw new Error(`No configs to replay (${named.map(([n]) => n).join(", ")})`);

const snap = snapshotOf(material);

// The decisions every item gets whatever the reading (triage, the tone of a note): once, for their cost.
const { runJev } = await import("../src/jev/runner.ts");
process.stdout.write("Decisions (triage, tones) … ");
store.setState({ snapshot: snap, jev: {}, jevBaseline: {}, luna: {}, usage: {}, settings: { ...DEFAULT_SETTINGS, openaiKey: "from the environment" } });
await runJev();
const decisionsUsage = totalUsage(store.getState().usage);
const decisionsCost = costOf(decisionsUsage);
const triaged = Object.keys(store.getState().jev).length;
console.log(`${triaged} items, $${decisionsCost.toFixed(4)}`);

// What a month brings: the family's items of the last 30 days (messages and bulletins whether read or not, notes with words).
const now = RealDate.parse(material.at);
const within = (iso: string | null) => iso !== null && now - RealDate.parse(iso) < 30 * 86_400_000 && RealDate.parse(iso) <= now;
const perMonth = {
  messages: material.messages.filter((m) => within(m.sent)).length,
  news: material.news.filter((n) => within(n.published)).length,
  notes: material.notes.filter((n) => within(`${n.date}T12:00:00Z`)).length,
};
const monthItems = perMonth.messages + perMonth.news + perMonth.notes;

const out: { name: string; label: string; records: Record<string, LunaRecord>; cost: number; items: number; seconds: number; reading: ReturnType<typeof readingTotal> }[] = [];
for (const s of strategies) {
  process.stdout.write(`${s.name} … `);
  store.setState({ snapshot: snap, luna: {}, usage: {}, settings: { ...DEFAULT_SETTINGS, openaiKey: "from the environment", ...s.settings } });
  const started = RealDate.now();
  await runLuna();
  const seconds = (RealDate.now() - started) / 1000;
  const state = store.getState();
  if (state.lunaStatus.error) throw new Error(`${s.name}: ${state.lunaStatus.error}`);
  const total = totalUsage(state.usage);
  out.push({ name: s.name, label: s.label, records: state.luna, cost: costOf(total), items: total.items, seconds, reading: readingTotal(total) });
  console.log(`${total.items} items, $${costOf(total).toFixed(4)}, ${seconds.toFixed(0)} s`);
}

// What reached the app: events in the calendar's thresholds and required steps, per strategy.
const kept = (r: LunaRecord | undefined) =>
  r
    ? [
        // As the calendar keeps them (an optional thing counts for keeping, not for sure); "?" a suggestion.
        ...r.events
          .filter((e) => e.pDate >= T.keepDate && e.pCalendar + (e.pOptional ?? 0) >= T.keepCalendar)
          .map((e) => `${e.date} ${e.kind}${e.pDate >= T.sureDate && e.pCalendar >= T.sureCalendar && (e.pOptional ?? 0) < 0.5 ? "" : "?"}${e.pupils?.length ? ` (${e.pupils.join(", ")})` : ""}`),
        ...(r.action && r.action.pRequired >= 0.5 ? [`step${r.action.deadline ? ` by ${r.action.deadline}` : ""}`] : []),
      ]
        .sort()
        .join(", ") || "nothing"
    : "not read";
const lines: string[] = [`# Replay of a real inbox (${material.at.slice(0, 10)}): ${Object.keys(out[0].records).length} items`, ""];
const decisionsPerItem = decisionsCost / Math.max(1, triaged);
lines.push(
  `A month here brings ${monthItems} items (${perMonth.messages} messages, ${perMonth.news} bulletins, ${perMonth.notes} notes with words). The decisions (triage, tones) cost $${decisionsPerItem.toFixed(5)} an item (${triaged} items, $${decisionsCost.toFixed(4)}). These projections assume one read per item and exclude rereading and additional calls. The app pauses at $${monthlyLimit()} in recorded monthly usage; user-facing guidance is to plan for a few euros a month.`,
  ""
);
lines.push(
  "| Config | Reading, all items | Per item | Single-pass month (reading + decisions) | Against the pause limit | Reading calls | Tokens in / out | Time, all items |",
  "| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |"
);
for (const o of out) {
  const perItem = o.cost / Math.max(1, o.items);
  const month = monthItems * (perItem + decisionsPerItem);
  const verdict = month < monthlyLimit() ? "below the pause limit" : "at or above the pause limit";
  lines.push(`| ${o.name} | $${o.cost.toFixed(4)} | $${perItem.toFixed(5)} | $${month.toFixed(3)} | ${verdict} | ${o.reading.calls} | ${o.reading.input} / ${o.reading.output} | ${o.seconds.toFixed(0)} s |`);
}
for (const o of out) {
  const routes = Object.values(o.records).map((r) => r.route).filter((r): r is NonNullable<LunaRecord["route"]> => Boolean(r));
  if (!routes.length) continue;
  const n = routes.length;
  const pct = (k: number) => `${k} (${Math.round((100 * k) / n)} %)`;
  const ended = (rung: string) => routes.filter((r) => r.rungs.at(-1) === rung).length;
  lines.push(
    "",
    `${o.name} routes: skipped by the gate ${pct(routes.filter((r) => !r.rungs.length).length)}; Luna low ${pct(ended("gpt-6-luna/low"))}, Luna medium ${pct(ended("gpt-6-luna/medium"))}, Sol ${pct(ended("gpt-6.1-sol/low"))}; read twice ${pct(routes.filter((r) => r.rungs.length > 1).length)}.`
  );
}
// What later items said about earlier items' events (configs with crossItem): the calendar leaves out or merges these.
const titleOf = (key: string) => material.messages.find((m) => m.key === key)?.subject ?? material.news.find((x) => x.key === key)?.title ?? key;
for (const o of out) {
  const said = Object.entries(o.records).flatMap(([key, r]) =>
    Object.values(r.links?.about ?? {})
      .filter((l) => l.cancelled + l.moved >= 0.6 || l.same >= 0.6)
      .map((l) => `- "${titleOf(key).slice(0, 60)}" ${l.cancelled >= 0.6 ? "cancels" : l.moved >= 0.6 || l.cancelled + l.moved >= 0.6 ? "moves" : "repeats"} ${l.what} (${Math.max(l.cancelled + l.moved, l.same).toFixed(2)})`)
  );
  const asked = Object.values(o.records).reduce((n, r) => n + Object.keys(r.links?.about ?? {}).length, 0);
  if (asked) lines.push("", `## ${o.name}: later items about earlier events (${asked} asked, ${said.length} found)`, "", ...said);
}
lines.push("", "## Where the configs differ (what reached the app)", "");
for (const key of Object.keys(out[0].records)) {
  const got = out.map((o) => kept(o.records[key]));
  if (got.every((g) => g === got[0])) continue;
  const item = material.messages.find((m) => m.key === key)?.subject ?? material.news.find((x) => x.key === key)?.title ?? key;
  lines.push(`- ${item.slice(0, 70)}`);
  out.forEach((o, k) => {
    const route = o.records[key]?.route;
    lines.push(`  - ${o.name}: ${got[k]}${route ? ` (${route.rungs.join(" → ") || "skipped"}${route.why ? `; ${route.why}` : ""})` : ""}`);
  });
}
const dir = join(here, "results");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "replay-latest.md"), lines.join("\n"));
console.log(`\n${lines.slice(2, 6 + out.length).join("\n")}\nReport: evals/results/replay-latest.md`);
