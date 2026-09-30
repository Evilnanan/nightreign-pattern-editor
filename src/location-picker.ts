export type LocationPreviewField="spawn"|"circle1"|"circle2"|"location";
export type PickerChangeDetail={pointerY:number|null};

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
    const open=()=>{
      if(select.disabled) return;
      closeAll.forEach(close=>close());
      menu.hidden=false;
      trigger.setAttribute("aria-expanded","true");
      position();
      options.find(option=>option.dataset.positionValue===select.value)?.scrollIntoView({block:"nearest"});
    };
    let search="",lastSearch=0;
    const typeAhead=(event:KeyboardEvent)=>{
      if(select.disabled || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.key.length!==1 || event.key===" ") return false;
      const now=Date.now();search=now-lastSearch>700 ? event.key : search+event.key;lastSearch=now;
      const repeat=[...search].every(char=>char===search[0]),term=(repeat ? search[0] : search).toLocaleLowerCase();
      const index=options.indexOf(document.activeElement as HTMLButtonElement);
      const ordered=repeat ? [...options.slice(index+1),...options.slice(0,index+1)] : options;
      const option=ordered.find(option=>!option.disabled && (option.textContent?.trim().toLocaleLowerCase().startsWith(term) || option.dataset.positionValue?.toLocaleLowerCase().startsWith(term)));
      event.preventDefault();if(!isOpen()) open();if(option) focusOption(option);return true;
    };
    trigger.addEventListener("click",()=>{if(isOpen()) close();else open();},{signal});
    trigger.addEventListener("keydown",event=>{
      if(event.key==="Tab") {close();return;}
      if(typeAhead(event)) return;
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
      event.preventDefault();
      if(!isOpen()) open();
      const selected=options.find(option=>option.dataset.positionValue===select.value) ?? options[0];
      focusOption(event.key==="Home" ? options[0] : event.key==="End" ? options.at(-1)! : selected);
    },{signal});
    menu.addEventListener("pointerleave",clearPreview,{signal});
    menu.addEventListener("focusout",event=>{
      if(!(event.relatedTarget instanceof Node) || !menu.contains(event.relatedTarget)) clearPreview();
    },{signal});
    menu.addEventListener("keydown",event=>{
      if(event.key==="Escape" || event.key==="Tab") {
        if(event.key==="Escape") event.preventDefault();
        close();trigger.focus({preventScroll:true});return;
      }
      if(typeAhead(event)) return;
      const index=options.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==="ArrowDown" ? Math.min(index+1,options.length-1)
        : event.key==="ArrowUp" ? Math.max(index-1,0) : event.key==="Home" ? 0 : event.key==="End" ? options.length-1 : null;
      if(next!==null) {event.preventDefault();focusOption(options[next]);}
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
