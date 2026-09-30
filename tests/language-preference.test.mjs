import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const source = await readFile(new URL("../src/i18n.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const catalogs = {};
for (const language of ["en", "zh-CN"]) {
  catalogs[language] = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), "utf8"));
}
const load = new Function("require", "exports", "localStorage", "navigator", compiled + "\nreturn exports;");
const requireModule = id => {
  if (id === "intl-messageformat") return { IntlMessageFormat };
  if (id === "./locales/en.json") return catalogs.en;
  if (id === "./locales/zh-CN.json") return catalogs["zh-CN"];
  throw new Error(`Unexpected module ${id}`);
};
const storage = saved => {
  const preferences = new Map(saved ? [["nightreign-map-language", saved]] : []);
  return {
    getItem: key => preferences.get(key) ?? null,
    setItem: (key, value) => preferences.set(key, value),
  };
};

test("first launch selects the first supported system language and matches regional variants", () => {
  for (const [languages, expected] of [
    [["zh-CN"], "zh-CN"], [["zh", "en-US"], "zh-CN"], [["zh-Hans-CN"], "zh-CN"],
    [["zh-TW"], "zh-CN"], [["en-US", "zh-CN"], "en"], [["en-GB"], "en"],
    [["ja-JP", "zh-CN", "en-US"], "zh-CN"], [["fr-FR"], "en"],
  ]) {
    const preferences = storage();
    const i18n = load(requireModule, {}, preferences, { languages, language: languages[0] });
    assert.equal(i18n.getLanguage(), expected, languages.join(", "));
    assert.equal(i18n.t("ui.events"), catalogs[expected]["ui.events"]);
    assert.equal(preferences.getItem("nightreign-map-language"), null, "Automatic detection does not record a manual preference");
  }
});

test("saved language overrides the system while an invalid preference uses detection", () => {
  for (const [saved, locale, expected] of [["en", "zh-CN", "en"], ["zh-CN", "en-US", "zh-CN"], ["invalid", "zh-CN", "zh-CN"]]) {
    assert.equal(load(requireModule, {}, storage(saved), { languages: [locale], language: locale }).getLanguage(), expected);
  }
});

test("startup uses navigator.language when the preferred list is empty and defaults without a navigator", () => {
  assert.equal(load(requireModule, {}, storage(), { languages: [], language: "zh-CN" }).getLanguage(), "zh-CN");
  assert.equal(load(requireModule, {}, storage(), undefined).getLanguage(), "en");
});

test("system language still works when preference storage is unavailable", () => {
  const unavailable = { getItem: () => { throw new Error("Storage unavailable"); }, setItem: () => { throw new Error("Storage unavailable"); } };
  const i18n = load(requireModule, {}, unavailable, { languages: ["zh-CN"], language: "zh-CN" });
  assert.equal(i18n.getLanguage(), "zh-CN");
  i18n.setLanguage("en");
  assert.equal(i18n.getLanguage(), "en");
});

test("a manual language selection persists across launches with a different system language", () => {
  const preferences = storage();
  const i18n = load(requireModule, {}, preferences, { languages: ["zh-CN"], language: "zh-CN" });
  i18n.setLanguage("en");
  assert.equal(load(requireModule, {}, preferences, { languages: ["zh-TW"], language: "zh-TW" }).getLanguage(), "en");
});
