import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui";
import { AGENTS } from "@/lib/agents/registry";
import { moduleBySlug } from "@/lib/modules";

/** Honest status page for modules whose interface is not built yet. */
export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const mod = moduleBySlug(slug);
  if (!mod || mod.slug === "" || mod.status === "available") notFound();

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">
          {mod.letter} · {mod.name}
        </h1>
        <p className="text-sm text-mist-400">{mod.summary}</p>
      </header>
      <Notice tone="warn">
        <strong>In development — Phase {mod.phase}.</strong> The database tables and security policies for this module exist and are tested.
        The interface and automations are not built yet, so no results are shown here.
      </Notice>
      <Card id="tables" title="Backing tables">
        <ul className="flex flex-wrap gap-2">
          {mod.tables.map((t) => (
            <li key={t}>
              <Badge kind="neutral">{t}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      {mod.slug === "agents" ? (
        <Card id="agent-list" title="Agents">
          <ul className="divide-y divide-ink-800 text-sm">
            {AGENTS.map((a) => (
              <li key={a.id} className="py-2">
                <div className="font-medium">
                  <span className="font-mono text-xs text-mist-400">{a.number}</span> {a.name} <Badge kind="neutral">phase {a.phase}</Badge>
                </div>
                <p className="text-xs text-mist-400">{a.purpose}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
