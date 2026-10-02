import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/location-picker.ts",import.meta.url),"utf8");
const parsed=ts.createSourceFile("location-picker.ts",source,ts.ScriptTarget.ES2022,true);
const declaration=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text==="commitPickerOption");
const compiled=ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const searchDeclarations=parsed.statements.filter(node=>ts.isFunctionDeclaration(node) && ["normalizePickerSearch","pickerOptionMatches"].includes(node.name?.text));
const searchCompiled=ts.transpileModule(searchDeclarations.map(node=>node.getText(parsed)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {pickerOptionMatches}=await import(`data:text/javascript;base64,${Buffer.from(searchCompiled).toString("base64")}`);

test("dropdown search matches fuzzy names and IDs without case or accent sensitivity",()=>{
  assert.equal(pickerOptionMatches("ngld","Nightlord Gladius","4820"),true);
  assert.equal(pickerOptionMatches("ning","NÍNG","10"),true);
  assert.equal(pickerOptionMatches("宁福","宁姆韦福","11"),true);
  assert.equal(pickerOptionMatches("42","Gladius","4820"),true);
  assert.equal(pickerOptionMatches("福宁","宁姆韦福","11"),false);
});

test("all space-separated keywords must match the name or ID in any word order",()=>{
  assert.equal(pickerOptionMatches("  gld\t482\n ","Nightlord Gladius","4820"),true);
  assert.equal(pickerOptionMatches("482 NGL","Nightlord Gladius","4820"),true);
  assert.equal(pickerOptionMatches("宁姆　福","宁姆韦福","11"),true);
  assert.equal(pickerOptionMatches("Gladius 999","Nightlord Gladius","4820"),false);
});

test("empty dropdown searches restore all options, including placeholder values",()=>{
  assert.equal(pickerOptionMatches("","Choose event…",""),true);
  assert.equal(pickerOptionMatches(" \t ","Nightlord Gladius","4820"),true);
  assert.equal(pickerOptionMatches("ＨＯＬＬＯＷ","Great Hollow","4"),true);
  assert.equal(pickerOptionMatches("unknown","Choose event…",""),false);
});

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
