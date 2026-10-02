import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { compareVersions, readReleaseVersions } from "./release-version.mjs";

export function nextVersion(current,argument) {
  compareVersions(current,current);
  let next=argument;
  if(["patch","minor","major"].includes(argument)) {
    const [major,minor,patch]=current.split(/[+-]/)[0].split(".").map(BigInt);
    const prerelease=current.split("+")[0].includes("-");
    if(argument==="major") next=`${prerelease && minor===0n && patch===0n?major:major+1n}.0.0`;
    if(argument==="minor") next=`${major}.${prerelease && patch===0n?minor:minor+1n}.0`;
    if(argument==="patch") next=`${major}.${minor}.${prerelease?patch:patch+1n}`;
  }
  if(compareVersions(next,current)<=0) throw new Error(`Version must increase: ${current} -> ${next}`);
  return next;
}

function updateJson(source,paths,version) {
  JSON.parse(source);
  const parsed=ts.parseJsonText("version.json",source);
  const root=parsed.statements[0]?.expression;
  const edits=paths.map(path=>{
    let node=root;
    for(const key of path) {
      if(!node || !ts.isObjectLiteralExpression(node)) throw new Error(`Missing JSON version field: ${path.join(".")}`);
      const matches=node.properties.filter(property=>property.name?.text===key);
      if(matches.length!==1) throw new Error(`Missing or duplicate JSON version field: ${path.join(".")}`);
      node=matches[0].initializer;
    }
    if(!node || !ts.isStringLiteral(node)) throw new Error(`Invalid JSON version field: ${path.join(".")}`);
    return {start:node.getStart(parsed),end:node.end};
  }).sort((a,b)=>b.start-a.start);
  for(const {start,end} of edits) source=source.slice(0,start)+JSON.stringify(version)+source.slice(end);
  return source;
}

function updateToml(source,header,version,packageName) {
  const headers=Array.from(source.matchAll(/^\[\[?[^\]\r\n]+\]\]?[ \t]*\r?$/gm));
  const sections=headers.flatMap((match,index)=>{
    if(match[0].trim()!==header) return [];
    const start=match.index+match[0].length,end=headers[index+1]?.index ?? source.length;
    const body=source.slice(start,end);
    if(packageName && body.match(/^[ \t]*name[ \t]*=[ \t]*"([^"\r\n]+)"/m)?.[1]!==packageName) return [];
    return [{start,end,body}];
  });
  if(sections.length!==1) throw new Error(`Missing or duplicate TOML package section: ${header}`);
  const {start,end,body}=sections[0];
  const pattern=/^([ \t]*version[ \t]*=[ \t]*)"[^"\r\n]*"/gm;
  if(Array.from(body.matchAll(pattern)).length!==1) throw new Error(`Missing or duplicate TOML package version: ${header}`);
  return source.slice(0,start)+body.replace(pattern,(_,prefix)=>prefix+JSON.stringify(version))+source.slice(end);
}

export function bumpVersion(argument,{root="."}={}) {
  const versions=readReleaseVersions(root),next=nextVersion(versions.package,argument);
  const pkg=JSON.parse(readFileSync(resolve(root,"package.json"),"utf8"));
  const files=[
    ["package.json",source=>updateJson(source,[["version"]],next)],
    ["src-tauri/tauri.conf.json",source=>updateJson(source,[["version"]],next)],
    ["package-lock.json",source=>updateJson(source,[["version"],["packages","","version"]],next)],
    ["src-tauri/Cargo.toml",source=>updateToml(source,"[package]",next)],
    ["src-tauri/Cargo.lock",source=>updateToml(source,"[[package]]",next,pkg.name)]
  ].map(([name,update])=>{
    const path=resolve(root,name),original=readFileSync(path,"utf8");
    return {name,path,original,updated:update(original)};
  });
  // Prepare every edit before writing; restore completed writes if one fails.
  const written=[];
  try {for(const file of files) {writeFileSync(file.path,file.updated);written.push(file);}}
  catch(error) {for(const file of written.reverse()) writeFileSync(file.path,file.original);throw error;}
  return {previous:versions.package,version:next,files:files.map(file=>file.name)};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==3) throw new Error("Usage: pnpm version:bump <patch|minor|major|version>");
  const result=bumpVersion(process.argv[2]);
  console.log(`${result.previous} -> ${result.version}\nUpdated ${result.files.join(", ")}`);
}
