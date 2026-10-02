import { t } from "./i18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatPatternSeed, isPatternReachable, type SeedRequest, type SeedResponse } from "./pattern-seeds";

type SeedMode="normal"|"deep";
type SeedState={seed:number|null;busy:boolean;failed:boolean;requestId:number};
const modes:SeedMode[]=["normal","deep"];
const cache=new Map<number,Record<SeedMode,SeedState>>();
const pending=new Map<number,{pattern:number;mode:SeedMode}>();
const copyFeedbackTimers=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();
const seedProjectUrl="https://github.com/Evilnanan/nightreign-derandomizer";
let worker:Worker|null=null,sequence=0;

function seedsFor(pattern:number) {
  let entry=cache.get(pattern);
  if(!entry) {
    const empty=():SeedState=>({seed:null,busy:false,failed:false,requestId:0});
    entry={normal:empty(),deep:empty()};cache.set(pattern,entry);
  }
  return entry;
}

export function previewSeedHtml(pattern:number) {
  const helpId=`seed-help-${pattern}`;
  return `<div class="detail-section preview-seeds" data-pattern-seeds="${pattern}"><h3>${t("seeds.heading")}<button type="button" class="seed-help-button" popovertarget="${helpId}" aria-label="${t("seeds.help")}" title="${t("seeds.help")}" aria-expanded="false" aria-controls="${helpId}">?</button></h3><div id="${helpId}" class="seed-help-popover" popover="auto" role="dialog" aria-labelledby="${helpId}-title"><div class="seed-help-head"><strong id="${helpId}-title">${t("seeds.helpTitle")}</strong><button type="button" class="seed-help-close" popovertarget="${helpId}" popovertargetaction="hide" aria-label="${t("ui.close")}">×</button></div><p>${t("seeds.helpDescription")}</p><a class="seed-help-link" href="${seedProjectUrl}" target="_blank" rel="noopener noreferrer">${t("seeds.helpOpenProject")} ↗</a><div class="seed-help-error" role="status" aria-live="polite"></div></div>${modes.map(mode=>
    `<div class="preview-seed-row"><label for="pattern-seed-${mode}">${t(mode==="normal"?"seeds.normal":"seeds.deep")}</label><div class="preview-seed-controls"><div class="preview-seed-field"><input id="pattern-seed-${mode}" class="preview-seed-input" type="text" readonly autocomplete="off" spellcheck="false" data-seed-mode="${mode}"><span class="seed-copy-status" role="status" aria-live="polite"></span></div><button type="button" class="button secondary compact" data-reroll-seed="${mode}" aria-label="${t("seeds.rerollMode",{mode:t(mode==="normal"?"seeds.normal":"seeds.deep")})}">${t("seeds.reroll")}</button></div></div>`).join("")}</div>`;
}

function syncSeedControls(pattern:number) {
  const panel=document.querySelector<HTMLElement>(`[data-pattern-seeds="${pattern}"]`);
  if(!panel) return;
  const entry=seedsFor(pattern);
  for(const mode of modes) {
    const state=entry[mode],reachable=isPatternReachable(pattern,mode==="deep");
    const input=panel.querySelector<HTMLInputElement>(`[data-seed-mode="${mode}"]`)!;
    input.value=state.seed===null?"":formatPatternSeed(state.seed);
    input.placeholder=!reachable?t("seeds.unavailable"):state.failed?t("seeds.failed"):t("seeds.generating");
    input.disabled=!reachable || state.busy || state.seed===null;
    input.setAttribute("aria-busy",String(state.busy));
    panel.querySelector<HTMLButtonElement>(`[data-reroll-seed="${mode}"]`)!.disabled=!reachable || state.busy;
  }
}

function seedWorker() {
  if(worker) return worker;
  worker=new Worker(new URL("./pattern-seed-worker.ts",import.meta.url),{type:"module"});
  worker.addEventListener("message",(event:MessageEvent<SeedResponse>)=>{
    const job=pending.get(event.data.requestId);
    if(!job) return;
    pending.delete(event.data.requestId);
    const state=seedsFor(job.pattern)[job.mode];
    if(state.requestId!==event.data.requestId) return;
    state.busy=false;state.failed=event.data.seed===null;
    if(event.data.seed!==null) state.seed=event.data.seed;
    syncSeedControls(job.pattern);
  });
  worker.addEventListener("error",()=>{
    worker?.terminate();worker=null;
    for(const [requestId,job] of pending) {
      const state=seedsFor(job.pattern)[job.mode];
      if(state.requestId===requestId) {state.busy=false;state.failed=true;syncSeedControls(job.pattern);}
    }
    pending.clear();
  });
  return worker;
}

function rerollSeed(pattern:number,mode:SeedMode) {
  const state=seedsFor(pattern)[mode];
  if(state.busy || !isPatternReachable(pattern,mode==="deep")) return;
  state.busy=true;state.failed=false;state.requestId=++sequence;
  syncSeedControls(pattern);
  try {
    const random=crypto.getRandomValues(new Uint32Array(2));
    const request:SeedRequest={requestId:state.requestId,pattern,deepOfNight:mode==="deep",start:random[0],stride:random[1],exclude:state.seed};
    pending.set(request.requestId,{pattern,mode});
    seedWorker().postMessage(request);
  } catch {
    pending.delete(state.requestId);state.busy=false;state.failed=true;syncSeedControls(pattern);
  }
}

function clearCopyFeedback(status:HTMLElement) {
  clearTimeout(copyFeedbackTimers.get(status));
  copyFeedbackTimers.delete(status);
  status.classList.remove("is-visible");
  status.textContent="";
}

function showCopyFeedback(status:HTMLElement,copied:boolean) {
  clearCopyFeedback(status);
  status.textContent=t(copied?"seeds.copied":"seeds.copyFailed");
  // Restart the animation and lifetime on every copy attempt.
  void status.offsetWidth;
  status.classList.add("is-visible");
  copyFeedbackTimers.set(status,setTimeout(()=>clearCopyFeedback(status),1800));
}

async function copySeed(input:HTMLInputElement) {
  if(input.disabled || !input.value) return;
  const seed=input.value;
  let copied=false;
  try {await navigator.clipboard.writeText(seed);copied=true;}
  catch {
    // Legacy WebViews require a selection to copy. Keep it offscreen so the
    // displayed seed and its caret stay untouched.
    const active=document.activeElement as HTMLElement|null;
    const temporary=document.createElement("textarea");
    temporary.value=seed;temporary.readOnly=true;
    temporary.style.cssText="position:fixed;left:-9999px;top:0";
    document.body.append(temporary);
    try {temporary.select();copied=document.execCommand("copy");}
    catch {copied=false;}
    finally {temporary.remove();active?.focus({preventScroll:true});}
  }
  const status=input.parentElement?.querySelector<HTMLElement>(".seed-copy-status");
  if(status && input.isConnected && !input.disabled && input.value===seed)
    showCopyFeedback(status,copied);
}

export function bindPreviewSeeds(root:HTMLElement,pattern:number) {
  const panel=root.querySelector<HTMLElement>("[data-pattern-seeds]")!;
  const help=panel.querySelector<HTMLElement>(".seed-help-popover")!;
  const helpButton=panel.querySelector<HTMLButtonElement>(".seed-help-button")!;
  help.addEventListener("toggle",()=>{
    const open=help.matches(":popover-open");
    helpButton.setAttribute("aria-expanded",String(open));
    if(!open) return;
    const trigger=helpButton.getBoundingClientRect(),margin=12;
    const left=Math.max(margin,Math.min(trigger.left,window.innerWidth-help.offsetWidth-margin));
    const below=trigger.bottom+8,above=trigger.top-help.offsetHeight-8;
    const top=below+help.offsetHeight<=window.innerHeight-margin?below:Math.max(margin,above);
    help.style.left=`${left}px`;help.style.top=`${top}px`;
  });
  help.querySelector<HTMLAnchorElement>(".seed-help-link")!.addEventListener("click",event=>{
    if(!isTauri()) return;
    event.preventDefault();
    const status=help.querySelector<HTMLElement>(".seed-help-error")!;
    status.textContent="";
    void openUrl(seedProjectUrl).catch(error=>{
      console.error("Failed to open seed project",error);
      status.textContent=t("seeds.helpOpenFailed");
    });
  });
  for(const mode of modes) {
    const input=panel.querySelector<HTMLInputElement>(`[data-seed-mode="${mode}"]`)!;
    input.addEventListener("click",()=>{void copySeed(input);});
    input.addEventListener("keydown",event=>{
      if(event.key==="Enter" || event.key===" ") {event.preventDefault();void copySeed(input);}
    });
    panel.querySelector<HTMLButtonElement>(`[data-reroll-seed="${mode}"]`)!.addEventListener("click",()=>{
      clearCopyFeedback(input.parentElement!.querySelector<HTMLElement>(".seed-copy-status")!);
      rerollSeed(pattern,mode);
    });
    const state=seedsFor(pattern)[mode];
    if(state.seed===null && !state.busy && !state.failed) rerollSeed(pattern,mode);
  }
  syncSeedControls(pattern);
}
