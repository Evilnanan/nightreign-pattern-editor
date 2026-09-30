import assert from "node:assert/strict";
import test from "node:test";
import { generateContracts, validateBackendErrors, validateCatalogs, validateEntityTypes } from "../scripts/check-locales.mjs";

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
