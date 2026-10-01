// src/lib/reminder/__tests__/notificationClient.test.ts
//
// フロント側の純粋関数：設定の既定値・時刻の正規化・ディープリンク・VAPID 鍵の変換。

import { describe, it, expect } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS, formatReminderTime, prefsFromRow, toReminderTimeOption,
} from "../notificationPrefs";
import { extractOpenTarget, stripOpenParam } from "../deepLink";
import { sameKey, urlBase64ToUint8Array } from "../../push/pushClient";

describe("通知設定の既定値と正規化", () => {
  it("行が無い人は既定値（アプリ内オン・Windowsオフ・8:30）", () => {
    expect(prefsFromRow(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(DEFAULT_NOTIFICATION_PREFS).toMatchObject({ inapp_enabled: true, push_enabled: false, reminder_time: "08:30" });
  });
  it("DB の time を選択肢の値へ。範囲外・30分刻みでない値は既定値に寄せる", () => {
    expect(toReminderTimeOption("12:00:00")).toBe("12:00");
    expect(toReminderTimeOption("7:30:00")).toBe("07:30");
    expect(toReminderTimeOption("06:30:00")).toBe("08:30");
    expect(toReminderTimeOption("08:15:00")).toBe("08:30");
    expect(prefsFromRow({ push_enabled: true, reminder_time: "19:00:00" })).toMatchObject({ push_enabled: true, inapp_enabled: true, reminder_time: "19:00" });
  });
  it("表示は先頭の0を落とす", () => {
    expect(formatReminderTime("08:30")).toBe("8:30");
    expect(formatReminderTime("12:00")).toBe("12:00");
  });
});

describe("通知のクリック先（/?open=my-tasks）", () => {
  it("my-tasks だけを読む", () => {
    expect(extractOpenTarget("?open=my-tasks")).toBe("my-tasks");
    expect(extractOpenTarget("?open=other")).toBeNull();
    expect(extractOpenTarget("")).toBeNull();
  });
  it("open だけを消し、他のクエリとハッシュは残す", () => {
    expect(stripOpenParam("https://app.example/?open=my-tasks")).toBe("/");
    expect(stripOpenParam("https://app.example/?invite=abc&open=my-tasks#x")).toBe("/?invite=abc#x");
  });
});

describe("VAPID 公開鍵の変換", () => {
  it("base64url をバイト列にし、同じ鍵かを比べられる", () => {
    const bytes = urlBase64ToUint8Array("AQID_-8");
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255, 239]);
    expect(sameKey(bytes.buffer as ArrayBuffer, bytes)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2]).buffer, bytes)).toBe(false);
    expect(sameKey(null, bytes)).toBe(false);
  });
});
