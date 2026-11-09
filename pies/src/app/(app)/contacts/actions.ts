"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth";

const ORG_TYPES = ["employer", "university", "college", "funder", "government", "ngo", "accelerator", "business", "school", "clinic", "travel", "hospitality", "other"] as const;
const url = z.string().trim().max(500).regex(/^https?:\/\/\S+$/, "must start with http:// or https://");
const optUrl = z.union([z.literal(""), url]).transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).transform((v) => (v ? v : null));
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

const orgSchema = z.object({
  name: z.string().trim().min(1).max(300),
  website: optUrl,
  country: optText(80),
  org_type: z.union([z.literal(""), z.enum(ORG_TYPES)]).transform((v) => (v ? v : null)),
  source_url: optUrl,
  description: optText(1000),
});

const contactSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    role_title: optText(200),
    organization_id: z.union([z.literal(""), uuid]).transform((v) => (v ? v : null)),
    source_url: url,
    public_email: z.union([z.literal(""), z.string().trim().max(254).email()]).transform((v) => (v ? v.toLowerCase() : null)),
    email_source_url: optUrl,
    profile_url: optUrl,
    notes: optText(1000),
  })
  .refine((c) => !c.public_email || c.email_source_url, { message: "an email needs the page where it is published", path: ["email_source_url"] });

function fields(fd: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));
}

async function owner() {
  const s = await getSession();
  if (s.kind !== "signed_in") redirect("/login");
  return s;
}

function done(msg: string, error = false): never {
  revalidatePath("/contacts");
  redirect(`/contacts?${error ? "error" : "ok"}=${encodeURIComponent(msg)}`);
}

export async function saveOrganization(fd: FormData) {
  const s = await owner();
  const parsed = orgSchema.safeParse(fields(fd, ["name", "website", "country", "org_type", "source_url", "description"]));
  if (!parsed.success) done(`Organization not saved: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, true);
  const id = String(fd.get("id") ?? "");
  const { error } = id
    ? await s.supabase.from("organizations").update(parsed.data).eq("id", uuid.parse(id))
    : await s.supabase.from("organizations").insert({ ...parsed.data, user_id: s.userId });
  if (error) done("Organization not saved (database refused it).", true);
  done(id ? "Organization updated." : "Organization added.");
}

export async function deleteOrganization(fd: FormData) {
  const s = await owner();
  if (fd.get("confirm") !== "yes") done("Tick “confirm” to delete.", true);
  const { error } = await s.supabase.from("organizations").delete().eq("id", uuid.parse(String(fd.get("id"))));
  if (error) done("Organization not deleted.", true);
  done("Organization deleted. Its contacts were kept, without an organization.");
}

export async function saveContact(fd: FormData) {
  const s = await owner();
  const parsed = contactSchema.safeParse(fields(fd, ["full_name", "role_title", "organization_id", "source_url", "public_email", "email_source_url", "profile_url", "notes"]));
  if (!parsed.success) done(`Contact not saved: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, true);
  const id = String(fd.get("id") ?? "");
  const { error } = id
    ? await s.supabase.from("contacts").update(parsed.data).eq("id", uuid.parse(id))
    : await s.supabase.from("contacts").insert({ ...parsed.data, user_id: s.userId });
  if (error) done("Contact not saved (database refused it).", true);
  done(id ? "Contact updated." : "Contact added.");
}

export async function deleteContact(fd: FormData) {
  const s = await owner();
  if (fd.get("confirm") !== "yes") done("Tick “confirm” to delete.", true);
  const { error } = await s.supabase.from("contacts").delete().eq("id", uuid.parse(String(fd.get("id"))));
  if (error) done("Contact not deleted.", true);
  done("Contact deleted.");
}
