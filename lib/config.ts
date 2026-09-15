/**
 * Public configuration.
 *
 * The Supabase anon key is a *publishable* key: it is designed to ship inside
 * the browser bundle, and on its own it can read nothing, because row-level
 * security scopes every table to the signed-in user_id. Committing it keeps a
 * clone deployable with no setup. Environment variables still win where set.
 *
 * Secrets never live here. ANTHROPIC_API_KEY is read from the environment,
 * server-side only, and there is no service-role key anywhere in this project.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ecfenrpcissasgruvqpb.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZmVucnBjaXNzYXNncnV2cXBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODM0ODcsImV4cCI6MjEwNTA1OTQ4N30.keKZ6FfCIhdHrxuX9ZU--VoMlv4UoBXe7KJB4YTD_s8";

/** DLSU's Canvas. Also the origin /api/sync accepts cross-origin posts from. */
export const CANVAS_ORIGIN = process.env.NEXT_PUBLIC_CANVAS_ORIGIN || "https://dlsu.instructure.com";
