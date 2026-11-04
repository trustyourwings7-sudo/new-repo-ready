/**
 * Static audit of an n8n workflow export BEFORE it is published.
 *
 * Why: n8n Cloud offers built-in "gateway credits" for AI/search nodes
 * (OpenAI, Anthropic, Gemini, Brave, Firecrawl, ...). Those nodes run without
 * any credential and outside the PIES budget governor. PIES cannot block them
 * from its side, so every workflow must pass this audit:
 *   - only allowlisted node types
 *   - HTTP Request nodes may call ONLY the PIES automation API
 *   - no credentials attached to any node (the HMAC secret is an n8n variable)
 */
export const ALLOWED_N8N_NODE_TYPES = new Set([
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.httpRequest",
  "n8n-nodes-base.code",
  "n8n-nodes-base.if",
  "n8n-nodes-base.switch",
  "n8n-nodes-base.set",
  "n8n-nodes-base.splitInBatches",
  "n8n-nodes-base.noOp",
  "n8n-nodes-base.stickyNote",
  "n8n-nodes-base.rssFeedRead",
  "n8n-nodes-base.crypto",
]);

export interface N8nNode {
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export interface AuditFinding {
  node: string;
  problem: string;
}

export function auditN8nWorkflow(workflow: { nodes?: N8nNode[] }, piesApiOrigin: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const allowedPrefix = `${new URL(piesApiOrigin).origin}/api/automation/v1`;
  for (const node of workflow.nodes ?? []) {
    const name = node.name ?? "(unnamed)";
    const type = node.type ?? "";
    if (!ALLOWED_N8N_NODE_TYPES.has(type)) {
      findings.push({ node: name, problem: `node type not allowed: ${type || "(missing)"}` });
    }
    if (node.credentials && Object.keys(node.credentials).length > 0) {
      findings.push({ node: name, problem: "credentials attached (only the PIES HMAC secret, via an n8n variable, is allowed)" });
    }
    if (type === "n8n-nodes-base.code") {
      const code = String(node.parameters?.jsCode ?? node.parameters?.pythonCode ?? "");
      if (/httpRequest|fetch\s*\(|https?:\/\/|require\s*\(|import\s|\$env|process\.env/.test(code)) {
        findings.push({ node: name, problem: "Code node may not make network calls, import modules or read environment" });
      }
    }
    if (type === "n8n-nodes-base.httpRequest") {
      const url = String(node.parameters?.url ?? "");
      if (url !== allowedPrefix) {
        findings.push({ node: name, problem: `HTTP Request must target exactly ${allowedPrefix} (got ${url.slice(0, 120) || "(empty)"})` });
      }
    }
  }
  return findings;
}
