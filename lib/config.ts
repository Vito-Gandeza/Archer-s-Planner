/**
 * Public configuration.
 *
 * SUPABASE_PUBLISHABLE_KEY is a *publishable* key: it is meant to sit in the
 * browser bundle where anyone can read it, and on its own it can read nothing,
 * because row-level security scopes every table to the signed-in user_id. It
 * is also rotatable on its own from the Supabase dashboard without
 * invalidating anybody's session, which is why it is preferred here over the
 * older anon JWT. Committing it keeps a clone deployable with no setup;
 * environment variables still win wherever they are set.
 *
 * Secrets never live here. GEMINI_API_KEY is read from the environment,
 * server-side only, and there is no service-role key anywhere in this project.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ecfenrpcissasgruvqpb.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_8fIia_7X8LR_6FWOeoToNw_MwG_pinH";

/** DLSU's Canvas. Also the origin /api/sync accepts cross-origin posts from. */
export const CANVAS_ORIGIN = process.env.NEXT_PUBLIC_CANVAS_ORIGIN || "https://dlsu.instructure.com";
