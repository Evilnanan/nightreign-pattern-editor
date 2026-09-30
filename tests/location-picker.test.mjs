import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/location-picker.ts",import.meta.url),"utf8");
const parsed=ts.createSourceFile("location-picker.ts",source,ts.ScriptTarget.ES2022,true);
const declaration=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text==="commitPickerOption");
const compiled=ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

const selection=(onChange,click)=>{
  const option={dataset:{positionValue:"rise"}},trigger={id:"add-event"};
  const document={body:{},activeElement:option,getElementById:id=>{
    assert.equal(id,trigger.id);
    return {focus:()=>{document.activeElement=trigger;}};
  }};
  const select={value:"",dispatchEvent:event=>{
    assert.equal(event.type,"change");assert.equal(event.bubbles,true);
    onChange(document,event);
  }};
  const commit=new Function("document",`${compiled}\nreturn commitPickerOption;`)(document);
  commit(select,option,trigger,click);
  assert.equal(select.value,"rise");
  return {document,trigger};
};

test("choosing Rise or Frenzy preserves the newly added card's focus",()=>{
  for(const kind of ["rise","frenzy"]) {
    const card={kind};
    const {document}=selection(document=>{document.activeElement=card;});
    assert.equal(document.activeElement,card);
  }
});

test("ordinary dropdown changes return focus to the trigger",()=>{
  const {document,trigger}=selection(()=>{});
  assert.equal(document.activeElement,trigger);
});

test("dropdown changes that replace the editor restore focus when no new target was focused",()=>{
  const {document,trigger}=selection(document=>{document.activeElement=document.body;});
  assert.equal(document.activeElement,trigger);
});

test("pointer selection forwards the click height while keyboard selection has no pointer target",()=>{
  selection((document,event)=>assert.equal(event.detail.pointerY,480),{detail:1,clientY:480});
  selection((document,event)=>assert.equal(event.detail.pointerY,null),{detail:0,clientY:0});
  selection((document,event)=>assert.equal(event.detail.pointerY,null));
});
