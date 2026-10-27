/* Checks i18n.js: every locale is complete and consistent with English, plurals pick the
 * right form, and language tags resolve as ChatGPT and browsers report them.
 * Load i18n.js, then this file, then call CBDI18nTests.run().
 */
(function (root) {
  "use strict";
  function run() {
    const { create, resolve, LOCALES, MESSAGES } = root.CBDI18n;
    const results = [];
    const check = (ok, name) => { results.push({ name, passed: Boolean(ok) }); };
    const placeholders = value => [...new Set((typeof value === "string" ? [value] : Object.values(value))
      .flatMap(text => text.match(/\{\w+\}/g) || []))].sort().join();
    const en = MESSAGES.en;

    for (const locale of LOCALES) {
      const table = MESSAGES[locale];
      // Key names like Shift+End may stay English; words (click, drag) and the rest may not.
      const required = Object.keys(en).filter(key => !key.startsWith("k") || ["kClick", "kDrag", "kShiftClick"].includes(key));
      const missing = required.filter(key => !(key in table));
      check(!missing.length, `${locale}: no missing messages (${missing.join(", ")})`);
      const extra = Object.keys(table).filter(key => !(key in en));
      check(!extra.length, `${locale}: no unknown keys (${extra.join(", ")})`);
      const mismatched = Object.keys(table).filter(key => key in en && placeholders(table[key]) !== placeholders(en[key]));
      check(!mismatched.length, `${locale}: placeholders match English (${mismatched.join(", ")})`);
      // Every plural category the language uses must have a form (or fall back to "other").
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      const plural = Object.entries(table).filter(([, value]) => typeof value === "object");
      const noOther = plural.filter(([, value]) => !value.other).map(([key]) => key);
      check(!noOther.length, `${locale}: plural messages have "other" (${noOther.join(", ")})`);
      const unknown = plural.flatMap(([key, value]) => Object.keys(value).filter(c => !categories.includes(c)).map(c => `${key}.${c}`));
      check(!unknown.length, `${locale}: plural categories exist in the language (${unknown.join(", ")})`);
    }

    const en1 = create("en-US");
    check(en1.t("chats", { n: 1 }) === "1 Chat" && en1.t("chats", { n: 10 }) === "10 Chats", "English: 1 Chat / 10 Chats");
    check(en1.t("chats", { n: 1234 }) === "1,234 Chats", "Numbers use the locale's grouping");
    check(create("ko-KR").t("chats", { n: 10 }) === "대화 10개", "Korean keeps 대화 N개");
    const ru = create("ru");
    check([1, 3, 5, 21].map(n => ru.t("chats", { n })).join("|") === "1 чат|3 чата|5 чатов|21 чат", "Russian one/few/many");
    check(create("de").t("chats", { n: 1000 }) === "1.000 Chats", "German grouping and plural");
    check(resolve("zh-Hant-HK") === "zh-TW" && resolve("zh-TW") === "zh-TW" && resolve("zh-Hans") === "zh-CN" && resolve("zh") === "zh-CN",
      "Chinese tags pick simplified or traditional");
    check(resolve("pt-PT") === "pt-BR" && resolve("es-419") === "es" && resolve("ja_JP") === "ja", "Regional tags map to supported locales");
    check(create("xx", "nl-NL").locale === "en" && create("", "fr-CA").locale === "fr", "Unknown tags fall back to the next tag, then English");
    const parts = create("en").parts("chats", { n: 2 });
    check(parts.length === 2 && parts[0].name === "n" && parts[0].value === "2" && parts[1] === " Chats", "parts() exposes the number for styling");
    check(create("ko").t("kShiftEnd") === "Shift+End", "Untranslated key labels fall back to English");
    return results;
  }
  root.CBDI18nTests = { run };
})(globalThis);
