import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function publishRelease({repository,token,tag,sha,artifacts,apiUrl="https://api.github.com",fetchImpl=fetch}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !token) throw new Error("Missing repository or GitHub token");
  if(!/^v\d+\.\d+\.\d+(?:[-+][\da-zA-Z.+-]+)?$/.test(tag ?? "") || !/^[\da-f]{40}$/.test(sha ?? "")) throw new Error("Invalid release tag or commit SHA");
  if(!artifacts.some(file=>file.name===`nightreign-pattern-editor_${tag.slice(1)}_windows-x64.exe`) ||
    !artifacts.some(file=>file.name.includes(`_${tag.slice(1)}_`) && file.name.endsWith("-setup.exe")))
    throw new Error("Both the standalone executable and installer for this version are required before publishing");
  const prerelease=tag.split("+")[0].includes("-");
  const base=`${apiUrl.replace(/\/$/,"")}/repos/${repository}`;
  async function request(path,{method="GET",body,optional=false,binary=false}={}) {
    const url=path.startsWith("https://")?path:`${base}${path}`;
    const response=await fetchImpl(url,{method,headers:{
      Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json",
      "Content-Type":binary?"application/octet-stream":"application/json","User-Agent":"nightreign-pattern-editor"
    },body:body===undefined?undefined:binary?body:JSON.stringify(body)});
    if(optional && response.status===404) return null;
    if(!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}: ${await response.text()}`);
    return response.status===204?null:response.json();
  }
  const encodedTag=encodeURIComponent(tag);
  const ref=await request(`/git/ref/tags/${encodedTag}`,{optional:true});
  if(ref) {
    let object=ref.object;
    for(let depth=0;object.type==="tag" && depth<8;depth++) object=(await request(`/git/tags/${object.sha}`)).object;
    if(object.type!=="commit" || object.sha!==sha) throw new Error(`Tag ${tag} already points to another commit; it will not be moved`);
  }
  let release=await request(`/releases/tags/${encodedTag}`,{optional:true});
  if(release && !ref) throw new Error(`Release ${tag} exists without its tag; refusing to repair it automatically`);
  if(release && !release.draft) return {published:false,reason:`Release ${tag} is already published; assets left unchanged`};
  if(!ref) await request("/git/refs",{method:"POST",body:{ref:`refs/tags/${tag}`,sha}});
  if(!release) release=await request("/releases",{method:"POST",body:{
    tag_name:tag,target_commitish:sha,name:`Nightreign Pattern Editor ${tag}`,
    draft:true,prerelease,generate_release_notes:true
  }});
  // A failed upload leaves a draft. Only draft assets may be replaced on retry.
  for(const file of artifacts) {
    const existing=release.assets.find(asset=>asset.name===file.name);
    if(existing) await request(`/releases/assets/${existing.id}`,{method:"DELETE"});
    const upload=new URL(release.upload_url.split("{")[0]);
    upload.searchParams.set("name",file.name);
    await request(upload.href,{method:"POST",body:file.data,binary:true});
  }
  await request(`/releases/${release.id}`,{method:"PATCH",body:{draft:false,prerelease,make_latest:prerelease?"false":"legacy"}});
  return {published:true,reason:`Published ${tag} at ${sha}`};
}

async function main() {
  const folder=resolve("artifacts");
  const artifacts=readdirSync(folder).filter(name=>name.endsWith(".exe")).sort().map(name=>({name,data:readFileSync(resolve(folder,name))}));
  const result=await publishRelease({repository:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN,
    tag:process.env.RELEASE_TAG,sha:process.env.RELEASE_SHA,apiUrl:process.env.GITHUB_API_URL,artifacts});
  console.log(result.reason);
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();
