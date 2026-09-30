export const mapInformationFields = ["terrain", "event", "spawn", "circle1", "circle2", "boss1", "boss2", "extraBoss1", "extraBoss2", "nightlord"] as const;
export type MapInformationField = typeof mapInformationFields[number];
type Flag = { rowId:number; modifierSet:number; modifier:number; eventFlag:number };
type Play = { rowId:number; playArea1:number; playArea2:number; bossId1:number; bossId2:number; extraBossId1:number; extraBossId2:number };
export type MapInformationPattern = { id:number; terrainId:number; nightlordId:number; flags:Flag[]; play:Play|null };
type ReadValue = (pattern:MapInformationPattern, table:"flag"|"play", row:number, field:string, original:number)=>number;
export type MapEvent = { rowId:number; modifierSet:number; modifier:number; eventFlag:number };
const originalValue:ReadValue = (_pattern,_table,_row,_field,original)=>original;

export function mapInformationEvents(pattern:MapInformationPattern, read:ReadValue=originalValue):MapEvent[] {
  return pattern.flags.map(flag=>({
    rowId:flag.rowId,
    modifierSet:read(pattern,"flag",flag.rowId,"modifierSet",flag.modifierSet),
    modifier:read(pattern,"flag",flag.rowId,"modifier",flag.modifier),
    eventFlag:read(pattern,"flag",flag.rowId,"eventFlag",flag.eventFlag)
  })).filter(flag=>
    ((flag.modifierSet>=3000 && flag.modifierSet<=3130) || (flag.modifierSet>=500 && flag.modifierSet<=560)) && flag.eventFlag>=7700 && flag.eventFlag<=7727
  );
}

// Each field is an independent facet. Multiple values in a facet are alternatives.
// Missing rows remain distinct from the valid "no extra Boss" value (-1).
export function mapInformationValues(
  pattern:MapInformationPattern, field:MapInformationField, read:ReadValue=originalValue,
  eventKey:(event:MapEvent)=>string=event=>`${event.modifierSet}|${event.eventFlag}`
):string[] {
  if(field==="terrain") return [String(pattern.terrainId)];
  if(field==="nightlord") return [String(pattern.nightlordId)];
  if(field==="event") {
    const events=mapInformationEvents(pattern,read);
    return events.length ? [...new Set(events.map(eventKey))] : ["none"];
  }
  if(field==="spawn") {
    const spawn=pattern.flags.find(flag=>read(pattern,"flag",flag.rowId,"modifierSet",flag.modifierSet)===(pattern.terrainId===4 ? 160 : 190));
    return spawn ? [String(read(pattern,"flag",spawn.rowId,"modifier",spawn.modifier))] : ["none"];
  }
  const play=pattern.play;
  if(!play) return ["none"];
  const playField={circle1:"playArea1",circle2:"playArea2",boss1:"bossId1",boss2:"bossId2",extraBoss1:"extraBossId1",extraBoss2:"extraBossId2"}[field] as Exclude<keyof Play,"rowId">;
  return [String(read(pattern,"play",play.rowId,playField,play[playField]))];
}
