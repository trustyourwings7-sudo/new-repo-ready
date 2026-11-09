"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULES, type ModuleStatus } from "@/lib/modules";

const DOT: Record<ModuleStatus, string> = {
  available: "bg-ok-400",
  schema_ready: "bg-warn-400",
  planned: "bg-ink-600",
};
const LABEL: Record<ModuleStatus, string> = {
  available: "available",
  schema_ready: "read-only view; editing not built yet",
  planned: "planned",
};

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Modules" className="relative flex min-w-0 max-w-full gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
      <Link
        href="/ask"
        aria-current={pathname === "/ask" ? "page" : undefined}
        className={`flex shrink-0 items-center gap-2 rounded border border-signal-400/40 px-2.5 py-1.5 text-sm font-medium whitespace-nowrap ${
          pathname === "/ask" ? "bg-ink-800 text-mist-100" : "text-signal-400 hover:bg-ink-850"
        }`}
      >
        <span aria-hidden>›</span>
        <span>Ask PIES</span>
      </Link>
      {MODULES.map((m) => {
        const href = `/${m.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={m.letter}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded px-2.5 py-1.5 text-sm whitespace-nowrap ${
              active ? "bg-ink-800 text-mist-100" : "text-mist-300 hover:bg-ink-850 hover:text-mist-100"
            }`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[m.status]}`} />
            <span className="font-mono text-[11px] text-mist-400">{m.letter}</span>
            <span>{m.name}</span>
            <span className="sr-only">({LABEL[m.status]})</span>
          </Link>
        );
      })}
    </nav>
  );
}
