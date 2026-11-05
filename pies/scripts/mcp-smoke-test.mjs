// Minimal MCP stdio client used to smoke-test the project's configured MCP servers.
// Usage: node scripts/mcp-smoke-test.mjs <server-name-in-.mcp.json> [tool] [jsonArgs]
// Reads the server command from the repository-root .mcp.json so the test exercises the real configuration.
// Never prints environment variables or secrets.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, tool, rawArgs] = process.argv.slice(2);
// The project MCP config lives at the repository root (where Claude Code is launched).
const config = JSON.parse(readFileSync(path.join(root, "..", ".mcp.json"), "utf8"));
const server = config.mcpServers?.[name];
if (!server) {
  console.error(`unknown server: ${name}`);
  process.exit(2);
}
const extraArgs = (process.env.MCP_SMOKE_EXTRA_ARGS ?? "").split(" ").filter(Boolean);
const child = spawn(server.command, [...server.args, ...extraArgs], { cwd: path.join(root, ".."), stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* non-JSON log line */
    }
  }
});
child.stderr.on("data", () => {});

function request(method, params, timeoutMs = 60000) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout: ${method}`)), timeoutMs);
  });
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "pies-mcp-smoke", version: "1.0.0" },
  });
  console.log(`initialize: ${init.result?.serverInfo?.name ?? "?"} ${init.result?.serverInfo?.version ?? ""}`);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const list = await request("tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  console.log(`tools (${names.length}): ${names.join(", ")}`);
  if (tool) {
    const res = await request("tools/call", { name: tool, arguments: rawArgs ? JSON.parse(rawArgs) : {} }, 90000);
    const text = (res.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    console.log(`call ${tool}: ${res.error ? "ERROR " + JSON.stringify(res.error) : res.result?.isError ? "TOOL_ERROR" : "ok"}`);
    console.log(text.slice(0, 1500));
  }
  process.exitCode = 0;
} catch (err) {
  console.error(String(err));
  process.exitCode = 1;
} finally {
  child.kill();
}
