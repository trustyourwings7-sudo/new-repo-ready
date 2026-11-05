// Acts like n8n: signs requests with the shared secret and calls the automation API.
import { createHmac } from "node:crypto";

const URL_ = process.env.E2E_URL;
const SECRET = process.env.E2E_SECRET;
const INT = process.env.E2E_INT;

function sign(secret, integration, ts, body) {
  return "v1=" + createHmac("sha256", secret).update(`v1:${integration}:${ts}:${body}`).digest("hex");
}

async function call(envelope, { secret = SECRET, integration = INT, ts = Math.floor(Date.now() / 1000), raw } = {}) {
  const body = raw ?? JSON.stringify(envelope);
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pies-integration": integration,
      "x-pies-timestamp": String(ts),
      "x-pies-signature": sign(secret, integration, ts, body),
    },
    body,
  });
  return { status: res.status, body: await res.json() };
}

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " -> " + JSON.stringify(detail)}`);
  if (!cond) failures++;
}

const start = { request_id: "e2e-run-0001", agent: "discovery", operation: "run.start", payload: { workflow: "e2e" } };

let r = await call(start, { secret: "wrong-secret-wrong-secret-wrong-secret" });
check("wrong secret -> 401", r.status === 401, r);
r = await call(start, { ts: Math.floor(Date.now() / 1000) - 600 });
check("stale timestamp -> 401", r.status === 401, r);
r = await call(start, { integration: "44444444-0000-4000-8000-000000000004" });
check("unknown integration -> 401", r.status === 401, r);
r = await call({ ...start, agent: "outreach", operation: "gmail.send", request_id: "e2e-gmail-001" });
check("gmail.send -> 404 unknown_operation", r.status === 404 && r.body.error === "unknown_operation", r);
r = await call({ ...start, operation: "budget.reserve", request_id: "e2e-budget-01" });
check("budget.reserve -> 404", r.status === 404, r);
r = await call({ ...start, agent: "qualification", request_id: "e2e-agent-001" });
check("agent not enabled -> 422", r.status === 422 && r.body.error === "agent_not_enabled_for_integration", r);
const getRes = await fetch(URL_);
check("GET -> 405", getRes.status === 405, getRes.status);

r = await call(start);
check("valid run.start -> 200", r.status === 200 && typeof r.body.run_id === "string", r);
const runId = r.body.run_id;
r = await call(start);
check("duplicate delivery -> replayed, same run", r.status === 200 && r.body.replayed === true && r.body.run_id === runId, r);

const upsert = {
  request_id: "e2e-opp-0001", agent: "discovery", operation: "opportunity.upsert",
  payload: { run_id: runId, title: "E2E grant", category: "grant", source_url: "https://grants.example/e2e", dedupe_key: "e2e-key-0001" },
};
r = await call(upsert);
check("opportunity.upsert -> created", r.status === 200 && r.body.created === true, r);
r = await call({ ...upsert, request_id: "e2e-opp-0002", payload: { ...upsert.payload, qualification_score: 99 } });
check("agent cannot set score -> 422", r.status === 422 && r.body.error === "unknown_field:qualification_score", r);

if (failures) {
  console.error(`${failures} e2e check(s) failed`);
  process.exit(1);
}
