import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/event-capacity.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {eventCapacity}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const occupied=count=>Array.from({length:count},(_,index)=>({rowId:index+1,modifier:800,eventFlag:7700}));
const empty=rowId=>({rowId,modifierSet:3500,modifier:0,eventFlag:0});

test("event slots include spawn records and count either nonzero field once",()=>{
  assert.deepEqual(eventCapacity([
    {rowId:1,modifierSet:190,modifier:700,eventFlag:0},
    {rowId:2,modifierSet:3500,modifier:0,eventFlag:1044360220},
    {rowId:3,modifierSet:500,modifier:801,eventFlag:7727},empty(4)
  ]),{count:3,limit:20,invalidRowId:null});
});

test("19 occupied slots accept any number of empty rows, and exactly 20 accept a final occupied row",()=>{
  assert.equal(eventCapacity([...occupied(19),...Array.from({length:35},(_,index)=>empty(20+index))]).invalidRowId,null);
  assert.equal(eventCapacity([...occupied(19),empty(30),occupied(20).at(-1)]).invalidRowId,null);
  assert.deepEqual(eventCapacity(occupied(20)),{count:20,limit:20,invalidRowId:null});
  assert.deepEqual(eventCapacity([]),{count:0,limit:20,invalidRowId:null});
});

test("an empty row after the twentieth occupied slot fails at that row",()=>{
  assert.deepEqual(eventCapacity([...occupied(20),empty(45)]),{count:20,limit:20,invalidRowId:45});
});

test("overflow reports the first failing row and the total occupied count",()=>{
  assert.deepEqual(eventCapacity(occupied(22)),{count:22,limit:20,invalidRowId:21});
  assert.deepEqual(eventCapacity([...occupied(20),empty(45),...occupied(2)]),{count:22,limit:20,invalidRowId:45});
});
