import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareVersions, planRelease, readReleaseVersions, releaseVersionMain } from "../scripts/release-version.mjs";
import { publishRelease } from "../scripts/publish-release.mjs";

const versions=version=>({package:version,tauri:version,cargo:version,packageLock:version,packageLockRoot:version,cargoLock:version});
const plan=(changes={})=>planRelease({eventName:"push",ref:"refs/heads/main",current:versions("0.3.0"),previous:"0.2.0",...changes});

function temporaryFolder(t) {
  const folder=mkdtempSync(join(tmpdir(),"nightreign-release-"));
  t.after(()=>{
    assert.equal(dirname(folder),resolve(tmpdir()));
    assert.ok(basename(folder).startsWith("nightreign-release-"));
    rmSync(folder,{recursive:true,force:true});
  });
  return folder;
}

test("only a real main version increase schedules packaging and publishing",()=>{
  assert.equal(plan().publish,true);
  assert.equal(plan().tag,"v0.3.0");
  for(const change of [{previous:"0.3.0"},{eventName:"pull_request"},{ref:"refs/heads/dev"},{ref:"refs/tags/v0.3.0"},{created:true},{deleted:true}]) {
    const result=plan(change);assert.equal(result.build,false);assert.equal(result.publish,false);
  }
  assert.throws(()=>plan({previous:null}),/baseline/);
  assert.throws(()=>plan({previous:"0.4.0"}),/must increase/);
});

test("manual builds default to artifacts; publishing is limited to main",()=>{
  assert.deepEqual([plan({eventName:"workflow_dispatch"}).build,plan({eventName:"workflow_dispatch"}).publish],[true,false]);
  assert.equal(plan({eventName:"workflow_dispatch",manualPublish:true}).publish,true);
  assert.throws(()=>plan({eventName:"workflow_dispatch",manualPublish:true,ref:"refs/heads/dev"}),/target main/);
});

test("release configurations and lockfiles must all agree",()=>{
  for(const key of Object.keys(versions("0.3.0"))) {
    assert.throws(()=>plan({current:{...versions("0.3.0"),[key]:"0.2.0"}}),/mismatch/);
  }
  const current=readReleaseVersions(fileURLToPath(new URL("../",import.meta.url)));
  assert.equal(plan({current,previous:current.package}).publish,false);
});

test("semantic version ordering handles prereleases, numeric components and metadata",()=>{
  const sequence=["0.2.0-alpha","0.2.0-alpha.1","0.2.0-alpha.beta","0.2.0-beta.2","0.2.0-beta.11","0.2.0-rc.1","0.2.0","0.10.0","1.0.0"];
  for(let i=1;i<sequence.length;i++) assert.equal(compareVersions(sequence[i],sequence[i-1]),1);
  assert.equal(compareVersions("0.3.0+build-a","0.3.0+build-b"),0);
  assert.throws(()=>plan({current:versions("0.3.0+new"),previous:"0.3.0+old"}),/must increase/);
  for(const version of ["v0.3.0","01.3.0","0.3","0.3.0-beta.01","0.3.0\nmalicious=true"])
    assert.throws(()=>plan({current:versions(version)}),/Invalid semantic/);
});

test("the executable detector compares the whole push, rather than just HEAD's parent",t=>{
  const folder=temporaryFolder(t);
  const git=(...args)=>execFileSync("git",args,{cwd:folder,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","--initial-branch=main");
  mkdirSync(join(folder,"empty-hooks"));
  git("config","core.hooksPath",join(folder,"empty-hooks"));
  git("config","commit.gpgsign","false");git("config","user.name","Release tests");git("config","user.email","release-tests@example.invalid");
  const writeVersions=version=>{
    mkdirSync(join(folder,"src-tauri"),{recursive:true});
    writeFileSync(join(folder,"package.json"),JSON.stringify({name:"nightreign-pattern-editor",version}));
    writeFileSync(join(folder,"package-lock.json"),JSON.stringify({version,packages:{"":{version}}}));
    writeFileSync(join(folder,"src-tauri/tauri.conf.json"),JSON.stringify({version}));
    writeFileSync(join(folder,"src-tauri/Cargo.toml"),`[package]\nname = "nightreign-pattern-editor"\nversion = "${version}"\n`);
    writeFileSync(join(folder,"src-tauri/Cargo.lock"),`version = 4\n[[package]]\nname = "nightreign-pattern-editor"\nversion = "${version}"\n`);
    git("add",".");git("commit","-m",version);
  };
  writeVersions("0.2.0");const before=git("rev-parse","HEAD");
  writeVersions("0.3.0");writeFileSync(join(folder,"ordinary-change.txt"),"dependency or source edit");
  git("add",".");git("commit","-m","Ordinary change after version bump");
  const sha=git("rev-parse","HEAD"),eventPath=join(folder,"event.json"),output=join(folder,"outputs.txt");
  writeFileSync(eventPath,JSON.stringify({before,created:false,deleted:false}));
  const script=fileURLToPath(new URL("../scripts/release-version.mjs",import.meta.url));
  const env={...process.env,GITHUB_SHA:sha,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"push",GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:output};
  execFileSync(process.execPath,[script],{cwd:folder,env});
  assert.match(readFileSync(output,"utf8"),/publish=true/);
  assert.match(readFileSync(output,"utf8"),new RegExp(`sha=${sha}`));
  writeFileSync(eventPath,JSON.stringify({before:git("rev-parse","HEAD^"),created:false,deleted:false}));writeFileSync(output,"");
  execFileSync(process.execPath,[script],{cwd:folder,env});
  assert.match(readFileSync(output,"utf8"),/build=false/);
});

test("force-push baselines use an authenticated API fallback and fail closed on errors",async t=>{
  const folder=temporaryFolder(t),eventPath=join(folder,"event.json"),output=join(folder,"outputs.txt");
  const before="c".repeat(40),sha="a".repeat(40);
  writeFileSync(eventPath,JSON.stringify({before,created:false,deleted:false}));
  const env={GITHUB_SHA:sha,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"push",GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:output,
    GITHUB_REPOSITORY:"owner/repo",GH_TOKEN:"test-token"};
  const root=fileURLToPath(new URL("../",import.meta.url));
  const result=await releaseVersionMain(env,{root,fetchImpl:async(url,options)=>{
    assert.equal(url.searchParams.get("ref"),before);assert.equal(options.headers.Authorization,"Bearer test-token");
    return new Response(JSON.stringify({version:"0.0.0"}));
  }});
  assert.equal(result.publish,true);
  writeFileSync(output,"");
  await assert.rejects(releaseVersionMain(env,{root,fetchImpl:async()=>new Response("Forbidden",{status:403})}),/HTTP 403/);
  assert.equal(readFileSync(output,"utf8"),"");
});

const sha="a".repeat(40),otherSha="b".repeat(40);
const artifacts=version=>[
  {name:`nightreign-pattern-editor_${version}_windows-x64.exe`,data:Buffer.from("standalone")},
  {name:`Nightreign Pattern Editor_${version}_x64-setup.exe`,data:Buffer.from("installer")}
];

function github({ref=null,release=null,failUpload=false,forbidden=false,annotated=null}={}) {
  const state={ref,release,calls:[],failUpload};
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
  const fetchImpl=async(url,options)=>{
    const parsed=new URL(url),path=parsed.pathname,method=options.method;
    const body=options.headers["Content-Type"]==="application/json" && options.body?JSON.parse(options.body):options.body;
    state.calls.push({path,method,body});
    if(forbidden) return json({message:"Forbidden"},403);
    if(path.includes("/git/ref/tags/")) return state.ref?json({object:state.ref}):json({message:"Not Found"},404);
    if(path.includes("/git/tags/")) return json({object:annotated});
    if(path.includes("/releases/tags/")) return state.release?json(state.release):json({message:"Not Found"},404);
    if(path.endsWith("/git/refs") && method==="POST") {state.ref={type:"commit",sha:body.sha};return json({object:state.ref},201);}
    if(path==="/repos/owner/repo/releases" && method==="POST") {
      state.release={...body,id:7,assets:[],upload_url:"https://uploads.github.com/repos/owner/repo/releases/7/assets{?name,label}"};
      return json(state.release,201);
    }
    if(method==="DELETE") {
      state.release.assets=state.release.assets.filter(asset=>asset.id!==Number(path.split("/").pop()));
      return new Response(null,{status:204});
    }
    if(parsed.hostname==="uploads.github.com") {
      const name=parsed.searchParams.get("name");
      if(state.failUpload && name.endsWith("-setup.exe")) {state.failUpload=false;return json({message:"Upload interrupted"},502);}
      const asset={id:state.calls.length,name};state.release.assets.push(asset);return json(asset,201);
    }
    if(path.endsWith("/releases/7") && method==="PATCH") {Object.assign(state.release,body);return json(state.release);}
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return {state,run:(version="0.3.0",files=artifacts(version))=>publishRelease({repository:"owner/repo",token:"test-token",tag:`v${version}`,sha,artifacts:files,fetchImpl})};
}

test("a successful release creates a tag at the built SHA and uploads both assets before publishing",async()=>{
  const api=github();assert.equal((await api.run()).published,true);
  assert.deepEqual(api.state.ref,{type:"commit",sha});
  assert.equal(api.state.release.target_commitish,sha);
  assert.equal(api.state.release.draft,false);assert.equal(api.state.release.prerelease,false);
  assert.equal(api.state.release.assets.length,2);
  const changes=api.state.calls.filter(call=>call.method!=="GET");
  assert.deepEqual(changes.map(call=>call.method),["POST","POST","POST","POST","PATCH"]);
  assert.equal(changes[1].body.draft,true);
});

test("prereleases are marked correctly without mistaking build metadata for prerelease",async()=>{
  for(const [version,expected] of [["0.3.0-beta.1",true],["0.3.0+build-a",false]]) {
    const api=github();await api.run(version);assert.equal(api.state.release.prerelease,expected);
    assert.equal(api.state.release.make_latest,expected?"false":"legacy");
  }
});

test("an interrupted asset upload leaves a draft and a retry completes it",async()=>{
  const api=github({failUpload:true});
  await assert.rejects(api.run(),/HTTP 502/);
  assert.equal(api.state.release.draft,true);assert.equal(api.state.release.assets.length,1);
  assert.equal((await api.run()).published,true);
  assert.equal(api.state.release.draft,false);assert.equal(api.state.release.assets.length,2);
  assert.equal(api.state.calls.filter(call=>call.method==="DELETE").length,1);
  assert.equal(api.state.calls.filter(call=>call.path.endsWith("/git/refs") && call.method==="POST").length,1);
});

test("published releases remain untouched on repeat runs",async()=>{
  const api=github();await api.run();api.state.calls=[];
  assert.equal((await api.run()).published,false);
  assert.ok(api.state.calls.every(call=>call.method==="GET"));
});

test("tag collisions fail without moving a tag or changing any release",async()=>{
  const api=github({ref:{type:"commit",sha:otherSha}});
  await assert.rejects(api.run(),/another commit/);
  assert.ok(api.state.calls.every(call=>call.method==="GET"));
});

test("existing annotated tags are checked against their underlying commit",async()=>{
  const api=github({ref:{type:"tag",sha:otherSha},annotated:{type:"commit",sha}});
  await api.run();assert.equal(api.state.calls.filter(call=>call.path.endsWith("/git/refs")).length,0);
});

test("API permission failures are not treated as missing releases or tags",async()=>{
  const api=github({forbidden:true});await assert.rejects(api.run(),/HTTP 403/);
  assert.ok(api.state.calls.every(call=>call.method==="GET"));
});

test("a release cannot be created with a missing standalone executable or installer",async()=>{
  for(const files of [[],artifacts("0.3.0").slice(0,1),artifacts("0.3.0").slice(1),[artifacts("0.3.0")[0],artifacts("0.2.0")[1]]]) {
    const api=github();await assert.rejects(api.run("0.3.0",files),/Both/);assert.equal(api.state.calls.length,0);
  }
});
