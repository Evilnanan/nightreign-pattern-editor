import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { generateContracts, validateBackendErrors, validateCatalogs, validateEntityTypes } from "../scripts/check-locales.mjs";

test("locale checker accepts LF and CRLF files but rejects outdated types", async () => {
  const cache = new URL("../.cache/", import.meta.url);
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(new URL("locale-check-", cache));
  assert.equal(dirname(directory), resolve(fileURLToPath(cache)));
  const fixture = pathToFileURL(`${directory}/`);
  const file = path => new URL(path, fixture);
  const catalogs = {
    en: { "assets.loaded": "Loaded {count, number} icons from {path}" },
    "zh-CN": { "assets.loaded": "从 {path} 读取 {count, number} 张图标" },
  };
  const contracts = generateContracts(validateCatalogs(catalogs));
  const check = promisify(execFile);
  try {
    for (const path of ["scripts/", "src/locales/", "src-tauri/src/", "data/"]) {
      await mkdir(file(path), { recursive: true });
    }
    await copyFile(new URL("../scripts/check-locales.mjs", import.meta.url), file("scripts/check-locales.mjs"));
    for (const [language, catalog] of Object.entries(catalogs)) {
      await writeFile(file(`src/locales/${language}.json`), JSON.stringify(catalog));
    }
    await writeFile(file("data/pattern_names.csv"), "kind,id,variation,type,name,name_zh\n");
    const contractFile = file("src/locales/messages.d.ts");
    const script = fileURLToPath(file("scripts/check-locales.mjs"));
    for (const newline of ["\n", "\r\n"]) {
      await writeFile(contractFile, contracts.replaceAll("\n", newline));
      const { stdout } = await check(process.execPath, [script]);
      assert.match(stdout, /Validated 1 messages in 2 languages/);
    }
    await check(process.execPath, [script, "--write"]);
    assert.equal(await readFile(contractFile, "utf8"), contracts, "Generation writes canonical LF output");
    const outdated = contracts.replace('"count": number', '"count": string').replaceAll("\n", "\r\n");
    await writeFile(contractFile, outdated);
    await assert.rejects(check(process.execPath, [script]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Message types are out of date/);
      return true;
    });
    assert.equal(await readFile(contractFile, "utf8"), outdated, "Validation leaves outdated types for the developer to fix");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ICU argument contracts allow language-specific plural forms", () => {
  const contracts = validateCatalogs({
    en: { "assets.loaded": "{count, plural, one {# icon} other {# icons}} from {path}" },
    "zh-CN": { "assets.loaded": "从 {path} 读取 {count} 张图标" },
  });
  assert.equal(contracts.get("assets.loaded").get("count"), "number");
  assert.match(generateContracts(contracts), /"count": number/);
});

test("entity metadata requires stable translated types and unique identities",()=>{
  const contracts=validateCatalogs({en:{"unitType.fort":"Fort"}});
  const header="kind,id,variation,type,name,name_zh\n";
  validateEntityTypes(header+'spot,3000,0,fort,"Name, with comma",名称\n',contracts);
  assert.throws(()=>validateEntityTypes(header+"spot,3000,0,Fort,Name,\n",contracts),/unit type/);
  assert.throws(()=>validateEntityTypes(header+"spot,3000,0,missing,Name,\n",contracts),/unit type/);
  assert.throws(()=>validateEntityTypes(header+"spot,3000,0,fort,One,\nspot,3000,0,fort,Two,\n",contracts),/Duplicate entity/);
  assert.throws(()=>validateEntityTypes(header+"special_event,3010,7701,,Meteor,\n",contracts),/event.kind/);
});

test("catalog validation rejects missing keys, renamed arguments, and invalid ICU", () => {
  const en = { "assets.loaded": "Loaded {count, plural, one {# icon} other {# icons}}" };
  assert.throws(() => validateCatalogs({ en, "zh-CN": {} }), /missing keys/);
  assert.throws(() => validateCatalogs({ en, "zh-CN": { "assets.loaded": "{quantity} 张图标" } }), /argument names/);
  assert.throws(() => validateCatalogs({ en: { "assets.loaded": "{count, plural, one {# icon}}" } }), /MISSING_OTHER_CLAUSE/);
  assert.throws(() => validateCatalogs({ en: { "assets.loaded": "" } }), /nonempty/);
});

test("catalog validation rejects conflicting parameter types and sentence keys", () => {
  assert.throws(() => validateCatalogs({
    en: { "assets.loaded": "{value, number}" },
    "zh-CN": { "assets.loaded": "{value, date}" },
  }), /incompatible type/);
  assert.throws(() => validateCatalogs({ en: { "Reload Assets": "Reload Assets" } }), /Invalid message key/);
});

test("backend error codes and serialized parameter names match the messages", () => {
  const contracts = validateCatalogs({ en: { "errors.iconRead": "Could not read {file}." } });
  validateBackendErrors('AppError::contextual("errors.iconRead", serde_json::json!({"file": name}), e)', contracts);
  assert.throws(() => validateBackendErrors('AppError::new("errors.iconRead")', contracts), /parameters differ/);
  assert.throws(() => validateBackendErrors('AppError::params("errors.iconRead", serde_json::json!({"path": name}))', contracts), /parameters differ/);
  assert.throws(() => validateBackendErrors('AppError::new("errors.unknown")', contracts), /Untranslated/);
});
