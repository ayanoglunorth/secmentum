const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { MAX_UPLOAD_BYTES, validateVideoFile } = require("../server");

const port = 25173;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start");
}

before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      ACCESS_CODE: "DEMO-ACCESS",
      SESSION_SECRET: "test-session-secret-with-32-characters",
      R2_ENDPOINT: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET_NAME: "",
    },
    stdio: "ignore",
  });
  await waitForServer();
});

after(() => server?.kill());

test("public demo supports the safe candidate flow", async () => {
  const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login");

  for (const path of ["/hakkimizda", "/cozumler", "/iletisim"]) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 404);
  }

  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(await configResponse.json(), {
    brand: {
      name: "Secmentum",
      tagline: "A customizable internship assessment tool",
    },
    storageEnabled: false,
  });

  const loginPage = await (await fetch(`${baseUrl}/login`)).text();
  assert.match(loginPage, /Start assessment/i);
  assert.doesNotMatch(loginPage, /hr@secmentum\.com|All rights reserved|Tüm hakları/i);

  const invalidLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Demo User", email: "demo@example.com", accessCode: "WRONG" }),
  });
  assert.equal(invalidLogin.status, 401);

  const validLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Demo User", email: "demo@example.com", accessCode: "DEMO-ACCESS" }),
  });
  assert.equal(validLogin.status, 200);
  const cookie = validLogin.headers.get("set-cookie").split(";", 1)[0];

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } });
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.stages.length, 3);
  assert.deepEqual(dashboardData.stages.map(({ title, questions }) => [title, questions]), [
    ["Work Style", 5],
    ["English Communication", 5],
    ["Problem Solving", 5],
  ]);
  assert.equal(Object.hasOwn(dashboardData.user, "accessCode"), false);

  const questions = await fetch(`${baseUrl}/api/stages/1/questions`, { headers: { cookie } });
  const questionsData = await questions.json();
  assert.equal(questionsData.questions.length, 5);
  assert.match(questionsData.questions[0].text, /project brief/i);

  const invalidStage = await fetch(`${baseUrl}/api/stages/99/questions`, { headers: { cookie } });
  assert.equal(invalidStage.status, 400);

  const start = await fetch(`${baseUrl}/api/stage/start`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ stage: 1 }),
  });
  assert.equal(start.status, 200);

  const skippedUpload = await fetch(`${baseUrl}/api/upload-answers`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ stage: 1, content: "Demo answer", durationMs: 1000 }),
  });
  assert.deepEqual(await skippedUpload.json(), { success: true, skipped: true });

  const form = new FormData();
  form.append("video", new Blob(["not-video"], { type: "text/plain" }), "test.txt");
  const invalidUpload = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  assert.equal(invalidUpload.status, 415);
  const invalidUploadText = JSON.stringify(await invalidUpload.json());
  assert.doesNotMatch(invalidUploadText, /R2_ENDPOINT|localhost|secret|stack/i);
});

test("video validation rejects files over 256 MB", () => {
  assert.throws(
    () => validateVideoFile({ mimetype: "video/webm", size: MAX_UPLOAD_BYTES + 1 }),
    (error) => error.code === "LIMIT_FILE_SIZE",
  );
});
