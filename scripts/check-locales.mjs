import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const languages = ["en", "zh-CN"];
const contractPath = new URL("src/locales/messages.d.ts", root);

export function messageArguments(text) {
  const argumentsByName = new Map();
  function add(name, kind) {
    const previous = argumentsByName.get(name);
    if (previous && previous !== kind && previous !== "value" && kind !== "value") {
      throw new Error(`Argument ${name} has incompatible uses: ${previous} and ${kind}`);
    }
    argumentsByName.set(name, previous && kind === "value" ? previous : kind);
  }
  function visit(elements) {
    for (const element of elements) {
      if (element.type === TYPE.argument) add(element.value, "value");
      else if (element.type === TYPE.number || element.type === TYPE.plural) add(element.value, "number");
      else if (element.type === TYPE.date || element.type === TYPE.time) add(element.value, "date");
      else if (element.type === TYPE.select) add(element.value, "select");
      if (element.type === TYPE.plural || element.type === TYPE.select) {
        for (const option of Object.values(element.options)) visit(option.value);
      }
    }
  }
  visit(parse(text, { ignoreTag: true }));
  return argumentsByName;
}

export function validateCatalogs(catalogs) {
  const base = catalogs.en;
  const keys = Object.keys(base).sort();
  const contracts = new Map();
  for (const [language, catalog] of Object.entries(catalogs)) {
    const missing = keys.filter(key => !Object.hasOwn(catalog, key));
    const extra = Object.keys(catalog).filter(key => !Object.hasOwn(base, key));
    if (missing.length || extra.length) {
      throw new Error(`${language}: missing keys [${missing.join(", ")}]; extra keys [${extra.join(", ")}]`);
    }
    for (const key of keys) {
      if (!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(key)) throw new Error(`Invalid message key: ${key}`);
      const text = catalog[key];
      if (typeof text !== "string" || !text.trim()) throw new Error(`${language}/${key}: expected a nonempty ICU message`);
      let args;
      try { args = messageArguments(text); }
      catch (error) { throw new Error(`${language}/${key}: ${error.message}`); }
      const existing = contracts.get(key);
      if (!existing) contracts.set(key, args);
      else {
        if ([...existing.keys()].sort().join("\0") !== [...args.keys()].sort().join("\0")) {
          throw new Error(`${language}/${key}: argument names differ from English`);
        }
        for (const [name, kind] of args) {
          const previous = existing.get(name);
          if (previous !== kind && previous !== "value" && kind !== "value") {
            throw new Error(`${language}/${key}: argument ${name} has an incompatible type`);
          }
          if (previous === "value") existing.set(name, kind);
        }
      }
    }
  }
  return contracts;
}

export function generateContracts(contracts) {
  const typeFor = kind => ({ number: "number", date: "number | Date", select: "string", value: "string | number | LocalizedMessage" })[kind];
  const entries = [...contracts].map(([key, args]) => {
    const fields = [...args].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, kind]) => `${JSON.stringify(name)}: ${typeFor(kind)}`).join("; ");
    return `  ${JSON.stringify(key)}: { ${fields} };`;
  });
  return `// Generated from the locale catalogs. Run pnpm locales:generate after editing messages.\n` +
    `export interface MessageParams {\n${entries.join("\n")}\n}\n\n` +
    `export type MessageKey = keyof MessageParams;\n` +
    `export type MessageArguments<K extends MessageKey> = keyof MessageParams[K] extends never\n` +
    `  ? [key: K]\n  : [key: K, values: MessageParams[K]];\n` +
    `export type LocalizedMessage = {\n` +
    `  [K in MessageKey]: keyof MessageParams[K] extends never\n` +
    `    ? { readonly key: K; readonly values?: never }\n` +
    `    : { readonly key: K; readonly values: MessageParams[K] }\n` +
    `}[MessageKey];\n`;
}

export function validateEntityTypes(source, contracts) {
  const seen=new Set();
  for(const line of source.split(/\r?\n/).slice(1)) {
    if(!line.trim()) continue;
    // Identity and type columns precede names, which may contain quoted commas.
    const match=line.match(/^([a-z_]+),(\d+),([^,]*),([^,]*),/);
    if(!match) throw new Error(`Invalid entity identity: ${line}`);
    const [,kind,id,variation,type]=match,key=`${kind}:${id}:${variation}`;
    if(seen.has(key)) throw new Error(`Duplicate entity key ${key}`);
    seen.add(key);
    if(kind==="special_event") throw new Error("Known event names belong to event.kind messages, not the entity table");
    if(kind==="spot" && type && (!/^[a-z][a-zA-Z0-9]*$/.test(type) || !contracts.has(`unitType.${type}`))) {
      throw new Error(`Unknown or untranslated unit type ${type}`);
    }
  }
}

export function validateBackendErrors(source, contracts) {
  for (const match of source.matchAll(/AppError::(new|params|diagnostic|contextual)\(\s*"([^"]+)"/g)) {
    const key = match[2];
    const expected = contracts.get(key);
    if (!expected) throw new Error(`Untranslated backend error code ${key}`);
    const open = source.indexOf("(", match.index);
    const args = [];
    let start = open + 1, depth = 0, quoted = false, escaped = false;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === ")" && depth === 0) { args.push(source.slice(start, index)); break; }
      else if ("({[".includes(character)) depth++;
      else if (")}]".includes(character)) depth--;
      else if (character === "," && depth === 0) { args.push(source.slice(start, index)); start = index + 1; }
    }
    let names = [];
    if (match[1] === "params" || match[1] === "contextual") {
      const object = args[1]?.trim().match(/^(?:serde_json::)?json!\(\s*\{([\s\S]*)\}\s*\)$/);
      if (!object) throw new Error(`${key}: backend errors must declare their named parameters`);
      names = [...object[1].matchAll(/"([^"]+)"\s*:/g)].map(item => item[1]);
    }
    if (names.sort().join("\0") !== [...expected.keys()].sort().join("\0")) {
      throw new Error(`${key}: backend parameters differ from the message contract`);
    }
  }
}

async function main() {
  const catalogs = {};
  for (const language of languages) {
    const path = new URL(`src/locales/${language}.json`, root);
    const text = await readFile(path, "utf8");
    const ast = ts.parseJsonText(fileURLToPath(path), text);
    const seen = new Set();
    const object = ast.statements[0]?.expression;
    if (object && ts.isObjectLiteralExpression(object)) {
      for (const property of object.properties) {
        const key = property.name?.text;
        if (seen.has(key)) throw new Error(`${language}: duplicate key ${key}`);
        seen.add(key);
      }
    }
    catalogs[language] = JSON.parse(text);
  }
  const argumentsByKey = validateCatalogs(catalogs);
  validateEntityTypes(await readFile(new URL("data/pattern_names.csv",root),"utf8"),argumentsByKey);
  const rustDirectory = new URL("src-tauri/src/", root);
  for (const name of await readdir(rustDirectory)) {
    if (!name.endsWith(".rs")) continue;
    const source = await readFile(new URL(name, rustDirectory), "utf8");
    try { validateBackendErrors(source, argumentsByKey); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  const contracts = generateContracts(argumentsByKey);
  const previous = await readFile(contractPath, "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (process.argv.includes("--write")) {
    if (previous !== contracts) await writeFile(contractPath, contracts, "utf8");
  } else if (previous !== contracts) {
    throw new Error("Message types are out of date. Run pnpm locales:generate.");
  }
  console.log(`Validated ${Object.keys(catalogs.en).length} messages in ${languages.length} languages.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
