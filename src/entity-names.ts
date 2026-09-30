import { formatMessage, localizedName, message, t } from "./i18n";

export type EntityName = {kind:string;id:number;variation:number|null;type:string|null;name:string;nameZh:string|null};

const unitTypes = {
  camp:"Camp",church:"Church",difficultRise:"Difficult Sorcerer's Rise",fort:"Fort",
  greatChurch:"Great Church",mapEvent:"Map Event",marsh:"Marsh",northCastle:"North Castle",
  northUnderlevel:"North Underlevel",ruins:"Ruins",smallCamp:"Small Camp",rise:"Sorcerer's Rise",
  southCastle:"South Castle",southUnderlevel:"South Underlevel",township:"Township",village:"Village"
} as const;
export type UnitTypeId = keyof typeof unitTypes;
const legacyTypes = new Map<string,UnitTypeId>(Object.entries(unitTypes).map(([id,name])=>[name,id as UnitTypeId]));

// Accept legacy datasets at the boundary; display names never identify a type.
export function unitTypeId(value:string|null|undefined):string|null {
  return value ? legacyTypes.get(value) ?? value : null;
}
function typeMessage(type:string):`unitType.${UnitTypeId}`|null {
  return Object.hasOwn(unitTypes,type) ? `unitType.${type as UnitTypeId}` : null;
}
export function unitTypeName(value:string|null|undefined):string {
  const type=unitTypeId(value);
  const key=type && typeMessage(type);
  return key ? t(key) : value ?? "";
}
export function findEntityName(names:readonly EntityName[],kind:string,id:number,variation:number|null=null):EntityName|undefined {
  return names.find(named=>named.kind===kind && named.id===id && named.variation===variation);
}
export function entityName(named:EntityName,withType=false):string {
  const text=localizedName(named),type=withType ? unitTypeName(named.type) : "";
  return type ? `${type} - ${text}` : text;
}
export function entityLabel(names:readonly EntityName[],kind:string,id:number,variation:number|null=null,withType=false):string {
  const named=findEntityName(names,kind,id,variation);
  return named?.name ? entityName(named,withType) : variation===null ? String(id) : `${id}|${variation}`;
}
export function entitySearchText(named:EntityName):string {
  const type=unitTypeId(named.type),key=type && typeMessage(type);
  const types=key ? [formatMessage(message(key),"en"),formatMessage(message(key),"zh-CN")] : [named.type ?? ""];
  const names=[named.name,named.nameZh ?? ""];
  return [...types,...names,...types.flatMap(type=>names.map(name=>type ? `${type} - ${name}` : name))].join(" ").toLowerCase();
}
