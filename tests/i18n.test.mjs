import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createServer } from "vite";
import { validateCatalogs } from "../scripts/check-locales.mjs";

const preferences = new Map([["nightreign-map-language", "zh-CN"]]);
let server, i18n, entityNames, storedLanguage;
before(async () => {
  globalThis.localStorage = {
    getItem: key => preferences.get(key) ?? null,
    setItem: (key, value) => { preferences.set(key, value); },
  };
  server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
  i18n = await server.ssrLoadModule("/src/i18n.ts");
  entityNames = await server.ssrLoadModule("/src/entity-names.ts");
  storedLanguage = i18n.getLanguage();
});
beforeEach(() => { i18n.setLanguage("en"); });
after(async () => { delete globalThis.localStorage; await server.close(); });

test("the existing stored language preference is preserved", () => {
  assert.equal(storedLanguage, "zh-CN");
});

test("named arguments and plural rules work for zero, one, and multiple counts", () => {
  for (const count of [0, 1, 2]) {
    assert.equal(i18n.t("status.assetsLoaded", { count, path: "icons" }), `Loaded ${count} ${count === 1 ? "icon" : "icons"} from icons`);
  }
  assert.equal(i18n.t("status.dataLoaded", { patterns: 1 }), "Loaded 1 Pattern");
  i18n.setLanguage("zh-CN");
  assert.equal(i18n.t("status.assetsLoaded", { count: 1, path: "icons" }), "已从 icons 读取 1 张图标");
  assert.equal(i18n.t("save.button", { count: 0 }), "保存 regulation.bin");
});

test("saved status messages and nested labels follow later language changes", () => {
  const status = i18n.message("status.iconSettingsSaved", {
    unitId: 4100, variationSuffix: "|0", layer: i18n.message("assets.baseIcon"),
  });
  assert.match(i18n.formatMessage(status), /Base Icon/);
  i18n.setLanguage("zh-CN");
  assert.ok(i18n.formatMessage(status).includes(i18n.t("assets.baseIcon")));
  assert.ok(!i18n.formatMessage(status).includes("Base Icon"));
});

test("backend and client error descriptors can be translated after the error occurs", () => {
  const backend = i18n.errorMessage({ code: "errors.iconDirectoryMissing", params: { path: "icons" } });
  const client = new i18n.LocalizedError(i18n.message("errors.invalidIconData", { file: "bad.png" }));
  const status = i18n.message("errors.reloadAssets", { error: i18n.errorMessage(client) });
  assert.equal(i18n.formatMessage(backend), "Cannot find the icon directory: icons");
  assert.match(i18n.formatMessage(status), /Invalid icon data: bad.png/);
  i18n.setLanguage("zh-CN");
  assert.equal(i18n.formatMessage(backend), "找不到图标目录：icons");
  assert.ok(!i18n.formatMessage(status).includes("Invalid icon data"));
  assert.ok(i18n.formatMessage(status).includes("bad.png"));
});

test("language notifications persist the preference and support unsubscribing", () => {
  const changes = [];
  const unsubscribe = i18n.subscribeLanguage(language => { changes.push(language); });
  i18n.setLanguage("zh-CN");
  i18n.setLanguage("zh-CN");
  assert.deepEqual(changes, ["zh-CN"]);
  assert.equal(preferences.get("nightreign-map-language"), "zh-CN");
  unsubscribe();
  i18n.setLanguage("en");
  assert.deepEqual(changes, ["zh-CN"]);
  assert.throws(() => i18n.setLanguage("fr"), /Unsupported language/);
});

test("missing Chinese messages use English plural rules", async () => {
  const chinese = (await server.ssrLoadModule("/src/locales/zh-CN.json")).default;
  const previous = chinese["status.assetsLoaded"];
  delete chinese["status.assetsLoaded"];
  try {
    i18n.setLanguage("zh-CN");
    assert.equal(i18n.t("status.assetsLoaded", { count: 1, path: "icons" }), "Loaded 1 icon from icons");
  } finally { chinese["status.assetsLoaded"] = previous; }
});

test("entity names retain trimmed Chinese translations and English fallback", () => {
  i18n.setLanguage("zh-CN");
  assert.equal(i18n.localizedName({ name: "Boss", nameZh: "  首领  " }), "首领");
  assert.equal(i18n.localizedName({ name: "Boss", nameZh: "  " }), "Boss");
  i18n.setLanguage("en");
  assert.equal(i18n.localizedName({ name: "Boss", nameZh: "首领" }), "Boss");
});

test("entity labels translate stable types, retain short names and support bilingual searches", () => {
  const named={kind:"spot",id:3000,variation:0,type:"fort",name:"Lordsworn Captain",nameZh:"君王军队长"};
  assert.equal(entityNames.entityLabel([named],"spot",3000,0,true),"Fort - Lordsworn Captain");
  assert.equal(entityNames.entityName(named),"Lordsworn Captain");
  assert.equal(entityNames.unitTypeId("Difficult Sorcerer's Rise"),"difficultRise");
  i18n.setLanguage("zh-CN");
  assert.equal(entityNames.entityLabel([named],"spot",3000,0,true),"要塞 - 君王军队长");
  assert.equal(entityNames.entityName(named),"君王军队长");
  const search=entityNames.entitySearchText(named);
  for(const text of ["fort - lordsworn captain","君王军队长","要塞 - 君王军队长"]) assert.ok(search.includes(text));
  assert.equal(entityNames.entityLabel([named],"spot",9999,2),"9999|2");
  assert.equal(entityNames.entityLabel([named],"terrain",99),"99");
  assert.equal(entityNames.unitTypeName("customType"),"customType");
  assert.equal(entityNames.entityName({...named,nameZh:null},true),"要塞 - Lordsworn Captain");
});

test("persistent tower captions use type IDs across languages and exclude Followers",async()=>{
  const source=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
  const parsed=ts.createSourceFile("main.ts",source,ts.ScriptTarget.ES2022,true);
  const declaration=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text==="confirmedBossName");
  const compiled=ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const state={criteria:new Map(),data:{names:[]}},spot={unitId:4090,variationId:0,rowId:1};
  const caption=new Function("state","displayedSpot","key","numeric","confirmedUnitName","findEntityName","unitTypeId",compiled+"\nreturn confirmedBossName;")(
    state,()=>spot,(id,variation)=>`${id}|${variation}`,(_p,_table,_row,_field,original)=>original,
    ()=>"Tree, Candle",entityNames.findEntityName,entityNames.unitTypeId);
  for(const language of ["en","zh-CN"]) {
    i18n.setLanguage(language);
    state.data.names=[{kind:"spot",id:4090,variation:0,type:"difficultRise",name:"Renamed display text",nameZh:"新名字"}];
    assert.equal(caption({typeIndex:2},{}),"Tree\nCandle");
    spot.unitId=4330;assert.equal(caption({typeIndex:6},{}),null);spot.unitId=4090;
  }
});

test("every catalog message formats in both languages across plural branches", async () => {
  const catalogs = {};
  for (const language of ["en", "zh-CN"]) {
    catalogs[language] = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), "utf8"));
  }
  const contracts = validateCatalogs(catalogs);
  for (const language of ["en", "zh-CN"]) for (const count of [0, 1, 2]) {
    i18n.setLanguage(language);
    for (const [key, args] of contracts) {
      const values = Object.fromEntries([...args].map(([name, kind]) => [name, kind === "number" ? count : kind === "date" ? new Date(0) : "sample"]));
      assert.equal(typeof i18n.formatMessage({ key, values }), "string", `${language}/${key}`);
    }
  }
});

test("resource reload still updates filenames, numeric matching, and replaced image bytes", async () => {
  const icons = await server.ssrLoadModule("/src/icon-mapping.ts");
  assert.ok(icons.iconFiles.includes("3800.webp"));
  const resource = bytes => ({ name: "987654321.PNG", dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` });
  icons.setIconResources([resource([1, 2, 3])]);
  assert.equal(icons.automaticUnitIcons["987654321"], "987654321.PNG");
  assert.equal(icons.missingIcon("3800.webp"), true);
  const previous = icons.imageUrl("987654321.PNG");
  icons.setIconResources([resource([4, 5, 6])]);
  const current = icons.imageUrl("987654321.PNG");
  assert.notEqual(current, previous);
  assert.deepEqual([...new Uint8Array(await (await fetch(current)).arrayBuffer())], [4, 5, 6]);
  assert.throws(() => icons.setIconResources([{ name: "bad.png", dataUrl: "invalid" }]), i18n.LocalizedError);
  assert.equal(icons.imageUrl("987654321.PNG"), current);
  icons.setIconResources([]);
  assert.equal(icons.missingIcon("987654321.PNG"), true);
  assert.equal(icons.automaticUnitIcons["987654321"], undefined);
});

test("translation keys, missing parameters, and numeric counts are checked by TypeScript", async () => {
  await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
  const path = new URL("../.cache/i18n-typecheck.ts", import.meta.url);
  await writeFile(path, `import { t, message } from "../src/i18n";\n` +
    `t("status.assetsLoaded", { count: 1, path: "icons" });\n` +
    `message("errors.reloadAssets", { error: message("errors.noChanges") });\n` +
    `// @ts-expect-error Unknown message key\nt("assets.unknown");\n` +
    `// @ts-expect-error Missing values\nt("status.assetsLoaded");\n` +
    `// @ts-expect-error Missing path\nt("status.assetsLoaded", { count: 1 });\n` +
    `// @ts-expect-error Count must be numeric\nt("status.assetsLoaded", { count: "one", path: "icons" });\n` +
    `// @ts-expect-error Extra values are not allowed\nt("assets.reload", { path: "icons" });\n`);
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const fixture = fileURLToPath(path);
  const program = ts.createProgram([...parsed.fileNames, fixture], parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});
