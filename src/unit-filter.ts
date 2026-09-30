export type FilterCriterion = { include:Set<string>; exclude:Set<string> };
export type FilterSide = "include"|"exclude";
export type FilterSelection = "false"|"true"|"mixed";
export type UnitFilterOption = { key:string; type:string|null; count:number };
export type UnitFilterGroup = { key:string; type:string|null; options:UnitFilterOption[]; count:number };

export function buildUnitFilterGroups(
  patterns:Iterable<{ id:number; units:Iterable<string> }>,
  types:ReadonlyMap<string,string|null>,
  candidateIds:ReadonlySet<number>,
  criterion?:FilterCriterion
):UnitFilterGroup[] {
  const catalog=[...patterns].map(pattern=>({id:pattern.id,units:[...new Set(pattern.units)]}));
  const eligible=catalog.filter(pattern=>candidateIds.has(pattern.id));
  const groups=new Map<string,{type:string|null; options:Map<string,Set<number>>; patterns:Set<number>}>();
  // Keep membership independent of the other filters, including zero-count options.
  for(const pattern of catalog) for(const unit of pattern.units) {
    const type=types.get(unit)?.trim() || null;
    const groupKey=type===null ? "other" : `type:${type}`;
    let group=groups.get(groupKey);
    if(!group) {
      group={type,options:new Map(),patterns:new Set()};
      groups.set(groupKey,group);
    }
    let appearances=group.options.get(unit);
    if(!appearances) {appearances=new Set();group.options.set(unit,appearances);}
    if(candidateIds.has(pattern.id)) {appearances.add(pattern.id);group.patterns.add(pattern.id);}
  }
  const countAfterIncluding=(keys:readonly string[])=>{
    const next={include:new Set(criterion?.include),exclude:new Set(criterion?.exclude)};
    for(const key of keys) {next.include.add(key);next.exclude.delete(key);}
    return new Set(eligible.filter(pattern=>matchesUnitCriterion(pattern.units,next)).map(pattern=>pattern.id)).size;
  };
  return [...groups].map(([key,group])=>({
    key,type:group.type,count:countAfterIncluding([...group.options.keys()]),
    options:[...group.options.keys()].map(key=>({key,type:group.type,count:countAfterIncluding([key])}))
      // Selection previews change counts without moving tiles under the pointer.
      .sort((a,b)=>group.options.get(b.key)!.size-group.options.get(a.key)!.size || a.key.localeCompare(b.key))
  })).sort((a,b)=>Number(a.type===null)-Number(b.type===null) ||
    groups.get(b.key)!.patterns.size-groups.get(a.key)!.patterns.size || a.key.localeCompare(b.key));
}

export function filterSelection(criterion:FilterCriterion|undefined, keys:readonly string[], side:FilterSide):FilterSelection {
  const count=keys.filter(key=>criterion?.[side].has(key)).length;
  return count===0 ? "false" : count===keys.length ? "true" : "mixed";
}

export function toggleFilterChoices(criterion:FilterCriterion, keys:readonly string[], side:FilterSide) {
  const clear=filterSelection(criterion,keys,side)==="true";
  const other=criterion[side==="include" ? "exclude" : "include"];
  for(const key of keys) {
    if(clear) criterion[side].delete(key);
    else {criterion[side].add(key);other.delete(key);}
  }
}

export function matchesUnitCriterion(units:readonly string[], criterion:FilterCriterion) {
  return (!criterion.include.size || units.some(unit=>criterion.include.has(unit))) &&
    !units.some(unit=>criterion.exclude.has(unit));
}
