import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
const parsed=ts.createSourceFile("main.ts",source,ts.ScriptTarget.ES2022,true);
const shell=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text==="renderShell");
let handler;
const visit=node=>{
  if(ts.isCallExpression(node) && node.expression.getText(parsed)==="openFile.addEventListener" &&
    node.arguments[0]?.text==="focusout") handler=node.arguments[1];
  ts.forEachChild(node,visit);
};
visit(shell);
assert.ok(handler,"Missing Open menu focus handler");
const compiled=ts.transpileModule(`const focusOut=${handler.getText(parsed)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function menu() {
  class Node {}
  const trigger=new Node(),builtin=new Node(),imported=new Node(),outside=new Node();
  let hidden=false;
  const openFile={contains:node=>[trigger,builtin,imported].includes(node)};
  // WebView/Chromium temporarily focuses the document body between blur and
  // focus. Microtasks can execute in that interval, before the target's click.
  const document={activeElement:new Node()};
  const focusOut=new Function("openFile","closeOpenFileMenu","Node","document",`${compiled}\nreturn focusOut;`)(
    openFile,()=>{hidden=true;},Node,document);
  return {focusOut,trigger,builtin,imported,outside,isOpen:()=>!hidden};
}

test("pointer focus on either Open option keeps the menu visible until its click",async()=>{
  for(const option of ["builtin","imported"]) {
    const current=menu();
    current.focusOut({relatedTarget:current[option]});
    await Promise.resolve();
    assert.equal(current.isOpen(),true,`${option} remains available for the click`);
  }
});

test("returning focus to the Open trigger does not dismiss the menu",async()=>{
  const current=menu();current.focusOut({relatedTarget:current.trigger});
  await Promise.resolve();assert.equal(current.isOpen(),true);
});

test("tabbing outside or losing window focus dismisses the Open menu",async()=>{
  for(const target of ["outside",null]) {
    const current=menu();current.focusOut({relatedTarget:target===null ? null : current[target]});
    await Promise.resolve();assert.equal(current.isOpen(),false);
  }
});
