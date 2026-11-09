import { Chat } from "./chat";

export const metadata = { title: "Ask PIES" };

export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const initial = typeof sp.cmd === "string" ? sp.cmd.slice(0, 200) : null;
  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">Ask PIES</h1>
        <p className="text-sm text-mist-400">
          Type a command in plain words. PIES answers from your stored data and can start research on request. It understands a fixed set of commands; it is not a general chatbot.
        </p>
      </header>
      <Chat initial={initial} />
    </>
  );
}
