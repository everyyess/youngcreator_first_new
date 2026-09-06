"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  var __youngcreatorSupabaseClient: SupabaseClient | undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const browserSupabase = url && key
  ? (globalThis.__youngcreatorSupabaseClient ??= createClient(url, key))
  : null;
