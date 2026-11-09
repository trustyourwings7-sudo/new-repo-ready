"use client";

/** Shown instead of a blank page when anything inside the app fails to render. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-bad-400/60 bg-ink-900 p-4 text-sm">
      <p className="font-medium">Something on this page failed to display.</p>
      <p className="mt-1 text-mist-400">Nothing was sent, started or changed. Try again; if it repeats, ask Claude to check the logs.</p>
      <button type="button" onClick={reset} className="mt-3 rounded bg-signal-500 px-3 py-1.5 font-medium text-ink-950 hover:bg-signal-400">Try again</button>
    </div>
  );
}
