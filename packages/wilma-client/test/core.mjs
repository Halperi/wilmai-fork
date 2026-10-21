/*
 * The core entry point: no Node-only imports, and every request through the
 * transport it's given. A fake Wilma in memory plays the server, the way a
 * desktop app's native command or a browser extension would.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APIError, AuthenticationError, SessionEndedError, WilmaClient } from "../dist/core.js";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

// 1. Nothing reachable from core.js imports undici or node: modules.
{
  const seen = new Set();
  const visit = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, "utf8");
    for (const [, spec] of source.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)) {
      assert.ok(!spec.startsWith("node:") && spec !== "undici", `${file.replace(dist, "dist")} imports ${spec}`);
      if (spec.startsWith(".")) await visit(resolve(dirname(file), spec));
    }
  };
  await visit(resolve(dist, "core.js"));
  assert.ok(seen.size > 10, "walked the core module graph");
}

// A fake Wilma: one live session per account, like the real one.
function fakeWilma() {
  const state = { sid: 0, alive: null, posts: [], requests: [] };
  const reply = (status, { headers = {}, setCookies = [], body = "" } = {}) => ({
    status,
    headers: new Headers(headers),
    setCookies,
    body,
  });
  const transport = async (req) => {
    const url = new URL(req.url);
    const sid = /Wilma2SID=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
    state.requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/login" && req.method === "GET") return reply(200, { body: '<input type="hidden" name="SESSIONID" value="s">' });
    if (url.pathname === "/login" && req.method === "POST") {
      const form = new URLSearchParams(req.body);
      if (form.get("Login") !== "parent" || form.get("Password") !== "right") return reply(303, { headers: { location: "/?loginfailed" } });
      state.sid += 1;
      state.alive = `s${state.sid}`;
      return reply(303, { headers: { location: "/" }, setCookies: [`Wilma2SID=${state.alive}; Path=/; HttpOnly`] });
    }
    const live = sid && sid === state.alive;
    if (!live) return reply(302, { headers: { location: "/login" } });
    if (url.pathname === "/") return reply(200, { headers: { "content-type": "text/html" }, body: "<html>home</html>" });
    if (url.pathname === "/api/v1/accounts/me/roles")
      return reply(200, { headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: [{ type: "guardian", slug: "!1234567", name: "Testi Lapsi" }] }) });
    if (url.pathname === "/write" && req.method === "POST") {
      state.posts.push(req.body);
      return reply(303, { headers: { location: "/done" } });
    }
    if (url.pathname === "/done") return reply(200, { body: "saved" });
    return reply(404);
  };
  return { state, transport };
}

const profile = { baseUrl: "https://fake.inschool.fi", username: "parent", password: "right" };

// 2. Logging in and reading through a custom transport (cookies from setCookies).
{
  const wilma = fakeWilma();
  const client = await WilmaClient.login(profile, undefined, { transport: wilma.transport });
  const students = await client.students();
  assert.deepEqual(students.map((s) => s.studentNumber), ["1234567"]);
  assert.match(client.exportSession(), /Wilma2SID/);
  assert.equal(client.origin, "https://fake.inschool.fi");
}

// 3. relogin: false — an ended session is reported, never logged in again.
{
  const wilma = fakeWilma();
  const client = await WilmaClient.login(profile, undefined, { transport: wilma.transport, relogin: false });
  wilma.state.alive = "someone-else"; // another login on the account
  const loginsBefore = wilma.state.requests.filter((r) => r === "POST /login").length;
  await assert.rejects(() => client.students(), SessionEndedError);
  await assert.rejects(() => client.students(), SessionEndedError, "stays ended, no login");
  assert.equal(wilma.state.requests.filter((r) => r === "POST /login").length, loginsBefore, "no new login");
  assert.ok(new SessionEndedError() instanceof APIError, "a 401 APIError for callers that handle those");
}

// 4. With relogin (the default), the same situation logs in again, as before.
{
  const wilma = fakeWilma();
  const client = await WilmaClient.login(profile, undefined, { transport: wilma.transport });
  wilma.state.alive = "someone-else";
  const students = await client.students();
  assert.equal(students.length, 1);
}

// 5. submit(): one POST, never retried after a re-login.
{
  const wilma = fakeWilma();
  const client = await WilmaClient.login(profile, undefined, { transport: wilma.transport });
  const { sessionOf } = await import("../dist/internal.js");
  const session = sessionOf.get(client);
  const ok = await session.submit("/write", { a: "1" });
  assert.equal(await ok.text(), "saved");
  assert.equal(wilma.state.posts.length, 1);
  wilma.state.alive = "someone-else";
  await assert.rejects(() => session.submit("/write", { a: "2" }), SessionEndedError);
  assert.equal(wilma.state.posts.length, 1, "the ended session's post was not repeated after a login");
  assert.equal(wilma.state.requests.filter((r) => r === "POST /login").length, 1, "no login to retry a write");
}

// 6. resumeSession(): no credentials, never logs in; an empty state is refused.
{
  const wilma = fakeWilma();
  const first = await WilmaClient.login(profile, undefined, { transport: wilma.transport });
  const resumed = WilmaClient.resumeSession(profile.baseUrl, first.exportSession(), { transport: wilma.transport });
  assert.ok(resumed);
  assert.equal((await resumed.students()).length, 1);
  wilma.state.alive = null;
  await assert.rejects(() => resumed.students(), SessionEndedError);
  assert.equal(WilmaClient.resumeSession(profile.baseUrl, JSON.stringify({ cookies: [] }), { transport: wilma.transport }), null);
}

// 6b. A shared session: the WilmAI programs on one computer continue each other's sessions instead of logging in.
{
  const wilma = fakeWilma();
  const saved = { state: null, loads: 0, saves: 0 };
  const shared = {
    load: async () => (saved.loads++, saved.state),
    save: async (state) => {
      saved.saves++;
      saved.state = state;
    },
  };
  const logins = () => wilma.state.requests.filter((r) => r === "POST /login").length;

  // The app: logged in once, no logging in again by itself.
  const app = await WilmaClient.login(profile, undefined, { transport: wilma.transport, relogin: false, sharedSession: shared });
  assert.equal(saved.saves, 1, "a login is saved for the others");
  const appSession = saved.state;
  const events = [];
  app.onSessionEvent((event) => events.push(event));

  // Another program (the CLI) logs in and saves its session: Wilma ends the app's.
  const cli = await WilmaClient.login(profile, undefined, { transport: wilma.transport, sharedSession: shared });
  assert.notEqual(saved.state, appSession);
  assert.equal(logins(), 2);

  // The app continues the CLI's session: no login, and both work.
  const [a, b] = await Promise.all([app.students(), app.forStudent("1234567").students()]);
  assert.equal(a.length + b.length, 2);
  assert.equal(logins(), 2, "no login to continue");
  assert.equal((await cli.students()).length, 1, "the CLI's session is the same one, still alive");

  // Both ended (a login on the phone) and nothing newer saved: the app reports it, the CLI logs in and saves.
  wilma.state.alive = "phone";
  await assert.rejects(() => app.students(), SessionEndedError);
  assert.equal(logins(), 2);
  assert.equal((await cli.students()).length, 1);
  assert.equal(logins(), 3, "the CLI may log in again");
  // ...and the app, ended a moment ago, continues that new session on its next request.
  assert.equal((await app.students()).length, 1);
  assert.equal(logins(), 3);

  // A saved session Wilma no longer accepts isn't continued.
  const stale = saved.state;
  wilma.state.alive = "phone-again";
  saved.state = stale;
  await assert.rejects(() => app.students(), SessionEndedError);

  // An unreadable shared store is no worse than none.
  const broken = await WilmaClient.login(profile, undefined, {
    transport: wilma.transport,
    relogin: false,
    sharedSession: { load: async () => { throw new Error("disk"); }, save: async () => { throw new Error("disk"); } },
  });
  wilma.state.alive = "elsewhere";
  await assert.rejects(() => broken.students(), SessionEndedError);
}

// 7. Without any transport, core says how to get one.
{
  await assert.rejects(() => WilmaClient.login(profile), /No transport for Wilma/);
  assert.ok(AuthenticationError);
}

console.log("core: all assertions passed");
