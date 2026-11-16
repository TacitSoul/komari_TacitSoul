import { afterEach, describe, expect, it } from "vitest";
import i18n from "i18next";
import { TS_TEXT_SOURCES, TS_TEXT_TABLES, tsText } from "@/matrix/i18n/tsText";
import keysFromCode from "@/matrix/i18n/tsTextKeys.json";

const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join(",");

describe("tsText (matrix interface text)", () => {
  afterEach(async () => {
    if (i18n.isInitialized) await i18n.changeLanguage("zh-Hans");
  });

  it("has an English entry for every string the localisation pass wrapped", () => {
    const missing = (keysFromCode as string[]).filter((key) => !TS_TEXT_SOURCES.includes(key));
    expect(missing).toEqual([]);
  });

  it("keeps the same placeholders in every translation", () => {
    for (const [language, table] of Object.entries(TS_TEXT_TABLES)) {
      for (const [source, translated] of Object.entries(table)) {
        for (const form of translated.split("|")) {
          expect(`${language}: ${placeholders(form)}`).toBe(`${language}: ${placeholders(source)}`);
        }
      }
    }
  });

  it("shows no Simplified-only characters in zh-Hant (table entries and source fallbacks)", () => {
    // 后 is listed because in this interface it only ever means "after" (後); OpenCC keeps 天后 as a word.
    const simplifiedOnly = /[这们边设开关进说过时么为发对样还从热简体网络连载钮显数据线缓务级测负盘内实闲续费额阈总览图视区态访问页签后余]/;
    const table = TS_TEXT_TABLES["zh-Hant"];
    for (const source of TS_TEXT_SOURCES) {
      const shown = table[source] ?? source;
      expect(simplifiedOnly.test(shown) ? shown : "").toBe("");
    }
  });

  it("follows the UI language and fills placeholders", async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: "zh-Hans", resources: {} });
    await i18n.changeLanguage("en");
    expect(tsText("加载中")).toBe("Loading");
    expect(tsText("任务 #{0}", 7)).toBe("Task #7");
    expect(tsText("{0} 核", 1)).toBe("1 core");
    expect(tsText("{0} 核", 4)).toBe("4 cores");
    expect(tsText("。")).toBe(".");
    await i18n.changeLanguage("zh-Hant");
    expect(tsText("加载中")).toBe("載入中");
    expect(tsText("任务 #{0}", 7)).toBe("任務 #7");
    await i18n.changeLanguage("zh-Hans");
    expect(tsText("加载中")).toBe("加载中");
    expect(tsText("未知的新字符串 {0}", 1)).toBe("未知的新字符串 1");
  });
});
