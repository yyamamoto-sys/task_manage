// src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const isMisconfigured = !url || !key;

// 未設定の場合は App.tsx の isMisconfigured チェックで止まるため、
// ここでは空文字フォールバックでクライアントを生成しておく（呼ばれない）
export const supabase = createClient(url ?? "", key ?? "");
