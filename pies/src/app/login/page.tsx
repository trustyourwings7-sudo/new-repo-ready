import { Notice } from "@/components/ui";
import { requestMagicLink } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Enter a valid email address.",
  unconfigured: "Sign-in is unavailable: Supabase is not configured yet.",
  forbidden: "This account is not allowed to use PIES.",
  callback: "The sign-in link was invalid or expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const sent = sp.sent === "1";
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="font-mono text-xl font-semibold tracking-widest">PIES</h1>
      <p className="text-sm text-mist-400">Private system. Sign in with the owner email to receive a one-time link.</p>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {sent ? <Notice>If this address is allowed, a sign-in link is on its way.</Notice> : null}
      <form action={requestMagicLink} className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
        />
        <button className="mt-1 rounded bg-signal-500 px-3 py-2 text-sm font-medium text-ink-950 hover:bg-signal-400">Send sign-in link</button>
      </form>
    </main>
  );
}
