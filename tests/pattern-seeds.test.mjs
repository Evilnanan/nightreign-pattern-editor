import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/pattern-seeds.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {firstSeedDraw,patternForSeed,patternNightlord,patternBlocks,isPatternReachable,findPatternSeed,formatPatternSeed}=
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const reference=JSON.parse(await readFile(new URL("./fixtures/seed-model.json",import.meta.url),"utf8"));

test("SFMT draws and both mode predictions match the compiled reference C++ model",()=>{
  for(const {seed,draw,normal,deep} of reference.vectors) {
    assert.equal(firstSeedDraw(seed),draw,`SFMT seed ${seed}`);
    for(let owner=0;owner<10;owner++) {
      assert.equal(patternForSeed(owner,false,seed),normal[owner],`Normal seed ${seed}, Nightlord ${owner}`);
      assert.equal(patternForSeed(owner,true,seed),deep[owner],`Deep seed ${seed}, Nightlord ${owner}`);
    }
  }
});

test("random-path search matches C++ including odd stride coercion and uint32 overflow",()=>{
  for(const {pattern,deep,seed} of reference.searches)
    assert.equal(findPatternSeed(pattern,deep,0xFFFFFFFF,0x80000000),seed,`Pattern ${pattern}, deep=${deep}`);
});

test("every reachable Pattern can generate a seed that predicts the same Pattern",()=>{
  const counts=[0,0];
  for(let pattern=0;pattern<1200;pattern++) {
    for(const deep of [false,true]) {
      if(!isPatternReachable(pattern,deep)) continue;
      const seed=findPatternSeed(pattern,deep,0xFFFFFFFF,0x80000000);
      assert.notEqual(seed,null,`Pattern ${pattern}, deep=${deep}`);
      assert.equal(patternForSeed(patternNightlord(pattern),deep,seed),pattern);
      counts[Number(deep)]++;
    }
  }
  assert.deepEqual(counts,[440,520]);
});

test("reroll excludes the displayed seed, including zero",()=>{
  assert.equal(findPatternSeed(16,false,0,1),0);
  const rerolled=findPatternSeed(16,false,0,1,0);
  assert.notEqual(rerolled,0);
  assert.equal(patternForSeed(0,false,rerolled),16);
});

test("unassigned Patterns and mode-exclusive DLC do not start a futile search",()=>{
  for(const pattern of [-1,320,999,1200,1.5,NaN]) {
    assert.equal(patternNightlord(pattern),null);
    assert.equal(findPatternSeed(pattern,true,0,1),null);
  }
  assert.equal(isPatternReachable(1042,false),false);
  assert.equal(isPatternReachable(1042,true),true);
  assert.equal(findPatternSeed(1042,false,0,1),null);
  assert.equal(patternForSeed(-1,true,0),null);
  assert.equal(patternForSeed(10,false,0),null);
  assert.equal(patternBlocks(8,false).reduce((sum,block)=>sum+block.weight,0),10000);
});

test("seed display preserves the reference tool's full uint32 hexadecimal format",()=>{
  assert.equal(formatPatternSeed(0),"0x00000000");
  assert.equal(formatPatternSeed(0x066BB95B),"0x066BB95B");
  assert.equal(formatPatternSeed(0x80000000),"0x80000000");
  assert.equal(formatPatternSeed(0xFFFFFFFF),"0xFFFFFFFF");
});
