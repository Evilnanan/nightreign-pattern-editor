import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseVersion(version) {
  const match=typeof version==="string" && version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/);
  if(!match || match[4]?.split(".").some(part=>/^0\d+$/.test(part))) throw new Error(`Invalid semantic version: ${version}`);
  return {core:match.slice(1,4).map(BigInt),pre:match[4]?.split(".") ?? null};
}

export function compareVersions(left,right) {
  const a=parseVersion(left),b=parseVersion(right);
  for(let i=0;i<3;i++) if(a.core[i]!==b.core[i]) return a.core[i]>b.core[i]?1:-1;
  if(a.pre===null || b.pre===null) return a.pre===b.pre?0:a.pre===null?1:-1;
  for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++) {
    const x=a.pre[i],y=b.pre[i];
    if(x===y) continue;
    if(x===undefined || y===undefined) return x===undefined?-1:1;
    const xNumeric=/^\d+$/.test(x),yNumeric=/^\d+$/.test(y);
    if(xNumeric && yNumeric) return BigInt(x)>BigInt(y)?1:-1;
    if(xNumeric!==yNumeric) return xNumeric?-1:1;
    return x>y?1:-1;
  }
  return 0;
}

const tomlField=(section,name)=>section?.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`,"m"))?.[1];

export function readReleaseVersions(root=".") {
  const json=path=>JSON.parse(readFileSync(resolve(root,path),"utf8"));
  const pkg=json("package.json"),lock=json("package-lock.json");
  const cargo=readFileSync(resolve(root,"src-tauri/Cargo.toml"),"utf8").split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoLock=readFileSync(resolve(root,"src-tauri/Cargo.lock"),"utf8").split(/^\[\[package\]\]\s*$/m)
    .find(section=>tomlField(section,"name")===pkg.name);
  return {
    package:pkg.version,tauri:json("src-tauri/tauri.conf.json").version,cargo:tomlField(cargo,"version"),
    packageLock:lock.version,packageLockRoot:lock.packages?.[""]?.version,cargoLock:tomlField(cargoLock,"version")
  };
}

export function planRelease({eventName,ref,current,previous=null,manualPublish=false,created=false,deleted=false}) {
  parseVersion(current.package);
  for(const [source,version] of Object.entries(current)) {
    if(version!==current.package) throw new Error(`Version mismatch: package=${current.package}, ${source}=${version}`);
  }
  const plan={build:false,publish:false,version:current.package,tag:`v${current.package}`,reason:"Tests only: version unchanged"};
  if(eventName==="workflow_dispatch") {
    if(manualPublish && ref!=="refs/heads/main") throw new Error("Manual publishing must target main; rerun the original workflow to retry an older commit");
    return {...plan,build:true,publish:manualPublish,reason:manualPublish?"Manual release/retry":"Manual build without publishing"};
  }
  if(eventName!=="push" || ref!=="refs/heads/main" || deleted) return {...plan,reason:"Tests only: not a main push"};
  if(created) return {...plan,reason:"Tests only: new main branch has no previous version; use manual publishing for the first release"};
  if(previous===null) throw new Error("Cannot read the version before this push; refusing to publish without a baseline");
  if(previous===current.package) return plan;
  if(compareVersions(current.package,previous)<=0) throw new Error(`Release version must increase: ${previous} -> ${current.package}`);
  return {...plan,build:true,publish:true,reason:`Version increased: ${previous} -> ${current.package}`};
}

export async function releaseVersionMain(env=process.env,{root=".",fetchImpl=fetch}={}) {
  const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,"utf8"));
  const sha=env.GITHUB_SHA;
  if(!/^[\da-f]{40}$/.test(sha ?? "")) throw new Error("Missing or invalid workflow commit SHA");
  let previous=null;
  if(env.GITHUB_EVENT_NAME==="push" && !event.created && !event.deleted) {
    if(!/^[\da-f]{40}$/.test(event.before ?? "") || /^0+$/.test(event.before)) throw new Error("Missing push baseline SHA");
    const show=()=>execFileSync("git",["show",`${event.before}:package.json`],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    let oldPackage;
    try {oldPackage=show();}
    catch {
      // A force push may remove the old commit from the fetched branch history.
      const url=new URL(`${env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${env.GITHUB_REPOSITORY}/contents/package.json`);
      url.searchParams.set("ref",event.before);
      const response=await fetchImpl(url,{headers:{Accept:"application/vnd.github.raw+json",Authorization:`Bearer ${env.GH_TOKEN}`,"User-Agent":"nightreign-pattern-editor"}});
      if(!response.ok) throw new Error(`Cannot read push baseline ${event.before}: HTTP ${response.status}`);
      oldPackage=await response.text();
    }
    previous=JSON.parse(oldPackage).version;
  }
  const plan=planRelease({eventName:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,current:readReleaseVersions(root),previous,
    manualPublish:env.MANUAL_PUBLISH==="true",created:event.created,deleted:event.deleted});
  appendFileSync(env.GITHUB_OUTPUT,Object.entries({...plan,sha}).map(([key,value])=>`${key}=${value}\n`).join(""));
  console.log(plan.reason);
  return plan;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await releaseVersionMain();
