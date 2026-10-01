// src/lib/push/pushClient.ts
//
// このブラウザの Service Worker 登録と Web Push 購読（設計書 §3.1・§8.1）。
// 購読はブラウザ単位。DB の行（push_subscriptions）は register_push_subscription RPC で本人の行として登録する。
// SW は public/sw.js（push と notificationclick のみ・キャッシュしない）。

export const SW_URL = "/sw.js";

export function getVapidPublicKey(): string | null {
  const k = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof k === "string" && k.trim() !== "" ? k.trim() : null;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/** Teams のタブ内（iframe）では通知の許可を求められない */
export function isInIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

/** VAPID 公開鍵（base64url）→ applicationServerKey 用のバイト列 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function toSubscriptionKeys(sub: PushSubscription): SubscriptionKeys | null {
  const j = sub.toJSON();
  const p256dh = j.keys?.p256dh;
  const auth = j.keys?.auth;
  if (!j.endpoint || !p256dh || !auth) return null;
  return { endpoint: j.endpoint, p256dh, auth };
}

async function registerWorker(): Promise<ServiceWorkerRegistration> {
  // updateViaCache:"none" … sw.js を HTTP キャッシュから読まない（古い SW が残らないように。vercel.json も no-store）
  await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** このブラウザの既存の購読（SW 未登録・未購読なら null）。許可ダイアログは出さない */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * このブラウザで購読する（既にあればそれを返す）。鍵が変わっていたら購読し直す。
 * 許可（Notification.permission === "granted"）は呼び出し側で取っておくこと。
 */
export async function subscribeThisBrowser(vapidPublicKey: string): Promise<SubscriptionKeys> {
  const reg = await registerWorker();
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  }
  const keys = toSubscriptionKeys(sub);
  if (!keys) throw new Error("ブラウザから購読情報を取得できませんでした");
  return keys;
}

/** このブラウザの購読を解除する。解除した endpoint を返す（無ければ null） */
export async function unsubscribeThisBrowser(): Promise<string | null> {
  const sub = await getCurrentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
