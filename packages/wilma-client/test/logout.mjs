import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuthenticationError, WilmaClient } from "../dist/index.js";

let loginPosts = 0;
let sidCounter = 0;
let currentSid = null; // the account's one live session (Wilma allows one)
let loginDelayMs = 0;
let homeOutage = null; // HTTP status for the front page, e.g. 503
let homeWithoutForm = false;
let staleFormkey = false;
const logoutPosts = [];
const requests = [];

// Like Wilma: every page of a live session has the logout form with a
// formkey; POST /logout with it ends the session. Without a live session the
// front page is the login page.
const server = createServer(async (req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const sid = /Wilma2SID=(\d+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
  const live = sid !== null && sid === currentSid;
  let body = "";
  for await (const chunk of req) body += chunk;
  requests.push(`${req.method} ${req.url}`);

  if (req.method === "GET" && req.url === "/login") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end('<input type="hidden" name="SESSIONID" value="s">');
  }
  if (req.method === "POST" && req.url === "/login") {
    loginPosts += 1;
    if (loginDelayMs) await new Promise((r) => setTimeout(r, loginDelayMs));
    const form = new URLSearchParams(body);
    if (form.get("Login") === "parent" && form.get("Password") === "right") {
      currentSid = String(++sidCounter); // a new login cancels the previous session
      res.writeHead(303, { Location: `${base}/?checkcookie`, "Set-Cookie": `Wilma2SID=${currentSid}; Path=/` });
      return res.end();
    }
    res.writeHead(303, { Location: `${base}/?loginfailed` });
    return res.end();
  }
  if (req.url === "/?checkcookie") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end("<html>home</html>");
  }
  if (req.method === "GET" && req.url === "/") {
    if (homeOutage) {
      res.writeHead(homeOutage);
      return res.end("down");
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    if (!live || homeWithoutForm) return res.end('<form action="/login" method="post"><input name="Login"></form>');
    const formkey = staleFormkey ? "guardian:1:old" : `guardian:1:${sid}`;
    return res.end(`<html><body>
      <form action="/logout" id="logout-form" method="post"><input type="hidden" name="formkey" value="${formkey}"></form>
      <a href="/!1/">Lapsi Yksi</a></body></html>`);
  }
  if (req.method === "POST" && req.url === "/logout") {
    const form = new URLSearchParams(body);
    logoutPosts.push({ sid, formkey: form.get("formkey"), type: req.headers["content-type"] });
    if (live && form.get("formkey") !== `guardian:1:${sid}`) {
      res.writeHead(403);
      return res.end();
    }
    if (live) currentSid = null;
    res.writeHead(303, { Location: `${base}/?logout`, "Set-Cookie": "Wilma2SID=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" });
    return res.end();
  }
  if (req.url === "/api/v1/accounts/me/roles") {
    res.writeHead(!sid ? 401 : live ? 200 : 403, { "Content-Type": "application/json" });
    return res.end(live ? '{"payload":[]}' : "");
  }
  if (req.url === "/!1/overview") {
    res.writeHead(live ? 200 : 403, { "Content-Type": "application/json" });
    return res.end(live ? "{}" : "");
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profile = { baseUrl, username: "parent", password: "right" };

try {
  // A live session: logging out posts the page's formkey with the session's
  // cookie, ends the session in Wilma, and logs in nowhere.
  const client = await WilmaClient.login(profile);
  const kid = client.forStudent("1");
  await kid.overview.get();
  loginPosts = 0;
  assert.equal(await client.logout(), true, "a live session was ended");
  assert.deepEqual(logoutPosts, [{ sid: "1", formkey: "guardian:1:1", type: "application/x-www-form-urlencoded" }]);
  assert.equal(currentSid, null, "Wilma no longer has the session");
  assert.equal(loginPosts, 0, "logging out never logs in");

  // The children's clients share the login: they are logged out too, and
  // don't log in again by themselves.
  await assert.rejects(kid.overview.get(), AuthenticationError);
  assert.equal(loginPosts, 0, "no login after logging out");
  assert.equal(WilmaClient.resume(profile, client.exportSession()), null, "nothing left to resume");

  // Logging out again needs nothing: no requests, no error.
  requests.length = 0;
  assert.equal(await client.logout(), false);
  assert.deepEqual(requests, [], "no session, no requests");

  // A saved session that Wilma already ended (another login cancelled it):
  // nothing to end, and the newer session stays live.
  const older = (await WilmaClient.login(profile)).exportSession();
  const newer = await WilmaClient.login(profile);
  const liveSid = currentSid;
  loginPosts = 0;
  logoutPosts.length = 0;
  assert.equal(await WilmaClient.resume(profile, older).logout(), false, "an ended session needs nothing");
  assert.deepEqual(logoutPosts, [], "no logout posted for an ended session");
  assert.equal(currentSid, liveSid, "the newer session is untouched");
  assert.equal(loginPosts, 0);

  // A saved live session continued in another process can be ended there.
  assert.equal(await WilmaClient.resume(profile, newer.exportSession()).logout(), true);
  assert.equal(currentSid, null);
  assert.equal(loginPosts, 0);

  // Wilma down: the logout fails and the session is kept, so it still works
  // and logging out can be tried again.
  const kept = await WilmaClient.login(profile);
  loginPosts = 0;
  homeOutage = 503;
  await assert.rejects(kept.logout(), (err) => err.name === "APIError" && err.status === 503);
  homeOutage = null;
  await kept.forStudent("1").overview.get();
  assert.equal(loginPosts, 0, "the kept session needed no new login");

  // Wilma refusing the logout (a stale formkey) or a live page without the
  // form: the session is kept rather than forgotten while still open.
  staleFormkey = true;
  await assert.rejects(kept.logout(), (err) => err.name === "APIError" && err.status === 403);
  staleFormkey = false;
  homeWithoutForm = true;
  await assert.rejects(kept.logout(), /no logout form/);
  homeWithoutForm = false;
  assert.notEqual(currentSid, null, "still logged in");
  assert.equal(await kept.logout(), true);
  assert.equal(currentSid, null);

  // Logging out while the session is logging in again ends the new session,
  // and nothing logs in after that.
  const busy = await WilmaClient.login(profile);
  await WilmaClient.login(profile); // cancels busy's session
  loginPosts = 0;
  loginDelayMs = 200;
  const reading = busy.forStudent("1").overview.get(); // notices and logs in again
  await new Promise((r) => setTimeout(r, 50));
  const ended = await busy.logout();
  loginDelayMs = 0;
  await reading.catch(() => {});
  assert.equal(ended, true, "the re-login's session was ended");
  assert.equal(currentSid, null);
  assert.equal(loginPosts, 1, "only the re-login that was already running");

  console.log("logout: all assertions passed");
} finally {
  server.close();
}
