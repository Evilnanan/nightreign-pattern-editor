import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(path) {
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const {mapInformationValues, mapInformationEvents}=await loadModule("../src/map-information.ts");
const {matchesUnitCriterion,toggleFilterChoices}=await loadModule("../src/unit-filter.ts");
const pattern=(overrides={})=>({id:0,terrainId:0,nightlordId:3,flags:[],play:{rowId:10,playArea1:1001,playArea2:1002,bossId1:4770,bossId2:4820,extraBossId1:-1,extraBossId2:4840},...overrides});

test("map information keeps both nights and regular/extra Bosses independent",()=>{
  const p=pattern();
  assert.deepEqual(mapInformationValues(p,"terrain"),["0"]);
  assert.deepEqual(mapInformationValues(p,"nightlord"),["3"]);
  for(const [field,value] of [["circle1","1001"],["circle2","1002"],["boss1","4770"],["boss2","4820"],["extraBoss1","-1"],["extraBoss2","4840"]]) {
    assert.deepEqual(mapInformationValues(p,field),[value]);
  }
  assert.deepEqual(mapInformationValues(pattern({play:null}),"extraBoss1"),["none"]);
});

test("spawn uses the correct terrain's result row and reads unsaved changes",()=>{
  const flags=[{rowId:1,modifierSet:190,modifier:705,eventFlag:0},{rowId:2,modifierSet:160,modifier:13001,eventFlag:0}];
  assert.deepEqual(mapInformationValues(pattern({flags}),"spawn"),["705"]);
  assert.deepEqual(mapInformationValues(pattern({flags,terrainId:4}),"spawn"),["13001"]);
  const read=(_p,_table,row,field,value)=>row===2 && field==="modifier" ? 13002 : value;
  assert.deepEqual(mapInformationValues(pattern({flags,terrainId:4}),"spawn",read),["13002"]);
  assert.deepEqual(mapInformationValues(pattern(),"spawn"),["none"]);
});

test("event filters include public event rows, skipping terrain blessings and auxiliary flags",()=>{
  const flags=[
    {rowId:1,modifierSet:3040,modifier:800,eventFlag:7705},
    {rowId:2,modifierSet:3100,modifier:220,eventFlag:0},
    {rowId:3,modifierSet:3500,modifier:0,eventFlag:1044360220},
    {rowId:4,modifierSet:500,modifier:0,eventFlag:1046300590},
    {rowId:5,modifierSet:190,modifier:700,eventFlag:0}
  ];
  assert.deepEqual(mapInformationEvents(pattern({flags})).map(event=>event.rowId),[1]);
  assert.deepEqual(mapInformationValues(pattern({flags}),"event"),["3040|7705"]);
  assert.deepEqual(mapInformationValues(pattern({terrainId:3,flags:[flags[3]]}),"event"),["none"]);
  assert.deepEqual(mapInformationValues(pattern({flags:flags.slice(1,3)}),"event"),["none"]);
});

test("equivalent event records merge into a single choice while retaining multi-event matches",()=>{
  const p=pattern({flags:[
    {rowId:1,modifierSet:3000,modifier:800,eventFlag:7700},
    {rowId:2,modifierSet:505,modifier:800,eventFlag:7700},
    {rowId:3,modifierSet:3030,modifier:801,eventFlag:7724}
  ]});
  const values=mapInformationValues(p,"event",undefined,event=>event.eventFlag===7700 ? "day1-extra-boss" : "day2-horde");
  assert.deepEqual(values,["day1-extra-boss","day2-horde"]);
  assert.equal(matchesUnitCriterion(values,{include:new Set(["day2-horde"]),exclude:new Set(["day1-extra-boss"])}),false);
});

test("map facets use the same OR, exclusion, side switching and repeat-to-clear rules as units",()=>{
  const terrain={include:new Set(),exclude:new Set()};
  toggleFilterChoices(terrain,["1"],"include");toggleFilterChoices(terrain,["3"],"include");
  assert.equal(matchesUnitCriterion(["1"],terrain),true);
  assert.equal(matchesUnitCriterion(["3"],terrain),true);
  assert.equal(matchesUnitCriterion(["0"],terrain),false);
  toggleFilterChoices(terrain,["1"],"exclude");
  assert.equal(matchesUnitCriterion(["1"],terrain),false);
  assert.equal(matchesUnitCriterion(["3"],terrain),true);
  assert.deepEqual([...terrain.include],["3"]);
  toggleFilterChoices(terrain,["1"],"exclude");
  assert.equal(terrain.exclude.size,0);
});

test("edited play and event values immediately participate in filtering",()=>{
  const p=pattern({flags:[{rowId:2,modifierSet:3000,modifier:800,eventFlag:7700}]});
  const read=(_p,table,row,field,value)=>table==="play" && row===10 && field==="extraBossId1" ? 4910
    : table==="flag" && row===2 && field==="eventFlag" ? 7720 : value;
  assert.deepEqual(mapInformationValues(p,"extraBoss1",read),["4910"]);
  assert.deepEqual(mapInformationValues(p,"event",read),["3000|7720"]);
});
