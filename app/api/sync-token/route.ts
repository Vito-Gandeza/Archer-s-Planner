import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { hashToken } from "@/lib/token";

export const runtime = "nodejs";

/** Mint a sync token. The plaintext is returned once and never stored. */
export async function POST() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const token = `csp_${randomBytes(32).toString("base64url")}`;
  // One live token per student keeps the extension setup unambiguous.
  await sb.from("sync_tokens").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  const { error } = await sb
    .from("sync_tokens")
    .insert({ user_id: auth.user.id, token_hash: hashToken(token), label: "extension" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ token });
}

export async function DELETE() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  await sb.from("sync_tokens").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  return NextResponse.json({ ok: true });
}
