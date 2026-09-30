type Flag = { rowId:number; modifierSet:number; modifier:number; eventFlag:number };
type Pattern = { terrainId:number; flags:Flag[] };
type Location = { scope:string; eventFlag?:number|null };
type ReadValue<P> = (pattern:P, table:"flag", row:number, field:string, original:number)=>number;

// The event enables a tower; a separate flag chooses its position. Both must
// match, including unsaved edits, before the map can display that position.
export function frenzyTowerPositionRow<P extends Pattern>(
  pattern:P, location:Location,
  read:ReadValue<P>=(_pattern,_table,_row,_field,original)=>original
):Flag|undefined {
  if(location.eventFlag==null || location.scope!==(pattern.terrainId===4 ? "Great Hollow" : "Surface")) return;
  const value=(flag:Flag,field:"modifierSet"|"modifier"|"eventFlag")=>read(pattern,"flag",flag.rowId,field,flag[field]);
  const enabled=pattern.flags.some(flag=>[7707,7727].includes(value(flag,"eventFlag")));
  if(!enabled) return;
  return pattern.flags.find(flag=>value(flag,"eventFlag")===location.eventFlag &&
    (pattern.terrainId===4
      ? value(flag,"modifierSet")===1000 || value(flag,"modifierSet")===0 && value(flag,"modifier")===140
      : value(flag,"modifierSet")===3500));
}
