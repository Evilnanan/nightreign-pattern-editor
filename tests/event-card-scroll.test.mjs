import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
const parsed=ts.createSourceFile("main.ts",source,ts.ScriptTarget.ES2022,true);
const declarations=parsed.statements.filter(node=>ts.isFunctionDeclaration(node) && ["revealEventCard","revealEditorCard"].includes(node.name?.text));
const compiled=ts.transpileModule(declarations.map(node=>node.getText(parsed)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function reveal({scrollTop=200,scrollHeight=2000,clientHeight=500,cardTop=900,cardHeight=200,pointerY=500}={}) {
  const calls=[];
  const scroller={scrollTop,scrollHeight,clientHeight,scrollTo:options=>calls.push({scroll:options})};
  const card={closest:()=>scroller,getBoundingClientRect:()=>({top:cardTop,height:cardHeight}),
    scrollIntoView:options=>calls.push({reveal:options}),focus:options=>calls.push({focus:options})};
  const document={querySelector:selector=>{assert.equal(selector,'#inspector [data-event-row="42"]');return card;}};
  const run=new Function("document","currentPattern",`${compiled}\nreturn revealEventCard;`)(document,()=>null);
  run(42,true,pointerY);
  return calls;
}

test("new event card center scrolls to the pointer height and retains focus",()=>{
  assert.deepEqual(reveal(),[{scroll:{top:700,behavior:"smooth"}},{focus:{preventScroll:true}}]);
  // A taller card uses its actual center too.
  assert.equal(reveal({cardHeight:800})[0].scroll.top,1000);
});

test("event card alignment stops at either end of the scrollable list",()=>{
  assert.equal(reveal({scrollTop:0,cardTop:100})[0].scroll.top,0);
  assert.equal(reveal({scrollTop:1400,cardTop:1000})[0].scroll.top,1500);
  assert.equal(reveal({scrollHeight:400})[0].scroll.top,0);
});

test("keyboard additions and existing card navigation retain nearest visibility and focus",()=>{
  assert.deepEqual(reveal({pointerY:null}),[{reveal:{block:"nearest"}},{focus:{preventScroll:true}}]);
});
