import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bumpVersion, nextVersion } from "../scripts/bump-version.mjs";
import { readReleaseVersions } from "../scripts/release-version.mjs";

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),"nightreign-version-"));
  t.after(()=>{
    assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith("nightreign-version-"));
    rmSync(root,{recursive:true,force:true});
  });
  mkdirSync(join(root,"src-tauri"));
  const files={
    "package.json":'{\n  "dependencies": {"example": {"version": "0.2.0"}},\n  "name": "nightreign-pattern-editor",\n  "version": "0.2.0"\n}\n',
    "package-lock.json":'{\n  "version": "0.2.0",\n  "packages": {\n    "node_modules/example": {"version": "0.2.0"},\n    "": {"version": "0.2.0"}\n  }\n}\n',
    "src-tauri/tauri.conf.json":'{\n  "plugins": {"example": {"version": "0.2.0"}},\n  "version": "0.2.0",\n  "app": {"windows": [{"title": "Keep inline formatting"}]}\n}\n',
    "src-tauri/Cargo.toml":'# Keep comment\n[package]\nname = "nightreign-pattern-editor"\nversion = "0.2.0" # Keep suffix\n\n[dependencies]\nexample = { version = "0.2.0" }\n',
    "src-tauri/Cargo.lock":'version = 4\n\n[[package]]\nname = "example"\nversion = "0.2.0"\n\n[[package]]\nname = "nightreign-pattern-editor"\nversion = "0.2.0"\n\n[[package]]\nname = "another"\nversion = "0.2.0"\n'
  };
  for(const [name,content] of Object.entries(files)) {
    files[name]=content.replaceAll("\n","\r\n");writeFileSync(join(root,name),files[name]);
  }
  return {root,files};
}

test("one command synchronizes every version while preserving formatting and dependency versions",t=>{
  const {root,files}=fixture(t),result=bumpVersion("0.3.0-beta.1",{root});
  assert.equal(result.version,"0.3.0-beta.1");assert.equal(result.files.length,5);
  assert.ok(Object.values(readReleaseVersions(root)).every(version=>version===result.version));
  for(const [name,original] of Object.entries(files)) {
    const updated=readFileSync(join(root,name),"utf8");
    assert.equal(updated.replaceAll("0.3.0-beta.1","0.2.0"),original,`${name} changed outside version values`);
  }
  assert.equal(JSON.parse(readFileSync(join(root,"package.json"),"utf8")).dependencies.example.version,"0.2.0");
  assert.equal(JSON.parse(readFileSync(join(root,"package-lock.json"),"utf8")).packages["node_modules/example"].version,"0.2.0");
  assert.match(readFileSync(join(root,"src-tauri/Cargo.lock"),"utf8"),/name = "example"\r\nversion = "0.2.0"/);
  assert.match(readFileSync(join(root,"src-tauri/Cargo.lock"),"utf8"),/name = "another"\r\nversion = "0.2.0"/);
});

test("patch, minor and major increments promote prereleases consistently",()=>{
  assert.equal(nextVersion("0.2.0","patch"),"0.2.1");assert.equal(nextVersion("0.2.0","minor"),"0.3.0");assert.equal(nextVersion("0.2.0","major"),"1.0.0");
  assert.equal(nextVersion("0.3.0-beta.1","patch"),"0.3.0");assert.equal(nextVersion("0.3.0-beta.1","minor"),"0.3.0");
  assert.equal(nextVersion("1.0.0-beta.1","major"),"1.0.0");assert.equal(nextVersion("0.2.0","0.3.0-beta.2"),"0.3.0-beta.2");
});

test("invalid, unchanged and decreasing versions leave all files untouched",t=>{
  const {root,files}=fixture(t);
  for(const argument of ["0.2.0","0.1.0","0.2.0+new","v0.3.0","0.3.0-beta.01","invalid"]) {
    assert.throws(()=>bumpVersion(argument,{root}));
    for(const [name,original] of Object.entries(files)) assert.equal(readFileSync(join(root,name),"utf8"),original);
  }
});

test("missing target fields are detected before any file is modified",t=>{
  const {root,files}=fixture(t);
  files["src-tauri/Cargo.lock"]=files["src-tauri/Cargo.lock"].replace('name = "nightreign-pattern-editor"','name = "missing"');
  writeFileSync(join(root,"src-tauri/Cargo.lock"),files["src-tauri/Cargo.lock"]);
  assert.throws(()=>bumpVersion("patch",{root}),/Missing/);
  for(const [name,original] of Object.entries(files)) assert.equal(readFileSync(join(root,name),"utf8"),original);
});

test("CLI accepts a single bump argument and needs no Git repository",t=>{
  const {root}=fixture(t),script=fileURLToPath(new URL("../scripts/bump-version.mjs",import.meta.url));
  const output=execFileSync(process.execPath,[script,"patch"],{cwd:root,encoding:"utf8"});
  assert.match(output,/0.2.0 -> 0.2.1/);assert.ok(Object.values(readReleaseVersions(root)).every(version=>version==="0.2.1"));
});
