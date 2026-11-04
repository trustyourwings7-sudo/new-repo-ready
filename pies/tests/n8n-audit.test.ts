import { describe, expect, it } from "vitest";
import { auditN8nWorkflow } from "@/lib/automation/n8n-audit";

const ORIGIN = "https://pies.example.com";
const API = `${ORIGIN}/api/automation/v1`;

describe("n8n workflow audit (budget-governor bypass guard)", () => {
  it("accepts a workflow that only talks to the PIES API", () => {
    expect(
      auditN8nWorkflow(
        {
          nodes: [
            { name: "Daily", type: "n8n-nodes-base.scheduleTrigger" },
            { name: "Sign", type: "n8n-nodes-base.code" },
            { name: "Call PIES", type: "n8n-nodes-base.httpRequest", parameters: { url: API } },
          ],
        },
        ORIGIN,
      ),
    ).toEqual([]);
  });

  it.each([
    "@n8n/n8n-nodes-langchain.lmChatAnthropic",
    "@n8n/n8n-nodes-langchain.openAi",
    "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
    "@brave/n8n-nodes-brave-search.braveSearch",
    "@mendable/n8n-nodes-firecrawl.firecrawl",
    "n8n-nodes-base.gmail",
    "n8n-nodes-base.postgres",
    "n8n-nodes-base.supabase",
  ])("rejects metered or direct-access node %s", (type) => {
    expect(auditN8nWorkflow({ nodes: [{ name: "x", type }] }, ORIGIN)[0]?.problem).toMatch(/not allowed/);
  });

  it("rejects HTTP calls anywhere except the PIES API", () => {
    for (const url of ["https://api.anthropic.com/v1/messages", `${ORIGIN}/api/automation/v1/../../rest`, "https://xyz.supabase.co/rest/v1/opportunities", ""]) {
      expect(auditN8nWorkflow({ nodes: [{ name: "h", type: "n8n-nodes-base.httpRequest", parameters: { url } }] }, ORIGIN)).toHaveLength(1);
    }
  });

  it("rejects Code nodes that make network calls", () => {
    for (const jsCode of ["return await this.helpers.httpRequest({url:'x'})", "await fetch('https://api.openai.com')", "const k = $env.KEY", "require('axios')"]) {
      expect(auditN8nWorkflow({ nodes: [{ name: "c", type: "n8n-nodes-base.code", parameters: { jsCode } }] }, ORIGIN)).toHaveLength(1);
    }
    expect(auditN8nWorkflow({ nodes: [{ name: "c", type: "n8n-nodes-base.code", parameters: { jsCode: "return items.map(i => i)" } }] }, ORIGIN)).toEqual([]);
  });

  it("rejects attached credentials", () => {
    const f = auditN8nWorkflow(
      { nodes: [{ name: "h", type: "n8n-nodes-base.httpRequest", parameters: { url: API }, credentials: { httpHeaderAuth: { id: "1" } } }] },
      ORIGIN,
    );
    expect(f.map((x) => x.problem).join()).toMatch(/credentials attached/);
  });
});
