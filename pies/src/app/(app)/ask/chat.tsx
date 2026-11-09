"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Reply } from "@/lib/assistant/answer";
import type { Tone } from "@/lib/assistant/explain";
import { ask, startResearch } from "./actions";

type Msg = { id: number; role: "you" | "pies"; text: string; reply?: Reply };

const TONE: Record<Tone, string> = {
  ok: "border-ok-400/40",
  warn: "border-warn-400/50",
  bad: "border-bad-400/60",
  info: "border-ink-700",
};
const DOT: Record<Tone, string> = { ok: "bg-ok-400", warn: "bg-warn-400", bad: "bg-bad-400", info: "bg-mist-400" };
const START = ["Show my deadlines", "Find scholarships in Canada", "Research now", "Explain why today's research failed", "Check PIES health", "Show my budget"];

interface Status {
  phase: "queued" | "running" | "done" | "unknown";
  message?: string;
  conclusion?: string | null;
  outcome?: string | null;
  metrics?: Record<string, number> | null;
  explanation?: string | null;
  found?: { title: string; source_url: string; deadline: string | null; last_verified_at: string | null }[];
  url?: string;
  steps?: { name: string; status: string; conclusion: string | null }[];
}

function Tracker({ requestId }: { requestId: string }) {
  const [s, setS] = useState<Status>({ phase: "queued", message: "Asking GitHub to start the run…" });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let stop = false;
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    async function poll() {
      while (!stop) {
        try {
          const r = await fetch(`/api/research/status?id=${requestId}`, { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as Status;
            setS(j);
            if (j.phase === "done") break;
          }
        } catch {
          /* keep polling */
        }
        await new Promise((res) => setTimeout(res, 5000));
        if (Date.now() - t0 > 20 * 60_000) {
          setS((p) => ({ ...p, phase: "unknown", message: "Still not finished after 20 minutes. Ask “Research status” or “Explain why today's research failed”." }));
          break;
        }
      }
      clearInterval(tick);
    }
    poll();
    return () => {
      stop = true;
      clearInterval(tick);
    };
  }, [requestId]);

  const m = s.metrics;
  const ok = s.phase === "done" && s.conclusion === "success";
  return (
    <div className="mt-2 rounded border border-ink-700 bg-ink-950/60 p-2 text-xs" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {s.phase === "done" ? (ok ? `Finished: ${s.outcome ?? "done"}` : `Run ${s.conclusion ?? "ended"}`) : (s.message ?? "Working…")}
        </span>
        <span className="font-mono text-mist-400">{s.phase === "done" ? "" : `${elapsed}s`}</span>
      </div>
      {s.steps && s.phase !== "done" ? (
        <ol className="mt-1 flex flex-wrap gap-1 text-mist-400">
          {s.steps.filter((x) => !/^(Set up job|Post |Complete job)/.test(x.name)).map((x) => (
            <li key={x.name} className={x.status === "completed" ? "text-ok-400" : x.status === "in_progress" ? "text-signal-400" : ""}>
              {x.status === "completed" ? "✓" : x.status === "in_progress" ? "…" : "·"} {x.name.replace(" (metrics only)", "")}
            </li>
          ))}
        </ol>
      ) : null}
      {m ? (
        <p className="mt-1 text-mist-300">
          {m.queries ?? 0} searches · {m.extracted ?? 0} pages read · {m.persisted ?? 0} saved · {m.verified ?? 0} verified · {m.rejected ?? 0} rejected · {m.failed ?? 0} failed · cost ${Number(m.committedUsd ?? 0).toFixed(4)}
        </p>
      ) : null}
      {s.explanation ? <p className="mt-1 text-warn-400">{s.explanation}</p> : null}
      {s.found && s.found.length ? (
        <ul className="mt-1 space-y-0.5">
          {s.found.map((f) => (
            <li key={f.source_url} className="break-words">
              <a className="underline" href={f.source_url} target="_blank" rel="noopener noreferrer nofollow">{f.title}</a>
              <span className="text-mist-400"> · {f.deadline ? `deadline ${f.deadline.slice(0, 10)}` : "no deadline found"}{f.last_verified_at ? " · verified" : ""}</span>
            </li>
          ))}
        </ul>
      ) : s.phase === "done" && ok ? (
        <p className="mt-1 text-mist-400">No new opportunities were saved by this run.</p>
      ) : null}
      {s.url ? (
        <a className="mt-1 inline-block text-mist-400 underline" href={s.url} target="_blank" rel="noopener noreferrer">GitHub run log</a>
      ) : null}
    </div>
  );
}

function ReplyView({ reply, onSend, onConfirm, busy }: { reply: Reply; onSend: (t: string) => void; onConfirm: (q: string | null, c: string) => void; busy: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div>
      <p className="whitespace-pre-line">{reply.text}</p>
      {reply.items?.length ? (
        <ul className="mt-2 space-y-1.5">
          {reply.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[it.tone ?? "info"]}`} />
              <div className="min-w-0 break-words">
                {it.href ? (
                  <a className="font-medium underline decoration-ink-700 underline-offset-2" href={it.href} target="_blank" rel="noopener noreferrer nofollow">{it.title}</a>
                ) : (
                  <span className="font-medium">{it.title}</span>
                )}
                {it.detail ? <div className="text-xs text-mist-400">{it.detail}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {reply.confirm ? (
        <div className="mt-2 rounded border border-signal-400/40 p-2">
          <p className="text-xs text-mist-300">Estimated cost: {reply.confirm.estimate}. Review-only: nothing is sent or applied for.</p>
          <button
            type="button"
            disabled={busy || confirmed}
            onClick={() => {
              setConfirmed(true);
              onConfirm(reply.confirm!.query, reply.confirm!.category);
            }}
            className="mt-2 rounded bg-signal-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-signal-400 disabled:opacity-50"
          >
            {confirmed ? "Starting…" : reply.confirm.label}
          </button>
        </div>
      ) : null}
      {reply.track ? <Tracker requestId={reply.track.requestId} /> : null}
      {reply.suggestions?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reply.suggestions.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => onSend(s)} className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:border-mist-400 disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Chat({ initial }: { initial: string | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  const push = (m: Omit<Msg, "id">) => setMsgs((prev) => [...prev, { ...m, id: ++seq.current }]);

  function send(t: string) {
    const v = t.trim();
    if (!v || busy) return;
    push({ role: "you", text: v });
    setText("");
    start(async () => {
      try {
        const reply = await ask(v);
        push({ role: "pies", text: reply.text, reply });
      } catch {
        push({ role: "pies", text: "The server did not answer. Check your connection and try again.", reply: { text: "The server did not answer. Check your connection and try again.", tone: "bad" } });
      }
    });
  }

  function confirm(q: string | null, c: string) {
    start(async () => {
      try {
        const reply = await startResearch(q, c);
        push({ role: "pies", text: reply.text, reply });
      } catch {
        push({ role: "pies", text: "Could not start research.", reply: { text: "Could not start research. Nothing was spent.", tone: "bad" } });
      }
    });
  }

  useEffect(() => {
    if (initial && !sentInitial.current) {
      sentInitial.current = true;
      send(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs.length]);

  return (
    <section aria-label="Command chat" className="flex min-w-0 flex-col gap-3">
      {msgs.length === 0 ? (
        <div className="rounded-lg border border-ink-800 bg-ink-900 p-3 text-sm">
          <p className="text-mist-300">Try one of these:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {START.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:border-mist-400">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col gap-2">
        {msgs.map((m) => (
          <li key={m.id} className={m.role === "you" ? "ml-auto max-w-[85%] rounded-lg bg-signal-500/15 px-3 py-2 text-sm" : `max-w-full rounded-lg border bg-ink-900 px-3 py-2 text-sm ${TONE[m.reply?.tone ?? "info"]}`}>
            {m.role === "you" || !m.reply ? <p className="whitespace-pre-line break-words">{m.text}</p> : <ReplyView reply={m.reply} onSend={send} onConfirm={confirm} busy={busy} />}
          </li>
        ))}
        {busy ? <li className="text-xs text-mist-400" aria-live="polite">PIES is working…</li> : null}
      </ol>
      <div ref={end} />
      <form
        className="sticky bottom-0 flex gap-2 border-t border-ink-800 bg-ink-950 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="cmd" className="sr-only">Command</label>
        <input
          id="cmd"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          autoComplete="off"
          placeholder="e.g. Find grants in Germany"
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-base placeholder:text-mist-400 sm:text-sm"
        />
        <button disabled={busy || !text.trim()} className="rounded bg-signal-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-signal-400 disabled:opacity-50">Send</button>
      </form>
    </section>
  );
}
