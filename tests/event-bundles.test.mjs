import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/event-bundles.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {eventGroups,eventTemplates,planEventChange,planEventDayChange,planMapEventLocationChange,eventTiming,planFrenzyLocations,frenzyEventPositions}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const flag=(rowId,modifierSet,modifier,eventFlag)=>({rowId,modifierSet,modifier,eventFlag});
const unit=(rowId,unitId,attachId=500,locationIndex=null)=>({rowId,locationIndex,attachId,unitId,variationId:0,modifier:0,mapIndex:0,visible:locationIndex!==null});
const pattern=(id,terrainId,flags,placements=[],play=null)=>({id,terrainId,flags,placements,play});
const horde=()=>pattern(0,0,[flag(0,190,705,0),flag(1,0,180,0),flag(8,3030,801,7724)],
  [unit(100,4600),unit(101,4601)]);
const morgott=()=>pattern(43,0,[flag(496,0,604,8075),flag(504,3040,800,7705),flag(505,3100,220,0)]);
const meteor=()=>pattern(11,0,[flag(110,0,200,0),flag(111,3010,800,7701)],[unit(112,2080,109,21)]);
const mausoleum=()=>pattern(128,0,[flag(1280,0,210,0),flag(1281,3020,801,7722)],[unit(1282,2030,103,16)]);
const extra=()=>pattern(46,0,[flag(460,0,120,0),flag(461,3000,800,7700)],[],
  {rowId:46,extraBossId1:4770,extraBossModifier1:800,extraBossId2:-1,extraBossModifier2:0});

test("a day-two horde switched to Morgott replaces its selector and removes its units",()=>{
  const original=horde(),target=eventTemplates([morgott()],0)[0],group=eventGroups(original)[0];
  assert.equal(group.kind,"horde");
  const plan=planEventChange(original,group.rowId,target);
  assert.equal(plan.error,undefined);
  assert.deepEqual(plan.flags.update.map(row=>[row.rowId,row.modifierSet,row.modifier,row.eventFlag]),
    [[8,3040,800,7705],[1,0,604,8075]]);
  assert.deepEqual(plan.flags.add.map(row=>[row.modifierSet,row.modifier,row.eventFlag]),[[3100,220,0]]);
  assert.deepEqual(plan.units.remove,[100,101]);
});

test("repairing the user's partially edited Pattern 0 consumes the stale horde companion",()=>{
  const imported=horde();Object.assign(imported.flags.find(row=>row.rowId===8),{modifierSet:3040,modifier:800,eventFlag:7705});
  const groups=eventGroups(imported);
  assert.deepEqual(groups.map(group=>group.kind),["morgott","horde"]);
  assert.deepEqual(groups[0].issues,["selector"]);
  const plan=planEventChange(imported,8,eventTemplates([morgott()],0)[0]);
  assert.deepEqual(plan.flags.update.map(row=>[row.rowId,row.modifier,row.eventFlag]),[[1,604,8075]]);
  assert.deepEqual(plan.units.remove,[100,101]);
});

test("shared selectors remain until the last schedule is deleted",()=>{
  const p=pattern(15,0,[flag(150,0,200,0),flag(151,3010,800,7701),flag(152,3010,801,7721)]);
  const groups=eventGroups(p);
  assert.equal(groups.length,2);
  const first=planEventChange(p,151,null);
  assert.deepEqual(first.flags.remove,[151]);
  const second=planEventChange(p,152,null);
  assert.deepEqual(second.flags.remove,[152]);
  const last=planEventChange({...p,flags:p.flags.filter(row=>row.rowId!==151)},152,null);
  assert.deepEqual(last.flags.remove,[152,150]);
});

test("frenzy schedule, selector and position form one card",()=>{
  const p=pattern(83,0,[flag(830,0,140,0),flag(831,3080,801,7727),flag(832,3500,0,1044360220)]);
  const groups=eventGroups(p);
  assert.equal(groups.length,1);assert.equal(groups[0].kind,"frenzy");
  assert.deepEqual(groups[0].flags.map(row=>row.rowId),[831,830,832]);
  assert.deepEqual(planEventChange(p,831,null).flags.remove,[831,830,832]);
});

test("both Frenzy towers and imported day schedules share one card without duplicate errors",()=>{
  const p=pattern(83,0,[flag(830,0,140,0),flag(831,3080,801,7727),flag(832,3500,0,1044360220),
    flag(833,3080,800,7707),flag(834,3500,0,1044380230)]);
  const groups=eventGroups(p);
  assert.equal(groups.length,1);assert.deepEqual(groups[0].issues,[]);
  assert.deepEqual(frenzyEventPositions(p,groups[0]),[1044360220,1044380230]);
  assert.deepEqual(planFrenzyLocations(p,831,[1044380230]).flags.remove,[832]);
  assert.deepEqual(new Set(planFrenzyLocations(p,831,[]).flags.remove),new Set([830,831,832,833,834]));
});

test("adding the northern Frenzy tower adds only its position and retains the shared schedule",()=>{
  const p=pattern(83,0,[flag(830,0,140,0),flag(831,3080,801,7727),flag(832,3500,0,1044360220)]);
  const plan=planFrenzyLocations(p,831,[1044360220,1044380230]);
  assert.equal(plan.error,undefined);assert.equal(plan.flags.update.length,0);assert.deepEqual(plan.flags.remove,[]);
  assert.deepEqual(plan.flags.add.map(row=>[row.modifierSet,row.modifier,row.eventFlag]),[[3500,0,1044380230]]);
  assert.equal(planFrenzyLocations(p,831,[1038400230]).error,"location");
});

test("removing a Hollow combined position row retains a selector for the remaining tower",()=>{
  const p=pattern(410,4,[flag(4100,530,801,7727),flag(4101,0,140,1038400230),flag(4102,1000,0,1046400230)]);
  const plan=planFrenzyLocations(p,4100,[1046400230]);
  assert.deepEqual(plan.flags.remove,[4101]);
  assert.deepEqual(plan.flags.add.map(row=>[row.modifierSet,row.modifier,row.eventFlag]),[[0,140,0]]);
  const updated={...p,flags:[...p.flags.filter(row=>!plan.flags.remove.includes(row.rowId)),...plan.flags.add.map(row=>({...row,rowId:4103}))]};
  assert.deepEqual(eventGroups(updated)[0].issues,[]);
});

test("repairing a dual-tower card preserves both positions and its imported dates",()=>{
  const p=pattern(83,0,[flag(830,0,140,0),flag(831,3080,801,7727),flag(832,3500,0,1044360220),
    flag(833,3080,800,7707),flag(834,3500,0,1044380230)]);
  const original=pattern(84,0,[flag(840,0,140,0),flag(841,3080,800,7707),flag(842,3500,0,1044360220)]);
  const plan=planEventChange(p,831,eventTemplates([original],0)[0]);
  assert.deepEqual(plan.flags,{update:[],add:[],remove:[]});
});

test("unit-only Ancient Rises need no schedule and remain separate at distinct attachments",()=>{
  const p=pattern(0,0,[],[unit(8,4090,300,27),unit(9,4090,301,29)]);
  const groups=eventGroups(p);
  assert.equal(groups.length,2);assert.ok(groups.every(group=>group.issues.length===0 && group.flags.length===0));
  assert.deepEqual(groups.map(group=>group.rowId),[-11,-12]);
  assert.deepEqual(planEventChange(p,-11,null).units.remove,[8]);
  assert.deepEqual(planEventChange(p,-11,null).flags.remove,[]);
});

test("Ancient Rise locations include unused ordinary-tower points and placement adds no date flags",()=>{
  const rise=pattern(90,0,[flag(900,0,230,0),flag(901,3090,800,7706)],[{...unit(902,4090,307,32),variationId:8}]);
  const normal=pattern(0,0,[],[unit(8,4100,300,27)]);
  const templates=eventTemplates([rise,normal],0).filter(template=>template.group.kind==="rise");
  assert.deepEqual(new Set(templates.map(template=>template.group.position)),new Set([307,300]));
  const plan=planEventChange(normal,null,templates.find(template=>template.group.position===300));
  assert.deepEqual(plan.flags,{update:[],add:[],remove:[]});
  assert.deepEqual(plan.units.update.map(row=>[row.rowId,row.unitId,row.attachId]),[[8,4090,300]]);
  assert.equal(eventTemplates([rise,normal],4).length,0);
});

test("moving a directly placed Rise preserves its puzzles and uses the target tower attachment",()=>{
  const p=pattern(0,0,[],[{...unit(8,4090,300,27),variationId:7},unit(9,4341,351,29)]);
  const normal=pattern(1,0,[],[unit(10,4100,301,29)]);
  const target=eventTemplates([p,normal],0).find(template=>template.group.position===301);
  const plan=planEventChange(p,-11,target);
  assert.deepEqual(plan.flags,{update:[],add:[],remove:[]});assert.deepEqual(plan.units.remove,[8]);
  assert.deepEqual(plan.units.update.map(row=>[row.rowId,row.unitId,row.attachId,row.variationId]),[[9,4090,301,7]]);
});

test("extra Boss data follows its trigger when the event changes",()=>{
  const old=meteor(),target=eventTemplates([extra()],0)[0];
  const added=planEventChange(old,111,target);
  assert.equal(added.play.extraBossId1,4770);
  assert.equal(added.play.extraBossModifier1,800);
  assert.deepEqual(added.flags.update.map(row=>row.eventFlag),[7700,0]);
  const removed=planEventChange(extra(),461,null);
  assert.deepEqual(removed.play,{extraBossId1:-1,extraBossModifier1:0});
});

test("Hollow set 530 is classified by its schedule, and surface templates stay separate",()=>{
  const hollow=pattern(410,4,[flag(4100,530,800,7700)],[],{rowId:410,extraBossId1:4780,extraBossModifier1:800,extraBossId2:-1,extraBossModifier2:0});
  assert.equal(eventGroups(hollow)[0].kind,"extraBoss");
  const frenzy=pattern(411,4,[flag(4110,0,140,0),flag(4111,530,801,7727),flag(4112,1000,0,1046400230)]);
  assert.equal(eventGroups(frenzy)[0].kind,"frenzy");
  assert.ok(eventTemplates([hollow,frenzy,morgott()],4).every(x=>x.pattern.terrainId===4));
});

test("forest blessings stay in their terrain and cannot be stacked",()=>{
  const forest=pattern(300,3,[flag(3000,500,0,1046300590)]);
  const template=eventTemplates([forest],3)[0];
  assert.equal(template.group.kind,"blessing");
  assert.equal(eventTemplates([forest],0).length,0);
  assert.equal(planEventChange(forest,null,template).error,"conflict");
});

test("different invasion types conflict even on different days",()=>{
  const caligo=pattern(340,0,[flag(3400,0,10000,8080),flag(3401,3110,801,7725)],[unit(3402,5305)]);
  const template=eventTemplates([caligo],0)[0];
  assert.equal(planEventChange(morgott(),null,template).error,"conflict");
  assert.equal(planEventChange(morgott(),504,template).error,undefined,"Replacing the invasion is supported");
});

test("a second day does not provide an independent repeat of the same event",()=>{
  const second=morgott();Object.assign(second.flags[1],{modifier:801,eventFlag:7725});
  assert.equal(planEventChange(morgott(),null,eventTemplates([second],0)[0]).error,"conflict");
  const duplicate=morgott();duplicate.flags.push(flag(506,3040,801,7725));
  assert.ok(eventGroups(duplicate).every(group=>group.issues.includes("duplicate")));
  assert.deepEqual(planEventChange(duplicate,506,null).flags.remove,[506],"Imported duplicate schedules can still be removed");
});

test("location events are present at the start while timed events and night encounters keep their timing",()=>{
  for(const kind of ["mausoleum","rise","frenzy","blessing"]) assert.equal(eventTiming(kind),"start");
  for(const kind of ["morgott","caligo","meteor","horde"]) assert.equal(eventTiming(kind),"timed");
  assert.equal(eventTiming("extraBoss"),"night");
});

test("meteor and mausoleum cards include the Map Event packages that supply their locations",()=>{
  for(const p of [meteor(),mausoleum()]) {
    const group=eventGroups(p)[0];
    assert.equal(group.units.length,1);assert.equal(group.position,p.placements[0].attachId);
    assert.equal(group.issues.length,0);
    assert.deepEqual(planEventChange(p,group.rowId,null).units.remove,[p.placements[0].rowId]);
    assert.deepEqual(eventGroups({...p,placements:[]})[0].issues,["units"]);
  }
});

test("changing a location moves the package instead of merely changing the schedule",()=>{
  const original=meteor(),another=meteor();another.id=16;
  another.placements=[unit(160,2100,110,23)];
  const plan=planEventChange(original,111,eventTemplates([another],0)[0]);
  assert.deepEqual(plan.units.remove,[112]);
  assert.deepEqual(plan.units.add.map(row=>[row.unitId,row.attachId]),[[2100,110]]);
  assert.equal(plan.flags.update.length,0);
});

test("event locations can replace a camp but preserve other kinds of occupied units",()=>{
  const target=eventTemplates([meteor()],0)[0];
  const p=pattern(0,0,[],[unit(50,3410,109,21)]);
  const plan=planEventChange(p,null,target);
  assert.deepEqual(plan.units.update.map(row=>[row.rowId,row.unitId]),[[50,2080]]);
  assert.equal(plan.units.add.length,0);
  assert.equal(planEventChange({...p,placements:[unit(50,4090,109,21)]},null,target).error,"location");
});

test("adding a second map event adds a location to the shared pool",()=>{
  const p=meteor(),maus=eventTemplates([mausoleum()],0)[0];
  const add=planEventChange(p,null,maus);
  assert.equal(add.error,undefined);
  assert.deepEqual(add.units,{update:[],add:mausoleum().placements,remove:[]});
  const both={...p,flags:[...p.flags,...add.flags.add],placements:[...p.placements,...add.units.add]};
  assert.ok(eventGroups(both).every(group=>group.units.length===2 && group.units[0].rowId===112));
  assert.deepEqual(planEventChange(both,111,null).units.remove,[]);
  const other=meteor();other.placements=[unit(160,2100,110,23)];
  assert.equal(planEventChange(both,111,eventTemplates([other],0)[0]).error,"location");
});

test("the first map event adds exactly one candidate even when its template has several",()=>{
  const source=meteor();source.placements.push(unit(160,2100,110,23));
  const p=pattern(0,0,[]),plan=planEventChange(p,null,eventTemplates([source],0)[0]);
  assert.equal(plan.error,undefined);assert.deepEqual(plan.units.add,[source.placements[0]]);
  assert.deepEqual(p.placements,[]);
});

test("adding a map event reuses sufficient prepared locations without needing another source",()=>{
  const p=meteor();p.placements.push(unit(160,2100,110,23));
  const template=eventTemplates([mausoleum()],0)[0];
  const plan=planEventChange(p,null,template,[]);
  assert.equal(plan.error,undefined);assert.deepEqual(plan.units,{update:[],add:[],remove:[]});
  assert.equal(plan.flags.add.length,2);
  const prepared={...p,flags:[],placements:[p.placements[0]]};
  const first=planEventChange(prepared,null,template,[]);
  assert.equal(first.error,undefined);assert.deepEqual(first.units,{update:[],add:[],remove:[]});
});

test("adding a map event fills only the missing candidates and counts distinct points",()=>{
  const p=meteor();p.placements=[];
  const template=eventTemplates([mausoleum()],0)[0];
  const sources=[...mausoleum().placements,...meteor().placements,unit(160,2100,110,23)];
  const plan=planEventChange(p,null,template,sources);
  assert.equal(plan.error,undefined);assert.equal(plan.units.add.length,2);
  const duplicate=meteor();duplicate.placements.push({...duplicate.placements[0],rowId:113});
  const repair=planEventChange(duplicate,null,template,sources);
  assert.equal(repair.error,undefined);assert.equal(repair.units.add.length,1);
});

test("new map events skip used points and protected units and can replace a camp",()=>{
  const p=meteor();p.placements.push(unit(50,4090,110,23),unit(51,3410,115,24));
  const source=mausoleum();source.placements=[{...p.placements[0],rowId:1282}];
  const target=eventTemplates([source],0)[0],candidate=unit(170,2090,115,24);
  const plan=planEventChange(p,null,target,[...source.placements,unit(160,2100,110,23),candidate]);
  assert.equal(plan.error,undefined);
  assert.deepEqual(plan.units.update,[{...candidate,rowId:51}]);
  assert.deepEqual(plan.units.add,[]);assert.deepEqual(plan.units.remove,[]);
  const unavailable=planEventChange(p,null,target);
  assert.equal(unavailable.error,"location");
  assert.deepEqual(unavailable.flags,{update:[],add:[],remove:[]});
});

test("shared pool edits move or add candidates without touching either event controller",()=>{
  const p=meteor();p.flags.push(...mausoleum().flags);
  const source=unit(160,2100,110,23),plan=planMapEventLocationChange(p,112,source);
  assert.equal(plan.error,undefined);assert.deepEqual(plan.flags,{update:[],add:[],remove:[]});
  assert.deepEqual(plan.units.remove,[112]);assert.deepEqual(plan.units.add,[source]);assert.deepEqual(plan.play,{});
  const moved={...p,placements:[{...source,rowId:113}]};
  assert.ok(eventGroups(moved).every(group=>group.units[0].attachId===110 && !group.issues.length));
  const add=planMapEventLocationChange(moved,null,p.placements[0]);
  assert.equal(add.error,undefined);assert.deepEqual(add.units.remove,[]);
  const multiple={...moved,placements:[...moved.placements,...add.units.add]};
  assert.ok(eventGroups(multiple).every(group=>group.units.length===2 && group.position===null));
  assert.deepEqual(planMapEventLocationChange(multiple,113,null).units.remove,[113]);
});

test("shared pool guards the last candidate, occupied points and duplicate attachments",()=>{
  const p=meteor();p.flags.push(...mausoleum().flags);
  assert.equal(planMapEventLocationChange(p,112,null).error,"location");
  assert.equal(planMapEventLocationChange(p,null,p.placements[0]).error,"location");
  assert.deepEqual(planMapEventLocationChange(p,112,{...p.placements[0],modifier:999}).units,{update:[],add:[],remove:[]});
  const source=unit(160,2100,110,23);
  assert.equal(planMapEventLocationChange({...p,placements:[...p.placements,unit(50,4090,110,23)]},112,source).error,"location");
  const camp=unit(50,3410,115,23),replace=planMapEventLocationChange({...p,placements:[...p.placements,camp]},112,source);
  assert.deepEqual(replace.units.update.map(row=>[row.rowId,row.unitId,row.attachId]),[[50,2100,110]]);
  assert.deepEqual(replace.units.remove,[112]);
});

test("changing an event date preserves a shared multi-location pool and custom companions",()=>{
  const p=meteor();p.flags.push(...mausoleum().flags);p.placements.push(unit(160,2100,110,23));
  p.placements[0].variationId=3;p.placements[0].modifier=777;
  const plan=planEventDayChange(p,111,2);
  assert.equal(plan.error,undefined);assert.deepEqual(plan.units,{update:[],add:[],remove:[]});
  assert.deepEqual(plan.flags,{update:[flag(111,3010,801,7721)],add:[],remove:[]});assert.deepEqual(plan.play,{});
  assert.equal(planEventDayChange(p,1281,1).error,"template","Start events have no day switch");
});

test("extra Boss date changes move edited Boss settings to the matching night",()=>{
  const p=extra();p.play.extraBossId1=9999;p.play.extraBossModifier1=123;
  const plan=planEventDayChange(p,461,2);
  assert.equal(plan.error,undefined);
  assert.deepEqual(plan.play,{extraBossId1:-1,extraBossModifier1:0,extraBossId2:9999,extraBossModifier2:123});
  assert.deepEqual(plan.flags.update,[flag(461,3000,801,7720)]);
  const duplicate={...p,flags:[...p.flags,flag(462,3000,801,7720)]};
  assert.equal(planEventDayChange(duplicate,461,2).error,"conflict");
});

test("special terrains omit swallowed event locations but reuse surviving surface packages",()=>{
  const valid=meteor(),swallowed=meteor();swallowed.id=16;swallowed.placements=[unit(160,2100,110,23)];
  const rise=pattern(90,0,[],[unit(902,4090,307,32)]);
  const terrain=pattern(180,1,[],[unit(1800,3410,109,21),unit(1801,4100,300,27)]);
  const templates=eventTemplates([valid,swallowed,rise,terrain],1);
  assert.deepEqual(templates.filter(t=>t.group.kind==="meteor").map(t=>t.group.position),[109]);
  assert.deepEqual(templates.filter(t=>t.group.kind==="rise").map(t=>t.group.position),[300]);
  assert.equal(planEventChange(terrain,null,templates.find(t=>t.group.kind==="rise")).error,undefined);
});

test("Great Hollow Rise templates use its four tower frames and no surface attachments or date flags",()=>{
  const rise=pattern(90,0,[],[{...unit(902,4090,307,32),variationId:8}]);
  const hollow=pattern(1000,4,[],[unit(10001,5110,1150,83),unit(10002,5110,1151,84),unit(10003,5110,1152,85),unit(10004,5110,1153,86)]);
  const templates=eventTemplates([rise,hollow],4).filter(t=>t.group.kind==="rise");
  assert.deepEqual(templates.map(t=>t.group.position),[1150,1151,1152,1153]);
  assert.ok(templates.every(t=>t.pattern.terrainId===4 && t.group.trigger===null && t.group.flags.length===0));
  const p={...hollow,placements:[unit(10001,5115,1150,83)]},plan=planEventChange(p,null,templates[0]);
  assert.equal(plan.error,undefined);assert.deepEqual(plan.flags,{update:[],add:[],remove:[]});
  assert.deepEqual(plan.units.update.map(u=>[u.rowId,u.unitId,u.attachId,u.variationId]),[[10001,4090,1150,8]]);
  for(const unitId of [5100,5105]) {
    const base={...p,placements:[{...p.placements[0],unitId,visible:unitId!==5105}]};
    const replace=planEventChange(base,null,templates[0]);assert.equal(replace.error,undefined);
    assert.equal(replace.units.add.length,0);assert.equal(replace.units.update[0].unitId,4090);
  }
});

test("Frenzy terrain replacements block new missing towers while imported flags can be removed",()=>{
  const p=pattern(109,2,[flag(1090,0,140,0),flag(1091,3080,800,7707),flag(1092,3500,0,1044360220)]);
  assert.equal(planFrenzyLocations(p,1091,[1044360220,1044380230]).error,"location");
  const forest={...p,terrainId:3};
  assert.equal(planFrenzyLocations(forest,1091,[1044380230]).error,undefined);
  assert.deepEqual(planFrenzyLocations(forest,1091,[1044380230]).flags.remove,[1092]);
});
