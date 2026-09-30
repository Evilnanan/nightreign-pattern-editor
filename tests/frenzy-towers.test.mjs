import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/frenzy-towers.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {frenzyTowerPositionRow}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const flag=(rowId,modifierSet,eventFlag,modifier=0)=>({rowId,modifierSet,eventFlag,modifier});
const south={scope:"Surface",eventFlag:1044360220},north={scope:"Surface",eventFlag:1044380230};
const hollowSouth={scope:"Great Hollow",eventFlag:1046400230},hollowNorth={scope:"Great Hollow",eventFlag:1038400230};

test("surface towers require the frenzy event and its independent position flag",()=>{
  const position=flag(2,3500,south.eventFlag);
  for(const eventFlag of [7707,7727]) {
    const p={terrainId:0,flags:[flag(1,3080,eventFlag),position]};
    assert.equal(frenzyTowerPositionRow(p,south),position);
    assert.equal(frenzyTowerPositionRow(p,north),undefined);
    assert.equal(frenzyTowerPositionRow(p,hollowSouth),undefined);
  }
  for(const flags of [[position],[flag(1,3080,7707)],[flag(1,3050,7725),position]]) {
    assert.equal(frenzyTowerPositionRow({terrainId:0,flags},south),undefined);
  }
});

test("Great Hollow supports both normal and combined event position rows",()=>{
  for(const set of [500,530]) for(const position of [flag(2,1000,hollowSouth.eventFlag),flag(2,0,hollowSouth.eventFlag,140)]) {
    const p={terrainId:4,flags:[flag(1,set,7727),position]};
    assert.equal(frenzyTowerPositionRow(p,hollowSouth),position);
    assert.equal(frenzyTowerPositionRow(p,hollowNorth),undefined);
    assert.equal(frenzyTowerPositionRow(p,south),undefined);
  }
  assert.equal(frenzyTowerPositionRow({terrainId:4,flags:[flag(1,530,7707),flag(2,0,hollowSouth.eventFlag,141)]},hollowSouth),undefined);
});

test("both independently enabled positions are visible under one controller",()=>{
  const p={terrainId:0,flags:[flag(1,3080,7727),flag(2,3500,south.eventFlag),flag(3,3500,north.eventFlag)]};
  assert.equal(frenzyTowerPositionRow(p,south),p.flags[1]);assert.equal(frenzyTowerPositionRow(p,north),p.flags[2]);
  p.flags.splice(1,1);
  assert.equal(frenzyTowerPositionRow(p,south),undefined);assert.equal(frenzyTowerPositionRow(p,north),p.flags[1]);
});

test("unsaved edits move the marker and disabling or replacing the event removes it",()=>{
  const p={terrainId:0,flags:[flag(1,3080,7727),flag(2,3500,south.eventFlag)]};
  const edits=new Map([["2:eventFlag",north.eventFlag]]);
  const read=(_p,_table,row,field,value)=>edits.get(`${row}:${field}`) ?? value;
  assert.equal(frenzyTowerPositionRow(p,south,read),undefined);
  assert.equal(frenzyTowerPositionRow(p,north,read),p.flags[1]);
  edits.set("1:eventFlag",7725);
  assert.equal(frenzyTowerPositionRow(p,north,read),undefined);
  edits.delete("1:eventFlag");
  edits.set("1:modifierSet",3050);
  assert.equal(frenzyTowerPositionRow(p,north,read),p.flags[1],"The runtime gate uses the flag, not its editor grouping set");
  edits.delete("1:modifierSet");
  edits.set("2:modifierSet",0);
  assert.equal(frenzyTowerPositionRow(p,north,read),undefined);
});
