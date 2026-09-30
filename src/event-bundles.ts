// Event schedules are not self-contained: type flags, positions, units and
// extra-boss fields belong to the same logical event. Keep this model independent
// of the editor's patch storage so grouping and transactions use identical rules.
export type EventFlagRow = {rowId:number;modifierSet:number;modifier:number;eventFlag:number};
export type EventUnitRow = {rowId:number;locationIndex:number|null;attachId:number;unitId:number;variationId:number;modifier:number;mapIndex:number;visible:boolean};
export type EventPlayRow = {rowId:number;extraBossId1:number;extraBossId2:number;extraBossModifier1:number;extraBossModifier2:number};
export type EventPattern = {id:number;terrainId:number;flags:EventFlagRow[];placements?:EventUnitRow[];play?:EventPlayRow|null};
export const eventKinds = ["extraBoss","meteor","mausoleum","horde","morgott","maris","gnoster","libra","frenzy","rise","caligo","gladius","balancers","blessing","unknown"] as const;
export type EventKind = typeof eventKinds[number];
export type EventIssue = "schedule"|"selector"|"position"|"units"|"boss"|"conflict"|"duplicate";
export type EventGroup = {rowId:number;kind:EventKind;day:1|2;trigger:EventFlagRow|null;flags:EventFlagRow[];units:EventUnitRow[];position:number|null;issues:EventIssue[]};
const definitions:Partial<Record<EventKind,{set:number;hollowSet?:number;code:number;selector:number;typeFlag?:number;units?:number[];support?:boolean}>> = {
  extraBoss:{set:3000,hollowSet:505,code:0,selector:120}, meteor:{set:3010,code:1,selector:200},
  mausoleum:{set:3020,code:2,selector:210}, horde:{set:3030,code:4,selector:180,units:[4600,4601,4602,4603,4604,4605,4606]},
  morgott:{set:3040,code:5,selector:604,typeFlag:8075,support:true},
  maris:{set:3050,hollowSet:540,code:5,selector:603,typeFlag:8076,units:[4552],support:true},
  gnoster:{set:3060,hollowSet:550,code:5,selector:601,typeFlag:8078,units:[4553],support:true},
  libra:{set:3070,hollowSet:560,code:5,selector:602,typeFlag:8079,units:[4555],support:true},
  frenzy:{set:3080,hollowSet:500,code:7,selector:140}, rise:{set:3090,code:6,selector:230,units:[4090]},
  caligo:{set:3110,hollowSet:510,code:5,selector:10000,typeFlag:8080,units:[5305]},
  gladius:{set:3120,hollowSet:520,code:5,selector:600,typeFlag:8077,units:[5300]},
  balancers:{set:3130,code:5,selector:10001,typeFlag:8081}
};
export const frenzyPositions = [1044360220,1044380230,1038400230,1046400230];
// Surface terrain replacements remove the northern tower on Mountaintop/Crater
// and the southern tower in Rotted Woods. Hollow has its own two assets.
export function frenzyTerrainPositions(terrain:number):number[] {
  return terrain===4 ? frenzyPositions.slice(2) : frenzyPositions.slice(0,2)
    .filter(position=>position===1044360220 ? terrain!==3 : ![1,2].includes(terrain));
}
export const blessingPositions = [1046300590,1047300590,1057300590];
const kinds=Object.keys(definitions) as EventKind[];
const invasion=(kind:EventKind)=>definitions[kind]?.code===5;
export const isInvasionEvent = invasion;
export const isMapEventUnit=(unitId:number)=>unitId>=2000 && unitId<=2150 && unitId%10===0;
export const usesMapEventLocations=(kind:EventKind)=>kind==="meteor" || kind==="mausoleum";
export function eventTiming(kind:EventKind):"start"|"night"|"timed"|"unknown" {
  if(["mausoleum","rise","frenzy","blessing"].includes(kind)) return "start";
  if(kind==="extraBoss") return "night";
  return kind==="unknown" ? "unknown" : "timed";
}
const isSelector=(row:EventFlagRow,kind:EventKind)=>{
  const def=definitions[kind];
  return !!def && row.modifierSet===0 && row.modifier===def.selector &&
    (def.typeFlag ? row.eventFlag===def.typeFlag : row.eventFlag===0 || kind==="frenzy" && frenzyPositions.includes(row.eventFlag));
};
const isPosition=(row:EventFlagRow,kind:EventKind,terrain:number)=>kind==="frenzy" &&
  frenzyPositions.includes(row.eventFlag) && (terrain===4 ? [0,1000].includes(row.modifierSet) : row.modifierSet===3500);
const legacyEventRow=(row:EventFlagRow,terrain:number)=>(row.modifierSet>=3000 && row.modifierSet<=3130) ||
  (row.modifierSet>=500 && row.modifierSet<=560) || row.modifierSet===3500 || isPosition(row,"frenzy",terrain);
export function eventKindForRow(pattern:EventPattern,row:EventFlagRow):EventKind {
  if(!legacyEventRow(row,pattern.terrainId)) return "unknown";
  const code=row.eventFlag-(row.eventFlag>=7720 ? 7720 : 7700);
  if(code===5) {
    const active=kinds.filter(kind=>invasion(kind) && pattern.flags.some(flag=>isSelector(flag,kind)));
    return active.length===1 ? active[0] : kinds.find(kind=>invasion(kind) &&
      (definitions[kind]!.set===row.modifierSet || definitions[kind]!.hollowSet===row.modifierSet)) ?? "unknown";
  }
  return kinds.find(kind=>definitions[kind]!.code===code) ?? "unknown";
}
export function eventGroups(pattern:EventPattern):EventGroup[] {
  const groups:EventGroup[]=[],claimed=new Set<number>();
  const activeInvasions=kinds.filter(kind=>invasion(kind) && pattern.flags.some(row=>isSelector(row,kind)));
  const add=(kind:EventKind,trigger:EventFlagRow|null,anchor:EventFlagRow|null,day:1|2,unit?:EventUnitRow)=>{
    const def=definitions[kind], flags=pattern.flags.filter(row=>isSelector(row,kind) || isPosition(row,kind,pattern.terrainId) ||
      def?.support && row.modifierSet===3100 && row.modifier===220 && row.eventFlag===0);
    if(trigger && !flags.some(row=>row.rowId===trigger.rowId)) flags.unshift(trigger);
    if(anchor && !flags.some(row=>row.rowId===anchor.rowId)) flags.unshift(anchor);
    const units=unit ? [unit] : (pattern.placements ?? []).filter(row=>usesMapEventLocations(kind) ? isMapEventUnit(row.unitId) : def?.units?.includes(row.unitId));
    const position=flags.find(row=>isPosition(row,kind,pattern.terrainId))?.eventFlag ??
      (kind==="blessing" ? anchor?.eventFlag ?? null : kind==="rise" || usesMapEventLocations(kind) && units.length===1 ? units[0]?.attachId ?? null : null);
    const issues:EventIssue[]=[];
    if(def && !trigger && kind!=="rise") issues.push("schedule");
    // Older Hollow extra-boss schedules are valid without selector 120.
    if(def && !flags.some(row=>isSelector(row,kind)) && kind!=="rise" && !(kind==="extraBoss" && pattern.terrainId===4)) issues.push("selector");
    if(kind==="frenzy" && position===null) issues.push("position");
    if(def?.units?.some(id=>!units.some(row=>row.unitId===id))) issues.push("units");
    if(usesMapEventLocations(kind) && !units.length) issues.push("units");
    if(kind==="extraBoss" && (!pattern.play || pattern.play[day===1?"extraBossId1":"extraBossId2"]<0)) issues.push("boss");
    if(invasion(kind) && activeInvasions.length>1) issues.push("conflict");
    // Unit-only cards use negative IDs so flag and placement Row IDs cannot collide.
    const group={rowId:trigger?.rowId ?? anchor?.rowId ?? (unit ? -unit.rowId-3 : -day),kind,day,trigger,flags,units,position,issues};
    groups.push(group);flags.forEach(row=>claimed.add(row.rowId));
  };
  // Frenzy has one global controller and independently enabled position flags.
  // Imported schedules on both days still belong to this same controller.
  const frenzySchedules=pattern.flags.filter(row=>legacyEventRow(row,pattern.terrainId) && [7707,7727].includes(row.eventFlag));
  const frenzyRows=pattern.flags.filter(row=>isSelector(row,"frenzy") || isPosition(row,"frenzy",pattern.terrainId));
  if(frenzySchedules.length || frenzyRows.length) {
    const trigger=frenzySchedules[0] ?? null;
    add("frenzy",trigger,frenzyRows[0] ?? null,trigger?.eventFlag===7727 ? 2 : 1);
    const group=groups.at(-1)!;
    for(const row of frenzySchedules) if(!group.flags.some(flag=>flag.rowId===row.rowId)) group.flags.push(row);
    group.flags.forEach(row=>claimed.add(row.rowId));
    if(new Set(group.flags.filter(row=>isPosition(row,"frenzy",pattern.terrainId)).map(row=>row.eventFlag)).size>1) group.position=null;
  }
  // Ancient Rise is a self-contained map unit. Its legacy schedule and selector
  // are optional metadata and shared by any copies already placed on the map.
  const riseUnits=(pattern.placements ?? []).filter(row=>row.unitId===4090);
  const riseSchedules=pattern.flags.filter(row=>legacyEventRow(row,pattern.terrainId) && [7706,7726].includes(row.eventFlag));
  if(riseUnits.length) {
    for(const [index,unit] of riseUnits.entries()) {
      const trigger=riseSchedules[0] ?? null;
      add("rise",index===0 ? trigger : null,null,trigger?.eventFlag===7726 ? 2 : 1,unit);
      const group=groups.at(-1)!;
      for(const row of riseSchedules) if(!group.flags.some(flag=>flag.rowId===row.rowId)) group.flags.push(row);
      group.flags.forEach(row=>claimed.add(row.rowId));
    }
  }
  for(const row of pattern.flags) {
    if(claimed.has(row.rowId)) continue;
    const day:1|2=row.eventFlag>=7720?2:1,code=row.eventFlag-(day===1?7700:7720);
    if(!legacyEventRow(row,pattern.terrainId) || ![0,1,2,4,5,6,7].includes(code)) continue;
    const kind=eventKindForRow(pattern,row);
    add(kind,row,null,day);
  }
  for(const row of pattern.flags) {
    if(claimed.has(row.rowId)) continue;
    if(pattern.terrainId===3 && row.modifierSet===500 && blessingPositions.includes(row.eventFlag)) {add("blessing",null,row,1);continue;}
    const kind=kinds.find(kind=>isSelector(row,kind) || isPosition(row,kind,pattern.terrainId));
    if(kind) {add(kind,null,row,1);continue;}
    if(legacyEventRow(row,pattern.terrainId)) add("unknown",null,row,1);
  }
  for(const day of [1,2] as const) if(pattern.play && pattern.play[day===1?"extraBossId1":"extraBossId2"]>=0 &&
    !groups.some(group=>group.kind==="extraBoss" && group.day===day)) add("extraBoss",null,null,day);
  for(const group of groups) if(group.kind!=="unknown" && groups.some(other=>other!==group && other.kind===group.kind &&
    (group.kind!=="rise" || other.position===group.position)))
    group.issues.push("duplicate");
  return groups;
}
export type EventTemplate = {pattern:EventPattern;group:EventGroup};
export function eventTerrainLocations(patterns:EventPattern[],terrain:number):Set<number> {
  return new Set(patterns.filter(pattern=>pattern.terrainId===terrain).flatMap(pattern=>(pattern.placements ?? [])
    .filter(unit=>unit.visible && unit.locationIndex!==null).map(unit=>unit.locationIndex!)));
}
export function eventTemplates(patterns:EventPattern[],terrain:number):EventTemplate[] {
  // Surface maps share the same grid; prefer a layout from the target terrain.
  // Hollow uses different entities and positions and must never borrow surface layouts.
  const compatible=patterns.filter(p=>terrain===4 ? p.terrainId===4 : p.terrainId!==4);
  const available=eventTerrainLocations(patterns,terrain);
  const templates=compatible
    .flatMap(pattern=>eventGroups(pattern).filter(group=>group.kind!=="unknown" && !group.issues.length &&
      (group.kind!=="blessing" || terrain===3) && (group.kind!=="frenzy" || frenzyEventPositions(pattern,group).every(position=>frenzyTerrainPositions(terrain).includes(position))) && group.units.every(unit=>!unit.visible || unit.locationIndex===null || available.has(unit.locationIndex))).map(group=>({pattern,group})))
    .sort((a,b)=>Number(b.pattern.terrainId===terrain)-Number(a.pattern.terrainId===terrain) || a.pattern.id-b.pattern.id);
  // 4090 uses the same attachment frame as an ordinary 4100 tower. Build
  // location choices from known tower placements, not only seven event layouts.
  const rise=templates.find(template=>template.group.kind==="rise") ?? patterns.flatMap(pattern=>eventGroups(pattern)
    .filter(group=>group.kind==="rise" && !group.issues.length).map(group=>({pattern,group})))[0];
  if(rise) {
    const seen=new Set(templates.filter(template=>template.group.kind==="rise").map(template=>template.group.position));
    for(const pattern of [...compatible].sort((a,b)=>Number(b.terrainId===terrain)-Number(a.terrainId===terrain)))
      for(const unit of pattern.placements ?? []) if(unit.unitId===(terrain===4 ? 5110 : 4100) && unit.visible && unit.locationIndex!==null && available.has(unit.locationIndex) && !seen.has(unit.attachId)) {
        seen.add(unit.attachId);
        const source={...unit,unitId:4090,variationId:rise.group.units[0].variationId,modifier:rise.group.units[0].modifier};
        templates.push({pattern,group:{...rise.group,rowId:-source.rowId-3,trigger:null,flags:[],units:[source],position:unit.attachId}});
      }
  }
  return templates;
}
export function frenzyEventPositions(pattern:EventPattern,group:EventGroup):number[] {
  return [...new Set(group.flags.filter(row=>isPosition(row,"frenzy",pattern.terrainId)).map(row=>row.eventFlag))];
}
export type EventPlan = {flags:{update:EventFlagRow[];add:EventFlagRow[];remove:number[]};units:{update:EventUnitRow[];add:EventUnitRow[];remove:number[]};play:Partial<EventPlayRow>;error?:"conflict"|"template"|"location"};
export function planEventDayChange(pattern:EventPattern,rowId:number,day:1|2):EventPlan {
  const empty:EventPlan={flags:{update:[],add:[],remove:[]},units:{update:[],add:[],remove:[]},play:{}};
  const group=eventGroups(pattern).find(group=>group.rowId===rowId);
  if(!group?.trigger || !["timed","night"].includes(eventTiming(group.kind)) || ![1,2].includes(day)) return {...empty,error:"template"};
  if(group.day===day) return empty;
  const trigger={...group.trigger,eventFlag:group.trigger.eventFlag+(day-group.day)*20,
    modifier:[800,801].includes(group.trigger.modifier) ? day===1 ? 800 : 801 : group.trigger.modifier};
  // Use the current companions and candidates so changing the date cannot move
  // a location, replace an invasion unit, or reset an edited extra Boss.
  return planEventChange(pattern,rowId,{pattern,group:{...group,day,trigger,
    flags:group.flags.map(row=>row.rowId===trigger.rowId ? trigger : row)}});
}
// Edit the common candidate pool directly, leaving both event controllers intact.
// Remove/insert a moved package so the editor can restore a replaced camp.
export function planMapEventLocationChange(pattern:EventPattern,rowId:number|null,source:EventUnitRow|null):EventPlan {
  const plan:EventPlan={flags:{update:[],add:[],remove:[]},units:{update:[],add:[],remove:[]},play:{}};
  if(!eventGroups(pattern).some(group=>usesMapEventLocations(group.kind))) return {...plan,error:"template"};
  const pool=(pattern.placements ?? []).filter(row=>isMapEventUnit(row.unitId));
  const old=pool.find(row=>row.rowId===rowId);
  if(rowId!==null && !old) return {...plan,error:"template"};
  if(!source) {
    if(!old || pool.length<=1) return {...plan,error:"location"};
    plan.units.remove.push(old.rowId);return plan;
  }
  if(!isMapEventUnit(source.unitId) || !source.visible || source.locationIndex===null) return {...plan,error:"location"};
  if(old?.attachId===source.attachId && old.locationIndex===source.locationIndex) return plan;
  if(pool.some(row=>row!==old && (row.attachId===source.attachId || row.locationIndex===source.locationIndex))) return {...plan,error:"location"};
  const target=(pattern.placements ?? []).find(row=>row.visible && row.locationIndex===source.locationIndex && row!==old);
  if(target && (target.unitId<3000 || target.unitId>=4000)) return {...plan,error:"location"};
  if(target) plan.units.update.push({...source,rowId:target.rowId,mapIndex:target.mapIndex});
  else plan.units.add.push({...source});
  if(old) plan.units.remove.push(old.rowId);
  return plan;
}
export function planEventChange(pattern:EventPattern,rowId:number|null,template:EventTemplate|null,locationSources:EventUnitRow[]=template?.group.units ?? []):EventPlan {
  const plan:EventPlan={flags:{update:[],add:[],remove:[]},units:{update:[],add:[],remove:[]},play:{}};
  const groups=eventGroups(pattern),old=groups.find(group=>group.rowId===rowId);
  if(rowId!==null && !old) return {...plan,error:"template"};
  const next=template?.group;
  const stale=old?.issues.includes("selector") && next?.kind===old.kind ? groups.filter(group=>group!==old && !group.trigger &&
    (group.kind==="horde" || invasion(group.kind)) && group.kind!==old.kind) : [];
  const others=groups.filter(group=>group!==old && !stale.includes(group));
  // Most events have a shared one-shot controller. Ancient Rise is instead
  // instantiated by its map unit and may occupy multiple distinct attachments.
  if(next && others.some(group=>group.kind===next.kind && (next.kind!=="rise" || group.position===next.position) ||
    invasion(group.kind) && invasion(next.kind) && group.kind!==next.kind)) return {...plan,error:"conflict"};
  const sharedFlag=new Set(others.flatMap(group=>group.flags.map(row=>row.rowId)));
  const sharedUnit=new Set(others.flatMap(group=>group.units.map(row=>row.rowId)));
  const locationPool=(pattern.placements ?? []).filter(row=>isMapEventUnit(row.unitId));
  // Both event scripts are loaded by every Map Event package. There is one
  // shared pool, not an independently assigned location for each event.
  const reusePool=next && usesMapEventLocations(next.kind) && locationPool.length>0 &&
    (!old || old.kind!==next.kind || old.position===next.position);
  let desiredUnits=reusePool ? locationPool : next?.units ?? [];
  if(rowId===null && next && usesMapEventLocations(next.kind)) {
    // Reuse prepared candidates and only fill the new controller's shortfall.
    desiredUnits=[...locationPool];
    const required=others.filter(group=>usesMapEventLocations(group.kind)).length+1;
    const count=new Set(locationPool.map(unit=>unit.locationIndex ?? `attach:${unit.attachId}`)).size;
    for(let index=count;index<required;index++) {
      const source=locationSources.find(source=>{
        if(!isMapEventUnit(source.unitId) || !source.visible || source.locationIndex===null ||
          desiredUnits.some(unit=>unit.attachId===source.attachId || unit.locationIndex===source.locationIndex)) return false;
        const target=(pattern.placements ?? []).find(unit=>unit.visible && unit.locationIndex===source.locationIndex);
        return !target || target.unitId>=3000 && target.unitId<4000;
      });
      if(!source) return {...plan,error:"location"};
      desiredUnits.push(source);
    }
  }
  if(next && old?.kind===next.kind && usesMapEventLocations(next.kind) && !reusePool &&
    others.some(group=>usesMapEventLocations(group.kind))) return {...plan,error:"location"};
  const available=[...(old?.flags ?? []),...stale.flatMap(group=>group.flags)].filter(row=>!sharedFlag.has(row.rowId));
  const used=new Set<number>();
  // Placing/moving a Rise unit does not require manufacturing a legacy schedule.
  // Keep existing optional metadata when editing a Rise; remove it with the last
  // unit, and preserve shared metadata while other Rise cards still use it.
  const desiredFlags=next?.kind==="rise" ? old?.kind==="rise" ? old.flags : pattern.flags.filter(row=>isSelector(row,"rise") ||
    legacyEventRow(row,pattern.terrainId) && [7706,7726].includes(row.eventFlag)) :
    next?.kind==="frenzy" && old?.kind==="frenzy" && old.flags.some(row=>isPosition(row,"frenzy",pattern.terrainId)) ?
      [...next.flags.filter(row=>!isPosition(row,"frenzy",pattern.terrainId)),...old.flags.filter(row=>isPosition(row,"frenzy",pattern.terrainId) ||
        row.rowId!==old.trigger?.rowId && [7707,7727].includes(row.eventFlag))] : next?.flags ?? [];
  for(const source of desiredFlags) {
    let target:EventFlagRow|undefined;
    if(source.rowId===next!.trigger?.rowId && !sharedFlag.has(old?.trigger?.rowId ?? -1)) target=old?.trigger ?? (old?.kind==="unknown" ? available[0] : undefined);
    else target=pattern.flags.find(row=>row.modifierSet===source.modifierSet && row.modifier===source.modifier && row.eventFlag===source.eventFlag);
    if(!target) target=available.find(row=>!used.has(row.rowId) && row.rowId!==old?.trigger?.rowId &&
      (isPosition(row,old?.kind ?? "unknown",pattern.terrainId)===isPosition(source,next!.kind,pattern.terrainId)));
    if(target) {
      used.add(target.rowId);
      const desired=source.rowId===next!.trigger?.rowId && old?.kind===next!.kind && target===old.trigger ?
        eventTiming(next!.kind)==="start" ? target : {...source,modifierSet:target.modifierSet} : source;
      if(target.modifierSet!==desired.modifierSet || target.modifier!==desired.modifier || target.eventFlag!==desired.eventFlag)
        plan.flags.update.push({...desired,rowId:target.rowId});
    } else plan.flags.add.push({...source});
  }
  plan.flags.remove=available.filter(row=>!used.has(row.rowId)).map(row=>row.rowId);
  const keptUnits=new Set<number>();
  for(const templateUnit of desiredUnits) {
    const source=next?.kind==="rise" && old?.kind==="rise" && old.units[0] ?
      {...templateUnit,variationId:old.units[0].variationId,modifier:old.units[0].modifier} : templateUnit;
    // Preserve edited positions/variants when a unit already belongs to this event.
    let target=(pattern.placements ?? []).find(row=>row.unitId===source.unitId && row.attachId===source.attachId &&
      !keptUnits.has(row.rowId) && (row.mapIndex===source.mapIndex || !source.visible));
    if(!target) target=(pattern.placements ?? []).find(row=>row.unitId===source.unitId && row.attachId===source.attachId && !keptUnits.has(row.rowId));
    if(!target && source.visible && source.locationIndex!==null) {
      target=(pattern.placements ?? []).find(row=>(row.visible || next!.kind==="rise" && pattern.terrainId===4 && row.unitId===5105 && row.attachId===source.attachId) && row.locationIndex===source.locationIndex &&
        !(old?.units.some(unit=>unit.rowId===row.rowId) && !sharedUnit.has(row.rowId)));
      const replaceable=next!.kind==="rise" && target && (target.unitId>=4000 && target.unitId<4550 || pattern.terrainId===4 && [5100,5105,5110,5115].includes(target.unitId)) ||
        usesMapEventLocations(next!.kind) && target && target.unitId>=3000 && target.unitId<4000;
      if(target && !replaceable) return {...plan,error:"location"};
      if(target) plan.units.update.push({...source,rowId:target.rowId,mapIndex:target.mapIndex});
    }
    if(target) keptUnits.add(target.rowId);else plan.units.add.push({...source});
  }
  plan.units.remove=[...(old?.units ?? []),...stale.flatMap(group=>group.units)]
    .filter(row=>!sharedUnit.has(row.rowId) && !keptUnits.has(row.rowId)).map(row=>row.rowId);
  if(old?.kind==="extraBoss" && !others.some(group=>group.kind==="extraBoss" && group.day===old.day)) {
    plan.play[old.day===1?"extraBossId1":"extraBossId2"]=-1;
    plan.play[old.day===1?"extraBossModifier1":"extraBossModifier2"]=0;
  }
  if(next?.kind==="extraBoss" && template?.pattern.play) {
    const source=old?.kind==="extraBoss" && pattern.play && pattern.play[old.day===1?"extraBossId1":"extraBossId2"]>=0 ? pattern.play : template.pattern.play;
    const day=source===pattern.play ? old!.day : next.day;
    plan.play[next.day===1?"extraBossId1":"extraBossId2"]=source[day===1?"extraBossId1":"extraBossId2"];
    plan.play[next.day===1?"extraBossModifier1":"extraBossModifier2"]=source[day===1?"extraBossModifier1":"extraBossModifier2"];
  }
  return plan;
}
// Enable any subset of the map's prepared Frenzy towers without duplicating its
// global schedule. All selected towers share the game's completion/storm flags.
export function planFrenzyLocations(pattern:EventPattern,rowId:number,positions:number[]):EventPlan {
  const group=eventGroups(pattern).find(group=>group.rowId===rowId && group.kind==="frenzy");
  const plan:EventPlan={flags:{update:[],add:[],remove:[]},units:{update:[],add:[],remove:[]},play:{}};
  if(!group) return {...plan,error:"template"};
  const allowed=frenzyTerrainPositions(pattern.terrainId),existing=frenzyEventPositions(pattern,group);
  if(positions.some(position=>!allowed.includes(position) && !existing.includes(position))) return {...plan,error:"location"};
  if(!positions.length) return planEventChange(pattern,rowId,null);
  const rows=group.flags.filter(row=>isPosition(row,"frenzy",pattern.terrainId));
  plan.flags.remove=rows.filter(row=>!positions.includes(row.eventFlag)).map(row=>row.rowId);
  for(const position of new Set(positions)) if(!rows.some(row=>row.eventFlag===position))
    plan.flags.add.push({rowId:rows[0]?.rowId ?? group.rowId,modifierSet:pattern.terrainId===4 ? 1000 : 3500,modifier:0,eventFlag:position});
  // Hollow sometimes combines selector 140 and the position in one row.
  if(!group.flags.some(row=>isSelector(row,"frenzy") && !plan.flags.remove.includes(row.rowId)))
    plan.flags.add.push({rowId:group.rowId,modifierSet:0,modifier:140,eventFlag:0});
  return plan;
}
