// Usage: node scripts/audit-n8n-workflow.ts <workflow.json> <pies-origin>
// Exit 0 = no findings (publishable from the boundary's point of view), 1 = findings, 2 = usage error.
import { readFileSync } from "node:fs";
import { auditN8nWorkflow } from "../src/lib/automation/n8n-audit.ts";

const [file, origin] = process.argv.slice(2);
if (!file || !origin) {
  console.error("usage: node scripts/audit-n8n-workflow.ts <workflow.json> <pies-origin>");
  process.exit(2);
}
const json = JSON.parse(readFileSync(file, "utf8"));
const findings = auditN8nWorkflow(json, origin);
if (findings.length === 0) {
  console.log(`OK: ${json.nodes?.length ?? 0} nodes, no findings`);
  process.exit(0);
}
for (const f of findings) console.log(`FINDING [${f.node}] ${f.problem}`);
process.exit(1);
