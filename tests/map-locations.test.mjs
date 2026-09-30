import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const frenzySource=await readFile(new URL("../src/frenzy-towers.ts",import.meta.url),"utf8");
const {frenzyTowerPositionRow}=await import(`data:text/javascript;base64,${Buffer.from(compile(frenzySource)).toString("base64")}`);
const bundleSource=await readFile(new URL('../src/event-bundles.ts',import.meta.url),'utf8');
const {frenzyTerrainPositions}=await import('data:text/javascript;base64,'+Buffer.from(compile(bundleSource)).toString('base64'));
const mainSource=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
const parsed=ts.createSourceFile("main.ts",mainSource,ts.ScriptTarget.ES2022,true);
// Exercise the map's real selection functions without starting the desktop UI.
const functions=["buildTerrainLocations","currentPattern","mapLocations","mapUnderground"].map(name=>{
  const node=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text===name);
  assert.ok(node,`Missing ${name}`);
  return node.getText(parsed);
}).join("\n");
const layers=parsed.statements.find(node=>ts.isVariableStatement(node) &&
  node.declarationList.declarations.some(declaration=>declaration.name.getText(parsed)==="hollowLowerLocations")).getText(parsed);
const selectLocations=new Function("frenzyTowerPositionRow","frenzyTerrainPositions",compile(`
  ${layers}
  function selectLocations(data,terrain,mode="filter",selectedPattern=null,underground=false) {
    const state={data,terrain,mode,selectedPattern,underground,terrainLocations:buildTerrainLocations(data)};
    const directPointPresent=(pattern,location)=>frenzyTowerPositionRow(pattern,location)!==undefined;
    ${functions}
    return mapLocations();
  }
`) + "\nreturn selectLocations;")(frenzyTowerPositionRow,frenzyTerrainPositions);

const flag=(rowId,modifierSet,eventFlag)=>({rowId,modifierSet,eventFlag,modifier:0});
const tower=(index,scope,eventFlag)=>({index,scope,eventFlag,typeIndex:8});
const pattern=(id,terrainId,eventFlag)=>({id,terrainId,placements:[],flags:
  eventFlag ? [flag(1,terrainId===4 ? 500 : 3080,7727),flag(2,terrainId===4 ? 1000 : 3500,eventFlag)] : []});
const data={
  locations:[tower(118,"Surface",1044380230),tower(119,"Surface",1044360220),
    tower(120,"Great Hollow",1038400230),tower(121,"Great Hollow",1046400230),
    {index:10,scope:"Surface",typeIndex:0},{index:86,scope:"Great Hollow",typeIndex:19}],
  patterns:[pattern(83,0,1044360220),pattern(195,5,1044380230),
    pattern(1047,4,1038400230),pattern(1026,4,1046400230),pattern(42,0,null)]
};
data.patterns[0].placements.push({locationIndex:10,visible:true});
data.patterns[2].placements.push({locationIndex:86,visible:true});
const indices=(...args)=>selectLocations(data,...args).map(location=>location.index);

test("surface filtering shows North even when its only Pattern uses Noklateo",()=>{
  assert.deepEqual(indices(0),[118,119,10]);
  for(const terrain of [1,2]) assert.deepEqual(indices(terrain),[119]);
  assert.deepEqual(indices(3),[118]);assert.deepEqual(indices(5),[118,119]);
});

test("preview and edit show only the tower enabled by the selected Pattern",()=>{
  for(const mode of ["preview","edit"]) {
    assert.deepEqual(indices(0,mode,83),[119,10]);
    assert.deepEqual(indices(5,mode,195),[118]);
    assert.deepEqual(indices(0,mode,42),[10]);
  }
});

test("Great Hollow tower candidates stay on its upper layer",()=>{
  assert.deepEqual(indices(4),[120,121]);
  assert.deepEqual(indices(4,"preview",1047),[120]);
  assert.deepEqual(indices(4,"preview",1026),[121]);
  assert.deepEqual(indices(4,"filter",null,true),[86]);
  assert.deepEqual(indices(4,"preview",1047,true),[86]);
});
