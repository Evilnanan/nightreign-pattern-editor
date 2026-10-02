import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { placeBossLabels, type BossLabel, type IconRect, type LabelRect } from "./boss-label-layout";
import { errorMessage, formatMessage, getLanguage, message, setLanguage, subscribeLanguage, t, type Language, type StatusMessage } from "./i18n";
import { entityLabel, entityName, entitySearchText, findEntityName, unitTypeId, unitTypeName, type EntityName } from "./entity-names";
import { automaticUnitIcons, badgeStyle, baseFrame, baseGlow, baseScale, baseShadow, categoryIcon, defaultBadgeStyle, emptyIconConfig, fileIconStyle, iconFileKey, iconFiles, iconSource, imageUrl, mapIconScale, missingIcon, setIconResources, unitBadge, unitDefaultIcon, unitIcon, type BadgeStyle, type IconFileStyle, type IconConfig, type IconResource } from "./icon-mapping";
import { buildUnitFilterGroups, filterSelection, matchesUnitCriterion, toggleFilterChoices, type FilterCriterion, type FilterSide, type UnitFilterGroup, type UnitFilterOption } from "./unit-filter";
import { patchChildren } from "./dom-patch";
import { mapInformationFields, mapInformationValues, type MapEvent, type MapInformationField } from "./map-information";
import { frenzyTowerPositionRow } from "./frenzy-towers";
import { bindLocationPickers, type LocationPreviewField, type PickerChangeDetail } from "./location-picker";
import { eventCapacity } from "./event-capacity";
import { eventGroups, eventKindForRow, eventKinds, eventTemplates, eventTerrainLocations, planEventChange, planEventDayChange, planMapEventLocationChange, planFrenzyLocations, frenzyEventPositions, frenzyPositions, frenzyTerrainPositions, eventTiming, isMapEventUnit, usesMapEventLocations, type EventGroup, type EventKind, type EventPlan, type EventTemplate, type EventUnitRow } from "./event-bundles";
import "./style.css";

type Location = { index:number; scope:string; category:string; name:string; x:number; y:number; typeIndex:number|null; eventFlag?:number|null };
type Name = EntityName;
type Flag = { rowId:number; modifierSet:number; modifier:number; eventFlag:number };
type Play = { rowId:number; playArea1:number; playArea2:number; bossId1:number; bossId2:number; extraBossId1:number; extraBossId2:number; bossModifier1:number; bossModifier2:number; extraBossModifier1:number; extraBossModifier2:number };
type Placement = { rowId:number; locationIndex:number|null; attachId:number; unitId:number; variationId:number; modifier:number; mapIndex:number; visible:boolean };
type Pattern = { id:number; terrainId:number; nightlordId:number; flags:Flag[]; play:Play|null; placements:Placement[] };
type CircleCenter = { id:number; x:number; y:number; source:"playArea"|"community"|"default" };
type ResultDiagnostic = {code:string;params:Record<string,string|number>};
type Dataset = { version:string; sourcePath:string|null; patterns:Pattern[]; locations:Location[]; names:Name[]; circleCenters:CircleCenter[]; diagnostics?:ResultDiagnostic[] };
type Patch = { patternId:number; table:"spot"|"flag"|"play"; rowId:number; field:string; oldValue:number; newValue:number };
type RowAddition = { patternId:number; table:Patch["table"]; rowId:number; sourceRowId:number; fields:Record<string,number> };
type RowRemoval = { patternId:number; rowId:number } & ({table:"spot";row:Placement}|{table:"flag";row:Flag});
type PatternRows = { terrainId:number; nightlordId:number; placements:Placement[]; flags:Flag[]; play:Play|null };
type Criterion = FilterCriterion;
type DirectFilterType = 5399|4940|"rot-blessing"|"frenzy-tower";
const directFilterTypes:DirectFilterType[] = [5399,4940,"rot-blessing","frenzy-tower"];
type BubbleTarget = number|"nightlord";
type Mode = "filter"|"preview"|"edit";
type EditTab = "spot"|"event"|"spawn"|"circle"|"boss";
type MapInformationTab = "terrain"|"event"|"spawn"|"circle"|"boss"|"extraBoss"|"nightlord";
type PositionField = LocationPreviewField;
type IconUnit = {id:number; variants:Name[]; sample:Location|null; uses:number};
type IconResources = {path:string; icons:IconResource[]};

const defaultTerrainNames = ["Default", "Mountaintop", "Crater", "Rotted Woods", "Great Hollow", "Noklateo"];
function terrainName(id:number) {
  const named=findEntityName(state.data?.names ?? [],"terrain",id);
  return named ? entityName(named) : defaultTerrainNames[id] ?? String(id);
}
// Match the Nightlord disc at the lower-left corner of the community maps.
const nightlordPosition = {x:188,y:1348};
// South Great Church (69) and Southeast Ruin (72) are also on the lower layer.
const hollowLowerLocations = new Set([69,72,86,91,92,96,102,103,106,108]);
const towerLayouts = [
  {id:"nw",name:"Northwest Tower",anchorIndex:77,floors:[76,77,78],side:-1},
  {id:"se",name:"Southeast Tower",anchorIndex:74,floors:[73,74,75],side:1}
];
const spawnLocationIds:Record<number,number> = {700:27,701:29,702:31,703:30,704:32,705:33,706:37,707:34,708:35};
// Great Hollow spawns have no corresponding map-unit location. Use the landing
// arrows on community maps #1005, #1008 and #1006 (1536 × 1536 coordinates).
const hollowSpawnPositions:Record<number,{x:number;y:number}> = {
  13000:{x:410,y:1065},
  13001:{x:696,y:1224},
  13002:{x:1120,y:456}
};
const hiddenUnitIds = new Set([2000,4130,4552,4553,4555,4600,4601,4602,4603,4604,4605,4606,4678,5006,5105,5300,5305,5349,5350,5351,5352,5353,5354,5355,5356,5357,5362,5363,5364,5380,5381,5382,5383,5386,5387,5388,5389,5390,5391]);
const terrainImage = (id:number, underground:boolean) => `/maps/map_${id}_L0${id === 4 && underground ? "_B1" : ""}.webp`;
const html = (value:unknown) => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[ch]!);
const key = (unit:number, variation:number) => `${unit}|${variation}`;
const patchKey = (table:string, row:number, field:string) => `${table}:${row}:${field}`;
const app = document.querySelector<HTMLDivElement>("#app")!;
let iconReloadGeneration=0;
let disposeLocationPickers:(()=>void)|null=null;
const mapArtworkBounds=new Map<string,{left:number;top:number;right:number;bottom:number}|null>();

const state = {
  data: null as Dataset|null,
  templates: null as Dataset|null,
  terrainLocations: new Map<number,Set<number>>(),
  mode: "filter" as Mode,
  terrain: 0,
  underground: false,
  nightlord: {include:new Set<string>(),exclude:new Set<string>()} as Criterion,
  mapCriteria: new Map<MapInformationField,Criterion>(),
  mapInformationTab: "terrain" as MapInformationTab,
  mapInformationScroll: new Map<MapInformationTab,number>(),
  criteria: new Map<number, Criterion>(),
  expandedCriterion: null as {index:number; group:string; side:FilterSide}|null,
  bubble: null as BubbleTarget|null,
  bubbleCategory: null as string|null,
  selectedPattern: null as number|null,
  selectedLocation: null as number|null,
  selectedFlag: null as number|null,
  expandedEventCards: new Set<number>(),
  tab: "spot" as EditTab,
  editorMarkerPreview: null as {field:PositionField;value:number}|null,
  search: "",
  patches: new Map<string, Patch>(),
  editSnapshot: null as Map<string, Patch>|null,
  additions: new Map<string,RowAddition>(),
  editRowSnapshot: null as Map<string,RowAddition>|null,
  removals: new Map<string,RowRemoval>(),
  originalRecords: new Map<number,PatternRows>(),
  builtinRecords: new Map<number,PatternRows>(),
  restorations: new Set<number>(),
  editRestorationSnapshot: null as Set<number>|null,
  editRemovalSnapshot: null as Map<string,RowRemoval>|null,
  editRecordSnapshot: null as Map<number,PatternRows>|null,
  zoom: 1,
  panX: 0,
  panY: 0,
  busy: false,
  message: null as StatusMessage,
  iconConfig: emptyIconConfig(),
  iconUnits: [] as IconUnit[],
  iconStudioOpen: false,
  iconConfigScope: "unit" as "unit"|"file",
  iconSelectedFile: null as string|null,
  iconFileSearch: "",
  iconSelectedId: null as number|null,
  iconSelectedVariation: null as number|null,
  iconSearch: "",
  iconAssetSearch: "",
  iconAssetLayer: "base" as "base"|"badge",
  expandedIconSettings: new Set<string>(),
  iconFilter: "all" as "all"|"pending"|"assigned"|"missing",
  iconResourcePath: "",
  iconBusy: false,
  iconMessage: null as StatusMessage
};

let preservingScroll=false;
function preserveScroll(render:()=>void) {
  if(preservingScroll) {render();return;}
  const positions=new Map<string,{top:number;left:number}>();
  document.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach(element=>{
    if(!element.getClientRects().length) return;
    positions.set(element.dataset.scrollKey!,{top:element.scrollTop,left:element.scrollLeft});
  });
  preservingScroll=true;
  try {render();}
  finally {
    preservingScroll=false;
    // Restore by content identity, since innerHTML may replace the container.
    // A new Pattern, editor tab, map point, or bubble gets its own scroll context.
    document.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach(element=>{
      if(!element.getClientRects().length) return;
      const position=positions.get(element.dataset.scrollKey!);
      element.scrollTop=position?.top ?? 0;
      element.scrollLeft=position?.left ?? 0;
    });
  }
}

function formattedName(named:Name) { return entityName(named,true); }
function name(kind:string, id:number, variation:number|null = null) {
  return entityLabel(state.data?.names ?? [],kind,id,variation,true);
}
function unitName(unit:number, variation:number) { return name("spot", unit, variation); }
function unitNameOnly(unit:number, variation:number) {
  return entityLabel(state.data?.names ?? [],"spot",unit,variation);
}
function locationName(location:Location) {
  const named=findEntityName(state.data?.names ?? [],location.eventFlag!=null
    ? location.typeIndex===8 ? "frenzy_tower" : "rot_blessing" : "location",location.eventFlag ?? location.index);
  return (named ? entityName(named) : location.name).trim() || String(location.index);
}
function locationCategory(location:Location) {
  const named=location.typeIndex===null ? undefined : findEntityName(state.data?.names ?? [],"location_type",location.typeIndex);
  return named ? entityName(named) : location.category;
}
function nameSearchText(named:Name) {
  return entitySearchText(named);
}
function namedSearchText(kind:string,id:number) {
  const named=findEntityName(state.data?.names ?? [],kind,id);
  return named ? nameSearchText(named) : String(id);
}
function iconArtwork(base:string|null, badge:string|null, style:BadgeStyle, className:string, frame=fileIconStyle(state.iconConfig,base).frame, glow=fileIconStyle(state.iconConfig,base).glow, scale=fileIconStyle(state.iconConfig,base).scale,mapScale=mapIconScale(state.iconConfig,base),shadow=fileIconStyle(state.iconConfig,base).shadow) {
  if(!shadow) className+=" icon-no-map-shadow";
  if(base===null) return `<span class="icon-art icon-art-none ${className}" style="--map-icon-scale:${mapScale}" role="img" aria-label="${t("ui.noIcon")}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7.5"/><path d="M5 19 19 5"/></svg></span>`;
  return `<span class="icon-art ${className}" style="--badge-size:${style.size}%;--map-icon-scale:${mapScale}"><span class="icon-art-base-layer ${frame?"framed":""} ${glow?"glowing":""}" style="--icon-scale:${frame?scale/100:1}"><img class="icon-art-base" src="${html(imageUrl(base))}" alt=""></span>${badge?`<span class="icon-art-badge ${style.frame?"framed":""} ${style.glow?"glowing":""}" style="--icon-scale:${style.frame?(style.scale??100)/100:1}"><img src="${html(imageUrl(badge))}" alt=""></span>`:""}</span>`;
}
function unresolvedPointIcon(location:Location) {
  if(location.scope==="Great Hollow" && location.index===68) return "Strong Boss.webp";
  if(location.typeIndex===16 || location.typeIndex===18) return "Orb.webp";
  if(location.typeIndex===1 || location.category==="Major Base") return "3000.webp";
  if(location.typeIndex===2 || location.typeIndex===19 || location.category==="Minor Base") return "4100.webp";
  return categoryIcon(location);
}
function unresolvedPointArtwork(location:Location) {
  const base=unresolvedPointIcon(location);
  if(location.typeIndex===16 || location.typeIndex===18) {
    const style=state.iconConfig.fileIconStyles[iconFileKey(base)];
    return iconArtwork(base,null,defaultBadgeStyle,"icon-map-art",style?.frame ?? true,style?.glow ?? false,style?.scale ?? 150);
  }
  if(![1,2,19].includes(location.typeIndex ?? -1) && !["Major Base","Minor Base"].includes(location.category)) return iconArtwork(base,null,defaultBadgeStyle,"icon-map-art");
  return iconArtwork(base,null,defaultBadgeStyle,"icon-map-art icon-art-unresolved").replace(/<\/span>$/,`<svg class="icon-art-question" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="none" stroke-linecap="round"><path d="M9 11C9 7 12 5 16 5S23 7 23 11C23 15 16 16 16 20" stroke="#111912" stroke-width="6"/><path d="M9 11C9 7 12 5 16 5S23 7 23 11C23 15 16 16 16 20" stroke="#f2ecd4" stroke-width="3.5"/></g><circle cx="16" cy="26" r="3.5" fill="#111912"/><circle cx="16" cy="26" r="2" fill="#f2ecd4"/></svg></span>`);
}
function filteredPointArtwork(location:Location):{html:string;base:string|null;mapScale:number}|null {
  const included=state.criteria.get(location.index)?.include;
  return sharedUnitArtwork(included ?? [],location,"icon-map-art");
}
function sharedUnitArtwork(units:Iterable<string>, location:Location, className:string):{html:string;base:string|null;mapScale:number}|null {
  let sharedArtwork:{html:string;base:string|null;mapScale:number}|null=null;
  let sharedMainArtwork:{html:string;base:string|null;mapScale:number}|null=null;
  let sameArtwork=true;
  for(const selected of units) {
    const [unit,variation]=selected.split("|").map(Number);
    const base=unitIcon(state.iconConfig,unit,variation,location);
    const badge=unitBadge(state.iconConfig,unit,variation);
    const mapScale=mapIconScale(state.iconConfig,base,unit,variation);
    // Compare the rendered layers. Unused badge styles and hidden badges do
    // not make otherwise identical icons different.
    const artwork=iconArtwork(base,badge,badge?badgeStyle(state.iconConfig,unit,variation):defaultBadgeStyle,className,baseFrame(state.iconConfig,unit,variation,base),baseGlow(state.iconConfig,unit,variation,base),baseScale(state.iconConfig,unit,variation,base),mapScale,baseShadow(state.iconConfig,unit,variation,base));
    const mainArtwork=iconArtwork(base,null,defaultBadgeStyle,className,baseFrame(state.iconConfig,unit,variation,base),baseGlow(state.iconConfig,unit,variation,base),baseScale(state.iconConfig,unit,variation,base),mapScale,baseShadow(state.iconConfig,unit,variation,base));
    if(sharedMainArtwork!==null && sharedMainArtwork.html!==mainArtwork) return null;
    if(sharedArtwork!==null && sharedArtwork.html!==artwork) sameArtwork=false;
    sharedArtwork={html:artwork,base,mapScale};
    sharedMainArtwork={html:mainArtwork,base,mapScale};
  }
  // Retain identical badges; differing badges leave only the shared main icon.
  return sameArtwork ? sharedArtwork : sharedMainArtwork;
}
function displayedSpot(location:Location, p:Pattern|null) {
  return p?.placements.find(s=>s.locationIndex===location.index && visibleSpot(p,s) && unitIcon(state.iconConfig,
    numeric(p,"spot",s.rowId,"unitId",s.unitId),numeric(p,"spot",s.rowId,"variationId",s.variationId),location)!==null);
}
function pointArtwork(location:Location, p:Pattern|null) {
  if(location.eventFlag!=null) {
    const base=categoryIcon(location);
    return {base,html:iconArtwork(base,null,defaultBadgeStyle,"icon-map-art"),mapScale:mapIconScale(state.iconConfig,base)};
  }
  const spot=displayedSpot(location,p);
  if(spot && p) {
    const unit=numeric(p,"spot",spot.rowId,"unitId",spot.unitId),variation=numeric(p,"spot",spot.rowId,"variationId",spot.variationId);
    const base=unitIcon(state.iconConfig,unit,variation,location);
    const mapScale=mapIconScale(state.iconConfig,base,unit,variation);
    return {base,mapScale,html:iconArtwork(base,unitBadge(state.iconConfig,unit,variation),badgeStyle(state.iconConfig,unit,variation),"icon-map-art",baseFrame(state.iconConfig,unit,variation,base),baseGlow(state.iconConfig,unit,variation,base),baseScale(state.iconConfig,unit,variation,base),mapScale,baseShadow(state.iconConfig,unit,variation,base))};
  }
  return (state.mode==="filter" ? filteredPointArtwork(location) : null) ?? {base:unresolvedPointIcon(location),html:unresolvedPointArtwork(location),mapScale:mapIconScale(state.iconConfig,unresolvedPointIcon(location))};
}
function confirmedUnitName(location:Location, p:Pattern|null):string|null {
  if(location.eventFlag!=null) return null;
  const spot=displayedSpot(location,p);
  if(spot && p) return unitNameOnly(numeric(p,"spot",spot.rowId,"unitId",spot.unitId),numeric(p,"spot",spot.rowId,"variationId",spot.variationId));
  if(state.mode!=="filter" || !filteredPointArtwork(location)?.base) return null;
  const selected=state.criteria.get(location.index)?.include;
  if(!selected?.size) return null;
  const names=new Set([...selected].map(value=>{
    const [unit,variation]=value.split("|").map(Number);
    return unitNameOnly(unit,variation);
  }));
  return names.size===1 ? [...names][0] : null;
}
function confirmedBossName(location:Location, p:Pattern|null):string|null {
  const spot=displayedSpot(location,p);
  const units=spot && p
    ? [key(numeric(p,"spot",spot.rowId,"unitId",spot.unitId),numeric(p,"spot",spot.rowId,"variationId",spot.variationId))]
    : [...(state.criteria.get(location.index)?.include ?? [])];
  // Putrid Ancestral Followers use the icon without a persistent caption.
  if(units.some(value=>Number(value.split("|")[0])===4330)) return null;
  const types=new Set(units.map(value=>{
    const [unit,variation]=value.split("|").map(Number);
    return unitTypeId(findEntityName(state.data?.names ?? [],"spot",unit,variation)?.type);
  }));
  const type=types.size===1 ? [...types][0] : null;
  if(![3,4,5,6,14].includes(location.typeIndex ?? -1) &&
    type!=="rise" && type!=="difficultRise") return null;
  const text=confirmedUnitName(location,p);
  return text && type==="difficultRise" ? text.split(/[,，]/).map(part=>part.trim()).join("\n") : text;
}
function hasManualIcon(unit:IconUnit) {
  return Boolean(Object.hasOwn(state.iconConfig.unitIcons,String(unit.id)) || state.iconConfig.unitBadges[String(unit.id)] || state.iconConfig.unitBadgeStyles[String(unit.id)] || Object.hasOwn(state.iconConfig.unitIconFrames || {},String(unit.id)) || Object.hasOwn(state.iconConfig.unitIconGlows || {},String(unit.id)) || Object.hasOwn(state.iconConfig.unitIconShadows || {},String(unit.id)) || Object.hasOwn(state.iconConfig.unitIconScales || {},String(unit.id)) || Object.hasOwn(state.iconConfig.unitMapIconScales || {},String(unit.id)) ||
    unit.variants.some(v=>Object.hasOwn(state.iconConfig.variantIcons,`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantBadges,`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantBadgeStyles,`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantIconFrames || {},`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantIconGlows || {},`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantIconShadows || {},`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantIconScales || {},`${unit.id}|${v.variation}`) || Object.hasOwn(state.iconConfig.variantMapIconScales || {},`${unit.id}|${v.variation}`)));
}
function manualIconCount() {
  const c=state.iconConfig;
  return [c.unitIcons,c.variantIcons,c.unitBadges,c.variantBadges,c.unitBadgeStyles,c.variantBadgeStyles,
    c.unitIconFrames,c.variantIconFrames,c.unitIconGlows,c.variantIconGlows,c.unitIconShadows,c.variantIconShadows,c.unitIconScales,c.variantIconScales,c.unitMapIconScales,c.variantMapIconScales,c.fileIconStyles,c.mapIconScales]
    .reduce((sum,map)=>sum+Object.keys(map || {}).length,0);
}
function hasMissingVariantIcon(id:number, variation:number) {
  const base=state.iconConfig.variantIcons[`${id}|${variation}`];
  const badge=state.iconConfig.variantBadges[`${id}|${variation}`];
  return Boolean(base&&missingIcon(base) || badge&&missingIcon(badge));
}
function hasMissingIcon(unit:IconUnit) {
  const base=state.iconConfig.unitIcons[String(unit.id)], badge=state.iconConfig.unitBadges[String(unit.id)];
  return Boolean(base&&missingIcon(base) || badge&&missingIcon(badge) ||
    unit.variants.some(variant=>hasMissingVariantIcon(unit.id,variant.variation!)));
}
function unitScopeMark(id:number) {
  const icon=state.iconConfig.unitIcons[String(id)], badge=state.iconConfig.unitBadges[String(id)];
  if(Object.hasOwn(state.iconConfig.unitIcons,String(id)) && icon===null) return " ∅";
  return icon&&missingIcon(icon) || badge&&missingIcon(badge) ? " ⚠" : "";
}
function variantScopeMark(id:number, variation:number) {
  const key=`${id}|${variation}`;
  if(Object.hasOwn(state.iconConfig.variantIcons,key) && state.iconConfig.variantIcons[key]===null) return " ∅";
  if(hasMissingVariantIcon(id,variation)) return " ⚠";
  return Object.hasOwn(state.iconConfig.variantIcons,key) || Object.hasOwn(state.iconConfig.variantBadges,key) ||
    Object.hasOwn(state.iconConfig.variantBadgeStyles,key) || Object.hasOwn(state.iconConfig.variantIconFrames || {},key) || Object.hasOwn(state.iconConfig.variantIconGlows || {},key) || Object.hasOwn(state.iconConfig.variantIconShadows || {},key) || Object.hasOwn(state.iconConfig.variantIconScales || {},key) || Object.hasOwn(state.iconConfig.variantMapIconScales || {},key) ? " ●" : "";
}
function locationAt(index:number) { return state.data?.locations.find(x => x.index === index); }
function directFilterType(location:Location|undefined):DirectFilterType|null {
  if(location?.typeIndex===7 && location.eventFlag!=null) return "rot-blessing";
  if(location?.typeIndex===8 && location.eventFlag!=null) return "frenzy-tower";
  if(location?.typeIndex===20 || location?.category==="Great Merchant") return 5399;
  if(location?.typeIndex===9 || location?.category==="Scale-Bearing Merchant") return 4940;
  return null;
}
function directFilterName(type:DirectFilterType) {
  return type==="rot-blessing" ? t("ui.rotBlessing") : type==="frenzy-tower" ? t("ui.frenzyTower")
    : type===5399 ? t("ui.greatMerchant") : t("ui.scaleBearingMerchant");
}
function eventLocationRow(p:Pattern, location:Location) {
  if(location.typeIndex===8) return frenzyTowerPositionRow(p,location,numeric);
  if(location.typeIndex===7 && p.terrainId===3) return p.flags.find(flag=>
    numeric(p,"flag",flag.rowId,"modifierSet",flag.modifierSet)===500 &&
    numeric(p,"flag",flag.rowId,"eventFlag",flag.eventFlag)===location.eventFlag);
}
function directPointPresent(p:Pattern, location:Location) {
  const type=directFilterType(location);
  if(type==="rot-blessing" || type==="frenzy-tower") return eventLocationRow(p,location)!==undefined;
  return cellUnits(p,location.index).some(spot=>numeric(p,"spot",spot.rowId,"unitId",spot.unitId)===type);
}
function buildTerrainLocations(data:Dataset) {
  const byTerrain=new Map<number,Set<number>>();
  // Use the entire loaded dataset, so candidate filters and hidden icons do
  // not remove shared points that physically exist on the current base map.
  for(const pattern of data.patterns) {
    const indices=byTerrain.get(pattern.terrainId) || new Set<number>();
    for(const spot of pattern.placements) {
      if(spot.visible && spot.locationIndex!==null) indices.add(spot.locationIndex);
    }
    for(const location of data.locations) if(location.typeIndex===8 && frenzyTowerPositionRow(pattern,location)) indices.add(location.index);
    byTerrain.set(pattern.terrainId,indices);
  }
  const woods=byTerrain.get(3);
  for(const location of data.locations) if(location.typeIndex===7 && location.eventFlag!=null) woods?.add(location.index);
  return byTerrain;
}
function buildIconUnits(data:Dataset): IconUnit[] {
  const grouped = new Map<number, Name[]>();
  for (const named of data.names.filter(n => n.kind === "spot" && n.variation !== null && n.name)) {
    const variants = grouped.get(named.id) || [];
    variants.push(named); grouped.set(named.id, variants);
  }
  const places = new Map<number, Map<number, number>>();
  const uses = new Map<number, number>();
  for (const pattern of data.patterns) for (const spot of pattern.placements) {
    if (!spot.visible || spot.locationIndex === null || !grouped.has(spot.unitId)) continue;
    uses.set(spot.unitId, (uses.get(spot.unitId) || 0) + 1);
    const byLocation = places.get(spot.unitId) || new Map<number,number>();
    byLocation.set(spot.locationIndex, (byLocation.get(spot.locationIndex) || 0) + 1);
    places.set(spot.unitId, byLocation);
  }
  return [...grouped].map(([id,variants]) => {
    variants.sort((a,b)=>a.variation!-b.variation!);
    const index = [...(places.get(id) || [])].sort((a,b)=>b[1]-a[1])[0]?.[0];
    return {id,variants,sample:data.locations.find(l=>l.index===index)||null,uses:uses.get(id)||0};
  }).sort((a,b)=>a.id-b.id);
}
function currentPattern() { return state.data?.patterns.find(p => p.id === state.selectedPattern) || null; }
function pendingChangeCount() { return state.patches.size+state.additions.size+state.removals.size+state.restorations.size; }
function patternMatchesRows(p:Pattern,rows:PatternRows,withPatches=true) {
  if(p.terrainId!==rows.terrainId || p.nightlordId!==rows.nightlordId) return false;
  const tables:[Patch["table"],(Placement|Flag|Play)[],(Placement|Flag|Play)[],string[]][]=[
    ["spot",p.placements ?? [],rows.placements,["attachId","unitId","variationId","modifier","mapIndex"]],
    ["flag",p.flags,rows.flags,["modifierSet","modifier","eventFlag"]],
    ["play",p.play?[p.play]:[],rows.play?[rows.play]:[],["playArea1","playArea2","bossId1","bossId2","extraBossId1","extraBossId2","bossModifier1","bossModifier2","extraBossModifier1","extraBossModifier2"]]
  ];
  return tables.every(([table,current,baseline,fields])=>{
    if(current.length!==baseline.length) return false;
    const originals=new Map(baseline.map(row=>[row.rowId,row as unknown as Record<string,number>]));
    return current.every(row=>{
      const original=originals.get(row.rowId),values=row as unknown as Record<string,number>;
      return original && fields.every(field=>(withPatches?numeric(p,table,row.rowId,field,values[field]):values[field])===original[field]);
    });
  });
}
function patternIsModified(patternId:number) {
  const p=state.data?.patterns.find(p=>p.id===patternId),rows=state.builtinRecords.get(patternId);
  return !!p && (!rows || !patternMatchesRows(p,rows));
}
function refreshDataset() {
  if(!state.data) return;
  for(const [terrain,indices] of buildTerrainLocations(state.data)) {
    const existing=state.terrainLocations.get(terrain) ?? new Set<number>();
    for(const index of indices) existing.add(index);
    state.terrainLocations.set(terrain,existing);
  }
  state.iconUnits=buildIconUnits(state.data);
}
function snapshotPatternRows(data=state.data) {
  return new Map(data?.patterns.map(p=>[p.id,{terrainId:p.terrainId,nightlordId:p.nightlordId,placements:(p.placements ?? []).map(row=>({...row})),flags:p.flags.map(row=>({...row})),play:p.play?{...p.play}:null}]));
}
function applyPatternRows(p:Pattern,rows:PatternRows) {
  p.terrainId=rows.terrainId;p.nightlordId=rows.nightlordId;
  p.placements=rows.placements.map(row=>({...row}));p.flags=rows.flags.map(row=>({...row}));p.play=rows.play?{...rows.play}:null;
}
function captureEditSnapshot() {
  state.editSnapshot=new Map(state.patches);
  state.editRowSnapshot=new Map(state.additions);
  state.editRemovalSnapshot=new Map(state.removals);
  state.editRecordSnapshot=pendingChangeCount() ? snapshotPatternRows() : state.originalRecords;
  state.editRestorationSnapshot=new Set(state.restorations);
}
function clearEditSnapshot() {
  state.editSnapshot=null;state.editRowSnapshot=null;state.editRemovalSnapshot=null;state.editRecordSnapshot=null;
  state.editRestorationSnapshot=null;
}
function restorePattern() {
  const p=currentPattern(),rows=p && state.builtinRecords.get(p.id);
  if(!p || !rows || state.busy || !patternIsModified(p.id)) return;
  applyPatternRows(p,rows);
  for(const [key,change] of state.patches) if(change.patternId===p.id) state.patches.delete(key);
  for(const [key,change] of state.additions) if(change.patternId===p.id) state.additions.delete(key);
  for(const [key,change] of state.removals) if(change.patternId===p.id) state.removals.delete(key);
  const loaded=state.originalRecords.get(p.id);
  if(loaded && patternMatchesRows(p,loaded,false)) state.restorations.delete(p.id);
  else state.restorations.add(p.id);
  if(!p.flags.some(row=>row.rowId===state.selectedFlag)) state.selectedFlag=null;
  state.terrain=p.terrainId;state.underground=false;resetView();
  refreshDataset();setMode("preview");
}
function removeUnitRow(rowId:number) {
  const p=currentPattern();
  if(!p || state.mode!=="edit" || state.busy) return;
  const row=p.placements.find(row=>row.rowId===rowId);
  if(!row) return;
  p.placements=p.placements.filter(row=>row.rowId!==rowId);
  if(!state.additions.delete(`spot:${rowId}`)) state.removals.set(`spot:${rowId}`,{patternId:p.id,table:"spot",rowId,row});
  for(const [key,patch] of state.patches) if(patch.table==="spot" && patch.rowId===rowId) state.patches.delete(key);
  refreshDataset();renderAll();
}
function removeEventRow(rowId:number) {
  const p=currentPattern();
  if(!p || state.mode!=="edit" || state.busy) return;
  const groups=patternEventGroups(p),group=groups.find(group=>group.rowId===rowId || group.flags.some(row=>row.rowId===rowId));
  if(!group) return;
  applyEventPlan(p,planEventChange(effectiveEventPattern(p),group.rowId,null));
}
function effectiveEventPattern(p:Pattern) {
  return {...p,flags:p.flags.map(row=>({...row,modifierSet:numeric(p,"flag",row.rowId,"modifierSet",row.modifierSet),
    modifier:numeric(p,"flag",row.rowId,"modifier",row.modifier),eventFlag:numeric(p,"flag",row.rowId,"eventFlag",row.eventFlag)})),
    placements:(p.placements ?? []).map(row=>({...row,attachId:numeric(p,"spot",row.rowId,"attachId",row.attachId),unitId:numeric(p,"spot",row.rowId,"unitId",row.unitId),
      variationId:numeric(p,"spot",row.rowId,"variationId",row.variationId),modifier:numeric(p,"spot",row.rowId,"modifier",row.modifier),
      mapIndex:numeric(p,"spot",row.rowId,"mapIndex",row.mapIndex),visible:visibleSpot(p,row)})),
    play:p.play ? Object.fromEntries(Object.entries(p.play).map(([field,value])=>[field,field==="rowId" ? value : numeric(p,"play",p.play!.rowId,field,value)])) as Play : null};
}
function patternEventGroups(p:Pattern) {
  const groups=eventGroups(effectiveEventPattern(p));
  // Retain access to manually edited, unknown records until they are removed.
  const claimed=new Set(groups.flatMap(group=>group.flags.map(row=>row.rowId)));
  for(const row of eventRows(p)) if(!claimed.has(row.rowId)) groups.push({rowId:row.rowId,kind:"unknown",day:1,trigger:null,
    flags:[effectiveEventPattern(p).flags.find(flag=>flag.rowId===row.rowId)!],units:[],position:null,issues:[]});
  return groups;
}
function eventTemplatePool(p:Pattern) {
  return eventTemplates(state.templates?.patterns ?? state.data?.patterns ?? [],p.terrainId);
}
function terrainPresetPatterns(p:Pattern) {
  return (state.templates?.patterns ?? state.data?.patterns ?? []).filter(pattern=>pattern.terrainId===p.terrainId);
}
function availableTerrainLocations(p:Pattern) {
  return eventTerrainLocations(state.templates?.patterns ?? state.data?.patterns ?? [],p.terrainId);
}
function eventChangePlan(p:Pattern,rowId:number|null,template:EventTemplate) {
  if(rowId!==null || !usesMapEventLocations(template.group.kind)) return planEventChange(effectiveEventPattern(p),rowId,template);
  const available=availableTerrainLocations(p);
  const sources=[...template.group.units,...eventTemplatePool(p).filter(candidate=>usesMapEventLocations(candidate.group.kind)).flatMap(candidate=>candidate.group.units)]
    .filter(unit=>unit.locationIndex!==null && available.has(unit.locationIndex));
  return planEventChange(effectiveEventPattern(p),rowId,template,sources);
}
function viableEventTemplate(p:Pattern,rowId:number|null,template:EventTemplate) {
  const plan=eventChangePlan(p,rowId,template);
  const available=availableTerrainLocations(p);
  return !plan.error && [...plan.units.update,...plan.units.add].every(unit=>!unit.visible || unit.locationIndex===null || available.has(unit.locationIndex)) && p.placements.length-plan.units.remove.length+plan.units.add.length<=128;
}
function nextEventRowId(table:Patch["table"]) {
  const ids=(state.data?.patterns ?? []).flatMap(p=>table==="flag" ? p.flags.map(row=>row.rowId) : table==="spot" ? (p.placements ?? []).map(row=>row.rowId) : p.play ? [p.play.rowId] : []);
  for(const p of state.builtinRecords.values()) ids.push(...(table==="flag" ? p.flags.map(row=>row.rowId) : table==="spot" ? p.placements.map(row=>row.rowId) : p.play ? [p.play.rowId] : []));
  ids.push(...[...state.removals.values()].filter(row=>row.table===table).map(row=>row.rowId));
  const id=ids.reduce((maximum,id)=>Math.max(maximum,id),-1)+1;
  if(id>2147483647) throw message("errors.rowIdRange");
  return id;
}
function applyEventPlan(p:Pattern,plan:EventPlan) {
  if(state.busy || state.mode!=="edit") return false;
  if(plan.error) {state.message=message(plan.error==="conflict" ? "errors.eventConflict" : plan.error==="location" ? "errors.eventLocationOccupied" : "errors.rowTemplateMissing");renderStatus();return false;}
  const rows={terrainId:p.terrainId,nightlordId:p.nightlordId,flags:p.flags.map(row=>({...row})),placements:(p.placements ?? []).map(row=>({...row})),play:p.play?{...p.play}:null};
  const patches=new Map(state.patches),additions=new Map(state.additions),removals=new Map(state.removals);
  const selected=state.selectedFlag;
  const patch=(table:Patch["table"],row:Flag|Placement|Play,values:Record<string,number>)=>{
    for(const [field,next] of Object.entries(values)) {
      if(field==="rowId") continue;
      const original=Number((row as unknown as Record<string,number>)[field]),key=patchKey(table,row.rowId,field);
      if(original===next) state.patches.delete(key);
      else state.patches.set(key,{patternId:p.id,table,rowId:row.rowId,field,oldValue:original,newValue:next});
    }
  };
  const remove=(table:"flag"|"spot",rowId:number)=>{
    const row=table==="flag" ? p.flags.find(row=>row.rowId===rowId) : p.placements.find(row=>row.rowId===rowId);
    if(!row) return;
    if(!state.additions.delete(`${table}:${rowId}`)) state.removals.set(`${table}:${rowId}`,{patternId:p.id,table,rowId,row} as RowRemoval);
    for(const [key,change] of state.patches) if(change.table===table && change.rowId===rowId) state.patches.delete(key);
    if(table==="flag") p.flags=p.flags.filter(row=>row.rowId!==rowId);else p.placements=p.placements.filter(row=>row.rowId!==rowId);
  };
  const insert=(table:Patch["table"],source:Flag|Placement|Play)=>{
    const rowId=nextEventRowId(table),fields=table==="flag" ? ["modifierSet","modifier","eventFlag"] : table==="spot" ? ["attachId","unitId","variationId","modifier","mapIndex"] :
      ["playArea1","playArea2","bossId1","bossId2","extraBossId1","extraBossId2","bossModifier1","bossModifier2","extraBossModifier1","extraBossModifier2"];
    const values=Object.fromEntries(fields.map(field=>[field,Number((source as unknown as Record<string,number>)[field])]));
    if(table==="spot") values.mapIndex=0;
    state.additions.set(`${table}:${rowId}`,{patternId:p.id,table,rowId,sourceRowId:source.rowId,fields:values});
    const row={...source,...values,rowId};
    if(table==="flag") p.flags.push(row as Flag);else if(table==="spot") p.placements.push(row as Placement);else p.play=row as Play;
    return rowId;
  };
  try {
    for(const rowId of plan.flags.remove) remove("flag",rowId);
    for(const rowId of plan.units.remove) {
      const row=p.placements.find(row=>row.rowId===rowId)!;
      // Location packages can replace a camp in the current draft. Removing or
      // moving the event restores that imported camp instead of leaving a hole.
      if(isMapEventUnit(numeric(p,"spot",rowId,"unitId",row.unitId)) && !isMapEventUnit(row.unitId)) {
        patch("spot",row,{attachId:row.attachId,unitId:row.unitId,variationId:row.variationId,modifier:row.modifier});
        continue;
      }
      // A rise event can replace an existing ordinary tower. Restore that tower
      // when removing the event, including after the result has been reimported.
      const ordinary=row.unitId!==4090 ? row : (state.templates?.patterns ?? []).filter(other=>other.terrainId===p.terrainId)
        .sort((a,b)=>Number(b.id===p.id)-Number(a.id===p.id))
        .flatMap(other=>other.placements).find(source=>source.attachId===row.attachId && (p.terrainId===4 ? [5100,5105,5110,5115] : [4100,4101]).includes(source.unitId));
      if(numeric(p,"spot",rowId,"unitId",row.unitId)===4090 && ordinary) patch("spot",row,{attachId:ordinary.attachId,unitId:ordinary.unitId,variationId:ordinary.variationId,modifier:ordinary.modifier});
      else remove("spot",rowId);
    }
    for(const source of plan.flags.update) {const row=p.flags.find(row=>row.rowId===source.rowId)!;patch("flag",row,{modifierSet:source.modifierSet,modifier:source.modifier,eventFlag:source.eventFlag});}
    for(const source of plan.units.update) {const row=p.placements.find(row=>row.rowId===source.rowId)!;patch("spot",row,{attachId:source.attachId,unitId:source.unitId,variationId:source.variationId,modifier:source.modifier});}
    for(const source of plan.flags.add) state.selectedFlag=insert("flag",source);
    for(const source of plan.units.add) insert("spot",source);
    if(p.placements.length>128) throw message("errors.eventUnitCapacity",{count:p.placements.length});
    if(Object.keys(plan.play).length) {
      if(!p.play) {
        const source=(state.templates?.patterns ?? []).find(other=>other.terrainId===p.terrainId && other.play)?.play;
        if(!source) throw message("errors.rowTemplateMissing");
        insert("play",{...source,extraBossId1:-1,extraBossId2:-1,extraBossModifier1:0,extraBossModifier2:0});
      }
      patch("play",p.play!,plan.play as Record<string,number>);
    }
    if(!normalizeMapIndices(p)) throw state.message;
    const locations=new Set<number>();
    for(const row of p.placements) if(row.locationIndex!==null && visibleSpot(p,row)) {
      if(locations.has(row.locationIndex)) throw message("errors.eventLocationOccupied");
      locations.add(row.locationIndex);
    }
    const capacity=patternEventCapacity(p);
    if(capacity.invalidRowId!==null && plan.flags.add.length) throw message("errors.eventBundleCapacity",{count:capacity.count,limit:capacity.limit});
    if(!p.flags.some(row=>row.rowId===state.selectedFlag)) state.selectedFlag=patternEventGroups(p)[0]?.rowId ?? null;
    refreshDataset();renderAll();return true;
  } catch(error) {
    applyPatternRows(p,rows);state.patches=patches;state.additions=additions;state.removals=removals;state.selectedFlag=selected;
    state.message=error as StatusMessage;renderAll();return false;
  }
}
function changeEventBundle(rowId:number|null,kind:EventKind,day:1|2,position:number|null=null,pointerY:number|null=null) {
  const p=currentPattern();if(!p || state.mode!=="edit" || state.busy) return;
  const old=patternEventGroups(p).find(group=>group.rowId===rowId);
  const preferred=position ?? (old?.kind===kind ? old.position : null);
  const candidates=eventTemplatePool(p).filter(template=>template.group.kind===kind && (eventTiming(kind)==="start" || template.group.day===day));
  const template=candidates.filter(template=>preferred===null || template.group.position===preferred)
    .find(template=>viableEventTemplate(p,rowId,template)) ??
    (position===null ? candidates.find(template=>viableEventTemplate(p,rowId,template)) : undefined);
  if(!template) {state.message=message("errors.rowTemplateMissing");renderStatus();return;}
  state.selectedFlag=rowId;
  if(applyEventPlan(p,eventChangePlan(p,rowId,template))) {
    const group=patternEventGroups(p).find(group=>group.kind===kind && (eventTiming(kind)==="start" || group.day===day) &&
      (kind!=="rise" || group.position===template.group.position));
    state.selectedFlag=group?.rowId ?? state.selectedFlag;
    const location=group?.units.find(unit=>unit.visible && unit.locationIndex!==null)?.locationIndex;
    if(p.terrainId===4 && location!==undefined && location!==null) {state.underground=hollowLowerLocations.has(location);renderMap();}
    revealEventCard(state.selectedFlag,true,rowId===null ? pointerY : null);
  }
}
function toggleFrenzyLocation(rowId:number,position:number,enabled:boolean) {
  const p=currentPattern();if(!p || state.mode!=="edit" || state.busy) return;
  const effective=effectiveEventPattern(p),group=eventGroups(effective).find(group=>group.rowId===rowId);
  if(!group || group.kind!=="frenzy") return;
  const positions=frenzyEventPositions(effective,group).filter(value=>value!==position);
  if(enabled) positions.push(position);
  applyEventPlan(p,planFrenzyLocations(effective,rowId,positions));
}
function chooseEventKind(rowId:number|null,kind:EventKind,pointerY:number|null=null) {
  const p=currentPattern();if(!p || state.mode!=="edit" || state.busy) return;
  const old=patternEventGroups(p).find(group=>group.rowId===rowId);
  const candidates=eventTemplatePool(p).filter(template=>template.group.kind===kind)
    .sort((a,b)=>Number(b.group.day===(old?.day ?? 1))-Number(a.group.day===(old?.day ?? 1)));
  const template=candidates.find(template=>viableEventTemplate(p,rowId,template));
  if(!template) {state.message=message("errors.rowTemplateMissing");renderStatus();return;}
  changeEventBundle(rowId,kind,template.group.day,null,pointerY);
}
function changeEventDay(rowId:number,day:1|2) {
  const p=currentPattern();if(!p || state.mode!=="edit" || state.busy) return;
  applyEventPlan(p,planEventDayChange(effectiveEventPattern(p),rowId,day));
}
function changeMapEventLocation(rowId:number|null,position:number|null) {
  const p=currentPattern();if(!p || state.mode!=="edit" || state.busy) return;
  const source=position===null ? null : mapEventLocationChoices(p,eventTemplatePool(p),rowId).find(unit=>unit.attachId===position);
  if(position!==null && !source) {state.message=message("errors.eventLocationOccupied");renderStatus();return;}
  applyEventPlan(p,planMapEventLocationChange(effectiveEventPattern(p),rowId,source ?? null));
}
function addRow(kind:"spot"|"event"|"spawn"|"play") {
  const p=currentPattern(),data=state.data;
  if(!p || !data || state.mode!=="edit" || state.busy || kind==="play" && p.play) return;
  if(kind==="spawn" && p.flags.some(row=>row.modifierSet===(p.terrainId===4 ? 160 : 190))) return;
  const table:Patch["table"]=kind==="spot" ? "spot" : kind==="play" ? "play" : "flag";
  const location=kind==="spot" ? locationAt(state.selectedLocation ?? -1) : null;
  if(kind==="spot" && (!location || location.eventFlag!=null)) return;
  if(kind==="spot" && p.placements.some(row=>row.locationIndex===location!.index && visibleSpot(p,row))) return;
  const candidates=[...data.patterns,...(state.templates?.patterns ?? [])].flatMap(pattern=>{
    const rows:(Placement|Flag|Play)[]=kind==="spawn" && pattern.terrainId!==p.terrainId ? [] : table==="spot" ? [...pattern.placements,...[...state.removals.values()].flatMap(removal=>removal.table==="spot" && removal.patternId===pattern.id ? [removal.row] : [])].filter(row=>row.locationIndex===location!.index && visibleSpot(pattern,row))
      : table==="play" ? pattern.play ? [pattern.play] : []
      : kind==="spawn" ? pattern.flags.filter(row=>row.modifierSet===(p.terrainId===4 ? 160 : 190)) : eventRows(pattern);
    return rows.map(row=>({pattern,row}));
  });
  const source=candidates.find(source=>source.pattern===p && source.row.rowId===state.selectedFlag && table==="flag")
    ?? candidates.find(source=>source.pattern===p)
    ?? candidates.find(source=>source.pattern.terrainId===p.terrainId) ?? candidates[0];
  if(!source) {state.message=message("errors.rowTemplateMissing");renderStatus();return;}
  const rows=data.patterns.flatMap(pattern=>table==="spot" ? pattern.placements.map(row=>row.rowId)
    : table==="flag" ? pattern.flags.map(row=>row.rowId) : pattern.play ? [pattern.play.rowId] : []);
  rows.push(...[...state.removals.values()].filter(removal=>removal.table===table).map(removal=>removal.rowId));
  for(const baseline of state.builtinRecords.values()) rows.push(...(table==="spot" ? baseline.placements.map(row=>row.rowId) : table==="flag" ? baseline.flags.map(row=>row.rowId) : baseline.play?[baseline.play.rowId]:[]));
  const rowId=rows.reduce((maximum,id)=>Math.max(maximum,id),-1)+1;
  if(rowId>2147483647) {state.message=message("errors.rowIdRange");renderStatus();return;}
  const fields=table==="spot" ? ["attachId","unitId","variationId","modifier","mapIndex"]
    : table==="flag" ? ["modifierSet","modifier","eventFlag"]
    : ["playArea1","playArea2","bossId1","bossId2","extraBossId1","extraBossId2","bossModifier1","bossModifier2","extraBossModifier1","extraBossModifier2"];
  const values=Object.fromEntries(fields.map(field=>[field,numeric(source.pattern,table,source.row.rowId,field,Number((source.row as unknown as Record<string,number>)[field]))]));
  if(table==="spot") values.mapIndex=0;
  const parent=state.additions.get(`${table}:${source.row.rowId}`);
  state.additions.set(`${table}:${rowId}`,{patternId:p.id,table,rowId,sourceRowId:parent?.sourceRowId ?? source.row.rowId,fields:values});
  const row={...source.row,...values,rowId};
  if(table==="spot") {
    const placement=row as unknown as Placement;
    placement.visible=visibleSpot(p,placement);
    p.placements.push(placement);
    if(!normalizeMapIndices(p)) {
      p.placements=p.placements.filter(row=>row.rowId!==rowId);
      state.additions.delete(`${table}:${rowId}`);renderAll();return;
    }
  } else if(table==="flag") {
    p.flags.push(row as unknown as Flag);
    if(kind==="event") state.selectedFlag=rowId;
  } else p.play=row as unknown as Play;
  refreshDataset();renderAll();
}
function numeric(p:Pattern, table:Patch["table"], row:number, field:string, original:number) {
  const patch=state.patches.get(patchKey(table,row,field));
  return patch?.patternId===p.id ? patch.newValue : original;
}
function normalizeMapIndices(p:Pattern) {
  const groups=new Map<string,Placement[]>();
  for(const row of p.placements ?? []) {
    const group=String(numeric(p,"spot",row.rowId,"unitId",row.unitId));
    const rows=groups.get(group) ?? [];rows.push(row);groups.set(group,rows);
  }
  const changes:[Placement,number][]=[];
  for(const rows of groups.values()) {
    if(rows.length>256) {state.message=message("errors.mapIndexLimit",{patternId:p.id});return false;}
    const used=new Set(rows.map(row=>numeric(p,"spot",row.rowId,"mapIndex",row.mapIndex)));
    const seen=new Set<number>();
    let next=0;
    for(const row of rows.sort((a,b)=>a.rowId-b.rowId)) {
      const index=numeric(p,"spot",row.rowId,"mapIndex",row.mapIndex);
      if(!seen.has(index)) {seen.add(index);continue;}
      while(used.has(next)) next++;
      changes.push([row,next]);used.add(next++);
    }
  }
  for(const [row,next] of changes) {
    const id=patchKey("spot",row.rowId,"mapIndex");
    if(next===row.mapIndex) state.patches.delete(id);
    else state.patches.set(id,{patternId:p.id,table:"spot",rowId:row.rowId,field:"mapIndex",oldValue:row.mapIndex,newValue:next});
  }
  return true;
}
function visibleSpot(p:Pattern,s:Placement) {
  const unit = numeric(p,"spot",s.rowId,"unitId",s.unitId);
  return !hiddenUnitIds.has(unit) && !(p.terrainId===2 && (s.attachId===129 || s.attachId===2129));
}
function setPatch(p:Pattern, table:Patch["table"], row:number, field:string, original:number, next:number) {
  setPatchBatch(p,[[table,row,field,original,next]]);
}
function cellUnits(p:Pattern, index:number) {
  return p.placements.filter(s => s.locationIndex === index && visibleSpot(p,s));
}
function matchesCriteria(p:Pattern, skipIndex?:number) {
  const merchantMatches=new Map<DirectFilterType,boolean>();
  for (const [index, criterion] of state.criteria) {
    if (index === skipIndex) continue;
    const merchant=directFilterType(locationAt(index));
    if(merchant!==null) {
      const present=directPointPresent(p,locationAt(index)!);
      if(criterion.exclude.size && present) return false;
      // Positive points of the same type are alternatives; exclusions still
      // apply independently, including event-controlled blessing locations.
      if(criterion.include.size) merchantMatches.set(merchant,(merchantMatches.get(merchant) || false) || present);
      continue;
    }
    const units = cellUnits(p,index).map(s => key(numeric(p,"spot",s.rowId,"unitId",s.unitId),numeric(p,"spot",s.rowId,"variationId",s.variationId)));
    if (!matchesUnitCriterion(units,criterion)) return false;
  }
  return [...merchantMatches.values()].every(Boolean);
}
function mapCriterion(field:MapInformationField) {
  return field==="nightlord" ? state.nightlord : state.mapCriteria.get(field);
}
function informationValues(p:Pattern, field:MapInformationField) {
  const effective=field==="event" ? effectiveEventPattern(p) : null;
  return mapInformationValues(p,field,
    (_pattern,table,row,field,original)=>numeric(p,table,row,field,original),
    event=>{
      const kind=eventKindForRow(effective!,event);
      // Equivalent event records share a choice across base and DLC Patterns.
      return kind!=="unknown" ? `event:${kind}` : `${event.modifierSet}|${event.eventFlag}`;
    });
}
function matchesMapCriteria(p:Pattern, skipField?:MapInformationField) {
  return mapInformationFields.every(field=>{
    const criterion=mapCriterion(field);
    return field===skipField || !criterion || matchesUnitCriterion(informationValues(p,field),criterion);
  });
}
function candidates(skipIndex?:BubbleTarget, skipField?:MapInformationField) {
  return (state.data?.patterns || []).filter(p =>
    matchesMapCriteria(p,skipIndex==="nightlord" ? "nightlord" : skipField) &&
    matchesCriteria(p,typeof skipIndex === "number" ? skipIndex : undefined)
  );
}
function toggleMapChoice(field:MapInformationField, value:string, side:FilterSide) {
  const criterion=mapCriterion(field) ?? {include:new Set<string>(),exclude:new Set<string>()};
  toggleCriterion(criterion,value,side);
  if(field!=="nightlord") {
    if(criterion.include.size || criterion.exclude.size) state.mapCriteria.set(field,criterion);
    else state.mapCriteria.delete(field);
  }
  if(field==="terrain" && side==="include" && criterion.include.has(value)) setViewedTerrain(Number(value));
  state.bubble=null;
  updateAfterFilter();
}
function setViewedTerrain(id:number) {
  if(state.terrain!==id) {state.terrain=id;state.underground=false;resetView();}
}
function viewTerrain(id:number) {
  setViewedTerrain(id);
  state.bubble=null;
  setMode("filter");
}
function toggleCriterion(criterion:Criterion, unitKey:string, side:"include"|"exclude") {
  toggleFilterChoices(criterion,[unitKey],side);
}
function toggleNightlordChoice(id:string, side:"include"|"exclude") {
  toggleCriterion(state.nightlord,id,side);
  updateAfterFilter();
}
function toggleChoice(index:number, unitKey:string, side:"include"|"exclude") {
  toggleChoices(index,[unitKey],side);
}
function toggleChoices(index:number, unitKeys:readonly string[], side:FilterSide) {
  const criterion = state.criteria.get(index) || {include:new Set<string>(),exclude:new Set<string>()};
  toggleFilterChoices(criterion,unitKeys,side);
  if (!criterion.include.size && !criterion.exclude.size) state.criteria.delete(index);
  else state.criteria.set(index,criterion);
  updateAfterFilter();
}
function toggleDirectPointChoice(index:number, side:"include"|"exclude") {
  const location=locationAt(index),unit=directFilterType(location);
  if(!location || unit===null) return;
  const value=typeof unit==="string" ? String(location.eventFlag) : key(unit,0);
  if(state.criteria.get(index)?.[side].size) state.criteria.delete(index);
  else state.criteria.set(index,{
    include:new Set(side==="include" ? [value] : []),
    exclude:new Set(side==="exclude" ? [value] : [])
  });
  state.bubble=null;
  // Stay on the filter map even for one result, so users can add alternative
  // merchant points and broaden the candidate set with another click.
  renderAll();
}
function selectPattern(id:number) {
  const p = state.data?.patterns.find(x => x.id === id);
  if (!p) return;
  state.selectedPattern = id; state.terrain = p.terrainId; state.underground = false;
  state.mode = "preview"; state.bubble = null; state.selectedLocation = null;
  clearEditSnapshot();
  resetView(); renderAll();
}
function resetView() { state.zoom = 1; state.panX = 0; state.panY = 0; }
function setMode(mode:Mode) {
  if(state.busy && (mode==="edit" || state.mode==="edit")) return;
  if (mode !== "filter" && !currentPattern()) return;
  if (mode === "edit" && state.mode !== "edit") {
    captureEditSnapshot();
    normalizeMapIndices(currentPattern()!);
  } else if (mode !== "edit") clearEditSnapshot();
  state.mode = mode; state.bubble = null;
  if (mode === "filter") {state.selectedPattern=null;state.selectedLocation=null;}
  renderAll();
}
function cancelEdit() {
  if (state.busy || state.mode !== "edit" || state.editSnapshot === null) return;
  state.patches = new Map(state.editSnapshot);
  state.additions = new Map(state.editRowSnapshot ?? []);
  state.removals = new Map(state.editRemovalSnapshot ?? []);
  state.restorations = new Set(state.editRestorationSnapshot ?? []);
  for(const p of state.data?.patterns ?? []) {
    const rows=state.editRecordSnapshot?.get(p.id);
    if(rows) applyPatternRows(p,rows);
  }
  if(!currentPattern()?.flags.some(row=>row.rowId===state.selectedFlag)) state.selectedFlag=null;
  refreshDataset();
  setMode("preview");
}
function changeLanguage(language:Language) {
  setLanguage(language);
}
subscribeLanguage(()=>{
  preserveScroll(()=>{renderShell();renderAll();renderStatus();renderIconStudio();});
  document.querySelector<HTMLSelectElement>("#language-select")!.focus();
});
function renderShell() {
  document.documentElement.lang=getLanguage();
  document.title=t("ui.appName");
  if(isTauri()) void getCurrentWindow().setTitle(document.title).catch(error=>console.error("Failed to update window title",error));
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><div class="brand-mark">✦</div><div><div class="brand-overline">NIGHTREIGN / PATTERN TOOLS</div><h1>${t("ui.appName")}</h1></div></div>
      <div class="top-actions"><span id="source-label" class="source-label"></span><select id="language-select" class="language-select" aria-label="${t("ui.language")}"><option value="en" ${getLanguage()==="en"?"selected":""}>English</option><option value="zh-CN" ${getLanguage()==="zh-CN"?"selected":""}>中文</option></select>${import.meta.env.DEV?`<button id="icons-button" class="button secondary">${t("ui.iconSettings")}</button>`:""}<div class="open-file"><button id="open-button" class="button secondary" type="button" aria-expanded="false" aria-controls="open-file-options">${t("ui.open")} <span aria-hidden="true">▾</span></button><div id="open-file-options" class="open-file-options" hidden><button id="default-button" type="button">${t("ui.openBundledRegulation")}</button><button id="import-button" type="button">${t("ui.openImportRegulation")}</button></div></div><button id="save-button" class="button primary">${t("ui.saveRegulationBin")}</button></div>
    </header>
    <main class="layout">
      <aside class="left-panel"><div id="filter-panel"></div><div id="result-panel"></div></aside>
      <section class="center-panel"><div id="map-viewport" class="map-viewport"><div id="map-board" class="map-board"></div><div class="map-controls" role="group" aria-label="${t("ui.mapViewControls")}"><button id="layer-switch" class="icon-button map-layer-switch" type="button" aria-label="${t("ui.lowerLevel")}" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg></button><button id="zoom-in" class="icon-button" aria-label="${t("ui.zoomInOnMap")}">＋</button><output id="zoom-label" aria-label="${t("ui.zoomLevel")}">100%</output><button id="zoom-out" class="icon-button" aria-label="${t("ui.zoomOutOfMap")}">−</button><button id="reset-view" class="icon-button" aria-label="${t("ui.resetMapView")}">⌖</button></div></div></section>
      <aside class="right-panel" id="inspector"></aside>
    </main><div id="statusbar" class="statusbar"></div><div id="icon-studio" class="icon-studio" hidden></div>`;
  if(import.meta.env.DEV) {
    document.querySelector("#icons-button")!.addEventListener("click",()=>{state.iconStudioOpen=true;renderIconStudio();});
  }
  document.querySelector<HTMLSelectElement>("#language-select")!.addEventListener("change",e=>changeLanguage((e.target as HTMLSelectElement).value as Language));
  const openButton=document.querySelector<HTMLButtonElement>("#open-button")!;
  const openOptions=document.querySelector<HTMLElement>("#open-file-options")!;
  const openFile=document.querySelector<HTMLElement>(".open-file")!;
  openButton.addEventListener("click",()=>{
    openOptions.hidden=!openOptions.hidden;
    openButton.setAttribute("aria-expanded",String(!openOptions.hidden));
  });
  openFile.addEventListener("keydown",event=>{
    if(event.key==="Escape" && !openOptions.hidden) {
      event.preventDefault();closeOpenFileMenu();openButton.focus();
    }
  });
  openFile.addEventListener("focusout",event=>{
    // During pointer focus changes, a microtask can run before the next button
    // receives focus. Hiding the menu in that gap cancels its pending click.
    if(!(event.relatedTarget instanceof Node) || !openFile.contains(event.relatedTarget)) closeOpenFileMenu();
  });
  document.querySelector("#default-button")!.addEventListener("click",()=>{closeOpenFileMenu();openButton.focus();void loadDefaultFile();});
  document.querySelector("#import-button")!.addEventListener("click",()=>{closeOpenFileMenu();openButton.focus();void importFile();});
  document.querySelector("#save-button")!.addEventListener("click", saveFile);
  document.querySelector("#zoom-out")!.addEventListener("click",()=>zoomView(state.zoom-.2));
  document.querySelector("#zoom-in")!.addEventListener("click",()=>zoomView(state.zoom+.2));
  document.querySelector("#reset-view")!.addEventListener("click",()=> {resetView();state.bubble=null;renderMap();});
  document.querySelector("#layer-switch")!.addEventListener("click",()=>{
    if(state.terrain!==4) return;
    state.underground=!state.underground;state.bubble=null;renderMap();
  });
  const viewport = document.querySelector<HTMLElement>("#map-viewport")!;
  bindMapEvents(document.querySelector<HTMLElement>("#map-board")!);
  viewport.addEventListener("dragstart",event=>event.preventDefault());
  viewport.addEventListener("wheel", event => {
    // Leave popup scrolling to the browser, including at the list boundaries.
    if ((event.target as HTMLElement).closest(".bubble")) return;
    event.preventDefault();
    if ((event.target as HTMLElement).closest(".map-controls")) return;
    zoomView(state.zoom + (event.deltaY < 0 ? .15 : -.15));
  }, {passive:false});
  let drag: {x:number;y:number;panX:number;panY:number}|null = null;
  let dragged = false;
  viewport.addEventListener("pointerdown", event => {
    dragged = false;
    if ((event.target as HTMLElement).closest("button, .bubble, .map-controls")) return;
    drag = {x:event.clientX,y:event.clientY,panX:state.panX,panY:state.panY};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", event => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) dragged = true;
    state.panX = drag.panX + event.clientX - drag.x;
    state.panY = drag.panY + event.clientY - drag.y;
    applyView();
  });
  viewport.addEventListener("pointerup", () => { drag = null; });
  viewport.addEventListener("pointercancel", () => { drag = null; });
  viewport.addEventListener("click", event => {
    if (dragged || state.mode === "filter" || state.selectedLocation === null) return;
    if ((event.target as Element).closest("button, .bubble, .map-controls, [data-location], [data-nightlord]")) return;
    state.selectedLocation = null;
    renderMap();renderInspector();
  });
}
document.addEventListener("contextmenu", event => event.preventDefault(), {capture:true});
for(const eventType of ["click","contextmenu"]) document.addEventListener(eventType, event => {
  const expanded=state.expandedCriterion;
  const group=(event.target as HTMLElement).closest<HTMLElement>("[data-criterion-group]");
  if(expanded && (!group || Number(group.dataset.index)!==expanded.index || group.dataset.criterionGroup!==expanded.group || group.dataset.side!==expanded.side)) {
    state.expandedCriterion=null;
    // Let the clicked control finish before replacing any filter buttons.
    queueMicrotask(()=>{
      if(!state.expandedCriterion && document.querySelector(".criterion-choice-group.expanded")) renderFilterPanel();
    });
  }
}, {capture:true});
document.addEventListener("click", event => {
  if (!(event.target as Element).closest(".open-file")) closeOpenFileMenu();
  if (state.bubble === null || (event.target as HTMLElement).closest(".bubble, [data-location], [data-nightlord], #language-select")) return;
  state.bubble = null;
  renderMap();
});
window.addEventListener("resize",()=>{if(state.data) renderMap();});
function closeOpenFileMenu() {
  const options=document.querySelector<HTMLElement>("#open-file-options");
  if(options) options.hidden=true;
  document.querySelector("#open-button")?.setAttribute("aria-expanded","false");
}
function renderStatus() {
  const source = state.data?.sourcePath?.split(/[\\/]/).pop() || t("ui.bundledRegulationBin");
  document.querySelector("#source-label")!.textContent = `${source} · v${state.data?.version || "—"}`;
  const saveButton = document.querySelector<HTMLButtonElement>("#save-button")!;
  if(import.meta.env.DEV) document.querySelector<HTMLButtonElement>("#icons-button")!.disabled = !state.data;
  saveButton.disabled = !state.data || state.busy;
  saveButton.textContent = state.busy ? t("ui.working") : t("save.button", { count: pendingChangeCount() });
  document.querySelector("#statusbar")!.innerHTML = `<span class="status-dot"></span>${html(formatMessage(state.message) || (state.data ? t("status.ready") : t("status.loadingMap")))}`;
  syncBusyControls();
}
function syncBusyControls() {
  if(state.busy) closeOpenFileMenu();
  document.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>(
    "#open-button, #default-button, #import-button, #edit-pattern, #restore-pattern, #cancel-edit, #exit-edit, #inspector [data-edit-field], #inspector [data-spot-preset], #inspector [data-event-preset], #inspector [data-event-day], #inspector [data-event-position], #inspector [data-frenzy-position], #inspector [data-add-event], #inspector [data-repair-event], #inspector [data-boss-preset], #inspector [data-add-row], #inspector [data-remove-unit], #inspector [data-remove-event], #inspector [data-map-event-position]"
  ).forEach(control=>{control.disabled=state.busy;});
  document.querySelectorAll<HTMLButtonElement>("#inspector [data-event-day]").forEach(button=>{
    button.disabled=state.busy || button.hasAttribute("data-day-unavailable");
  });
  document.querySelectorAll<HTMLSelectElement>("#inspector [data-add-map-event-location]").forEach(select=>{select.disabled=state.busy || select.options.length<=1;});
  document.querySelectorAll<HTMLButtonElement>("#inspector [data-remove-map-event-location]").forEach(button=>{
    button.disabled=state.busy || document.querySelectorAll("#inspector [data-map-event-position]").length<=1;
  });
  document.querySelectorAll<HTMLButtonElement>("#inspector .location-picker button").forEach(button=>{
    const select=button.closest(".location-picker")?.querySelector<HTMLSelectElement>("select");
    const option=Array.from(select?.options ?? []).find(option=>option.value===button.dataset.positionValue);
    button.disabled=state.busy || !!select?.disabled || !!option?.disabled;
  });
}
function iconUnitList() {
  const term=state.iconSearch.trim().toLowerCase();
  return state.iconUnits.filter(unit => {
    const pending=!Object.hasOwn(state.iconConfig.unitIcons,String(unit.id)) && !automaticUnitIcons[String(unit.id)];
    const assigned=hasManualIcon(unit);
    if(state.iconFilter==="pending" && !pending) return false;
    if(state.iconFilter==="assigned" && !assigned) return false;
    if(state.iconFilter==="missing" && !hasMissingIcon(unit)) return false;
    return !term || String(unit.id).includes(term) || unit.variants.some(v=>nameSearchText(v).includes(term));
  });
}
function renderIconUnitList() {
  preserveScroll(renderIconUnitListContent);
}
function renderIconUnitListContent() {
  const target=document.querySelector<HTMLElement>("#icon-unit-list");
  if(!target) return;
  const shown=iconUnitList();
  target.innerHTML=shown.length?shown.map(unit=>{
    const first=unit.variants[0];
    const displayName=formattedName(unit.id===state.iconSelectedId && state.iconSelectedVariation!==null
      ? unit.variants.find(v=>v.variation===state.iconSelectedVariation) || first
      : first);
    const displayedVariation=unit.id===state.iconSelectedId ? state.iconSelectedVariation : null;
    const asset=displayedVariation===null?unitDefaultIcon(state.iconConfig,unit.id,unit.sample):unitIcon(state.iconConfig,unit.id,displayedVariation,unit.sample);
    const badge=displayedVariation===null?state.iconConfig.unitBadges[String(unit.id)] || null:unitBadge(state.iconConfig,unit.id,displayedVariation);
    const assigned=hasManualIcon(unit);
    const missing=hasMissingIcon(unit);
    const source=missing?t("ui.missingAssets"):asset===null?t("ui.noIconHiddenOnMap"):assigned?t("ui.assigned"):automaticUnitIcons[String(unit.id)]?t("ui.automatic"):t("ui.pending");
    return `<button class="icon-unit ${state.iconSelectedId===unit.id?"selected":""} ${missing?"missing":""}" data-icon-unit="${unit.id}">${iconArtwork(asset,badge,badgeStyle(state.iconConfig,unit.id,displayedVariation),"icon-list-art",baseFrame(state.iconConfig,unit.id,displayedVariation,asset),baseGlow(state.iconConfig,unit.id,displayedVariation,asset),baseScale(state.iconConfig,unit.id,displayedVariation,asset))}<span><strong>${unit.id} · ${html(displayName)}</strong><small>${t("counts.variants", { count: unit.variants.length })} · ${t("counts.placements", { count: unit.uses })} · ${source}</small></span></button>`;
  }).join(""):`<div class="icon-empty">${t("ui.noMatchingUnits")}</div>`;
  target.querySelectorAll<HTMLElement>("[data-icon-unit]").forEach(button=>button.addEventListener("click",()=>{
    state.iconSelectedId=Number(button.dataset.iconUnit);state.iconSelectedVariation=null;state.iconAssetSearch="";renderIconStudio();
  }));
}
function renderIconPalette() {
  preserveScroll(renderIconPaletteContent);
}
function renderIconPaletteContent() {
  const target=document.querySelector<HTMLElement>("#icon-palette");
  if(!target) return;
  const term=state.iconAssetSearch.trim().toLowerCase();
  const files=iconFiles.filter(file=>file.toLowerCase().includes(term));
  const unit=state.iconUnits.find(x=>x.id===state.iconSelectedId);
  const selected=unit?(state.iconAssetLayer==="badge"
    ? state.iconSelectedVariation===null ? state.iconConfig.unitBadges[String(unit.id)] : unitBadge(state.iconConfig,unit.id,state.iconSelectedVariation)
    : state.iconSelectedVariation===null
      ? unitDefaultIcon(state.iconConfig,unit.id,unit.sample)
      : unitIcon(state.iconConfig,unit.id,state.iconSelectedVariation,unit.sample)):"";
  target.innerHTML=files.length?files.map(file=>`<button class="icon-asset ${file===selected?"selected":""}" data-icon-file="${html(file)}" aria-label="${html(file)}" ${state.iconBusy?"disabled":""}><img src="${imageUrl(file)}" alt=""><span>${html(file.replace(/\.(webp|png|jpe?g)$/i,""))}</span></button>`).join(""):`<div class="icon-empty">${t("ui.noMatchingIcons")}</div>`;
  target.querySelectorAll<HTMLElement>("[data-icon-file]").forEach(button=>button.addEventListener("click",()=>saveIconAssignment(button.dataset.iconFile!)));
}
function iconStudioHeader() {
  const assigned=manualIconCount();
  const pending=state.iconUnits.filter(x=>!Object.hasOwn(state.iconConfig.unitIcons,String(x.id))&&!automaticUnitIcons[String(x.id)]).length;
  const missing=state.iconUnits.filter(hasMissingIcon).length;
  return `<div class="icon-studio-head"><div><span class="eyebrow">${t("assets.heading")}</span><h2>${t("assets.title")}</h2><p>${t("help.assets")}</p></div><div class="icon-studio-actions"><button id="icon-reload" class="button secondary" ${state.iconBusy?"disabled":""}>${t("assets.reload")}</button><button id="icon-import" class="button secondary" ${state.iconBusy?"disabled":""}>${t("ui.importJson")}</button><button id="icon-export" class="button secondary" ${state.iconBusy?"disabled":""}>${t("ui.exportJson")}</button><button id="icon-close" class="button primary">${t("ui.backToMap")}</button></div></div>
    <div class="icon-studio-info"><span>${t("assets.summary", { icons: iconFiles.length, units: state.iconUnits.length, assigned, pending, missing })}</span><span>${html(formatMessage(state.iconMessage) || (state.iconResourcePath?t("assets.directory", { path: state.iconResourcePath }):t("help.settingsTransfer")))}</span></div>
<div class="icon-layer-tabs icon-config-tabs"><button data-icon-config-scope="unit" class="${state.iconConfigScope==="unit"?"active":""}">${t("ui.unitSettings")}</button><button data-icon-config-scope="file" class="${state.iconConfigScope==="file"?"active":""}">${t("ui.iconFileSettings")}</button></div>`;
}
function bindIconStudioActions(studio:HTMLElement) {
  studio.querySelector("#icon-close")!.addEventListener("click",()=>{state.iconStudioOpen=false;renderIconStudio();});
  studio.querySelector("#icon-reload")!.addEventListener("click",()=>reloadIconResources());
  studio.querySelector("#icon-import")!.addEventListener("click",importIconConfig);
  studio.querySelector("#icon-export")!.addEventListener("click",exportIconConfig);
  studio.querySelectorAll<HTMLElement>("[data-icon-config-scope]").forEach(button=>button.addEventListener("click",()=>{
    state.iconConfigScope=button.dataset.iconConfigScope as "unit"|"file";renderIconStudio();
  }));
}
function renderIconStudio() {
  if(!import.meta.env.DEV) return;
  preserveScroll(renderIconStudioContent);
}
function renderIconFileList() {
  const target=document.querySelector<HTMLElement>("#icon-file-list");if(!target) return;
  const files=iconFiles.filter(file=>file.toLowerCase().includes(state.iconFileSearch.trim().toLowerCase()));
  target.innerHTML=files.map(file=>{
    const key=iconFileKey(file),style=fileIconStyle(state.iconConfig,file);
    const configured=Object.hasOwn(state.iconConfig.mapIconScales,key) || Object.keys(state.iconConfig.fileIconStyles[key] ?? {}).length>0;
    return `<button class="icon-unit ${state.iconSelectedFile===file?"selected":""}" data-config-icon-file="${html(file)}">${iconArtwork(file,null,defaultBadgeStyle,"icon-list-art",style.frame,style.glow,style.scale)}<span><strong>${html(file)}</strong><small>${t(configured?"ui.fileSettingsConfigured":"ui.builtInDefaults")}</small></span></button>`;
  }).join("") || `<div class="icon-empty">${t("ui.noMatchingIcons")}</div>`;
  target.querySelectorAll<HTMLElement>("[data-config-icon-file]").forEach(button=>button.addEventListener("click",()=>{
    state.iconSelectedFile=button.dataset.configIconFile!;renderIconStudio();
  }));
}
function renderIconFileStudio(studio:HTMLElement) {
  const file=state.iconSelectedFile && iconFiles.includes(state.iconSelectedFile) ? state.iconSelectedFile : iconFiles[0];
  state.iconSelectedFile=file ?? null;
  if(!file) {studio.innerHTML=`${iconStudioHeader()}<div class="icon-empty">${t("ui.noMatchingIcons")}</div>`;bindIconStudioActions(studio);return;}
  const key=iconFileKey(file),style=fileIconStyle(state.iconConfig,file),settings=state.iconConfig.fileIconStyles[key] ?? {};
  const controls=(["mapScale","frame","scale","glow","shadow","size"] as const).map(setting=>{
    const value=setting==="mapScale" ? Math.round(mapIconScale(state.iconConfig,file)*100) : style[setting];
    const overridden=setting==="mapScale" ? Object.hasOwn(state.iconConfig.mapIconScales,key) : Object.hasOwn(settings,setting);
    const label=t(setting==="mapScale"?"ui.mapIconScale":setting==="frame"?"ui.addStatStyleFrame":setting==="scale"?"ui.iconScaleWithinFrame":setting==="glow"?"ui.addWhiteGlow":setting==="shadow"?"ui.mapIconShadow":"ui.iconFileBadgeSize");
    const disabled=state.iconBusy || setting==="scale" && !style.frame;
    const field=typeof value==="boolean" ? `<label class="icon-frame-control"><input data-file-icon-setting="${setting}" type="checkbox" ${value?"checked":""} ${disabled?"disabled":""}><span>${label}</span></label>`
      : `<label class="icon-size-control"><span>${label} <output data-file-icon-value="${setting}">${value}%</output></span><input data-file-icon-setting="${setting}" type="range" min="20" max="${setting==="size"?100:300}" step="1" value="${value}" ${disabled?"disabled":""}></label>`;
    return `<div class="icon-base-effect">${field}<button data-reset-file-icon-setting="${setting}" class="button secondary compact" ${!overridden||state.iconBusy?"disabled":""}>${t("ui.restoreDefault")}</button></div>`;
  }).join("");
  studio.innerHTML=`${iconStudioHeader()}<div class="icon-studio-body"><aside class="icon-unit-panel"><div class="icon-search-wrap"><input id="icon-file-search" type="search" autocomplete="off" placeholder="${t("ui.searchIconFilename")}" value="${html(state.iconFileSearch)}"></div><div class="icon-unit-list" id="icon-file-list" data-scroll-key="icon-files"></div></aside><section class="icon-detail" data-scroll-key="icon-file-detail:${html(file)}"><div class="icon-detail-top"><div class="icon-current">${iconArtwork(file,null,defaultBadgeStyle,"icon-preview-art",style.frame,style.glow,style.scale)}<div><span class="eyebrow">${t("ui.iconFileSettings")}</span><h3>${html(file)}</h3><p>${t("help.iconFileSettings")}</p></div></div></div><div class="icon-base-settings">${controls}</div></section></div>`;
  bindIconStudioActions(studio);renderIconFileList();
  studio.querySelector<HTMLInputElement>("#icon-file-search")!.addEventListener("input",event=>{
    state.iconFileSearch=(event.target as HTMLInputElement).value;renderIconFileList();
  });
  studio.querySelectorAll<HTMLInputElement>("[data-file-icon-setting]").forEach(input=>{
    const setting=input.dataset.fileIconSetting as "mapScale"|keyof IconFileStyle;
    input.addEventListener("input",()=>{
      const output=studio.querySelector(`[data-file-icon-value="${setting}"]`);if(output) output.textContent=`${input.value}%`;
      if(setting==="scale") studio.querySelector<HTMLElement>(".icon-current .icon-art-base-layer")?.style.setProperty("--icon-scale",String(Number(input.value)/100));
    });
    input.addEventListener("change",()=>saveFileIconSetting(setting,input.type==="checkbox"?input.checked:Number(input.value)));
  });
  studio.querySelectorAll<HTMLElement>("[data-reset-file-icon-setting]").forEach(button=>button.addEventListener("click",()=>{
    saveFileIconSetting(button.dataset.resetFileIconSetting as "mapScale"|keyof IconFileStyle,null);
  }));
}
async function saveFileIconSetting(setting:"mapScale"|keyof IconFileStyle,value:number|boolean|null) {
  const file=state.iconSelectedFile;if(state.iconBusy || !file) return;
  const key=iconFileKey(file);
  const next:IconConfig={...state.iconConfig,schemaVersion:10,mapIconScales:{...state.iconConfig.mapIconScales},fileIconStyles:{...state.iconConfig.fileIconStyles}};
  if(setting==="mapScale") {
    if(value===null) delete next.mapIconScales[key];else next.mapIconScales[key]=value as number;
  } else {
    const style={...next.fileIconStyles[key]};
    if(value===null) delete style[setting];else Object.assign(style,{[setting]:value});
    if(Object.keys(style).length) next.fileIconStyles[key]=style;else delete next.fileIconStyles[key];
  }
  const previous=state.iconConfig;
  state.iconConfig=next;state.iconBusy=true;state.iconMessage=message("status.iconSettingsSaving");renderAll();renderIconStudio();
  try {await invoke("save_icon_config",{config:next});state.iconMessage=message("status.iconFileSettingSaved",{file});}
  catch(error) {state.iconConfig=previous;state.iconMessage=message("errors.saveIconFileSetting",{error:errorMessage(error)});renderAll();}
  finally {state.iconBusy=false;renderIconStudio();}
}
function renderIconStudioContent() {
  const studio=document.querySelector<HTMLElement>("#icon-studio")!;
  studio.hidden=!state.iconStudioOpen;
  if(!state.iconStudioOpen) return;
  if(state.iconConfigScope==="file") {renderIconFileStudio(studio);return;}
  const unit=state.iconUnits.find(x=>x.id===state.iconSelectedId) || state.iconUnits[0];
  if(!unit) {studio.innerHTML="";return;}
  state.iconSelectedId=unit.id;
  if(state.iconSelectedVariation!==null && !unit.variants.some(v=>v.variation===state.iconSelectedVariation)) state.iconSelectedVariation=null;
  const variant=state.iconSelectedVariation;
  const displayName=formattedName(variant===null?unit.variants[0]:unit.variants.find(v=>v.variation===variant) || unit.variants[0]);
  const current=variant===null?unitDefaultIcon(state.iconConfig,unit.id,unit.sample):unitIcon(state.iconConfig,unit.id,variant,unit.sample);
  const source=t("assets.source", { source: variant===null?(Object.hasOwn(state.iconConfig.unitIcons,String(unit.id))?
    current===null?t("ui.unitSetToNoIcon"):t("ui.unitAssignment"):automaticUnitIcons[String(unit.id)]?t("ui.matchedByNumericFilename"):t("ui.categoryFallbackPending")):
    iconSource(state.iconConfig,unit.id,variant), missing: variant===null&&current!==null&&missingIcon(current)?"yes":"no" });
  const badge=variant===null?state.iconConfig.unitBadges[String(unit.id)] || null:unitBadge(state.iconConfig,unit.id,variant);
  const badgeOverride=variant!==null && Object.hasOwn(state.iconConfig.variantBadges,`${unit.id}|${variant}`);
  const badgeSource=t("assets.source", { source: variant===null?(badge?t("ui.defaultUnitBadge"):t("ui.noBadge")):badgeOverride?(badge?t("ui.variantBadge"):t("ui.setNoBadge")):(badge?t("ui.inheritUnitBadge"):t("ui.noBadge")),
    missing: badge&&missingIcon(badge)?"yes":"no" });
  const currentStyle=badgeStyle(state.iconConfig,unit.id,variant);
  const styleOverride=variant===null?Boolean(state.iconConfig.unitBadgeStyles[String(unit.id)]):Boolean(state.iconConfig.variantBadgeStyles[`${unit.id}|${variant}`]);
  const styleSource=styleOverride?(variant===null?t("ui.defaultUnitStyle"):t("ui.variantStyle")):(variant===null?t("ui.iconFileDefaults"):t("ui.inheritUnitStyle"));
  const currentFrame=baseFrame(state.iconConfig,unit.id,variant,current);
  const currentScale=baseScale(state.iconConfig,unit.id,variant,current);
  const currentMapScale=Math.round(mapIconScale(state.iconConfig,current,unit.id,variant)*100);
  const mapScaleOverride=Object.hasOwn(variant===null?state.iconConfig.unitMapIconScales:state.iconConfig.variantMapIconScales,variant===null?String(unit.id):`${unit.id}|${variant}`);
  const scaleOverride=Object.hasOwn(variant===null?state.iconConfig.unitIconScales || {}:state.iconConfig.variantIconScales || {},variant===null?String(unit.id):`${unit.id}|${variant}`);
  const frameOverride=Object.hasOwn(variant===null?state.iconConfig.unitIconFrames || {}:state.iconConfig.variantIconFrames || {},variant===null?String(unit.id):`${unit.id}|${variant}`);
  const frameSource=frameOverride?(variant===null?t("ui.unitDefaults"):t("ui.variantSettings")):(variant===null?t("ui.iconFileDefaults"):t("ui.inheritedUnitSettings"));
  const currentGlow=baseGlow(state.iconConfig,unit.id,variant,current);
  const currentShadow=baseShadow(state.iconConfig,unit.id,variant,current);
  const shadowOverride=Object.hasOwn(variant===null?state.iconConfig.unitIconShadows || {}:state.iconConfig.variantIconShadows || {},variant===null?String(unit.id):`${unit.id}|${variant}`);
  const glowOverride=Object.hasOwn(variant===null?state.iconConfig.unitIconGlows || {}:state.iconConfig.variantIconGlows || {},variant===null?String(unit.id):`${unit.id}|${variant}`);
  const baseOverride=variant===null?Object.hasOwn(state.iconConfig.unitIcons,String(unit.id)):Object.hasOwn(state.iconConfig.variantIcons,`${unit.id}|${variant}`);
  const resetEnabled=state.iconAssetLayer==="base"?baseOverride:variant===null?Boolean(badge):badgeOverride;
  const resetLabel=state.iconAssetLayer==="base"?(variant===null?t("ui.resetToAutomatic"):t("ui.inheritUnitDefaults")):(variant===null?t("ui.clearDefaultBadge"):t("ui.inheritUnitBadge"));
  const settingsKey=`${unit.id}:${variant ?? "base"}:${state.iconAssetLayer}`;
  studio.innerHTML=`${iconStudioHeader()}
    <div class="icon-studio-body"><aside class="icon-unit-panel"><div class="icon-search-wrap"><input id="icon-unit-search" type="search" autocomplete="off" placeholder="${t("ui.searchUnitIdOrName")}" value="${html(state.iconSearch)}"><div class="icon-filters"><button data-icon-filter="all" class="${state.iconFilter==="all"?"active":""}">${t("ui.all")}</button><button data-icon-filter="pending" class="${state.iconFilter==="pending"?"active":""}">${t("ui.pending")}</button><button data-icon-filter="assigned" class="${state.iconFilter==="assigned"?"active":""}">${t("ui.assigned")}</button><button data-icon-filter="missing" class="${state.iconFilter==="missing"?"active":""}">${t("ui.missingAssets")}</button></div></div><div id="icon-unit-list" class="icon-unit-list" data-scroll-key="icon-units"></div></aside>
    <section class="icon-detail" data-scroll-key="icon-detail:${unit.id}:${variant??"base"}:${state.iconAssetLayer}"><div class="icon-detail-top"><div class="icon-current">${iconArtwork(current,badge,currentStyle,"icon-preview-art",currentFrame,currentGlow,currentScale)}<div><span class="eyebrow">${t("assets.unitHeading", { unitId: unit.id, scope: variant===null?"unit":"variant", variant: variant??"" })}</span><h3>${html(displayName)}</h3><p>${t("ui.base")} ${html(current || t("ui.noIcon"))} · ${html(source)}</p><p>${t("assets.badge")} ${html(badge || t("ui.none"))} · ${html(badgeSource)}</p><small>${t("ui.base")} ${currentFrame?t("assets.frameScale", { scale: currentScale }):t("ui.withoutFrame")}${currentGlow?` · ${t("assets.glow")}`:""} · ${html(frameSource)}</small><br><small>${t("ui.badgeSize")} ${currentStyle.size}% · ${currentStyle.frame?t("assets.frameScale", { scale: currentStyle.scale }):t("ui.withoutFrame")}${currentStyle.glow?` · ${t("assets.glow")}`:""} · ${html(styleSource)}</small></div></div><div class="icon-reset-actions"><button id="icon-reset" class="button secondary compact" ${!resetEnabled||state.iconBusy?"disabled":""}>${resetLabel}</button>${state.iconAssetLayer==="base"?`<button id="icon-no-icon" class="button secondary compact" ${baseOverride&&current===null||state.iconBusy?"disabled":""}>${t("ui.setNoIcon")}</button>`:variant!==null?`<button id="icon-no-badge" class="button secondary compact" ${badgeOverride&&badge===null||state.iconBusy?"disabled":""}>${t("ui.setNoBadge")}</button>`:""}</div></div>
    <div class="icon-scope"><button data-icon-variation="base" class="${variant===null?"active":""}">${t("ui.unitIdDefaults")}${unitScopeMark(unit.id)}</button>${unit.variants.map(v=>`<button data-icon-variation="${v.variation}" class="${variant===v.variation?"active":""}">${t("ui.variant")} ${v.variation} · ${html(formattedName(v))}${variantScopeMark(unit.id,v.variation!)}</button>`).join("")}</div>
    <div class="icon-layer-tabs"><button data-icon-layer="base" class="${state.iconAssetLayer==="base"?"active":""}">${t("assets.baseIcon")}</button><button data-icon-layer="badge" class="${state.iconAssetLayer==="badge"?"active":""}">${t("ui.lowerRightBadge")}</button></div>
    <details class="icon-settings-details" data-icon-settings="${settingsKey}" ${state.expandedIconSettings.has(settingsKey)?"open":""}><summary>${t(state.iconAssetLayer==="base"?"ui.iconStyleSettings":"ui.badgeStyleSettings")}</summary>
    ${(state.iconAssetLayer==="base"?current:badge)?`<div class="icon-file-link"><button class="text-button" data-edit-icon-file="${html((state.iconAssetLayer==="base"?current:badge)!)}">${t("ui.editIconFileSettings")}</button></div>`:""}
    ${state.iconAssetLayer==="badge"?`<div class="icon-badge-settings">
      <label class="icon-size-control" for="icon-badge-size"><span>${t("ui.badgeSize")} <output id="icon-badge-size-value">${currentStyle.size}%</output></span><input id="icon-badge-size" type="range" min="20" max="100" step="1" value="${currentStyle.size}" ${state.iconBusy?"disabled":""}></label>
      <label class="icon-frame-control"><input id="icon-badge-frame" type="checkbox" ${currentStyle.frame?"checked":""} ${state.iconBusy?"disabled":""}><span>${t("ui.addStatStyleFrame")}</span></label>
      <label class="icon-size-control" for="icon-badge-scale"><span>${t("ui.iconScaleWithinFrame")} <output id="icon-badge-scale-value">${currentStyle.scale}%</output></span><input id="icon-badge-scale" type="range" min="20" max="300" step="1" value="${currentStyle.scale}" ${!currentStyle.frame||state.iconBusy?"disabled":""}></label>
      <label class="icon-frame-control"><input id="icon-badge-glow" type="checkbox" ${currentStyle.glow?"checked":""} ${state.iconBusy?"disabled":""}><span>${t("ui.addWhiteGlow")}</span></label>
      <button id="icon-style-reset" class="button secondary compact" ${!styleOverride||state.iconBusy?"disabled":""}>${variant===null?t("ui.inheritIconSettings"):t("ui.inheritUnitStyle")}</button></div>`:`<div class="icon-base-settings">
      <div class="icon-base-effect"><label class="icon-size-control" for="icon-map-scale"><span>${t("ui.mapIconScale")} <output id="icon-map-scale-value">${currentMapScale}%</output></span><input id="icon-map-scale" type="range" min="20" max="300" step="1" value="${currentMapScale}" ${state.iconBusy?"disabled":""}></label><button id="icon-map-scale-reset" class="button secondary compact" ${!mapScaleOverride||state.iconBusy?"disabled":""}>${variant===null?t("ui.inheritIconSettings"):t("ui.inheritUnitScale")}</button></div>
      <div class="icon-base-effect"><label class="icon-frame-control"><input id="icon-base-frame" type="checkbox" ${currentFrame?"checked":""} ${state.iconBusy?"disabled":""}><span>${t("ui.addStatStyleFrame")}</span></label><button id="icon-base-frame-reset" class="button secondary compact" ${!frameOverride||state.iconBusy?"disabled":""}>${variant===null?t("ui.inheritIconSettings"):t("ui.inheritUnitFrame")}</button></div>
      <div class="icon-base-effect"><label class="icon-size-control" for="icon-base-scale"><span>${t("ui.iconScaleWithinFrame")} <output id="icon-base-scale-value">${currentScale}%</output></span><input id="icon-base-scale" type="range" min="20" max="300" step="1" value="${currentScale}" ${!currentFrame||state.iconBusy?"disabled":""}></label><button id="icon-base-scale-reset" class="button secondary compact" ${!scaleOverride||state.iconBusy?"disabled":""}>${variant===null?t("ui.inheritIconSettings"):t("ui.inheritUnitScale")}</button></div>
      <div class="icon-base-effect"><label class="icon-frame-control"><input id="icon-base-glow" type="checkbox" ${currentGlow?"checked":""} ${state.iconBusy?"disabled":""}><span>${t("ui.addWhiteGlow")}</span></label><button id="icon-base-glow-reset" class="button secondary compact" ${!glowOverride||state.iconBusy?"disabled":""}>${variant===null?t("ui.inheritIconSettings"):t("ui.inheritUnitGlow")}</button></div>
      <div class="icon-base-effect"><label class="icon-frame-control"><input id="icon-base-shadow" type="checkbox" ${currentShadow?"checked":""} ${state.iconBusy?"disabled":""}><span>${t("ui.mapIconShadow")}</span></label><button id="icon-base-shadow-reset" class="button secondary compact" ${!shadowOverride||state.iconBusy?"disabled":""}>${variant===null?t("ui.inheritIconSettings"):t("ui.inheritUnitShadow")}</button></div></div>`}
    </details>
    <div class="icon-detail-caption"><div><h3>${state.iconAssetLayer==="base"?t("ui.chooseABaseIcon"):t("ui.chooseABadge")}</h3><p>${state.iconAssetLayer==="base"?(variant===null?t("help.unitDefaults", { unitId: unit.id }):t("help.unitVariant", { unitId: unit.id, variant: variant })):(variant===null?t("help.badgeDefault"):t("help.badgeVariant"))}</p></div><input id="icon-asset-search" type="search" autocomplete="off" placeholder="${t("ui.searchIconFilename")}" value="${html(state.iconAssetSearch)}"></div><div id="icon-palette" class="icon-palette" data-scroll-key="icon-palette"></div></section></div>`;
  renderIconUnitList();renderIconPalette();
  bindIconStudioActions(studio);
  const settingsDetails=studio.querySelector<HTMLDetailsElement>("[data-icon-settings]")!;
  settingsDetails.addEventListener("toggle",()=>{
    if(!settingsDetails.isConnected) return;
    if(settingsDetails.open) state.expandedIconSettings.add(settingsKey);else state.expandedIconSettings.delete(settingsKey);
  });
  studio.querySelector<HTMLElement>("[data-edit-icon-file]")?.addEventListener("click",event=>{
    state.iconSelectedFile=(event.currentTarget as HTMLElement).dataset.editIconFile!;
    state.iconConfigScope="file";renderIconStudio();
  });
  studio.querySelector("#icon-reset")!.addEventListener("click",()=>saveIconAssignment(null,"inherit"));
  studio.querySelector("#icon-no-icon")?.addEventListener("click",()=>saveIconAssignment(null));
  studio.querySelector("#icon-no-badge")?.addEventListener("click",()=>saveIconAssignment(null));
  const sizeSlider=studio.querySelector<HTMLInputElement>("#icon-badge-size");
  sizeSlider?.addEventListener("input",()=>{
    studio.querySelector("#icon-badge-size-value")!.textContent=`${sizeSlider.value}%`;
    studio.querySelector<HTMLElement>(".icon-current .icon-art")?.style.setProperty("--badge-size",`${sizeSlider.value}%`);
  });
  const readBadgeStyle=():BadgeStyle=>({size:Number(sizeSlider!.value),
    frame:studio.querySelector<HTMLInputElement>("#icon-badge-frame")!.checked,
    glow:studio.querySelector<HTMLInputElement>("#icon-badge-glow")!.checked,
    scale:Number(studio.querySelector<HTMLInputElement>("#icon-badge-scale")!.value)});
  sizeSlider?.addEventListener("change",()=>saveBadgeStyle(readBadgeStyle()));
  studio.querySelector<HTMLInputElement>("#icon-badge-frame")?.addEventListener("change",()=>saveBadgeStyle(readBadgeStyle()));
  studio.querySelector<HTMLInputElement>("#icon-badge-glow")?.addEventListener("change",()=>saveBadgeStyle(readBadgeStyle()));
  studio.querySelector("#icon-style-reset")?.addEventListener("click",()=>saveBadgeStyle(null));
  studio.querySelector<HTMLInputElement>("#icon-base-frame")?.addEventListener("change",event=>saveBaseEffect("frame",(event.target as HTMLInputElement).checked));
  studio.querySelector("#icon-base-frame-reset")?.addEventListener("click",()=>saveBaseEffect("frame",null));
  studio.querySelector<HTMLInputElement>("#icon-base-glow")?.addEventListener("change",event=>saveBaseEffect("glow",(event.target as HTMLInputElement).checked));
  studio.querySelector("#icon-base-glow-reset")?.addEventListener("click",()=>saveBaseEffect("glow",null));
  studio.querySelector<HTMLInputElement>("#icon-base-shadow")?.addEventListener("change",event=>saveBaseEffect("shadow",(event.target as HTMLInputElement).checked));
  studio.querySelector("#icon-base-shadow-reset")?.addEventListener("click",()=>saveBaseEffect("shadow",null));
  for(const layer of ["base","badge"] as const) {
    const slider=studio.querySelector<HTMLInputElement>(`#icon-${layer}-scale`);
    slider?.addEventListener("input",()=>{
      studio.querySelector(`#icon-${layer}-scale-value`)!.textContent=`${slider.value}%`;
      studio.querySelector<HTMLElement>(layer==="base"?".icon-current .icon-art-base-layer":".icon-current .icon-art-badge")?.style.setProperty("--icon-scale",String(Number(slider.value)/100));
    });
    slider?.addEventListener("change",()=>layer==="base"?saveBaseScale(Number(slider.value)):saveBadgeStyle(readBadgeStyle()));
  }
  studio.querySelector("#icon-base-scale-reset")?.addEventListener("click",()=>saveBaseScale(null));
  const mapScaleSlider=studio.querySelector<HTMLInputElement>("#icon-map-scale");
  mapScaleSlider?.addEventListener("input",()=>{
    studio.querySelector("#icon-map-scale-value")!.textContent=`${mapScaleSlider.value}%`;
  });
  mapScaleSlider?.addEventListener("change",()=>saveMapIconScale(Number(mapScaleSlider.value)));
  studio.querySelector("#icon-map-scale-reset")?.addEventListener("click",()=>saveMapIconScale(null));
  studio.querySelector<HTMLInputElement>("#icon-unit-search")!.addEventListener("input",event=>{state.iconSearch=(event.target as HTMLInputElement).value;renderIconUnitList();});
  studio.querySelector<HTMLInputElement>("#icon-asset-search")!.addEventListener("input",event=>{state.iconAssetSearch=(event.target as HTMLInputElement).value;renderIconPalette();});
  studio.querySelectorAll<HTMLElement>("[data-icon-filter]").forEach(button=>button.addEventListener("click",()=>{state.iconFilter=button.dataset.iconFilter as typeof state.iconFilter;renderIconStudio();}));
  studio.querySelectorAll<HTMLElement>("[data-icon-variation]").forEach(button=>button.addEventListener("click",()=>{state.iconSelectedVariation=button.dataset.iconVariation==="base"?null:Number(button.dataset.iconVariation);renderIconStudio();}));
  studio.querySelectorAll<HTMLElement>("[data-icon-layer]").forEach(button=>button.addEventListener("click",()=>{state.iconAssetLayer=button.dataset.iconLayer as typeof state.iconAssetLayer;renderIconStudio();}));
}
async function saveIconAssignment(file:string|null, resetMode?:"inherit") {
  if(state.iconBusy || state.iconSelectedId===null) return;
  const id=state.iconSelectedId, variant=state.iconSelectedVariation, layer=state.iconAssetLayer;
  const next:IconConfig={...state.iconConfig,schemaVersion:10,unitIcons:{...state.iconConfig.unitIcons},variantIcons:{...state.iconConfig.variantIcons},
    unitBadges:{...state.iconConfig.unitBadges},variantBadges:{...state.iconConfig.variantBadges},
    unitBadgeStyles:{...state.iconConfig.unitBadgeStyles},variantBadgeStyles:{...state.iconConfig.variantBadgeStyles},
    unitIconFrames:{...state.iconConfig.unitIconFrames},variantIconFrames:{...state.iconConfig.variantIconFrames},
    unitIconGlows:{...state.iconConfig.unitIconGlows},variantIconGlows:{...state.iconConfig.variantIconGlows},
    unitIconScales:{...state.iconConfig.unitIconScales},variantIconScales:{...state.iconConfig.variantIconScales}};
  if(layer==="base") {
    if(variant===null) {if(resetMode==="inherit") delete next.unitIcons[String(id)];else next.unitIcons[String(id)]=file;}
    else {if(resetMode==="inherit") delete next.variantIcons[`${id}|${variant}`];else next.variantIcons[`${id}|${variant}`]=file;}
  } else if(variant===null) {
    if(file) next.unitBadges[String(id)]=file;else delete next.unitBadges[String(id)];
  } else if(resetMode==="inherit") delete next.variantBadges[`${id}|${variant}`];
  else next.variantBadges[`${id}|${variant}`]=file;
  state.iconBusy=true;state.iconMessage=message("status.iconSettingsSaving");renderIconStudio();
  try {
    await invoke("save_icon_config",{config:next});
    state.iconConfig=next;state.iconMessage=message("status.iconSettingsSaved", { unitId: id, variationSuffix: variant===null?"":`|${variant}`, layer: layer==="base"?message("assets.baseIcon"):message("assets.badge") });
    renderAll();
  } catch(error) {state.iconMessage=message("errors.save", { error: errorMessage(error) });}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function saveBadgeStyle(style:BadgeStyle|null) {
  if(state.iconBusy || state.iconSelectedId===null) return;
  const id=state.iconSelectedId, variant=state.iconSelectedVariation;
  const next:IconConfig={...state.iconConfig,schemaVersion:10,
    unitBadgeStyles:{...state.iconConfig.unitBadgeStyles},variantBadgeStyles:{...state.iconConfig.variantBadgeStyles}};
  if(variant===null) {
    if(!style) delete next.unitBadgeStyles[String(id)];
    else next.unitBadgeStyles[String(id)]=style;
  } else if(style) next.variantBadgeStyles[`${id}|${variant}`]=style;
  else delete next.variantBadgeStyles[`${id}|${variant}`];
  const previous=state.iconConfig;
  state.iconConfig=next;state.iconBusy=true;state.iconMessage=message("status.badgeStyleSaving");renderAll();renderIconStudio();
  try {
    await invoke("save_icon_config",{config:next});
    state.iconMessage=message("status.badgeStyleSaved", { unitId: id, variationSuffix: variant===null?"":`|${variant}` });
  } catch(error) {state.iconConfig=previous;state.iconMessage=message("errors.saveBadgeStyle", { error: errorMessage(error) });renderAll();}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function saveBaseEffect(effect:"frame"|"glow"|"shadow",value:boolean|null) {
  if(state.iconBusy || state.iconSelectedId===null) return;
  const id=state.iconSelectedId, variant=state.iconSelectedVariation;
  const unitKey=effect==="frame"?"unitIconFrames":effect==="glow"?"unitIconGlows":"unitIconShadows";
  const variantKey=effect==="frame"?"variantIconFrames":effect==="glow"?"variantIconGlows":"variantIconShadows";
  const label=effect==="frame"?message("assets.baseFrame"):effect==="glow"?message("assets.whiteGlow"):message("ui.mapIconShadow");
  const next:IconConfig={...state.iconConfig,schemaVersion:10,
    [unitKey]:{...state.iconConfig[unitKey]},[variantKey]:{...state.iconConfig[variantKey]}};
  if(variant===null) {
    if(value!==null) next[unitKey][String(id)]=value;
    else delete next[unitKey][String(id)];
  } else if(value!==null) next[variantKey][`${id}|${variant}`]=value;
  else delete next[variantKey][`${id}|${variant}`];
  const previous=state.iconConfig;
  state.iconConfig=next;state.iconBusy=true;state.iconMessage=message("status.effectSaving", { effect: label });renderAll();renderIconStudio();
  try {
    await invoke("save_icon_config",{config:next});
    state.iconMessage=message("status.effectSaved", { unitId: id, variationSuffix: variant===null?"":`|${variant}`, effect: label });
  } catch(error) {state.iconConfig=previous;state.iconMessage=message("errors.saveEffect", { effect: label, error: errorMessage(error) });renderAll();}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function saveBaseScale(scale:number|null) {
  if(state.iconBusy || state.iconSelectedId===null) return;
  const id=state.iconSelectedId, variant=state.iconSelectedVariation;
  const next:IconConfig={...state.iconConfig,schemaVersion:10,
    unitIconScales:{...state.iconConfig.unitIconScales},variantIconScales:{...state.iconConfig.variantIconScales}};
  if(variant===null) {
    if(scale===null) delete next.unitIconScales[String(id)];
    else next.unitIconScales[String(id)]=scale;
  } else if(scale===null) delete next.variantIconScales[`${id}|${variant}`];
  else next.variantIconScales[`${id}|${variant}`]=scale;
  const previous=state.iconConfig;
  state.iconConfig=next;state.iconBusy=true;state.iconMessage=message("status.iconScaleSaving");renderAll();renderIconStudio();
  try {await invoke("save_icon_config",{config:next});state.iconMessage=message("status.iconScaleSaved", { unitId: id, variationSuffix: variant===null?"":`|${variant}` });}
  catch(error) {state.iconConfig=previous;state.iconMessage=message("errors.saveIconScale", { error: errorMessage(error) });renderAll();}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function saveMapIconScale(scale:number|null) {
  if(state.iconBusy || state.iconSelectedId===null) return;
  const id=state.iconSelectedId,variant=state.iconSelectedVariation;
  const next:IconConfig={...state.iconConfig,schemaVersion:10,
    unitMapIconScales:{...state.iconConfig.unitMapIconScales},variantMapIconScales:{...state.iconConfig.variantMapIconScales}};
  const scales=variant===null ? next.unitMapIconScales : next.variantMapIconScales;
  const key=variant===null ? String(id) : `${id}|${variant}`;
  if(scale===null) delete scales[key];else scales[key]=scale;
  const previous=state.iconConfig;
  state.iconConfig=next;state.iconBusy=true;state.iconMessage=message("status.mapIconScaleSaving");renderAll();renderIconStudio();
  try {await invoke("save_icon_config",{config:next});state.iconMessage=message("status.mapIconScaleSaved",{unitId:id,variationSuffix:variant===null?"":`|${variant}`});}
  catch(error) {state.iconConfig=previous;state.iconMessage=message("errors.saveMapIconScale",{error:errorMessage(error)});renderAll();}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function importIconConfig() {
  if(state.iconBusy) return;
  if(manualIconCount() &&
    !await confirm(t("confirm.importIcons"),{title:t("ui.importIconSettings")})) return;
  const path=await open({multiple:false,directory:false,filters:[{name:t("ui.jsonIconSettings"),extensions:["json"]}]});
  if(!path || Array.isArray(path)) return;
  state.iconBusy=true;state.iconMessage=message("status.iconsImporting");renderIconStudio();
  try {state.iconConfig=await invoke<IconConfig>("import_icon_config",{path});state.iconMessage=message("status.imported", { path: path });renderAll();}
  catch(error) {state.iconMessage=message("errors.import", { error: errorMessage(error) });}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function exportIconConfig() {
  if(state.iconBusy) return;
  const path=await save({defaultPath:"nightreign-icons.json",filters:[{name:t("ui.jsonIconSettings"),extensions:["json"]}]});
  if(!path) return;
  state.iconBusy=true;state.iconMessage=message("status.iconsExporting");renderIconStudio();
  try {await invoke("export_icon_config",{path});state.iconMessage=message("status.exported", { path: path });}
  catch(error) {state.iconMessage=message("errors.export", { error: errorMessage(error) });}
  finally {state.iconBusy=false;renderIconStudio();}
}
async function reloadIconResources(silent=false) {
  if(state.iconBusy) return;
  const generation=++iconReloadGeneration;
  if(!silent) {state.iconBusy=true;state.iconMessage=message("status.reloadingAssets");renderIconStudio();}
  try {
    const result=await invoke<IconResources>("reload_icon_resources");
    if(generation!==iconReloadGeneration) return;
    setIconResources(result.icons);
    state.iconResourcePath=result.path;
    state.iconMessage=message("status.assetsLoaded", { path: result.path, count: result.icons.length });
    renderAll();renderIconStudio();
  } catch(error) {
    if(!silent&&generation===iconReloadGeneration) {state.iconMessage=message("errors.reloadAssets", { error: errorMessage(error) });renderIconStudio();}
  } finally {
    if(!silent&&generation===iconReloadGeneration) {state.iconBusy=false;renderIconStudio();}
  }
}
function renderFilterPanel() {
  preserveScroll(renderFilterPanelContent);
}
function criterionChoiceHtml(label:string, side:FilterSide, attributes:string, removeLabel=t("filters.removeOption",{name:label})) {
  return `<span class="chip-choice criterion-choice ${side==="include"?"positive":"negative"}"><span class="criterion-choice-name">${side==="exclude"?"≠ ":""}${html(label)}</span><button ${attributes} aria-label="${html(removeLabel)}">×</button></span>`;
}
function renderFilterPanelContent() {
  const data = state.data;
  if (!data) return;
  const hasNightlord = Boolean(state.nightlord.include.size || state.nightlord.exclude.size);
  let expandedRendered=false;
  const choiceAttributes=(index:number|"nightlord", value:string, side:FilterSide)=>`data-action="remove-choice" data-index="${index}" data-key="${html(value)}" data-side="${side}"`;
  const nightlordChip = hasNightlord ? `<div class="criterion-chip"><div><strong>${t("ui.nightlord")}</strong><div class="chip-choices">${(["include","exclude"] as const).flatMap(side=>
    [...state.nightlord[side]].map(id=>criterionChoiceHtml(name("nightlord",Number(id)),side,choiceAttributes("nightlord",id,side))))
  .join("")}</div></div><button data-action="remove-nightlord" aria-label="${t("ui.removeNightlordFilters")}">×</button></div>` : "";
  const informationChips=[...state.mapCriteria].map(([field,criterion])=>{
    const entries=(["include","exclude"] as const).flatMap(side=>[...criterion[side]].map(value=>
      criterionChoiceHtml(informationChoiceName(field,value),side,`data-action="remove-map-choice" data-field="${field}" data-key="${html(value)}" data-side="${side}"`))).join("");
    return `<div class="criterion-chip" data-map-filter="${field}"><div><strong>${html(informationFieldName(field))}</strong><div class="chip-choices">${entries}</div></div><button data-action="remove-map-filter" data-field="${field}" aria-label="${t("ui.removeThisFilter")}">×</button></div>`;
  }).join("");
  const chip = (index:number, c:Criterion) => {
    const loc = locationAt(index);
    const groups=unitFilterGroups(index);
    const entries=(["include","exclude"] as const).flatMap(side=>{
      const remaining=new Set(c[side]);
      return [...c[side]].map(value=>{
        if(!remaining.delete(value)) return "";
        const group=groups.find(group=>group.options.length>1 && group.options.some(option=>option.key===value) && group.options.every(option=>c[side].has(option.key)));
        if(!group) return criterionChoiceHtml(unitName(...value.split("|").map(Number) as [number,number]),side,choiceAttributes(index,value,side));
        for(const option of group.options) remaining.delete(option.key);
        const label=filterGroupName(group),expanded=state.expandedCriterion;
        const open=expanded?.index===index && expanded.group===group.key && expanded.side===side;
        if(open) expandedRendered=true;
        const attributes=`data-index="${index}" data-group="${html(group.key)}" data-side="${side}"`;
        const toggleLabel=t(open?"filters.collapseSelection":"filters.expandSelection",{name:label});
        const removeLabel=t("filters.removeOption",{name:label});
        const units=open?group.options.map(option=>criterionChoiceHtml(unitNameOnly(...option.key.split("|").map(Number) as [number,number]),side,choiceAttributes(index,option.key,side))).join(""):"";
        return `<div class="criterion-choice-group ${open?"expanded":""}" data-criterion-group="${html(group.key)}" data-index="${index}" data-side="${side}"><span class="chip-choice criterion-choice criterion-group-summary ${side==="include"?"positive":"negative"}"><button class="criterion-group-toggle" data-action="expand-criterion" ${attributes} aria-expanded="${open}" aria-label="${html(toggleLabel)}">${side==="exclude"?"≠ ":""}${html(label)}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button><button data-action="remove-group" ${attributes} aria-label="${html(removeLabel)}">×</button></span>${open?`<div class="criterion-group-units">${units}</div>`:""}</div>`;
      });
    }).join("");
    return `<div class="criterion-chip"><div><strong>${html(loc ? locationName(loc) : index)}</strong><div class="chip-choices">${entries}</div></div><button data-action="remove-criterion" data-index="${index}" aria-label="${t("ui.removeThisFilter")}">×</button></div>`;
  };
  const merchantCriteria=new Map<DirectFilterType,[number,Criterion][]>();
  const pointChips:string[]=[];
  for(const [index,criterion] of state.criteria) {
    const merchant=directFilterType(locationAt(index));
    if(merchant===null) pointChips.push(chip(index,criterion));
    else {
      const points=merchantCriteria.get(merchant) ?? [];
      points.push([index,criterion]);merchantCriteria.set(merchant,points);
    }
  }
  const merchantChips=directFilterTypes.map(merchant=>{
    const points=merchantCriteria.get(merchant);
    if(!points?.length) return "";
    const label=directFilterName(merchant),sample=locationAt(points[0][0]) ?? null;
    const artwork=typeof merchant==="string" ? iconArtwork(categoryIcon(sample),null,defaultBadgeStyle,"merchant-filter-art")
      : iconArtwork(unitIcon(state.iconConfig,merchant,0,sample),unitBadge(state.iconConfig,merchant,0),badgeStyle(state.iconConfig,merchant,0),"merchant-filter-art",baseFrame(state.iconConfig,merchant,0,unitIcon(state.iconConfig,merchant,0,sample)),baseGlow(state.iconConfig,merchant,0,unitIcon(state.iconConfig,merchant,0,sample)),baseScale(state.iconConfig,merchant,0,unitIcon(state.iconConfig,merchant,0,sample)));
    const entries=(["include","exclude"] as const).flatMap(side=>points.filter(([,criterion])=>criterion[side].size).map(([index])=>{
      const location=locationAt(index),name=location ? locationName(location) : String(index);
      return criterionChoiceHtml(name,side,`data-action="remove-criterion" data-index="${index}"`,t("filters.removeLocationFilter",{name}));
    })).join("");
    const removeLabel=t("filters.removeMerchantFilters",{name:label});
    return `<div class="criterion-chip merchant-criterion" data-merchant-filter="${merchant}"><div><div class="merchant-criterion-heading">${artwork}<strong>${html(label)}</strong></div><div class="chip-choices">${entries}</div></div><button data-action="remove-merchant" data-merchant="${merchant}" aria-label="${html(removeLabel)}">×</button></div>`;
  }).join("");
  if(!expandedRendered) state.expandedCriterion=null;
  document.querySelector("#filter-panel")!.innerHTML = `
    <div class="condition-heading"><span class="eyebrow">${t("ui.selectedFilters")}</span><button data-action="clear-filters" class="text-button" ${state.criteria.size || hasNightlord || state.mapCriteria.size ? "" : "disabled"}>${t("ui.clear")}</button></div>
    <div class="conditions" data-scroll-key="conditions">${state.criteria.size || hasNightlord || state.mapCriteria.size ? informationChips+nightlordChip+merchantChips+pointChips.join("") : `<div class="empty-small">${t("help.filtersEmpty")}</div>`}</div>`;
  document.querySelectorAll<HTMLElement>("[data-action='remove-map-filter']").forEach(el=>el.addEventListener("click",()=>{
    state.mapCriteria.delete(el.dataset.field as MapInformationField);renderAll();
  }));
  document.querySelectorAll<HTMLElement>("[data-action='remove-map-choice']").forEach(el=>el.addEventListener("click",()=>{
    const field=el.dataset.field as MapInformationField,criterion=state.mapCriteria.get(field);
    if(!criterion) return;
    criterion[el.dataset.side as FilterSide].delete(el.dataset.key!);
    if(!criterion.include.size && !criterion.exclude.size) state.mapCriteria.delete(field);
    renderAll();
  }));
  document.querySelector("[data-action='remove-nightlord']")?.addEventListener("click",()=> {state.nightlord.include.clear();state.nightlord.exclude.clear();renderAll();});
  document.querySelectorAll<HTMLElement>("[data-action='remove-criterion']").forEach(el=>el.addEventListener("click",()=> { state.criteria.delete(Number(el.dataset.index)); renderAll(); }));
  document.querySelectorAll<HTMLElement>("[data-action='remove-choice']").forEach(el=>el.addEventListener("click",()=>{
    const index=el.dataset.index!,criterion=index==="nightlord" ? state.nightlord : state.criteria.get(Number(index));
    if(!criterion) return;
    criterion[el.dataset.side as FilterSide].delete(el.dataset.key!);
    if(index!=="nightlord" && !criterion.include.size && !criterion.exclude.size) state.criteria.delete(Number(index));
    renderAll();
  }));
  document.querySelectorAll<HTMLElement>("[data-action='expand-criterion']").forEach(el=>el.addEventListener("click",()=>{
    const next={index:Number(el.dataset.index),group:el.dataset.group!,side:el.dataset.side as FilterSide};
    const expanded=state.expandedCriterion;
    const focused=document.activeElement===el;
    state.expandedCriterion=expanded?.index===next.index && expanded.group===next.group && expanded.side===next.side ? null : next;
    renderFilterPanel();
    if(focused) Array.from(document.querySelectorAll<HTMLElement>("[data-action='expand-criterion']")).find(button=>Number(button.dataset.index)===next.index && button.dataset.group===next.group && button.dataset.side===next.side)?.focus({preventScroll:true});
  }));
  document.querySelectorAll<HTMLElement>("[data-action='remove-group']").forEach(el=>el.addEventListener("click",()=>{
    const index=Number(el.dataset.index),criterion=state.criteria.get(index);
    const group=unitFilterGroups(index).find(group=>group.key===el.dataset.group);
    if(!criterion || !group) return;
    for(const option of group.options) criterion[el.dataset.side as FilterSide].delete(option.key);
    if(!criterion.include.size && !criterion.exclude.size) state.criteria.delete(index);
    renderAll();
  }));
  document.querySelectorAll<HTMLElement>("[data-action='remove-merchant']").forEach(el=>el.addEventListener("click",()=>{
    for(const index of state.criteria.keys()) if(String(directFilterType(locationAt(index)))===el.dataset.merchant) state.criteria.delete(index);
    renderAll();
  }));
  document.querySelector("[data-action='clear-filters']")?.addEventListener("click",()=> { state.criteria.clear(); state.nightlord.include.clear();state.nightlord.exclude.clear();state.mapCriteria.clear();state.mode="filter";state.selectedPattern=null;state.selectedLocation=null;state.bubble=null;renderAll(); });
}
function updateAfterFilter() {
  state.mode="filter";state.selectedPattern=null;state.selectedLocation=null;renderAll();
}
function renderCandidateList() {
  preserveScroll(renderCandidateListContent);
}
function renderCandidateListContent() {
  const all = candidates();
  const term = state.search.trim().toLowerCase();
  const shown = term ? all.filter(p => `${p.id} ${namedSearchText("nightlord",p.nightlordId)} ${namedSearchText("terrain",p.terrainId)}`.toLowerCase().includes(term)) : all;
  document.querySelector("#result-count")!.textContent = String(all.length);
  document.querySelector("#result-list")!.innerHTML = shown.length ? shown.map(p => `
    <button class="result-item ${state.selectedPattern === p.id ? "selected" : ""} ${patternIsModified(p.id)?"modified":""}" data-pattern="${p.id}" aria-pressed="${state.selectedPattern === p.id}" aria-description="${state.selectedPattern === p.id ? t("ui.deselectAndReturnToFiltering") : t("ui.selectAndPreviewPattern")}">
      <span class="result-id">#${p.id}</span><span class="result-meta"><strong>${html(name("nightlord",p.nightlordId))}</strong><small>${html(terrainName(p.terrainId))}</small></span><span class="result-arrow">↗</span>
    </button>`).join("") : `<div class="empty-results">${t("filters.noMatches")}</div>`;
  document.querySelectorAll<HTMLElement>("[data-pattern]").forEach(el=>el.addEventListener("click",()=>{
    const id=Number(el.dataset.pattern);
    if(state.selectedPattern===id) setMode("filter");
    else selectPattern(id);
  }));
}
function renderResultPanel() {
  preserveScroll(renderResultPanelContent);
}
function renderResultPanelContent() {
  const diagnostics=datasetDiagnostics();
  const warning=diagnostics.length ? `<div class="dataset-diagnostics" role="status"><strong>${html(t("diagnostics.invalidPatterns",{count:diagnostics.length}))}</strong><div>${diagnostics.map(({pattern,errors})=>`<button type="button" class="diagnostic-pattern" data-diagnostic-pattern="${pattern.id}" aria-pressed="${state.selectedPattern===pattern.id}" title="${html(errors.map(diagnosticText).join("\n"))}">#${pattern.id}</button>`).join("")}</div></div>` : "";
  document.querySelector("#result-panel")!.innerHTML = `<div class="results-heading"><h2 class="eyebrow">${t("headings.matches")}</h2><span id="result-count" class="count"></span></div>${warning}<input id="result-search" type="search" autocomplete="off" placeholder="${t("filters.searchPlaceholder")}" value="${html(state.search)}"><div id="result-list" class="result-list" data-scroll-key="candidates"></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-diagnostic-pattern]").forEach(button=>button.addEventListener("click",()=>selectPattern(Number(button.dataset.diagnosticPattern))));
  document.querySelector<HTMLInputElement>("#result-search")!.addEventListener("input", e => { state.search = (e.target as HTMLInputElement).value; renderCandidateList(); });
  renderCandidateList();
}
function zoomView(next:number) {
  const zoom=Math.max(1,Math.min(3.2,next));
  if(zoom===state.zoom) return;
  state.zoom=zoom;
  if(state.bubble!==null) {state.bubble=null;renderMap();}
  else applyView();
}
function applyView(repositionLabels=true) {
  const board = document.querySelector<HTMLElement>("#map-board");
  if (board) {
    const textScale=String(1/state.zoom);
    const zoomChanged=board.style.getPropertyValue("--map-text-scale")!==textScale;
    board.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    // Keep popup dimensions fixed while its anchor follows the map.
    board.style.setProperty("--bubble-scale",textScale);
    board.style.setProperty("--map-text-scale",textScale);
    if(repositionLabels && zoomChanged && state.data) layoutBossNames(board,mapLocations(),state.mode==="filter" ? null : currentPattern());
    positionFilterBubble(board);
  }
  const label = document.querySelector("#zoom-label"); if (label) label.textContent = `${Math.round(state.zoom*100)}%`;
  const layer=document.querySelector<HTMLButtonElement>("#layer-switch");
  if(layer) {layer.hidden=state.terrain!==4;layer.setAttribute("aria-pressed",String(mapUnderground()));}
}
function mapLocations() {
  const scope = state.terrain === 4 ? "Great Hollow" : "Surface";
  const indices=state.terrainLocations.get(state.terrain);
  const p=state.mode==="filter" ? null : currentPattern();
  // Prepared tower assets may be removed by a special terrain replacement.
  return (state.data?.locations || []).filter(l => l.scope === scope &&
    (l.typeIndex===8 ? (!p && frenzyTerrainPositions(state.terrain).includes(l.eventFlag!) || !!p && directPointPresent(p,l)) : indices?.has(l.index)) &&
    (state.terrain !== 4 || hollowLowerLocations.has(l.index) === mapUnderground()));
}
function mapUnderground() {
  const preview=state.editorMarkerPreview;
  return state.terrain===4 && preview?.field==="location" ? hollowLowerLocations.has(preview.value) : state.underground;
}
function mapIconSize() {
  const board=document.querySelector<HTMLElement>("#map-board");
  return board ? parseFloat(getComputedStyle(board).getPropertyValue("--map-icon-size")) : 27;
}
function pointIconSize(location:Location) {
  const p=state.mode==="filter" ? null : currentPattern();
  return mapIconSize()*pointArtwork(location,p).mapScale;
}
function mapPixelOffset(pixels:number) {
  const width=document.querySelector<HTMLElement>("#map-board")?.clientWidth || 768;
  return pixels/width*1536;
}
function mapIconStep(firstSize=mapIconSize(), secondSize=firstSize, gap=2) {
  return mapPixelOffset((firstSize+secondSize)/2+gap);
}
function bossIconStep(firstSize=mapIconSize(), secondSize=firstSize) {
  // Slightly overlap the transparent padding around adjacent Boss portraits.
  return mapIconStep(firstSize,secondSize,-Math.min(firstSize,secondSize)*.15);
}
function displayPosition(location:Location) {
  if(location.scope==="Great Hollow") {
    const castleIndex=location.index===80 ? 79 : location.index===82 ? 81 : null;
    const castle=castleIndex===null ? null : locationAt(castleIndex);
    if(castle) return {x:castle.x,y:castle.y+mapIconStep(pointIconSize(castle),pointIconSize(location))};
    const tower=towerLayouts.find(t=>t.floors.includes(location.index));
    const anchor=tower && locationAt(tower.anchorIndex);
    if(tower && anchor) {
      const slot=tower.floors.indexOf(location.index);
      // Center each Boss on the building edge so half its icon overlaps the Tower.
      const horizontal=mapPixelOffset(mapIconSize()*mapIconScale(state.iconConfig,"Tower.webp")/2);
      const vertical=bossIconStep(pointIconSize(anchor),pointIconSize(location));
      return {x:anchor.x+tower.side*horizontal,y:anchor.y+(1-slot)*vertical};
    }
  }
  if(location.scope==="Surface" && (location.index===45 || location.index===46)) {
    const castle=locationAt(10);
    if(castle) {
      const horizontal=mapPixelOffset(pointIconSize(castle)/2);
      const basement=locationAt(45),rooftop=locationAt(46);
      const vertical=basement && rooftop ? bossIconStep(pointIconSize(basement),pointIconSize(rooftop)) : bossIconStep();
      return {x:castle.x-horizontal,y:castle.y+(location.index===46 ? -.5 : .5)*vertical};
    }
  }
  const overlapping = mapLocations().filter(other => Math.hypot(other.x-location.x,other.y-location.y)<3).sort((a,b)=>a.index-b.index);
  if(overlapping.length===1) return {x:location.x,y:location.y};
  const slot=overlapping.findIndex(other=>other.index===location.index);
  return {x:location.x+(slot-(overlapping.length-1)/2)*66,y:location.y};
}
function towerLandmarks(locations:Location[]) {
  if(state.terrain!==4) return "";
  return towerLayouts.map(tower=>{
    const anchor=locationAt(tower.anchorIndex);
    if(!anchor || !locations.some(l=>tower.floors.includes(l.index))) return "";
    return `<div class="tower-landmark" data-tower="${tower.id}" role="img" aria-label="${tower.name}" style="left:${anchor.x/1536*100}%;top:${anchor.y/1536*100}%">${iconArtwork("Tower.webp",null,defaultBadgeStyle,"icon-map-art")}</div>`;
  }).join("");
}
function nightlordArtwork(id:number|null, className="") {
  return `<span class="nightlord-art ${className}"><img class="nightlord-portrait" src="${html(imageUrl(`Nightlord-${id ?? "X"}.webp`))}" alt="" draggable="false"></span>`;
}
function nightlordMarkerHtml(p:Pattern|null) {
  const filtering = state.mode === "filter";
  const id = filtering ? (state.nightlord.include.size === 1 ? Number([...state.nightlord.include][0]) : null) : p?.nightlordId ?? null;
  const label = id === null ? t("ui.undeterminedNightlord") : name("nightlord",id);
  const tag = filtering ? "button" : "div";
  const active = filtering && state.bubble === "nightlord";
  const marked = filtering && (state.nightlord.include.size || state.nightlord.exclude.size);
  const title = t("map.nightlordTooltip", { name: label, filtering: filtering?"yes":"no" });
  return `<${tag} class="nightlord-marker ${active?"active":""} ${marked?"marked":""}" data-nightlord style="left:${nightlordPosition.x/1536*100}%;top:${nightlordPosition.y/1536*100}%" aria-label="${html(title)}" ${filtering?`aria-expanded="${active}"`:"role=\"img\""}>${nightlordArtwork(id)}<span class="marker-label">${html(label)}</span></${tag}>`;
}
function nightlordBubbleHtml() {
  if(state.mode !== "filter") return "";
  const choices = new Map<number,number>();
  const pool=candidates("nightlord");
  const lords = [...new Set(state.data!.patterns.map(p=>p.nightlordId))].sort((a,b)=>a-b);
  for(const id of lords) {
    const included=new Set(state.nightlord.include);
    included.add(String(id));
    choices.set(id,pool.filter(p=>included.has(String(p.nightlordId)) &&
      (p.nightlordId===id || !state.nightlord.exclude.has(String(p.nightlordId)))).length);
  }
  return `<div class="bubble nightlord-bubble" data-render-key="bubble:nightlord" role="dialog" aria-label="${t("ui.nightlordFilters")}" style="left:${nightlordPosition.x/1536*100}%;top:${nightlordPosition.y/1536*100}%;transform:scale(var(--bubble-scale,1)) translate(20px,calc(-100% - 20px)) translate(var(--bubble-shift-x,0px),var(--bubble-shift-y,0px))">
    <div class="bubble-head"><div><small>${t("ui.night3")}</small><strong>${t("ui.nightlord")}</strong></div><button id="close-bubble" aria-label="${t("ui.close")}">×</button></div>
    <div class="bubble-options" data-scroll-key="bubble:nightlord">${lords.map(id=>filterTileHtml(
      name("nightlord",id),choices.get(id) || 0,nightlordArtwork(id),state.nightlord,[String(id)],
      side=>`data-nightlord-choice="${side}" data-key="${id}"`
    )).join("")}</div>
  </div>`;
}
function unitFilterGroups(index:number) {
  const types=new Map((state.data?.names || []).filter(n=>n.kind==="spot" && n.variation!==null)
    .map(n=>[key(n.id,n.variation!),unitTypeId(n.type)]));
  const patterns=(state.data?.patterns || []).map(p=>({id:p.id,units:cellUnits(p,index)
    .map(s=>key(numeric(p,"spot",s.rowId,"unitId",s.unitId),numeric(p,"spot",s.rowId,"variationId",s.variationId)))}));
  return buildUnitFilterGroups(patterns,types,new Set(candidates(index).map(p=>p.id)),state.criteria.get(index));
}
function filterGroupName(group:UnitFilterGroup) { return group.type===null ? t("filters.other") : unitTypeName(group.type); }
function filterGroupArtwork(group:UnitFilterGroup, location:Location) {
  const shared=sharedUnitArtwork(group.options.map(option=>option.key),location,"filter-category-art");
  if(shared) return shared.html;
  // Mixed main icons fall back to the type's default building graphic.
  const ids=[...new Set(group.options.map(option=>Number(option.key.split("|")[0])))].sort((a,b)=>a-b);
  const base=group.type===null ? "Event.webp" : ids.map(id=>automaticUnitIcons[String(id)]).find(Boolean) ?? categoryIcon(location);
  return iconArtwork(base,null,defaultBadgeStyle,"filter-category-art");
}
function filterChoiceButtonsHtml(label:string, criterion:Criterion|undefined, keys:readonly string[], attributes:(side:FilterSide)=>string) {
  return (["include","exclude"] as const).map(side=>{
    const selected=filterSelection(criterion,keys,side);
    const action=t(side==="include"?"filters.includeOption":"filters.excludeOption",{name:label});
    return `<button class="filter-choice ${side} ${selected==="true"?"active":selected==="mixed"?"mixed":""}" ${attributes(side)} aria-label="${html(action)}" aria-pressed="${selected}"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${side==="include"?"M4 10.5 8 14.5 16 5.5":"M5 5 15 15M15 5 5 15"}"/></svg></button>`;
  }).join("");
}
function filterTileHtml(label:string, count:number, artwork:string, criterion:Criterion|undefined, keys:readonly string[], attributes:(side:FilterSide)=>string, browse?:string) {
  const include=filterSelection(criterion,keys,"include"),exclude=filterSelection(criterion,keys,"exclude");
  const classes=[include!=="false"?"has-included":"",exclude!=="false"?"has-excluded":"",
    include==="mixed" || exclude==="mixed"?"is-partial":"",count===0?"is-empty":""].join(" ");
  const enterLabel=browse?t("filters.viewCategory",{name:label}):"";
  const enterIcon=browse?`<button class="filter-tile-enter" data-filter-category="${html(browse)}" aria-label="${html(enterLabel)}"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 11V8a2 2 0 0 1 2-2h6l3 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V11Z"/><path d="M10 18h12m-4-4 4 4-4 4"/></svg></button>`:"";
  const content=`${artwork}<span class="filter-tile-count">${count}</span><span class="filter-tile-name">${html(label)}</span>`;
  return `<article class="filter-tile ${browse?"filter-tile-category":"filter-tile-unit"} ${classes}" data-render-key="tile:${html(browse ?? keys.join(","))}">
    <button class="filter-tile-main" ${attributes("include")} aria-label="${html(t("filters.includeOption",{name:label}))}" aria-pressed="${include}">${content}</button>
    <div class="filter-tile-actions">${filterChoiceButtonsHtml(label,criterion,keys,attributes)}</div>
    ${enterIcon}
  </article>`;
}
function bubbleHtml(index:BubbleTarget) {
  if(index === "nightlord") return nightlordBubbleHtml();
  const location = locationAt(index);
  if (!location || state.mode !== "filter" || directFilterType(location)!==null) return "";
  const groups=unitFilterGroups(index);
  const group=groups.length===1 ? groups[0] : groups.find(group=>group.key===state.bubbleCategory);
  const criterion = state.criteria.get(index);
  const groupActions=group && groups.length>1 ? `<div class="bubble-category-actions" role="group" aria-label="${html(t("filters.categoryActions",{name:filterGroupName(group)}))}">${filterChoiceButtonsHtml(filterGroupName(group),criterion,group.options.map(option=>option.key),side=>`data-group-choice="${side}" data-group="${html(group.key)}" data-index="${index}"`)}</div>` : "";
  const unitTile=(option:UnitFilterOption)=>{
    const [unit,variation]=option.key.split("|").map(Number);
    const artwork=iconArtwork(unitIcon(state.iconConfig,unit,variation,location),unitBadge(state.iconConfig,unit,variation),badgeStyle(state.iconConfig,unit,variation),"icon-option-art",baseFrame(state.iconConfig,unit,variation,unitIcon(state.iconConfig,unit,variation,location)),baseGlow(state.iconConfig,unit,variation,unitIcon(state.iconConfig,unit,variation,location)),baseScale(state.iconConfig,unit,variation,unitIcon(state.iconConfig,unit,variation,location)));
    return filterTileHtml(unitNameOnly(unit,variation),option.count,artwork,criterion,[option.key],side=>`data-choice="${side}" data-key="${html(option.key)}" data-index="${index}"`);
  };
  const tiles=group ? group.options.map(unitTile).join("") : groups.map(group=>group.options.length===1
    ? unitTile(group.options[0])
    : filterTileHtml(filterGroupName(group),group.count,filterGroupArtwork(group,location),criterion,group.options.map(option=>option.key),
      side=>`data-group-choice="${side}" data-group="${html(group.key)}" data-index="${index}"`,group.key)).join("");
  const position=displayPosition(location);
  const horizontal=position.x>900?"calc(-100% - 18px)":"20px";
  const vertical=position.y>700?"calc(-100% + 15px)":"-15px";
  return `<div class="bubble" data-render-key="bubble:${index}:${html(group?.key ?? "categories")}" role="dialog" aria-label="${html(locationName(location))}" style="left:${position.x/1536*100}%;top:${position.y/1536*100}%;transform:scale(var(--bubble-scale,1)) translate(${horizontal},${vertical}) translate(var(--bubble-shift-x,0px),var(--bubble-shift-y,0px))">
    <div class="bubble-head">${group && groups.length>1?`<button id="filter-back" class="bubble-back" aria-label="${t("filters.backToCategories")}">←</button>`:""}<div><small>${html(group?filterGroupName(group):t("map.locationCategory", { category: locationCategory(location), location: index }))}</small><strong>${html(locationName(location))}</strong></div>${groupActions}<button id="close-bubble" aria-label="${t("ui.close")}">×</button></div>
    <div class="bubble-options" data-scroll-key="bubble:${index}:${html(group?.key ?? "categories")}">${tiles || `<div class="empty-small">${t("filters.noUnits")}</div>`}</div>
  </div>`;
}
function markerHtml(location:Location, p:Pattern|null) {
  const spots = p ? p.placements.filter(s=>s.locationIndex===location.index && (visibleSpot(p,s) || state.mode === "edit")) : [];
  const spot = displayedSpot(location,p);
  const eventLocation=location.eventFlag!=null;
  if(eventLocation && p && !directPointPresent(p,location)) return "";
  if(state.mode==="preview" && !spot && !eventLocation) return "";
  const hiddenUnit=Boolean(p && !spot && spots.some(s=>visibleSpot(p,s)));
  const merchant=state.mode==="filter" ? directFilterType(location) : null;
  const active = merchant===null && (state.mode === "filter"
    ? state.bubble === location.index : state.selectedLocation === location.index);
  const criterion=state.criteria.get(location.index);
  const merchantState=criterion?.include.size ? "required" : criterion?.exclude.size ? "excluded" : "normal";
  const marked = merchant===null && state.criteria.has(location.index);
  const confirmedName=confirmedUnitName(location,p);
  const label=confirmedName ?? locationName(location);
  const buildingBoss=(location.scope==="Surface" && [45,46].includes(location.index)) ||
    (location.scope==="Great Hollow" && towerLayouts.some(t=>t.floors.includes(location.index)));
  const position=displayPosition(location);
  const artwork=pointArtwork(location,p).html;
  const merchantSelection=merchant!==null && merchantState==="required"
    ? `<span class="merchant-selection" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M2 6 4.5 8.5 10 3"/></svg></span>` : "";
  const bossName=confirmedBossName(location,p);
  const title=confirmedName ?? (merchant!==null
    ? t("map.merchantTooltip", { merchant: directFilterName(merchant), location: locationName(location), condition: merchantState==="required"?t("ui.includedAppearsAtAnyHighlightedLocation"):merchantState==="excluded"?t("ui.excludedCannotAppearHere"):t("ui.normalNoFilter") })
    : t("map.locationTooltip", { name: locationName(location), hidden: hiddenUnit?"yes":"no" }));
  const tooltip=state.mode==="filter" && merchant===null ? `${title} · ${t("map.clearLocationFilter")}` : title;
  return `<button class="map-marker ${bossName?"has-boss-name":""} ${buildingBoss?"building-boss":""} ${active?"active":""} ${marked?"marked":""} ${merchant!==null?`merchant-marker merchant-${merchantState}`:""} ${hiddenUnit?"hidden-placeholder":state.mode!=="filter"&&!spot&&!eventLocation?"unavailable":""}" style="left:${position.x/1536*100}%;top:${position.y/1536*100}%" data-location="${location.index}" ${eventLocation?`data-${location.typeIndex===8?"frenzy-tower":"rot-blessing"}="${location.eventFlag}"`:""} ${merchant!==null?`data-merchant-state="${merchantState}" aria-pressed="${merchantState==="required"?"true":merchantState==="excluded"?"mixed":"false"}"`:""} aria-label="${html(tooltip)}">
    ${artwork}${merchantSelection}<span class="marker-label">${html(label)}</span>
  </button>`;
}
function mapArtworkRect(icon:HTMLElement,x:number,y:number,width:number,height:number):LabelRect {
  if(icon.querySelector(".icon-art-base-layer.framed")) return {x:x-width/2,y:y-height/2,width,height};
  return mapImageArtworkRect(icon.querySelector<HTMLImageElement>(".icon-art-base"),x,y,width,height);
}
function mapBadgeArtworkRect(icon:HTMLElement,x:number,y:number,width:number,height:number):LabelRect|undefined {
  const badge=icon.querySelector<HTMLElement>(".icon-art-badge");
  if(!badge) return;
  const style=getComputedStyle(badge),iconStyle=getComputedStyle(icon);
  const scaleX=width/parseFloat(iconStyle.width),scaleY=height/parseFloat(iconStyle.height);
  const badgeWidth=parseFloat(style.width)*scaleX,badgeHeight=parseFloat(style.height)*scaleY;
  const right=parseFloat(style.right)*scaleX,bottom=parseFloat(style.bottom)*scaleY;
  const badgeX=x+width/2-right-badgeWidth/2,badgeY=y+height/2-bottom-badgeHeight/2;
  if(badge.classList.contains("framed")) return {x:badgeX-badgeWidth/2,y:badgeY-badgeHeight/2,width:badgeWidth,height:badgeHeight};
  return mapImageArtworkRect(badge.querySelector<HTMLImageElement>("img"),badgeX,badgeY,badgeWidth,badgeHeight);
}
function mapImageArtworkRect(image:HTMLImageElement|null,x:number,y:number,width:number,height:number):LabelRect {
  const fallback={x:x-width*.38,y:y-height*.38,width:width*.76,height:height*.76};
  if(!image?.complete || !image.naturalWidth) return fallback;
  const source=image.currentSrc || image.src;
  if(!mapArtworkBounds.has(source)) {
    try {
      const canvas=document.createElement("canvas");
      const factor=Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.ceil(image.naturalWidth*factor);canvas.height=Math.ceil(image.naturalHeight*factor);
      const context=canvas.getContext("2d")!;
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      let left=canvas.width,top=canvas.height,right=0,bottom=0;
      for(let row=0;row<canvas.height;row++) for(let column=0;column<canvas.width;column++) {
        if(pixels[(row*canvas.width+column)*4+3]<=128) continue;
        left=Math.min(left,column);top=Math.min(top,row);right=Math.max(right,column+1);bottom=Math.max(bottom,row+1);
      }
      mapArtworkBounds.set(source,right>left && bottom>top ?
        {left:left/canvas.width,top:top/canvas.height,right:right/canvas.width,bottom:bottom/canvas.height} : null);
    } catch {mapArtworkBounds.set(source,null);}
  }
  const bounds=mapArtworkBounds.get(source);
  if(!bounds) return fallback;
  const fit=Math.min(width/image.naturalWidth,height/image.naturalHeight);
  const imageWidth=image.naturalWidth*fit,imageHeight=image.naturalHeight*fit;
  return {x:x-imageWidth/2+bounds.left*imageWidth,y:y-imageHeight/2+bounds.top*imageHeight,
    width:(bounds.right-bounds.left)*imageWidth,height:(bounds.bottom-bounds.top)*imageHeight};
}
function emphasizeBossName(element:HTMLElement, emphasized:boolean, board:HTMLElement, hovered:boolean) {
  let shiftX=0,shiftY=0;
  if(emphasized) {
    const style=getComputedStyle(element);
    const [originX,originY]=style.transformOrigin.split(" ").map(parseFloat);
    const scale=1.35/state.zoom;
    const x=parseFloat(element.style.left)+originX*(1-scale);
    const y=parseFloat(element.style.top)+originY*(1-scale);
    const width=parseFloat(style.width)*scale,height=parseFloat(style.height)*scale;
    // Move enlarged names inside the board, even when that covers a portrait.
    shiftX=Math.max(6,Math.min(board.clientWidth-width-6,x))-x;
    shiftY=Math.max(6,Math.min(board.clientHeight-height-6,y))-y;
  }
  element.style.setProperty("--boss-name-shift-x",`${shiftX}px`);
  element.style.setProperty("--boss-name-shift-y",`${shiftY}px`);
  element.classList.toggle("is-emphasized",emphasized);
  element.classList.toggle("is-hovered",hovered);
}
function layoutBossNames(board:HTMLElement, locations:Location[], p:Pattern|null) {
  const width=board.clientWidth,height=board.clientHeight;
  const labels:BossLabel[]=[];
  const elements=new Map<number,HTMLElement>();
  const icons:IconRect[]=[];
  // Hover and selection share a stable layout. Their emphasis scales around
  // the portrait through CSS, without changing collision or wrapping inputs.
  board.querySelectorAll<HTMLElement>(".map-marker,.tower-landmark,.spawn-marker,.nightlord-marker").forEach(marker=>{
    const icon=marker.querySelector<HTMLElement>(".icon-map-art") ?? marker;
    const style=getComputedStyle(icon);
    const iconWidth=parseFloat(style.width),iconHeight=parseFloat(style.height);
    const x=parseFloat(marker.style.left)/100*width,y=parseFloat(marker.style.top)/100*height;
    icons.push({x:x-iconWidth/2,y:y-iconHeight/2,width:iconWidth,height:iconHeight,artwork:mapArtworkRect(icon,x,y,iconWidth,iconHeight),
      badge:mapBadgeArtworkRect(icon,x,y,iconWidth,iconHeight),
      locationId:marker.dataset.location===undefined ? undefined : Number(marker.dataset.location)});
  });
  for(const location of locations) {
    const text=confirmedBossName(location,p);
    const marker=board.querySelector<HTMLElement>(`.map-marker[data-location="${location.index}"]`);
    if(!text || !marker) continue;
    let element=board.querySelector<HTMLElement>(`.boss-name[data-boss-location="${location.index}"]`);
    if(!element) {
      element=document.createElement("span");
      element.className="boss-name";
      element.dataset.bossLocation=String(location.index);
      board.append(element);
    }
    const layoutScale=1/state.zoom;
    const tower=location.scope==="Great Hollow" ? towerLayouts.find(t=>t.floors.includes(location.index)) : null;
    element.classList.toggle("boss-name-tower",Boolean(tower));
    element.classList.toggle("boss-name-multiline",text.includes("\n"));
    element.textContent=text;
    element.style.removeProperty("max-width");
    elements.set(location.index,element);
    const icon=marker.querySelector<HTMLElement>(".icon-map-art")!;
    const iconStyle=getComputedStyle(icon);
    const x=parseFloat(marker.style.left)/100*width,y=parseFloat(marker.style.top)/100*height;
    const textStyle=getComputedStyle(element);
    labels.push({id:location.index,x,y,side:tower?.side,scale:layoutScale,overlap:location.typeIndex===3 ? 14 : undefined,
      artwork:icons.find(icon=>icon.locationId===location.index)?.artwork,
      width:Math.ceil(parseFloat(textStyle.width)*layoutScale),height:Math.ceil(parseFloat(textStyle.height)*layoutScale),
      iconWidth:parseFloat(iconStyle.width),iconHeight:parseFloat(iconStyle.height)});
  }
  // Wrap crowded names before choosing positions, so a long English name
  // does not occupy several neighbouring icons' columns.
  const measureContext=document.createElement("canvas").getContext("2d")!;
  const naturalLabels=labels.map(label=>({...label}));
  for(const label of labels) {
    const element=elements.get(label.id)!;
    if(element.matches(".boss-name-tower,.boss-name-multiline")) continue;
    const style=getComputedStyle(element);
    const natural=naturalLabels.find(other=>other.id===label.id)!;
    const neighbours=naturalLabels.filter(other=>other.id!==label.id &&
      Math.abs(other.y-label.y)<(label.iconHeight+other.iconHeight)/2+Math.max(label.height,other.height) &&
      Math.abs(other.x-label.x)<(natural.width+other.width)/2+6);
    if(!neighbours.length) continue;
    measureContext.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const longestWord=Math.max(...element.textContent!.split(/\s+/).map(word=>measureContext.measureText(word).width))+4;
    const localWidth=Math.min(...neighbours.map(other=>Math.abs(other.x-label.x)))/(label.scale ?? 1)-6;
    const maxWidth=Math.min(200,Math.max(100,longestWord,localWidth));
    if(parseFloat(style.width)<=maxWidth) continue;
    element.style.maxWidth=`${maxWidth}px`;
    const wrappedStyle=getComputedStyle(element);
    label.width=Math.ceil(parseFloat(wrappedStyle.width)*(label.scale ?? 1));
    label.height=Math.ceil(parseFloat(wrappedStyle.height)*(label.scale ?? 1));
  }
  board.querySelectorAll<HTMLElement>(".boss-name").forEach(element=>{
    if(!elements.has(Number(element.dataset.bossLocation))) element.remove();
  });
  const placed=placeBossLabels(labels,icons,width,height);
  for(const label of placed) {
    const element=elements.get(label.id)!;
    const scale=label.scale ?? 1;
    const left=label.x+(label.rect.x-label.x)/scale;
    const top=label.y+(label.rect.y-label.y)/scale;
    element.style.left=`${left}px`;
    element.style.top=`${top}px`;
    element.style.transformOrigin=`${label.x-left}px ${label.y-top}px`;
    element.style.visibility="visible";
    element.dataset.bossNameFallback=String(label.fallback);
    const marker=board.querySelector<HTMLElement>(`.map-marker[data-location="${label.id}"]`)!;
    emphasizeBossName(element,marker.matches(":hover,.active"),board,marker.matches(":hover"));
  }
}
function specialMarkers(p:Pattern|null) {
  if(!state.data || (p && p.terrainId!==state.terrain)) return "";
  const mapPatterns=state.data.patterns.filter(pattern=>(pattern.terrainId===4)===(state.terrain===4));
  const hovered=!p && state.mode==="filter" ? document.querySelector<HTMLElement>("#inspector .map-information-choice:hover .filter-tile-main[data-map-choice]") : null;
  const markerIds=(field:"spawn"|"circle1"|"circle2")=>{
    if(p && state.mode==="edit" && state.editorMarkerPreview?.field===field) return [state.editorMarkerPreview.value];
    if(p) return informationValues(p,field).filter(value=>value!=="none").map(Number);
    const visible=new Set(mapCriterion(field)?.include);
    if(hovered?.dataset.mapChoice===field) visible.add(hovered.dataset.key!);
    if(!visible.size) return [];
    // Use map scope rather than remaining candidates, so selected
    // positions still appear when other conditions leave no matching Pattern.
    const available=new Set(mapPatterns.flatMap(pattern=>informationValues(pattern,field)));
    return [...visible].filter(value=>value!=="none" && available.has(value)).map(Number);
  };
  const items:string[]=[];
  const preview=state.mode==="edit" && p ? state.editorMarkerPreview : null;
  const circles=new Map<string,{center:CircleCenter;nights:Set<1|2>;preview:boolean}>();
  for(const day of [1,2] as const) for(const id of markerIds(day===1?"circle1":"circle2")) {
    const center=state.data.circleCenters.find(c=>c.id===id);
    if(center && center.x>=0 && center.y>=0 && center.x<=1536 && center.y<=1536) {
      const position=`${center.x}:${center.y}`;
      const circle=circles.get(position) ?? {center,nights:new Set<1|2>(),preview:false};
      circle.nights.add(day);
      if(preview?.field===(day===1?"circle1":"circle2") && preview.value===id) circle.preview=true;
      circles.set(position,circle);
    }
  }
  for(const [position,{center,nights,preview}] of circles) {
    const label=[...nights].join(" / ");
    const day=nights.size===2 ? "shared" : label;
    const sourceLabel=center.source==="community"?t("map.circleCommunitySource"):center.source==="playArea"?t("map.circleVerifiedSource"):t("map.circleDefaultSource");
    items.push(`<div class="night-circle day-${day} ${preview?"is-preview":""}" data-render-key="circle:${position}" role="img" style="left:${center.x/1536*100}%;top:${center.y/1536*100}%" aria-label="${html(t("map.circleTooltip", { night: label, name: name("circle",center.id), source: sourceLabel }))}"><span>${label}</span></div>`);
  }
  for(const id of markerIds("spawn")) {
    const loc=state.terrain===4 ? hollowSpawnPositions[id] : locationAt(spawnLocationIds[id]);
    if(loc) items.push(`<div class="spawn-marker ${preview?.field==="spawn" && preview.value===id?"is-preview":""}" data-render-key="spawn:${id}" role="img" style="left:${loc.x/1536*100}%;top:${loc.y/1536*100}%" aria-label="${html(t("map.spawnTooltip", { name: name("spawn",id) }))}"><span class="spawn-ring" aria-hidden="true"></span><img class="spawn-icon" src="${html(imageUrl("Spawn Point.webp"))}" alt="" aria-hidden="true" draggable="false"></div>`);
  }
  if(preview?.field==="location") {
    const location=locationAt(preview.value);
    if(location && location.scope===(state.terrain===4 ? "Great Hollow" : "Surface") &&
      (state.terrain!==4 || hollowLowerLocations.has(location.index)===mapUnderground()))
      items.push(`<div class="location-preview-marker" data-render-key="location-preview:${location.index}" data-preview-location="${location.index}" role="img" style="left:${location.x/1536*100}%;top:${location.y/1536*100}%" aria-label="${html(locationName(location))}"><span class="location-preview-ring" aria-hidden="true"></span><span class="location-preview-label">${html(locationName(location))}</span></div>`);
  }
  return items.join("");
}
function renderMap() {
  preserveScroll(renderMapContent);
}
function renderMapContent() {
  const p = state.mode === "filter" ? null : currentPattern();
  const locations = mapLocations();
  const board = document.querySelector<HTMLElement>("#map-board")!;
  const content=document.createElement("template");
  content.innerHTML = `<img class="map-image" src="${terrainImage(state.terrain,mapUnderground())}" alt="${html(t("map.alt", { terrain: terrainName(state.terrain) }))}" draggable="false"><div class="map-vignette"></div>${specialMarkers(p)}${towerLandmarks(locations)}${locations.map(l=>markerHtml(l,p)).join("")}${nightlordMarkerHtml(p)}${state.bubble!==null?bubbleHtml(state.bubble):""}`;
  patchChildren(board,content.content,node=>node instanceof Element && node.classList.contains("boss-name"));
  applyView(false);
  layoutBossNames(board,locations,p);
}
function bindMapEvents(board:HTMLElement) {
  let imageLayoutFrame:number|null=null;
  board.addEventListener("load",event=>{
    if(!(event.target instanceof HTMLImageElement) || !event.target.matches(".map-marker .icon-art-base,.map-marker .icon-art-badge img") || imageLayoutFrame!==null) return;
    imageLayoutFrame=requestAnimationFrame(()=>{
      imageLayoutFrame=null;
      if(board.isConnected && state.data) layoutBossNames(board,mapLocations(),state.mode==="filter" ? null : currentPattern());
    });
  },true);
  const emphasizeName=(event:PointerEvent,hover:boolean)=>{
    const marker=(event.target as Element).closest<HTMLElement>("[data-location]");
    if(!marker || (event.relatedTarget instanceof Node && marker.contains(event.relatedTarget))) return;
    const name=board.querySelector<HTMLElement>(`.boss-name[data-boss-location="${marker.dataset.location}"]`);
    if(name) emphasizeBossName(name,hover || marker.classList.contains("active"),board,hover);
  };
  board.addEventListener("pointerover",event=>emphasizeName(event,true));
  board.addEventListener("pointerout",event=>emphasizeName(event,false));
  board.addEventListener("click",event=>{
    const el=(event.target as Element).closest<HTMLElement>("button,[data-location],[data-nightlord]");
    if(!el || !board.contains(el)) return;
    event.stopPropagation();
    if(el.id==="close-bubble") {state.bubble=null;renderMap();}
    else if(el.id==="filter-back") {state.bubbleCategory=null;renderMap();}
    else if(el.dataset.filterCategory!==undefined) {state.bubbleCategory=el.dataset.filterCategory;renderMap();}
    else if(el.dataset.groupChoice!==undefined) {
      const index=Number(el.dataset.index);
      const group=unitFilterGroups(index).find(group=>group.key===el.dataset.group);
      if(group) toggleChoices(index,group.options.map(option=>option.key),el.dataset.groupChoice as FilterSide);
    } else if(el.dataset.nightlordChoice!==undefined) toggleNightlordChoice(el.dataset.key!,el.dataset.nightlordChoice as FilterSide);
    else if(el.dataset.choice!==undefined) toggleChoice(Number(el.dataset.index),el.dataset.key!,el.dataset.choice as FilterSide);
    else if(el.dataset.location!==undefined) {
      const index=Number(el.dataset.location);
      if(state.mode==="filter" && directFilterType(locationAt(index))!==null) {toggleDirectPointChoice(index,"include");return;}
      if(state.mode==="filter") {state.bubble=state.bubble===index ? null : index;state.bubbleCategory=null;}
      else {
        state.selectedLocation=state.mode==="preview" && state.selectedLocation===index ? null : index;
        const location=locationAt(index);
        state.tab=location?.eventFlag!=null ? "event" : "spot";
        if(location?.eventFlag!=null) state.selectedFlag=eventLocationRow(currentPattern()!,location)?.rowId ?? null;
      }
      renderMap();renderInspector();
      if(state.mode==="edit" && state.tab==="event") revealEventCard(state.selectedFlag);
    } else if(el.hasAttribute("data-nightlord") && state.mode==="filter") {
      state.bubble=state.bubble==="nightlord" ? null : "nightlord";state.bubbleCategory=null;renderMap();
    }
  });
  board.addEventListener("contextmenu",event=>{
    const target=event.target as Element;
    const tile=target.closest<HTMLElement>(".filter-tile");
    if(tile) {
      event.preventDefault();event.stopPropagation();
      tile.querySelector<HTMLButtonElement>(".filter-choice.exclude")!.click();
      return;
    }
    const marker=target.closest<HTMLElement>("[data-location]");
    if(state.mode!=="filter") return;
    if(marker) {
      event.preventDefault();event.stopPropagation();
      const index=Number(marker.dataset.location);
      if(directFilterType(locationAt(index))!==null) toggleDirectPointChoice(index,"exclude");
      else if(state.criteria.delete(index)) updateAfterFilter();
    } else if(target.closest("[data-nightlord]")) {
      event.preventDefault();event.stopPropagation();
      if(state.nightlord.include.size || state.nightlord.exclude.size) {
        state.nightlord.include.clear();state.nightlord.exclude.clear();
        updateAfterFilter();
      }
    }
  });
}
function positionFilterBubble(board:HTMLElement) {
  const bubble=board.querySelector<HTMLElement>(".bubble");
  const viewport=board.parentElement;
  if(!bubble || !viewport) return;
  const bounds=viewport.getBoundingClientRect();
  // The larger grid stays inside the visible map, including after zoom and pan.
  bubble.style.maxWidth=`${Math.max(0,bounds.width-20)}px`;
  bubble.style.maxHeight=`${Math.max(0,bounds.height-20)}px`;
  bubble.style.setProperty("--bubble-shift-x","0px");
  bubble.style.setProperty("--bubble-shift-y","0px");
  const rect=bubble.getBoundingClientRect();
  const x=Math.max(bounds.left+10,Math.min(bounds.right-rect.width-10,rect.left))-rect.left;
  const y=Math.max(bounds.top+10,Math.min(bounds.bottom-rect.height-10,rect.top))-rect.top;
  bubble.style.setProperty("--bubble-shift-x",`${x}px`);
  bubble.style.setProperty("--bubble-shift-y",`${y}px`);
}
function previewSummary(p:Pattern) {
  const play=p.play;
  const bossName=(day:1|2)=>{
    if(!play) return t("ui.noExistingRow");
    const bossField=day===1 ? "bossId1" : "bossId2",extraField=day===1 ? "extraBossId1" : "extraBossId2";
    const boss=numeric(p,"play",play.rowId,bossField,play[bossField]);
    const extraBoss=numeric(p,"play",play.rowId,extraField,play[extraField]);
    return html([name("night_boss",boss),...(extraBoss>=0 ? [name("night_boss",extraBoss)] : [])].join(" & "));
  };
  const events=patternEventGroups(p).filter(group=>group.kind!=="blessing").map(group=>{
    const event=group.trigger ?? (group.kind==="unknown" ? group.flags[0] : null);
    const eventName=group.kind!=="unknown" ? eventGroupName(group.kind) :
      event ? name("special_event",event.modifierSet,event.eventFlag) : eventGroupName(group.kind);
    const schedule=["timed","night"].includes(eventTiming(group.kind)) ? `<span>${t(group.day===1 ? "event.day1" : "event.day2")}</span>` : "";
    return `<li><strong>${html(eventName)}</strong>${schedule}</li>`;
  }).join("");
  return `<div class="summary-card"><div class="summary-hero"><div class="summary-heading"><h2>${html(name("nightlord",p.nightlordId))}</h2><span class="eyebrow summary-pattern-id">#${p.id}</span></div><span>${html(terrainName(p.terrainId))}</span></div>
    <div class="summary-grid"><div><small>${t("ui.night1Boss")}</small><strong>${bossName(1)}</strong></div>
    <div><small>${t("ui.night2Boss")}</small><strong>${bossName(2)}</strong></div></div></div>
    <div class="detail-section"><h3>${t("ui.specialEvent")}</h3>${events ? `<ul class="preview-events">${events}</ul>` : `<p class="muted">${t("ui.noSpecialEvent")}</p>`}</div>`;
}
function field(p:Pattern, table:Patch["table"], row:number, fieldName:string, original:number, label:string, options?:{value:number;label:string}[],positionField?:PositionField) {
  const value=numeric(p,table,row,fieldName,original);
  const id=`location-picker-${table}-${row}-${fieldName}`;
  const choices=options && (options.some(option=>option.value===value) ? options : [...options,{value,label:`ID ${value}`}]).slice().sort((a,b)=>a.value-b.value);
  const select=choices ? `<select ${positionField?"hidden":""} data-edit-table="${table}" data-edit-row="${row}" data-edit-field="${fieldName}" data-original="${original}">${choices.map(option=>`<option value="${option.value}" ${option.value===value?"selected":""}>${html(option.label)}</option>`).join("")}</select>` : "";
  const picker=choices && positionField ? `<div class="location-picker" data-location-picker="${positionField}">${select}<button type="button" id="${id}" class="location-picker-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-options" aria-labelledby="${id}-label ${id}-value"><span id="${id}-value">${html(choices.find(option=>option.value===value)!.label)}</span><span aria-hidden="true">▾</span></button><div id="${id}-options" class="location-picker-options" hidden role="listbox" aria-labelledby="${id}-label">${choices.map(option=>`<button type="button" class="location-picker-option" role="option" aria-selected="${option.value===value}" tabindex="-1" data-position-value="${option.value}">${html(option.label)}</button>`).join("")}</div></div>` : select;
  return `<label class="editor-field"><span id="${id}-label">${html(label)}</span><div class="field-controls">${picker}<input type="number" autocomplete="off" step="1" value="${value}" data-edit-table="${table}" data-edit-row="${row}" data-edit-field="${fieldName}" data-original="${original}"></div></label>`;
}
function presetOptions(options:{value:string;label:string;previewValue?:number|null}[],current:string) {
  const unknown=options.some(option=>option.value===current) ? "" : `<option value="" selected>${t("ui.unknown")}</option>`;
  return unknown+options.map(option=>`<option value="${html(option.value)}" ${option.value===current?"selected":""}${option.previewValue===undefined || option.previewValue===null ? "" : ` data-preview-value="${option.previewValue}"`}>${html(option.label)}</option>`).join("");
}
function addRowButton(kind:"spot"|"event"|"spawn"|"play") {
  const label={spot:t("ui.addUnitRow"),event:t("ui.addEventRow"),spawn:t("ui.addSpawnRow"),play:t("ui.addPlayRow")}[kind];
  return `<div class="editor-row-actions"><button type="button" class="button secondary compact" data-add-row="${kind}" ${state.busy?"disabled":""}>${label}</button></div>`;
}
function removeRowButton(table:"spot"|"flag",rowId:number) {
  const label=table==="spot" ? t("ui.removeUnit") : t("ui.removeEvent");
  return `<button type="button" class="row-remove" data-remove-${table==="spot"?"unit":"event"}="${rowId}" aria-label="${html(label)} · Row #${rowId}" title="${html(label)}" ${state.busy?"disabled":""}><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 5 15 15M15 5 5 15"/></svg></button>`;
}
function spotEditor(p:Pattern) {
  const location=state.selectedLocation===null?null:locationAt(state.selectedLocation);
  if (!location) return `<div class="inspector-empty"><div class="empty-icon">⌖</div><h3>${t("ui.selectAMapLocation")}</h3><p>${t("help.inspectLocation")}</p></div>`;
  const rows=p.placements.filter(s=>s.locationIndex===location.index);
  if (!rows.length) return `<div class="inspector-empty"><div class="empty-icon">⊘</div><h3>${html(locationName(location))}</h3><p>${t("help.noLocationRows")}</p>${location.eventFlag==null?addRowButton("spot"):""}</div>`;
  const pool=new Map<string,{unit:number;variation:number;modifier:number;count:number}>();
  for(const other of state.data!.patterns) for(const s of other.placements.filter(s=>s.locationIndex===location.index)) {
    if(state.additions.has(`spot:${s.rowId}`)) continue;
    if(!visibleSpot(other,s)) continue;
    const k=`${s.unitId}|${s.variationId}|${s.modifier}`;
    const old=pool.get(k); if(old) old.count++; else pool.set(k,{unit:s.unitId,variation:s.variationId,modifier:s.modifier,count:1});
  }
  // Ancient Rise is enabled by its unit, so offer its known puzzle variants at
  // every ordinary tower location, including points with no vanilla Rise event.
  if(terrainPresetPatterns(p).some(other=>other.placements.some(row=>row.locationIndex===location.index && [4090,p.terrainId===4 ? 5110 : 4100].includes(row.unitId))))
    for(const option of riseUnitOptions()) if(!pool.has(option.value)) {
      const [unit,variation,modifier]=option.value.split("|").map(Number);
      pool.set(option.value,{unit,variation,modifier,count:0});
    }
  const options=[...pool.values()].sort((a,b)=>b.count-a.count).map(x=>({value:`${x.unit}|${x.variation}|${x.modifier}`,label:`${unitName(x.unit,x.variation)} · ${x.unit}|${x.variation} · modifier ${x.modifier}`}));
  return `<div class="editor-section"><h3>${html(locationName(location))}</h3><p class="muted">${html(t("help.locationEditing", { location: location.index, category: locationCategory(location) }))}</p>${location.eventFlag==null && !rows.some(s=>visibleSpot(p,s))?addRowButton("spot"):""}${rows.map(s=>{
    const current=`${numeric(p,"spot",s.rowId,"unitId",s.unitId)}|${numeric(p,"spot",s.rowId,"variationId",s.variationId)}|${numeric(p,"spot",s.rowId,"modifier",s.modifier)}`;
    return `
    <div class="row-editor"><div class="row-heading"><strong>${t("editor.unitRow", { rowId: s.rowId })}</strong>${removeRowButton("spot",s.rowId)}</div>
    <label class="editor-field"><span>${t("ui.knownUnitCombinations")}</span><select data-spot-preset="${s.rowId}">${presetOptions(options,current)}</select></label>
    ${field(p,"spot",s.rowId,"unitId",s.unitId,t("ui.unitId"))}${field(p,"spot",s.rowId,"variationId",s.variationId,t("ui.variantId"))}${field(p,"spot",s.rowId,"modifier",s.modifier,"Modifier")}
    <div class="row-foot">${t("editor.unitScope", { attachId: s.attachId, mapIndex: numeric(p,"spot",s.rowId,"mapIndex",s.mapIndex) })}</div></div>`;}).join("")}</div>`;
}
function eventRows(p:Pattern) {
  return p.flags.filter(f=> (f.modifierSet>=3000&&f.modifierSet<=3130) || (f.modifierSet>=500&&f.modifierSet<=560) || f.modifierSet===3500 ||
    (p.terrainId===4 && [0,1000].includes(f.modifierSet) && [1038400230,1046400230].includes(f.eventFlag)));
}
function resultTableWillBeRewritten(table:Patch["table"]) {
  return state.restorations.size>0 || [...state.additions.values(),...state.removals.values()].some(row=>row.table===table);
}
function patternEventCapacity(p:Pattern,draft?:{rowId:number;values:Partial<Flag>}) {
  const rows=p.flags.map(row=>({rowId:row.rowId,
    modifier:row.rowId===draft?.rowId && draft.values.modifier!==undefined ? draft.values.modifier : numeric(p,"flag",row.rowId,"modifier",row.modifier ?? 0),
    eventFlag:row.rowId===draft?.rowId && draft.values.eventFlag!==undefined ? draft.values.eventFlag : numeric(p,"flag",row.rowId,"eventFlag",row.eventFlag ?? 0)}));
  // Structural edits rewrite the entire flag table by Pattern and Row ID.
  // Field-only saves retain the imported physical order.
  if(resultTableWillBeRewritten("flag")) rows.sort((first,second)=>first.rowId-second.rowId);
  return eventCapacity(rows);
}
function patternDiagnostics(p:Pattern,draft?:{rowId:number;values:Partial<Flag>}) {
  const errors=(state.data?.diagnostics ?? []).filter(error=>error.params.patternId===p.id &&
    (error.code==="errors.flagRowOrder" && !resultTableWillBeRewritten("flag") ||
     error.code==="errors.spotRowOrder" && !resultTableWillBeRewritten("spot")));
  const capacity=patternEventCapacity(p,draft);
  if(capacity.invalidRowId!==null) errors.push({code:capacity.count>capacity.limit ? "errors.eventCapacity" : "errors.eventTrailingRow",
    params:{patternId:p.id,count:capacity.count,limit:capacity.limit,rowId:capacity.invalidRowId}});
  return errors;
}
function datasetDiagnostics() {
  return (state.data?.patterns ?? []).map(pattern=>({pattern,errors:patternDiagnostics(pattern)})).filter(item=>item.errors.length>0);
}
function diagnosticText(error:ResultDiagnostic) {
  return ["errors.eventCapacity","errors.eventTrailingRow"].includes(error.code) ? t("diagnostics.eventCapacityExceeded") : formatMessage(errorMessage(error));
}
function previewDiagnostics(p:Pattern) {
  const errors=patternDiagnostics(p);
  return errors.length ? `<div class="pattern-invalid-reasons pattern-diagnostics invalid" role="status"><strong>${html(t("diagnostics.invalidReasons"))}</strong>${errors.map(error=>`<p class="diagnostic-error">${html(diagnosticText(error))}</p>`).join("")}</div>` : "";
}
function editTabDiagnostics(errors:ResultDiagnostic[]) {
  const result=new Map<EditTab,ResultDiagnostic[]>();
  for(const error of errors) {
    const tab=error.code==="errors.spotRowOrder" ? "spot" :
      ["errors.eventCapacity","errors.eventTrailingRow","errors.flagRowOrder"].includes(error.code) ? "event" : null;
    if(tab) result.set(tab,[...(result.get(tab) ?? []),error]);
  }
  return result;
}
function editTabWarning(errors:ResultDiagnostic[]) {
  const reason=html(errors.map(diagnosticText).join("\n"));
  return errors.length ? `<span class="edit-tab-warning" role="img" aria-label="${reason}" title="${reason}">!</span>` : "";
}
function syncEditTabWarnings(p:Pattern,draft?:{rowId:number;values:Partial<Flag>}) {
  const diagnostics=editTabDiagnostics(patternDiagnostics(p,draft));
  document.querySelectorAll<HTMLElement>("#inspector [data-tab]").forEach(tab=>{
    const markup=editTabWarning(diagnostics.get(tab.dataset.tab as EditTab) ?? []),warning=tab.querySelector(".edit-tab-warning");
    if(warning) warning.outerHTML=markup;
    else if(markup) tab.insertAdjacentHTML("beforeend",markup);
  });
}
function eventCapacityFooter(p:Pattern,draft?:{rowId:number;values:Partial<Flag>}) {
  const capacity=patternEventCapacity(p,draft),invalid=capacity.invalidRowId!==null;
  return `<div class="edit-footer pattern-diagnostics ${invalid?"invalid":""}" data-pattern-diagnostics role="status"><strong>${html(t("diagnostics.eventUsage",{count:capacity.count,limit:capacity.limit}))}</strong>${invalid?`<p class="diagnostic-error">${html(t("diagnostics.eventCapacityExceeded"))}</p>`:""}</div>`;
}
function eventEditor(p:Pattern) {
  const groups=patternEventGroups(p),templates=eventTemplatePool(p);
  const options=[...new Map(templates.map(({group:{kind}})=>[kind,{value:kind,label:t(`event.kind.${kind}`)}])).values()];
  const bossOptions=eventBossOptions();
  const cards=groups.map(group=>{
    const current=group.kind==="unknown" ? "" : group.kind;
    const flagRows=group.flags.map(row=>`<div class="event-companion-row"><div class="event-companion-title">${html(row.rowId===group.trigger?.rowId ? t("event.schedule") : t("event.companion"))} · Row #${row.rowId}</div>
      ${field(p,"flag",row.rowId,"modifierSet",p.flags.find(source=>source.rowId===row.rowId)?.modifierSet ?? row.modifierSet,"Modifier Set")}
      ${field(p,"flag",row.rowId,"modifier",p.flags.find(source=>source.rowId===row.rowId)?.modifier ?? row.modifier,"Modifier")}
      ${field(p,"flag",row.rowId,"eventFlag",p.flags.find(source=>source.rowId===row.rowId)?.eventFlag ?? row.eventFlag,"Event Flag")}</div>`).join("");
    const unitRows=group.units.map(row=>`<div class="event-companion-row"><div class="event-companion-title">${html(unitName(row.unitId,row.variationId))} · Row #${row.rowId}</div>
      ${field(p,"spot",row.rowId,"unitId",p.placements.find(source=>source.rowId===row.rowId)?.unitId ?? row.unitId,"Unit ID")}
      ${field(p,"spot",row.rowId,"variationId",p.placements.find(source=>source.rowId===row.rowId)?.variationId ?? row.variationId,"Variation ID")}
      ${field(p,"spot",row.rowId,"modifier",p.placements.find(source=>source.rowId===row.rowId)?.modifier ?? row.modifier,"Modifier")}
      <div class="row-foot">Attach ID ${row.attachId} · Map Index ${row.mapIndex}</div></div>`).join("");
    const cardOptions=options.filter(option=>option.value===current || templates.some(template=>template.group.kind===option.value && viableEventTemplate(p,group.rowId,template)));
    if(current && !cardOptions.some(option=>option.value===current)) cardOptions.unshift({value:group.kind,label:t(`event.kind.${group.kind}`)});
    const schedule=["timed","night"].includes(eventTiming(group.kind)) ?
      `<div class="editor-field"><span id="event-schedule-${group.rowId}">${t("event.schedule")}</span><div class="event-schedule-toggle" role="group" aria-labelledby="event-schedule-${group.rowId}">${([1,2] as const).map(day=>{
        const unavailable=day!==group.day && !!planEventDayChange(effectiveEventPattern(p),group.rowId,day).error;
        return `<button type="button" data-event-day="${group.rowId}" value="${day}" aria-pressed="${day===group.day}" ${unavailable?"data-day-unavailable":""} ${state.busy || unavailable?"disabled":""}>${t(day===1?"event.day1":"event.day2")}</button>`;
      }).join("")}</div></div>` : "";
    const positionTemplates=usesMapEventLocations(group.kind) ? [] : templates.filter(template=>template.group.kind===group.kind &&
      (eventTiming(group.kind)==="start" || template.group.day===group.day) && viableEventTemplate(p,group.rowId,template));
    if(group.kind==="rise" && group.position!==null && !positionTemplates.some(template=>template.group.position===group.position))
      positionTemplates.unshift({pattern:effectiveEventPattern(p),group});
    // DLC attachments can represent the same map point. Show that point once,
    // retaining the current attachment when it is already selected.
    const positionChoices=new Map<number,number>();
    for(const template of [...positionTemplates].sort((a,b)=>Number(b.group.position===group.position)-Number(a.group.position===group.position))) {
      const position=template.group.position,point=template.group.units[0]?.locationIndex ?? position;
      if(position!==null && point!==null && !positionChoices.has(point)) positionChoices.set(point,position);
    }
    const positions=[...positionChoices.values()];
    const selectedFrenzy=frenzyEventPositions(effectiveEventPattern(p),group);
    const frenzyLocationOrder=[frenzyPositions[1],frenzyPositions[2],frenzyPositions[0],frenzyPositions[3]]; // North before South on both terrains.
    const frenzyLocations=[...new Set([...frenzyTerrainPositions(p.terrainId),...selectedFrenzy])]
      .sort((a,b)=>frenzyLocationOrder.indexOf(a)-frenzyLocationOrder.indexOf(b));
    const location=group.kind==="frenzy" ? `<div class="event-location-options"><span>${t("event.locations")}</span>${frenzyLocations.map(position=>
      `<label${eventPositionLocation("frenzy",position,templates) ? ` data-hover-location="${eventPositionLocation("frenzy",position,templates)!.index}"` : ""}><input type="checkbox" data-frenzy-position="${position}" data-frenzy-event="${group.rowId}" ${selectedFrenzy.includes(position)?"checked":""} ${state.busy?"disabled":""}>${html(eventPositionName("frenzy",position,templates))}</label>`).join("")}</div>` : group.position!==null && positions.length ? `<label class="editor-field"><span>${t("event.location")}</span>
      <select data-event-position="${group.rowId}" data-location-preview="location">${presetOptions(positions.map(position=>({value:String(position),label:eventPositionName(group.kind,position,templates),previewValue:eventPositionLocation(group.kind,position,templates)?.index})),String(group.position))}</select></label>` : "";
    const boss=group.kind==="extraBoss" && p.play ? (()=>{
      const idField=group.day===1 ? "extraBossId1" : "extraBossId2",modField=group.day===1 ? "extraBossModifier1" : "extraBossModifier2";
      const id=numeric(p,"play",p.play!.rowId,idField,p.play![idField]),modifier=numeric(p,"play",p.play!.rowId,modField,p.play![modField]);
      return `<label class="editor-field"><span>${t("event.extraBoss")}</span><select data-boss-preset="${idField}|${modField}">${presetOptions(bossOptions,`${id}|${modifier}`)}</select></label>`;
    })() : "";
    const rise=group.kind==="rise" && group.units[0] ? (()=>{
      const unit=group.units[0];
      return `<label class="editor-field"><span>${t("event.risePuzzle")}</span><select data-spot-preset="${unit.rowId}">${presetOptions(riseUnitOptions(),`${unit.unitId}|${unit.variationId}|${unit.modifier}`)}</select></label>`;
    })() : "";
    const issues=group.issues.length ? `<div class="event-issues" role="status">${group.issues.map(issue=>html(t(`event.issue.${issue}`))).join(" · ")}
      ${group.kind!=="unknown" ? `<button type="button" class="button secondary compact" data-repair-event="${group.rowId}">${t("event.repair")}</button>` : ""}</div>` : "";
    return `<div class="row-editor event-row-editor" data-event-row="${group.rowId}" tabindex="0"><div class="row-heading"><strong data-event-label="${group.rowId}">${html(eventGroupName(group.kind))}</strong>${removeRowButton("flag",group.rowId)}</div>
      <div class="event-row-count">${html(t("event.rows",{count:group.flags.length,units:group.units.length}))}</div>
      <label class="editor-field"><span>${t("event.type")}</span><select data-event-preset="${group.rowId}">${presetOptions(cardOptions,current)}</select></label>${schedule}
      ${usesMapEventLocations(group.kind) ? `<button type="button" class="button secondary compact" data-set-map-event-locations>${t("event.setLocations")}</button>` : ""}
      ${group.kind==="rise" || group.kind==="frenzy" ? `<p class="muted">${t(group.kind==="rise" ? "event.riseHelp" : "event.frenzyHelp")}</p>` : ""}${location}${rise}${boss}${issues}
      <details class="event-details" ${state.expandedEventCards.has(group.rowId)?"open":""}><summary>${t("event.advanced")}</summary>${flagRows}${unitRows || `<p class="muted">${t("event.noUnits")}</p>`}</details></div>`;
  }).join("");
  const addOptions=options.filter(option=>(option.value==="rise" || !groups.some(group=>group.kind===option.value)) &&
    templates.some(template=>template.group.kind===option.value && viableEventTemplate(p,null,template)));
  const add=`<div class="editor-row-actions"><label class="editor-field event-add-field"><span>${t("event.add")}</span><select data-add-event><option value="">${t("event.choose")}</option>${addOptions.map(option=>`<option value="${html(option.value)}">${html(option.label)}</option>`).join("")}</select></label></div>`;
  const timingHint=new Set(groups.filter(group=>group.trigger).map(group=>group.day)).size>1 ? `<p class="muted">${t("event.sharedTiming")}</p>` : "";
  return `<div class="editor-section"><h3>${t("ui.events")}</h3>${mapEventLocationEditor(p,groups,templates)}${cards || `<p class="muted">${t("ui.noEventRows")}</p>`}${timingHint}${add}</div>`;
}
function mapEventLocationChoices(p:Pattern,templates:EventTemplate[],rowId:number|null):EventUnitRow[] {
  const effective=effectiveEventPattern(p),current=effective.placements.find(unit=>unit.rowId===rowId && isMapEventUnit(unit.unitId));
  const available=availableTerrainLocations(p);
  const sources=[...(current ? [current] : []),...templates.filter(template=>usesMapEventLocations(template.group.kind)).flatMap(template=>template.group.units)];
  const choices=new Map<number,EventUnitRow>();
  for(const source of sources) {
    if(source.locationIndex===null || choices.has(source.locationIndex)) continue;
    if(source!==current && !available.has(source.locationIndex)) continue;
    const plan=planMapEventLocationChange(effective,rowId,source);
    if(!plan.error && p.placements.length-plan.units.remove.length+plan.units.add.length<=128) choices.set(source.locationIndex,source);
  }
  return [...choices.values()];
}
function mapEventLocationEditor(p:Pattern,groups:EventGroup[],templates:EventTemplate[]) {
  const events=groups.filter(group=>usesMapEventLocations(group.kind));
  if(!events.length) return "";
  const pool=effectiveEventPattern(p).placements.filter(unit=>isMapEventUnit(unit.unitId));
  const options=(units:EventUnitRow[])=>units.map(unit=>{
    const location=unit.locationIndex===null ? null : locationAt(unit.locationIndex);
    return {value:String(unit.attachId),label:location ? locationName(location) : `${t("event.location")} ${unit.attachId}`,previewValue:location?.index};
  });
  const rows=pool.map((unit,index)=>{
    const choices=mapEventLocationChoices(p,templates,unit.rowId);
    if(!choices.some(choice=>choice.attachId===unit.attachId)) choices.unshift(unit);
    const remove=pool.length>1 && !state.busy;
    return `<div class="map-event-location-row"><label class="editor-field"><span>${html(t("event.candidateLocation",{number:index+1}))}</span><select data-map-event-position="${unit.rowId}" data-location-preview="location">${presetOptions(options(choices),String(unit.attachId))}</select></label>
      <button type="button" class="row-remove" data-remove-map-event-location="${unit.rowId}" aria-label="${html(t("event.removeLocation"))}" title="${html(t(remove ? "event.removeLocation" : "event.keepLocation"))}" ${remove?"":"disabled"}><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 5 15 15M15 5 5 15"/></svg></button></div>`;
  }).join("");
  const additions=mapEventLocationChoices(p,templates,null);
  const add=`<label class="editor-field"><span>${t("event.addLocation")}</span><select data-add-map-event-location data-location-preview="location" ${!additions.length || state.busy ? "disabled" : ""}>${presetOptions([{value:"",label:t("event.chooseLocation")},...options(additions)],"")}</select></label>`;
  const count=new Set(pool.map(unit=>unit.locationIndex ?? `attach:${unit.attachId}`)).size;
  const warning=count<events.length ? `<div class="event-issues" role="status">${html(t("event.insufficientLocations",{events:events.length,locations:count,missing:events.length-count}))}</div>` : "";
  return `<div class="row-editor map-event-location-editor" data-map-event-locations tabindex="0"><div class="row-heading"><strong>${t("event.mapLocationsTitle")}</strong></div><p class="muted">${html(t("event.usedBy",{events:[...new Set(events.map(group=>t(`event.kind.${group.kind}`)))].join(" / ")}))}</p><p class="muted">${t("event.mapEventLocations")}</p>${warning}${rows}${add}</div>`;
}
function eventGroupName(kind:EventKind) {
  return t(`event.kind.${kind}`);
}
function eventPositionLocation(kind:EventKind,position:number,templates:EventTemplate[]):Location|null {
  if(kind==="rise" || usesMapEventLocations(kind)) {
    const unit=templates.find(template=>template.group.kind===kind && template.group.position===position)?.group.units[0] ??
      (kind==="rise" ? state.data?.patterns.flatMap(pattern=>effectiveEventPattern(pattern).placements).find(unit=>unit.unitId===4090 && unit.attachId===position) : undefined);
    const location=unit?.locationIndex===null || unit?.locationIndex===undefined ? null : locationAt(unit.locationIndex);
    return location ?? null;
  }
  return state.data?.locations.find(location=>location.eventFlag===position) ?? null;
}
function eventPositionName(kind:EventKind,position:number,templates:EventTemplate[]) {
  const location=eventPositionLocation(kind,position,templates);
  return location ? locationName(location) : String(position);
}
function riseUnitOptions() {
  const units=(state.templates?.patterns ?? state.data?.patterns ?? []).filter(p=>p.terrainId!==4)
    .flatMap(p=>p.placements ?? []).filter(unit=>unit.unitId===4090);
  const pairs=new Map(units.map(unit=>[`${unit.unitId}|${unit.variationId}|${unit.modifier}`,unit]));
  return [...pairs].sort((a,b)=>a[1].variationId-b[1].variationId).map(([value,unit])=>({value,label:unitName(unit.unitId,unit.variationId)}));
}
function eventBossOptions() {
  const pairs=new Map<string,{id:number;modifier:number}>();
  for(const other of state.templates?.patterns ?? state.data?.patterns ?? []) if(other.play) for(const [id,modifier] of [[other.play.extraBossId1,other.play.extraBossModifier1],[other.play.extraBossId2,other.play.extraBossModifier2]])
    if(id>=0) pairs.set(`${id}|${modifier}`,{id,modifier});
  return [...pairs.values()].sort((a,b)=>a.id-b.id).map(x=>({value:`${x.id}|${x.modifier}`,label:`${name("night_boss",x.id)} · ${x.id}/${x.modifier}`}));
}
function revealEventCard(rowId:number|null,focus=false,pointerY:number|null=null) {
  if(rowId===null) return;
  const p=currentPattern(),group=p && patternEventGroups(p).find(group=>group.rowId===rowId || group.flags.some(row=>row.rowId===rowId));
  const card=document.querySelector<HTMLElement>(`#inspector [data-event-row="${group?.rowId ?? rowId}"]`);
  revealEditorCard(card,focus,pointerY);
}
function revealEditorCard(card:HTMLElement|null,focus=false,pointerY:number|null=null) {
  const scroller=card?.closest<HTMLElement>(".editor-body");
  if(card && scroller && pointerY!==null && Number.isFinite(pointerY)) {
    const bounds=card.getBoundingClientRect();
    const top=scroller.scrollTop+bounds.top+bounds.height/2-pointerY;
    scroller.scrollTo({top:Math.max(0,Math.min(top,scroller.scrollHeight-scroller.clientHeight)),behavior:"smooth"});
  } else card?.scrollIntoView({block:"nearest"});
  if(focus) card?.focus({preventScroll:true});
}
function spawnEditor(p:Pattern) {
  const row=p.flags.find(f=>f.modifierSet===(p.terrainId===4?160:190));
  if(!row) return `<div class="inspector-empty"><div class="empty-icon">⌖</div><h3>${t("ui.noSpawnRow")}</h3><p>${t("help.noSpawnRows")}</p>${addRowButton("spawn")}</div>`;
  const ids=[...new Set(terrainPresetPatterns(p).flatMap(x=>x.flags.filter(f=>f.modifierSet===(p.terrainId===4?160:190)).map(f=>f.modifier)))].sort((a,b)=>a-b);
  return `<div class="editor-section"><h3>${t("ui.spawn")}</h3>${field(p,"flag",row.rowId,"modifier",row.modifier,t("ui.spawnId"),ids.map(id=>({value:id,label:`${name("spawn",id)} · ${id}`})),"spawn")}<div class="row-foot">modifierSet ${row.modifierSet} · Row #${row.rowId}</div></div>`;
}
function circleWarning(first:number,second:number) {
  return Number.isSafeInteger(first) && first===second ? `<div class="event-issues" role="status">${html(t("diagnostics.sameNightCircles"))}</div>` : "";
}
function circleEditor(p:Pattern) {
  if(!p.play) return `<div class="inspector-empty"><h3>${t("ui.noExistingRow")}</h3><p>${t("help.noPlayRow")}</p>${addRowButton("play")}</div>`;
  const options=(key:"playArea1"|"playArea2")=>[...new Set(terrainPresetPatterns(p).flatMap(x=>x.play ? [x.play[key]] : []))].sort((a,b)=>a-b).map(id=>({value:id,label:`${name("circle",id)} · ${id}`}));
  const warning=circleWarning(numeric(p,"play",p.play.rowId,"playArea1",p.play.playArea1),numeric(p,"play",p.play.rowId,"playArea2",p.play.playArea2));
  return `<div class="editor-section"><h3>${t("ui.nightCircles")}</h3><div data-circle-warning>${warning}</div>${field(p,"play",p.play.rowId,"playArea1",p.play.playArea1,t("ui.night1Circle"),options("playArea1"),"circle1")}${field(p,"play",p.play.rowId,"playArea2",p.play.playArea2,t("ui.night2Circle"),options("playArea2"),"circle2")}<div class="row-foot">LotResultPlayAreaParam · Row #${p.play.rowId}</div></div>`;
}
function bossEditor(p:Pattern) {
  if(!p.play) return `<div class="inspector-empty"><h3>${t("ui.noExistingRow")}</h3><p>${t("help.noPlayRow")}</p>${addRowButton("play")}</div>`;
  const pairs=new Map<string,{id:number;modifier:number}>();
  for(const other of state.data!.patterns) if(other.play && !state.additions.has(`play:${other.play.rowId}`)) for(const [id,modifier] of [[other.play.bossId1,other.play.bossModifier1],[other.play.bossId2,other.play.bossModifier2]]) pairs.set(`${id}|${modifier}`,{id,modifier});
  const options=[...pairs.values()].sort((a,b)=>a.id-b.id).map(x=>({value:`${x.id}|${x.modifier}`,label:`${x.id<0?t("ui.noExtraBoss"):name("night_boss",x.id)} · ${x.id}/${x.modifier}`}));
  const fields:[keyof Play,keyof Play,string][]=[
    ["bossId1","bossModifier1",t("ui.night1Boss")],["bossId2","bossModifier2",t("ui.night2Boss")]
  ];
  return `<div class="editor-section"><h3>${t("ui.nightBosses")}</h3><p class="muted">${t("help.bossCombinations")}</p>${fields.map(([idField,modField,label])=>{
    const current=`${numeric(p,"play",p.play!.rowId,idField,Number(p.play![idField]))}|${numeric(p,"play",p.play!.rowId,modField,Number(p.play![modField]))}`;
    return `<div class="row-editor"><div class="row-heading"><strong>${label}</strong></div><label class="editor-field"><span>${t("ui.knownCombinations")}</span><select data-boss-preset="${idField}|${modField}">${presetOptions(options,current)}</select></label>${field(p,"play",p.play!.rowId,idField,Number(p.play![idField]),"Boss ID")}${field(p,"play",p.play!.rowId,modField,Number(p.play![modField]),"Boss Modifier")}</div>`;}).join("")}</div>`;
}
function informationFieldName(field:MapInformationField) {
  const labels:Record<MapInformationField,string>={
    terrain:t("ui.terrain"),event:t("ui.events"),spawn:t("ui.spawn"),
    circle1:t("ui.night1Circle"),circle2:t("ui.night2Circle"),
    boss1:t("ui.night1Boss"),boss2:t("ui.night2Boss"),
    extraBoss1:t("ui.night1ExtraBoss"),extraBoss2:t("ui.night2ExtraBoss"),nightlord:t("ui.nightlord")
  };
  return labels[field];
}
function informationChoiceName(field:MapInformationField, value:string) {
  if(value==="none") return t(field==="event" ? "ui.noSpecialEvent" : field==="spawn" ? "ui.noSpawnRow" : "ui.noExistingRow");
  if(field==="terrain") return terrainName(Number(value));
  if(field==="event") {
    if(value.startsWith("event:")) {
      const kind=value.slice(6) as EventKind;
      return eventKinds.includes(kind) ? eventGroupName(kind) : value.slice(6);
    }
    const [set,flag]=value.split("|").map(Number);
    return name("special_event",set,flag);
  }
  if(field==="spawn") return name("spawn",Number(value));
  if(field==="nightlord") return name("nightlord",Number(value));
  if(field==="circle1" || field==="circle2") return name("circle",Number(value));
  return Number(value)<0 ? t("ui.noExtraBoss") : name("night_boss",Number(value));
}
function informationChoicesHtml(field:MapInformationField) {
  const criterion=mapCriterion(field);
  const catalog=(state.data?.patterns || []).map(pattern=>({pattern,values:informationValues(pattern,field)}));
  const values=field==="terrain" ? defaultTerrainNames.map((_,id)=>String(id)) : [...new Set(catalog.flatMap(item=>item.values))].sort((a,b)=>a.localeCompare(b,"en",{numeric:true}));
  const eligible=new Set(candidates(undefined,field).map(pattern=>pattern.id));
  const pool=catalog.filter(item=>eligible.has(item.pattern.id));
  return `<div class="map-information-options" data-map-field="${field}">${values.map(value=>{
    const label=informationChoiceName(field,value),keys=[value];
    const include=filterSelection(criterion,keys,"include"),exclude=filterSelection(criterion,keys,"exclude");
    const next={include:new Set(criterion?.include),exclude:new Set(criterion?.exclude)};
    next.include.add(value);next.exclude.delete(value);
    const count=pool.filter(item=>matchesUnitCriterion(item.values,next)).length;
    const attributes=(side:FilterSide)=>`data-map-choice="${field}" data-key="${html(value)}" data-side="${side}"`;
    const terrain=field==="terrain",viewing=terrain && state.terrain===Number(value);
    const eye=terrain ? `<button class="terrain-view ${viewing?"viewing":""}" data-view-terrain="${value}" aria-label="${html(t("filters.viewTerrain",{name:label}))}" aria-pressed="${viewing}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg></button>` : "";
    return `<article class="filter-tile map-information-choice ${terrain?"terrain-choice":""} ${include==="true"?"has-included":""} ${exclude==="true"?"has-excluded":""} ${viewing?"is-viewing":""} ${count===0?"is-empty":""}" data-render-key="map-choice:${field}:${html(value)}">
      <button class="filter-tile-main" ${attributes("include")} aria-label="${html(t("filters.includeOption",{name:label}))}" aria-pressed="${include}"><span class="map-information-label"><span class="filter-tile-name">${html(label)}</span><span class="filter-tile-count">${count}</span></span></button>
      <div class="filter-tile-actions">${filterChoiceButtonsHtml(label,criterion,keys,attributes)}</div>${eye}
    </article>`;
  }).join("")}</div>`;
}
function mapInformationHtml() {
  const tabs:{id:MapInformationTab;label:string;fields:MapInformationField[]}[]=[
    {id:"terrain",label:t("ui.terrain"),fields:["terrain"]},
    {id:"event",label:t("ui.events"),fields:["event"]},
    {id:"spawn",label:t("ui.spawn"),fields:["spawn"]},
    {id:"circle",label:t("ui.nightCircles"),fields:["circle1","circle2"]},
    {id:"boss",label:t("ui.nightBosses"),fields:["boss1","boss2"]},
    {id:"extraBoss",label:t("ui.extraNightBosses"),fields:["extraBoss1","extraBoss2"]},
    {id:"nightlord",label:t("ui.nightlord"),fields:["nightlord"]}
  ];
  const active=tabs.find(tab=>tab.id===state.mapInformationTab)!;
  return `<div class="map-information-tabs" role="tablist" aria-labelledby="map-information-title"><h2 class="eyebrow map-information-title" id="map-information-title">${t("headings.workspace")}</h2>${tabs.map(tab=>{
    const selected=tab.fields.reduce((count,field)=>{const criterion=mapCriterion(field);return count+(criterion?.include.size || 0)+(criterion?.exclude.size || 0);},0);
    const current=tab.id===active.id;
    return `<button type="button" class="map-information-tab ${current?"active":""}" id="map-information-tab-${tab.id}" data-map-tab="${tab.id}" role="tab" aria-selected="${current}" aria-controls="map-information-panel" tabindex="${current?0:-1}"><span>${html(tab.label)}</span><span class="map-information-selected ${selected?"":"is-empty"}" ${selected?"":"aria-hidden=\"true\""}>${selected}</span></button>`;
  }).join("")}</div><div class="map-information-panel" id="map-information-panel" role="tabpanel" aria-labelledby="map-information-tab-${active.id}" tabindex="0" data-scroll-key="map-information:${active.id}">${active.fields.map(field=>`${active.fields.length>1?`<h3>${html(informationFieldName(field))}</h3>`:""}${informationChoicesHtml(field)}`).join("")}</div>`;
}
function selectInformationTab(tab:MapInformationTab, focus=false) {
  const inspector=document.querySelector<HTMLElement>("#inspector")!;
  if(!inspector.querySelector(`[data-map-tab="${tab}"]`)) return;
  const panel=inspector.querySelector<HTMLElement>(".map-information-panel");
  if(panel) state.mapInformationScroll.set(state.mapInformationTab,panel.scrollTop);
  state.mapInformationTab=tab;
  renderInspector();
  const nextPanel=inspector.querySelector<HTMLElement>(".map-information-panel");
  if(nextPanel) nextPanel.scrollTop=state.mapInformationScroll.get(tab) ?? 0;
  renderMap();
  if(focus) inspector.querySelector<HTMLElement>(`[data-map-tab="${tab}"]`)?.focus({preventScroll:true});
}
const mapInformationBound=new WeakSet<Element>();
function bindMapInformation(inspector:HTMLElement) {
  if(mapInformationBound.has(inspector)) return;
  mapInformationBound.add(inspector);
  let markerPreviewFrame:number|null=null;
  const previewMarker=(event:PointerEvent)=>{
    if(state.mode!=="filter") return;
    const tile=(event.target as Element).closest(".map-information-choice");
    const field=tile?.querySelector<HTMLElement>(".filter-tile-main[data-map-choice]")?.dataset.mapChoice;
    if(!tile || (field!=="spawn" && field!=="circle1" && field!=="circle2") ||
      (event.relatedTarget instanceof Node && tile.contains(event.relatedTarget)) || markerPreviewFrame!==null) return;
    // Read the final hovered row after pointerout/pointerover have both settled.
    markerPreviewFrame=requestAnimationFrame(()=>{
      markerPreviewFrame=null;
      if(state.mode==="filter" && inspector.isConnected) renderMap();
    });
  };
  inspector.addEventListener("pointerover",previewMarker);
  inspector.addEventListener("pointerout",previewMarker);
  inspector.addEventListener("click",event=>{
    if(state.mode!=="filter") return;
    const target=event.target as Element;
    const tab=target.closest<HTMLElement>("[data-map-tab]");
    if(tab) {selectInformationTab(tab.dataset.mapTab as MapInformationTab);return;}
    const view=target.closest<HTMLElement>("[data-view-terrain]");
    if(view) {viewTerrain(Number(view.dataset.viewTerrain));return;}
    const choice=target.closest<HTMLElement>("[data-map-choice]");
    if(choice) toggleMapChoice(choice.dataset.mapChoice as MapInformationField,choice.dataset.key!,choice.dataset.side as FilterSide);
  });
  inspector.addEventListener("keydown",event=>{
    if(state.mode!=="filter") return;
    const target=(event.target as Element).closest<HTMLElement>("[data-map-tab]");
    if(!target) return;
    const tabs=Array.from(inspector.querySelectorAll<HTMLElement>("[data-map-tab]"));
    const index=tabs.indexOf(target);
    const next=event.key==="ArrowRight" ? (index+1)%tabs.length : event.key==="ArrowLeft" ? (index+tabs.length-1)%tabs.length
      : event.key==="Home" ? 0 : event.key==="End" ? tabs.length-1 : null;
    if(next===null) return;
    event.preventDefault();selectInformationTab(tabs[next].dataset.mapTab as MapInformationTab,true);
  });
  inspector.addEventListener("contextmenu",event=>{
    if(state.mode!=="filter") return;
    const tile=(event.target as Element).closest(".map-information-choice");
    const choice=tile?.querySelector<HTMLElement>(".filter-tile-main[data-map-choice]");
    if(!choice) return;
    event.preventDefault();
    toggleMapChoice(choice.dataset.mapChoice as MapInformationField,choice.dataset.key!,"exclude");
  });
}
function renderInspector() {
  disposeLocationPickers?.();disposeLocationPickers=null;
  preserveScroll(renderInspectorContent);
  syncBusyControls();
}
function renderInspectorContent() {
  const p=currentPattern();
  const inspector=document.querySelector<HTMLElement>("#inspector")!;
  inspector.dataset.scrollKey=`inspector:${p?.id ?? "none"}:${state.mode}`;
  inspector.classList.toggle("map-information-mode",!p || state.mode==="filter");
  if(!p || state.mode==="filter") {
    const content=document.createElement("template");content.innerHTML=mapInformationHtml();
    patchChildren(inspector,content.content);
    bindMapInformation(inspector);
    return;
  }
  if(state.mode==="preview") {
    const location=state.selectedLocation===null?null:locationAt(state.selectedLocation);
    const spots=location?p.placements.filter(s=>s.locationIndex===location.index&&visibleSpot(p,s)):[];
    inspector.innerHTML=`<div class="inspector-head"><span class="eyebrow">${t("headings.preview")}</span><div class="inspector-actions"><button id="exit-preview" class="button secondary">${t("ui.back")}</button>${patternIsModified(p.id)?`<button id="restore-pattern" class="button secondary" ${state.busy?"disabled":""}>${t("ui.restorePattern")}</button>`:""}<button id="edit-pattern" class="button primary">${t("ui.editPattern")}</button></div></div>${previewDiagnostics(p)}${previewSummary(p)}<div class="detail-section"><h3>${t("ui.mapUnits")} <span>${p.placements.filter(s=>visibleSpot(p,s)).length}</span></h3>${location?`<div class="selected-point"><small>${html(t("map.selectedLocation", { category: locationCategory(location) }))}</small><strong>${html(locationName(location))}</strong>${location.eventFlag!=null?`<p>${html(locationCategory(location))}</p>`:spots.length?spots.map(s=>{const id=numeric(p,"spot",s.rowId,"unitId",s.unitId),v=numeric(p,"spot",s.rowId,"variationId",s.variationId);return `<p>${html(unitName(id,v))} <code>${id}|${v}</code></p>`}).join(""):`<p>${t("ui.noVisibleUnits")}</p>`}</div>`:`<p class="muted">${t("help.inspectUnit")}</p>`}</div>`;
    document.querySelector("#exit-preview")!.addEventListener("click",()=>setMode("filter"));
    document.querySelector("#edit-pattern")!.addEventListener("click",()=>{setMode("edit");if(state.tab==="event") revealEventCard(state.selectedFlag);});
    document.querySelector("#restore-pattern")?.addEventListener("click",restorePattern);
    return;
  }
  const tabs:[EditTab,string][]=[["spot",t("ui.mapUnits")],["event",t("ui.events")],["spawn",t("ui.spawn")],["circle",t("ui.nightCircles")],["boss",t("ui.nightBosses")]];
  const tabDiagnostics=editTabDiagnostics(patternDiagnostics(p));
  inspector.innerHTML=`<div class="inspector-head"><div><span class="eyebrow">${t("headings.editor")}</span><h2>Pattern #${p.id}</h2></div><div class="inspector-actions"><button id="cancel-edit" class="button secondary compact">${t("ui.cancel")}</button><button id="exit-edit" class="button secondary compact">${t("ui.done")}</button></div></div><div class="edit-tabs">${tabs.map(([id,label])=>`<button data-tab="${id}" class="${state.tab===id?"active":""}">${label}${editTabWarning(tabDiagnostics.get(id) ?? [])}</button>`).join("")}</div><div class="editor-body" data-scroll-key="editor:${p.id}:${state.tab}:${state.tab==="spot"?state.selectedLocation:""}">${state.tab==="spot"?spotEditor(p):state.tab==="event"?eventEditor(p):state.tab==="spawn"?spawnEditor(p):state.tab==="circle"?circleEditor(p):bossEditor(p)}</div>${state.tab==="event"?eventCapacityFooter(p):""}`;
  document.querySelector("#exit-edit")!.addEventListener("click",()=>setMode("preview"));
  document.querySelector("#cancel-edit")!.addEventListener("click",cancelEdit);
  inspector.querySelectorAll<HTMLButtonElement>("[data-add-row]").forEach(button=>button.addEventListener("click",event=>{
    const kind=button.dataset.addRow as "spot"|"event"|"spawn"|"play",previousFlag=state.selectedFlag;
    addRow(kind);
    if(kind==="event" && state.selectedFlag!==previousFlag) revealEventCard(state.selectedFlag,true,event.detail ? event.clientY : null);
  }));
  inspector.querySelectorAll<HTMLElement>("[data-event-row]").forEach(card=>card.addEventListener("focusin",()=>{
    if(!state.busy) state.selectedFlag=Number(card.dataset.eventRow);
  }));
  inspector.querySelectorAll<HTMLDetailsElement>(".event-details").forEach(details=>details.addEventListener("toggle",()=>{
    const rowId=Number(details.closest<HTMLElement>("[data-event-row]")?.dataset.eventRow);
    if(details.open) state.expandedEventCards.add(rowId);else state.expandedEventCards.delete(rowId);
  }));
  inspector.querySelectorAll<HTMLButtonElement>("[data-remove-unit]").forEach(button=>button.addEventListener("click",()=>removeUnitRow(Number(button.dataset.removeUnit))));
  inspector.querySelectorAll<HTMLButtonElement>("[data-remove-event]").forEach(button=>button.addEventListener("click",()=>removeEventRow(Number(button.dataset.removeEvent))));
  inspector.querySelectorAll<HTMLElement>("[data-tab]").forEach(el=>el.addEventListener("click",()=>{state.tab=el.dataset.tab as EditTab;renderInspector();}));
  inspector.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-edit-field]").forEach(el=>el.addEventListener("change",()=>{
    const v=Number(el.value); if(!Number.isSafeInteger(v)) {state.message=message("errors.invalidInteger");renderStatus();return;}
    if(state.tab==="event" && el.dataset.editTable==="flag" && !state.busy) state.selectedFlag=Number(el.dataset.editRow);
    setPatch(p,el.dataset.editTable as Patch["table"],Number(el.dataset.editRow),el.dataset.editField!,Number(el.dataset.original),v);
  }));
  if(state.tab==="circle") {
    const first=inspector.querySelector<HTMLInputElement>('input[data-edit-field="playArea1"]');
    const second=inspector.querySelector<HTMLInputElement>('input[data-edit-field="playArea2"]');
    const warning=inspector.querySelector<HTMLElement>("[data-circle-warning]");
    if(first && second && warning) for(const input of [first,second]) input.addEventListener("input",()=>{
      warning.innerHTML=circleWarning(first.valueAsNumber,second.valueAsNumber);
    });
  }
  disposeLocationPickers=bindLocationPickers(inspector,(field,value)=>{
    const previous=state.editorMarkerPreview;
    if(field===previous?.field && value===previous.value || field===null && previous===null) return;
    state.editorMarkerPreview=field===null ? null : {field,value:value!};
    renderMap();
  });
  if(state.tab==="event") inspector.querySelectorAll<HTMLInputElement>('input[data-edit-table="flag"]').forEach(input=>input.addEventListener("input",()=>{
    const rowId=Number(input.dataset.editRow),row=p.flags.find(row=>row.rowId===rowId);
    if(!row) return;
    const fields=Array.from(inspector.querySelectorAll<HTMLInputElement>(`input[data-edit-table="flag"][data-edit-row="${rowId}"]`));
    const values=Object.fromEntries(fields.map(field=>[field.dataset.editField!,Number(field.value)]));
    const valid=fields.every(field=>field.value!=="" && Number.isSafeInteger(Number(field.value)));
    const draft=valid ? {rowId,values} : undefined;
    const diagnostics=inspector.querySelector<HTMLElement>("[data-pattern-diagnostics]");
    if(diagnostics) diagnostics.outerHTML=eventCapacityFooter(p,draft);
    syncEditTabWarnings(p,draft);
  }));
  inspector.querySelectorAll<HTMLSelectElement>("[data-spot-preset]").forEach(el=>el.addEventListener("change",()=>{
    if(!el.value) return; const row=p.placements.find(s=>s.rowId===Number(el.dataset.spotPreset))!;
    const [unit,variation,modifier]=el.value.split("|").map(Number);
    setPatchBatch(p,[["spot",row.rowId,"unitId",row.unitId,unit],["spot",row.rowId,"variationId",row.variationId,variation],["spot",row.rowId,"modifier",row.modifier,modifier]]);
  }));
  inspector.querySelectorAll<HTMLSelectElement>("[data-event-preset]").forEach(preset=>preset.addEventListener("change",()=>{
    if(preset.value) chooseEventKind(Number(preset.dataset.eventPreset),preset.value as EventKind);
  }));
  inspector.querySelectorAll<HTMLButtonElement>("[data-event-day]").forEach(button=>button.addEventListener("click",()=>{
    if(button.disabled || button.getAttribute("aria-pressed")==="true") return;
    if(button.value==="1" || button.value==="2") changeEventDay(Number(button.dataset.eventDay),Number(button.value) as 1|2);
  }));
  inspector.querySelectorAll<HTMLSelectElement>("[data-event-position]").forEach(select=>select.addEventListener("change",()=>{
    const rowId=Number(select.dataset.eventPosition),group=patternEventGroups(p).find(group=>group.rowId===rowId);
    if(group) changeEventBundle(rowId,group.kind,group.day,Number(select.value));
  }));
  inspector.querySelectorAll<HTMLSelectElement>("[data-map-event-position]").forEach(select=>select.addEventListener("change",()=>{
    if(select.value!=="") changeMapEventLocation(Number(select.dataset.mapEventPosition),Number(select.value));
  }));
  inspector.querySelectorAll<HTMLButtonElement>("[data-set-map-event-locations]").forEach(button=>button.addEventListener("click",event=>{
    const card=inspector.querySelector<HTMLElement>("[data-map-event-locations]");
    revealEditorCard(card,true,event.detail ? event.clientY : null);
  }));
  inspector.querySelector<HTMLSelectElement>("[data-add-map-event-location]")?.addEventListener("change",event=>{
    const select=event.currentTarget as HTMLSelectElement;
    if(select.value!=="") changeMapEventLocation(null,Number(select.value));
  });
  inspector.querySelectorAll<HTMLButtonElement>("[data-remove-map-event-location]").forEach(button=>button.addEventListener("click",()=>{
    changeMapEventLocation(Number(button.dataset.removeMapEventLocation),null);
  }));
  inspector.querySelectorAll<HTMLInputElement>("[data-frenzy-position]").forEach(input=>input.addEventListener("change",()=>{
    toggleFrenzyLocation(Number(input.dataset.frenzyEvent),Number(input.dataset.frenzyPosition),input.checked);
  }));
  inspector.querySelectorAll<HTMLSelectElement>("[data-add-event]").forEach(select=>select.addEventListener("change",event=>{
    if(select.value) chooseEventKind(null,select.value as EventKind,(event as CustomEvent<PickerChangeDetail>).detail?.pointerY ?? null);
  }));
  inspector.querySelectorAll<HTMLButtonElement>("[data-repair-event]").forEach(button=>button.addEventListener("click",()=>{
    const rowId=Number(button.dataset.repairEvent),group=patternEventGroups(p).find(group=>group.rowId===rowId);
    if(group) changeEventBundle(rowId,group.kind,group.day,group.position);
  }));
  inspector.querySelectorAll<HTMLSelectElement>("[data-boss-preset]").forEach(el=>el.addEventListener("change",()=>{
    if(!el.value || !p.play) return; const [idField,modField]=el.dataset.bossPreset!.split("|") as [keyof Play,keyof Play];
    const [id,modifier]=el.value.split("|").map(Number);
    setPatchBatch(p,[["play",p.play.rowId,idField,Number(p.play[idField]),id],["play",p.play.rowId,modField,Number(p.play[modField]),modifier]]);
  }));
}
function setPatchBatch(p:Pattern, changes:[Patch["table"],number,string,number,number][]) {
  if(state.busy) return;
  if(changes.some(change=>!Number.isSafeInteger(change[4]))) {state.message=message("errors.invalidInteger");renderStatus();return;}
  const before=new Map(state.patches);
  for(const [table,row,field,original,next] of changes) {
    const id=patchKey(table,row,field);
    if(next===original) state.patches.delete(id);
    else state.patches.set(id,{patternId:p.id,table,rowId:row,field,oldValue:original,newValue:next});
  }
  if(changes.some(change=>change[0]==="spot")) {
    const locations=new Set<number>();
    for(const row of p.placements ?? []) {
      if(row.locationIndex===null || !visibleSpot(p,row)) continue;
      if(locations.has(row.locationIndex)) {
        state.patches=before;
        state.message=message("errors.locationUnitExists",{patternId:p.id,location:row.locationIndex});
        renderAll();return;
      }
      locations.add(row.locationIndex);
    }
    if(!normalizeMapIndices(p)) state.patches=before;
  }
  renderAll();
}
function renderAll() {
  if(!state.data) return;
  state.editorMarkerPreview=null;
  preserveScroll(()=>{renderStatus();renderFilterPanel();renderResultPanel();renderMap();renderInspector();});
}
async function importFile() {
  if(state.busy) return;
  if(pendingChangeCount() && !await confirm(t("confirm.importRegulation"),{title:t("ui.importRegulationBin")})) return;
  const path=await open({multiple:false,directory:false,filters:[{name:"regulation.bin",extensions:["bin"]}]});
  if(!path || Array.isArray(path) || state.busy) return;
  await loadData(path);
}
async function loadDefaultFile() {
  if(state.busy) return;
  if(pendingChangeCount() && !await confirm(t("confirm.loadDefaultRegulation"),{title:t("ui.bundledRegulationBin")})) return;
  if(state.busy) return;
  await loadData(null);
}
async function saveFile() {
  if(!state.data || state.busy) return;
  const invalid=datasetDiagnostics()[0];
  if(invalid) {state.message=message("errors.save",{error:errorMessage(invalid.errors[0])});renderStatus();return;}
  const previousMessage=state.message;
  state.busy=true;state.message=message("status.regulationSaving");renderStatus();
  try {
    const path=await save({defaultPath:state.data?.sourcePath || "regulation.bin",filters:[{name:"regulation.bin",extensions:["bin"]}]});
    if(!path) {state.message=previousMessage;return;}
    const result=await invoke<string>("save_changes",{input:state.data?.sourcePath||null,output:path,patches:[...state.patches.values()],additions:[...state.additions.values()],removals:[...state.removals.values()].map(({patternId,table,rowId})=>({patternId,table,rowId})),restorations:[...state.restorations]});
    await loadData(result,false);
    state.message=message("status.saved", { path: result }); renderStatus();
  } catch(error) {state.message=message("errors.save", { error: errorMessage(error) });renderStatus();}
  finally {state.busy=false;renderStatus();}
}
async function loadData(path:string|null,reset=true) {
  state.busy=true;
  if(reset) state.message=message("status.loadingData");
  renderStatus();
  try {
    const [data,iconConfig]=await Promise.all([
      invoke<Dataset>("load_dataset",{path}),
      reset ? invoke<IconConfig>("load_icon_config") : Promise.resolve(state.iconConfig)
    ]);
    if(!state.templates) {
      const templates=path===null ? data : await invoke<Dataset>("load_dataset",{path:null});
      state.templates={...templates,patterns:templates.patterns.map(p=>({...p,placements:[...p.placements],flags:[...p.flags]}))};
      state.builtinRecords=snapshotPatternRows(state.templates);
    }
    state.data=data;
    state.originalRecords=snapshotPatternRows();
    state.iconConfig=iconConfig;
    if(reset || !state.terrainLocations.size) state.terrainLocations=buildTerrainLocations(state.templates);
    refreshDataset();
    if(!state.iconUnits.some(x=>x.id===state.iconSelectedId)) state.iconSelectedId=state.iconUnits[0]?.id ?? null;
    state.patches.clear();state.additions.clear();state.removals.clear();state.restorations.clear();
    if(reset){state.criteria.clear();state.mapCriteria.clear();state.mapInformationTab="terrain";state.mapInformationScroll.clear();state.mode="filter";state.terrain=0;state.selectedPattern=null;state.selectedLocation=null;state.bubble=null;state.nightlord.include.clear();state.nightlord.exclude.clear();resetView();}
    if(state.mode==="edit") captureEditSnapshot(); else clearEditSnapshot();
    const diagnostics=datasetDiagnostics();
    state.message=diagnostics.length ? message("status.dataLoadedWithIssues",{count:diagnostics.length,patternIds:diagnostics.map(item=>item.pattern.id).join(", ")}) : message("status.dataLoaded", { patterns: data.patterns.length });
    renderAll();
  } catch(error) {
    if(!reset) throw error;
    state.message=message("errors.loadData", { error: errorMessage(error) });renderStatus();
  }
  finally {if(reset) {state.busy=false;renderStatus();}}
}
renderShell();
loadData(null);
if(import.meta.env.DEV) reloadIconResources(true);

