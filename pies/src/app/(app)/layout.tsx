import { Nav } from "@/components/nav";
import { Notice } from "@/components/ui";
import { requireSessionOrSetup } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionOrSetup();
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col md:flex-row">
      <aside className="min-w-0 border-b border-ink-800 bg-ink-950 p-3 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="mb-3 flex items-center justify-between px-2">
          <span className="font-mono text-sm font-semibold tracking-widest text-mist-100">PIES</span>
          {session.kind === "signed_in" ? (
            <form action="/auth/signout" method="post">
              <button className="text-xs text-mist-400 hover:text-mist-100">Sign out</button>
            </form>
          ) : null}
        </div>
        <Nav />
      </aside>
      <main id="main" className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
        {session.kind === "unconfigured" ? (
          <Notice tone="warn">
            <strong>Setup mode.</strong> Supabase is not configured, so nothing is stored or shown and sign-in is disabled. Set{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, apply the migrations, then
            restart. See DEPLOYMENT.md.
          </Notice>
        ) : null}
        {session.kind === "forbidden" ? (
          <Notice tone="bad">
            This account is not on the PIES allowlist, so no data is shown.{" "}
            <a className="underline" href="/login">
              Back to sign in
            </a>
          </Notice>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
