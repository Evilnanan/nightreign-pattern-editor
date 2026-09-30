import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/unit-filter.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {buildUnitFilterGroups,filterSelection,toggleFilterChoices,matchesUnitCriterion}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const criterion=()=>({include:new Set(),exclude:new Set()});

test("groups variants by type and deduplicates map counts within each group and unit",()=>{
  const patterns=[{id:1,units:["3400|0","3400|0","3410|0"]},{id:2,units:["3400|0"]},{id:3,units:["3000|0"]}];
  const types=new Map([["3400|0","Ruins"],["3410|0","Ruins"],["3000|0","Fort"]]);
  const groups=buildUnitFilterGroups(patterns,types,new Set([1,2,3]));
  const ruins=groups.find(group=>group.type==="Ruins");
  assert.equal(ruins.count,2);
  assert.deepEqual(ruins.options.map(option=>[option.key,option.count]),[["3400|0",2],["3410|0",1]]);
});

test("missing and blank types use Other, without colliding with a type literally named Other",()=>{
  const groups=buildUnitFilterGroups([{id:1,units:["1|0","2|0","3|0","4|0"]}],
    new Map([["2|0",null],["3|0","  "],["4|0","Other"]]),new Set([1]));
  assert.equal(groups.length,2);
  assert.equal(groups.at(-1).type,null);
  assert.deepEqual(groups.at(-1).options.map(option=>option.key),["1|0","2|0","3|0"]);
});

test("other filters change counts while all categories and their membership stay available",()=>{
  const patterns=[{id:1,units:["1|0"]},{id:2,units:["2|0"]}];
  const types=new Map([["1|0","Ruins"],["2|0","Fort"]]);
  const groups=buildUnitFilterGroups(patterns,types,new Set([1]));
  assert.deepEqual(groups.find(group=>group.type==="Fort").options,[{key:"2|0",type:"Fort",count:0}]);
  const empty=buildUnitFilterGroups(patterns,types,new Set());
  assert.equal(empty.length,2);
  assert.ok(empty.every(group=>group.count===0 && group.options.every(option=>option.count===0)));
});

test("whole-category inclusion is an OR and exclusion rejects every matching member",()=>{
  const choice=criterion();
  toggleFilterChoices(choice,["3400|0","3410|0"],"include");
  assert.equal(matchesUnitCriterion(["3400|0"],choice),true);
  assert.equal(matchesUnitCriterion(["3410|0"],choice),true);
  assert.equal(matchesUnitCriterion(["3000|0"],choice),false);
  toggleFilterChoices(choice,["3400|0","3410|0"],"exclude");
  assert.equal(choice.include.size,0);
  assert.equal(matchesUnitCriterion(["3400|0","3000|0"],choice),false);
  assert.equal(matchesUnitCriterion(["3000|0"],choice),true);
});

test("detail edits make a group mixed and a later group toggle completes or clears it",()=>{
  const choice=criterion(),keys=["3400|0","3410|0"];
  choice.include.add("3000|0");
  toggleFilterChoices(choice,keys,"include");
  toggleFilterChoices(choice,["3400|0"],"exclude");
  assert.equal(filterSelection(choice,keys,"include"),"mixed");
  assert.equal(filterSelection(choice,keys,"exclude"),"mixed");
  assert.equal(matchesUnitCriterion(keys,choice),false);
  toggleFilterChoices(choice,keys,"include");
  assert.equal(filterSelection(choice,keys,"include"),"true");
  assert.equal(filterSelection(choice,keys,"exclude"),"false");
  toggleFilterChoices(choice,keys,"include");
  assert.equal(filterSelection(choice,keys,"include"),"false");
  assert.deepEqual([...choice.include],["3000|0"]);
});

test("empty groups never show selected, and unknown untyped units remain filterable",()=>{
  const choice=criterion();
  assert.equal(filterSelection(choice,[],"include"),"false");
  const [other]=buildUnitFilterGroups([{id:1,units:["9999|2"]}],new Map(),new Set([1]));
  assert.equal(other.type,null);
  toggleFilterChoices(choice,other.options.map(option=>option.key),"include");
  assert.equal(matchesUnitCriterion(["9999|2"],choice),true);
});

test("counts preview adding to existing alternatives, instead of only counting that unit's appearances",()=>{
  const patterns=[{id:1,units:["1|0"]},{id:2,units:["2|0"]},{id:3,units:["3|0"]},{id:4,units:["1|0","2|0"]}];
  const types=new Map([["1|0","Ruins"],["2|0","Ruins"],["3|0","Fort"]]);
  const choice={include:new Set(["1|0"]),exclude:new Set(["2|0"])};
  const groups=buildUnitFilterGroups(patterns,types,new Set([1,2,3,4]),choice);
  const ruins=groups.find(group=>group.type==="Ruins");
  assert.equal(ruins.options.find(option=>option.key==="1|0").count,1);
  assert.equal(ruins.options.find(option=>option.key==="2|0").count,3);
  assert.equal(ruins.count,3);
  assert.equal(groups.find(group=>group.type==="Fort").count,2);
  assert.deepEqual([...choice.include],["1|0"]);
  assert.deepEqual([...choice.exclude],["2|0"]);
});

test("predicted counts still apply other map filters and zero candidates",()=>{
  const patterns=[{id:1,units:["1|0"]},{id:2,units:["2|0"]},{id:3,units:["3|0"]}];
  const types=new Map([["1|0","Ruins"],["2|0","Ruins"],["3|0","Fort"]]);
  const choice={include:new Set(["1|0"]),exclude:new Set()};
  const groups=buildUnitFilterGroups(patterns,types,new Set([1,3]),choice);
  assert.equal(groups.find(group=>group.type==="Ruins").options.find(option=>option.key==="2|0").count,1);
  assert.equal(groups.find(group=>group.type==="Fort").count,2);
  assert.ok(buildUnitFilterGroups(patterns,types,new Set(),choice).every(group=>group.count===0));
});

test("changing a selection updates previews without reordering categories or units under the pointer",()=>{
  const patterns=[{id:1,units:["1|0"]},{id:2,units:["1|0"]},{id:3,units:["2|0"]},{id:4,units:["3|0"]}];
  const types=new Map([["1|0","Ruins"],["2|0","Ruins"],["3|0","Fort"]]);
  const candidates=new Set([1,2,3,4]);
  const initial=buildUnitFilterGroups(patterns,types,candidates);
  const selected=buildUnitFilterGroups(patterns,types,candidates,{include:new Set(["1|0"]),exclude:new Set()});
  const order=groups=>groups.map(group=>[group.key,group.options.map(option=>option.key)]);
  assert.deepEqual(order(selected),order(initial));
  assert.equal(selected[0].options[0].count,2);
  assert.equal(selected[0].options[1].count,3);
});
