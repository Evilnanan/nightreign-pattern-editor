import { t } from "./i18n";

export type LocationPreviewField="spawn"|"circle1"|"circle2"|"location";
export type PickerChangeDetail={pointerY:number|null};

function normalizePickerSearch(value:string) {
  return value.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase();
}

export function pickerOptionMatches(query:string,label:string,value:string) {
  const terms=normalizePickerSearch(query).trim().split(/\s+/u).filter(Boolean);
  const candidates=[label,value].map(normalizePickerSearch);
  return terms.every(term=>candidates.some(candidate=>{
    let position=0;
    for(const character of term) {
      const index=candidate.indexOf(character,position);
      if(index===-1) return false;
      position=index+character.length;
    }
    return true;
  }));
}

function commitPickerOption(select:HTMLSelectElement,option:HTMLButtonElement,trigger:HTMLButtonElement,event?:MouseEvent) {
  select.value=option.dataset.positionValue!;
  const previousFocus=document.activeElement;
  select.dispatchEvent(new CustomEvent<PickerChangeDetail>("change",{bubbles:true,detail:{pointerY:event?.detail ? event.clientY : null}}));
  // Changes may focus a newly added event card. Only restore the dropdown focus
  // when its handler left focus alone or removed the previously focused node.
  if(document.activeElement===previousFocus || document.activeElement===document.body)
    document.getElementById(trigger.id)?.focus({preventScroll:true});
}

// Keep the original select and its change handlers as the source of truth.
// Native popup menus cannot reliably share app scrollbar styles or hover events.
function enhanceSelects(root:HTMLElement) {
  root.querySelectorAll<HTMLSelectElement>("select").forEach((select,index)=>{
    if(select.hidden || select.multiple || select.closest(".location-picker")) return;
    const id=`picker-${root.id || "editor"}-${index}`;
    const picker=document.createElement("div");picker.className="location-picker";
    picker.dataset.locationPicker=select.dataset.locationPreview ?? "";
    select.before(picker);picker.append(select);select.hidden=true;
    const trigger=document.createElement("button");trigger.type="button";trigger.id=id;trigger.className="location-picker-trigger";
    trigger.setAttribute("role","combobox");trigger.setAttribute("aria-haspopup","listbox");trigger.setAttribute("aria-expanded","false");
    trigger.setAttribute("aria-controls",`${id}-options`);
    const label=picker.closest("label")?.querySelector<HTMLElement>(":scope > span");
    if(label) {label.id ||= `${id}-label`;trigger.setAttribute("aria-labelledby",`${label.id} ${id}-value`);}
    else trigger.setAttribute("aria-label",select.getAttribute("aria-label") ?? "");
    const value=document.createElement("span");value.id=`${id}-value`;
    const arrow=document.createElement("span");arrow.textContent="▾";arrow.setAttribute("aria-hidden","true");
    trigger.append(value,arrow);
    const menu=document.createElement("div");menu.id=`${id}-options`;menu.className="location-picker-options";menu.hidden=true;
    menu.setAttribute("role","listbox");if(label) menu.setAttribute("aria-labelledby",label.id);
    for(const source of Array.from(select.options)) {
      const option=document.createElement("button");option.type="button";option.className="location-picker-option";option.tabIndex=-1;
      option.textContent=source.text;option.dataset.positionValue=source.value;
      if(source.dataset.previewValue!==undefined) option.dataset.previewValue=source.dataset.previewValue;
      option.disabled=source.disabled;option.setAttribute("role","option");menu.append(option);
    }
    picker.append(trigger,menu);
  });
}

export function bindLocationPickers(root:HTMLElement, preview:(field:LocationPreviewField|null, value?:number)=>void) {
  enhanceSelects(root);
  const controller=new AbortController();
  const {signal}=controller;
  const closeAll: (()=>void)[]=[];
  let activePreview:HTMLElement|null=null;
  root.querySelectorAll<HTMLElement>("[data-location-picker]").forEach(picker=>{
    const trigger=picker.querySelector<HTMLButtonElement>(".location-picker-trigger")!;
    const menu=picker.querySelector<HTMLElement>(".location-picker-options")!;
    const select=picker.querySelector<HTMLSelectElement>("select")!;
    const options=Array.from(menu.querySelectorAll<HTMLButtonElement>("[data-position-value]"));
    const searchBar=document.createElement("div");searchBar.className="location-picker-search-bar";
    const searchInput=document.createElement("input");searchInput.type="search";searchInput.className="location-picker-search";
    searchInput.placeholder=t("ui.searchDropdown");searchInput.setAttribute("aria-label",t("ui.searchDropdown"));searchInput.autocomplete="off";
    searchBar.append(searchInput);
    const list=document.createElement("div");list.id=`${trigger.id}-listbox`;list.setAttribute("role","listbox");
    const labelId=menu.getAttribute("aria-labelledby");if(labelId) list.setAttribute("aria-labelledby",labelId);
    list.append(...options);
    const empty=document.createElement("div");empty.className="location-picker-empty";empty.textContent=t("ui.noMatchingOptions");
    empty.setAttribute("role","status");empty.hidden=true;
    menu.removeAttribute("role");menu.removeAttribute("aria-labelledby");menu.replaceChildren(searchBar,list,empty);
    trigger.setAttribute("aria-controls",list.id);searchInput.setAttribute("aria-controls",list.id);
    const field=picker.dataset.locationPicker as LocationPreviewField|"";
    const sync=()=>{
      trigger.querySelector("span")!.textContent=select.selectedOptions[0]?.text ?? "";
      trigger.disabled=select.disabled;
      for(const option of options) option.setAttribute("aria-selected",String(option.dataset.positionValue===select.value));
    };
    sync();select.addEventListener("change",sync,{signal});
    const isOpen=()=>!menu.hidden;
    const clearPreview=()=>{
      if(activePreview!==menu) return;
      activePreview=null;preview(null);
    };
    const close=()=>{
      menu.hidden=true;
      trigger.setAttribute("aria-expanded","false");
      clearPreview();
    };
    closeAll.push(close);
    const position=()=>{
      const bounds=trigger.getBoundingClientRect(),gap=4,padding=8;
      const below=window.innerHeight-bounds.bottom-gap-padding,above=bounds.top-gap-padding;
      const height=Math.min(280,Math.max(below,above));
      menu.style.width=`${bounds.width}px`;
      menu.style.maxHeight=`${height}px`;
      menu.style.left=`${Math.max(padding,Math.min(bounds.left,window.innerWidth-bounds.width-padding))}px`;
      menu.style.top=below>=Math.min(280,menu.scrollHeight) || below>=above
        ? `${bounds.bottom+gap}px` : `${Math.max(padding,bounds.top-gap-Math.min(menu.scrollHeight,height))}px`;
    };
    const focusOption=(option:HTMLButtonElement)=>{
      option.focus({preventScroll:true});
      option.scrollIntoView({block:"nearest"});
    };
    const enabledOptions=()=>options.filter(option=>!option.hidden && !option.disabled);
    const filterOptions=()=>{
      clearPreview();
      for(const option of options) option.hidden=!pickerOptionMatches(searchInput.value,option.textContent ?? "",option.dataset.positionValue ?? "");
      empty.hidden=options.some(option=>!option.hidden);
      menu.scrollTop=0;
      if(isOpen()) position();
    };
    searchInput.addEventListener("input",filterOptions,{signal});
    const open=(query="")=>{
      if(select.disabled) return;
      closeAll.forEach(close=>close());
      searchInput.value=query;
      filterOptions();
      menu.hidden=false;
      trigger.setAttribute("aria-expanded","true");
      position();
      searchInput.focus({preventScroll:true});
    };
    const startSearch=(event:KeyboardEvent)=>{
      if(select.disabled || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.key.length!==1 || event.key===" ") return false;
      event.preventDefault();
      if(!isOpen()) open(event.key);
      else {searchInput.value+=event.key;filterOptions();searchInput.focus({preventScroll:true});}
      return true;
    };
    trigger.addEventListener("click",()=>{if(isOpen()) close();else open();},{signal});
    trigger.addEventListener("keydown",event=>{
      if(event.key==="Tab") {close();return;}
      if(event.isComposing || startSearch(event)) return;
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
      event.preventDefault();
      if(!isOpen()) open();
      const available=enabledOptions();
      const selected=available.find(option=>option.dataset.positionValue===select.value) ?? available[0];
      const next=event.key==="Home" ? available[0] : event.key==="End" ? available.at(-1) : selected;
      if(next) focusOption(next);
    },{signal});
    menu.addEventListener("pointerleave",clearPreview,{signal});
    menu.addEventListener("focusout",event=>{
      if(!(event.relatedTarget instanceof Node) || !menu.contains(event.relatedTarget)) clearPreview();
    },{signal});
    menu.addEventListener("keydown",event=>{
      if(event.isComposing) return;
      if(event.key==="Escape" || event.key==="Tab") {
        if(event.key==="Escape") event.preventDefault();
        close();trigger.focus({preventScroll:true});return;
      }
      const available=enabledOptions(),searchFocused=event.target===searchInput;
      if(searchFocused && event.key==="Enter") {
        event.preventDefault();available[0]?.click();return;
      }
      if(searchFocused && !["ArrowDown","ArrowUp"].includes(event.key)) return;
      if(!searchFocused && startSearch(event)) return;
      const index=available.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==="ArrowDown" ? Math.min(index+1,available.length-1)
        : event.key==="ArrowUp" ? (searchFocused ? available.length-1 : Math.max(index-1,0))
        : event.key==="Home" ? 0 : event.key==="End" ? available.length-1 : null;
      if(next!==null) {event.preventDefault();if(available[next]) focusOption(available[next]);}
    },{signal});
    for(const option of options) {
      const show=()=>{
        if(!field || select.disabled || option.disabled) return;
        const value=field==="location" ? option.dataset.previewValue : option.dataset.positionValue;
        if(value===undefined || value==="" || !Number.isFinite(Number(value))) {clearPreview();return;}
        activePreview=menu;preview(field,Number(value));
      };
      option.addEventListener("pointerenter",show,{signal});
      option.addEventListener("focus",show,{signal});
      option.addEventListener("click",event=>{
        if(select.disabled || option.disabled) return;
        close();
        commitPickerOption(select,option,trigger,event);
      },{signal});
    }
    document.addEventListener("pointerdown",event=>{
      if(isOpen() && event.target instanceof Node && !picker.contains(event.target)) close();
    },{signal});
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape" && isOpen()) {event.preventDefault();close();trigger.focus({preventScroll:true});}
    },{signal});
    window.addEventListener("resize",()=>{if(isOpen()) position();},{signal});
    document.addEventListener("scroll",event=>{if(isOpen() && (!(event.target instanceof Node) || !menu.contains(event.target))) close();},{signal,capture:true});
  });
  // Fixed event locations (such as the two Frenzy towers) use the same preview
  // callback without changing their checkbox state.
  root.querySelectorAll<HTMLElement>("[data-hover-location]").forEach(option=>{
    const show=()=>{
      if(option.querySelector<HTMLInputElement>("input")?.disabled) return;
      activePreview=option;preview("location",Number(option.dataset.hoverLocation));
    };
    const clear=()=>{if(activePreview===option) {activePreview=null;preview(null);}};
    option.addEventListener("pointerenter",show,{signal});option.addEventListener("pointerleave",clear,{signal});
    option.addEventListener("focusin",show,{signal});option.addEventListener("focusout",clear,{signal});
    closeAll.push(clear);
  });
  return ()=>{controller.abort();closeAll.forEach(close=>close());};
}
