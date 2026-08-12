import { describe, it, expect } from "vitest";
import { trimKintoneImportText } from "../importTextTrim";

describe("trimKintoneImportText", () => {
  it("削る対象が無ければそのまま返す（前後の空白はtrimする）", () => {
    const text = "  個人KR_1（AAS）\n●達成基準\n基準  \n";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe(text.trim());
    expect(result.removedSectionCount).toBe(0);
    expect(result.originalCharCount).toBe(text.length);
  });

  it("巻末の付録セクション（役割等級要件・面談参考資料）を丸ごと落とす", () => {
    const text = "個人KR_1（AAS）\n●達成基準\n基準\n役割等級要件\nここに長い評価基準の説明が続く\n面談参考資料\nここに面談メモが続く";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe("個人KR_1（AAS）\n●達成基準\n基準");
    // 「役割等級要件」を末尾まで丸ごと落とす時点で、それより後ろにある「面談参考資料」も
    // 一緒に消える（2つ目のheadingはもう見つからないため、カウントは1のまま）。
    expect(result.removedSectionCount).toBe(1);
    expect(result.trimmedCharCount).toBeLessThan(result.originalCharCount);
  });

  it("個人単位の合計値サマリーセクションを次のKR見出しまで落とす", () => {
    const text = "個人KR_1（AAS）\n●達成基準\n基準1\n個人OKR月次評価（達成度）\n合計は75%でした\n個人KR_2（統合営業）\n●達成基準\n基準2";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe("個人KR_1（AAS）\n●達成基準\n基準1\n個人KR_2（統合営業）\n●達成基準\n基準2");
    expect(result.removedSectionCount).toBe(1);
  });

  it("個人単位の合計値サマリーセクションが末尾にある場合は文末まで落とす", () => {
    const text = "個人KR_1（AAS）\n●達成基準\n基準1\n個人OKR 四半期評価（達成度）\n合計は80%でした";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe("個人KR_1（AAS）\n●達成基準\n基準1");
    expect(result.removedSectionCount).toBe(1);
  });

  it("【N月限定KRの一時的なブロックを次のKR見出しまで落とす", () => {
    const text = "個人KR_1（AAS）\n●達成基準\n基準1\n【7月限定KR】\n一時的なKRの内容\n個人KR_2（統合営業）\n●達成基準\n基準2";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe("個人KR_1（AAS）\n●達成基準\n基準1\n個人KR_2（統合営業）\n●達成基準\n基準2");
    expect(result.removedSectionCount).toBe(1);
  });

  it("複数の【N月限定KR】ブロックがあってもすべて落とす", () => {
    const text = "個人KR_1（AAS）\n基準1\n【7月限定KR】\n内容A\n個人KR_2（統合営業）\n基準2\n【8月限定KR】\n内容B\n個人KR_3（勤怠）\n基準3";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe("個人KR_1（AAS）\n基準1\n個人KR_2（統合営業）\n基準2\n個人KR_3（勤怠）\n基準3");
    expect(result.removedSectionCount).toBe(2);
  });

  it("本文中の●や▼の見出しは削らない（安全側：見出し語だけを境界にする）", () => {
    const text = "個人KR_1（AAS）\n●達成基準\n基準1\n●補足\n補足の本文";
    const result = trimKintoneImportText(text);
    expect(result.trimmedText).toBe(text);
    expect(result.removedSectionCount).toBe(0);
  });
});
