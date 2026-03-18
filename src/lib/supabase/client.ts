// src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を .env.local に設定してください");
}

export const supabase = createClient(url, key);
