import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
const capacitySource=await readFile(new URL("../src/event-capacity.ts",import.meta.url),"utf8");
const capacityCompiled=ts.transpileModule(capacitySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {eventCapacity}=await import(`data:text/javascript;base64,${Buffer.from(capacityCompiled).toString("base64")}`);
const bundleSource=await readFile(new URL("../src/event-bundles.ts",import.meta.url),"utf8");
const bundleCompiled=ts.transpileModule(bundleSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {eventGroups,eventTemplates,eventTerrainLocations,planEventChange,planEventDayChange,planMapEventLocationChange,usesMapEventLocations,isMapEventUnit,eventTiming,planFrenzyLocations,frenzyEventPositions,frenzyTerrainPositions}=await import(`data:text/javascript;base64,${Buffer.from(bundleCompiled).toString("base64")}`);
const parsed=ts.createSourceFile("main.ts",source,ts.ScriptTarget.ES2022,true);
const declaration=name=>{
  const node=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text===name ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(value=>value.name.getText(parsed)===name));
  assert.ok(node,`Missing ${name}`);
  return node.getText(parsed);
};
const declarations=["state","hollowLowerLocations","patchKey","currentPattern","numeric","setMode","cancelEdit","selectPattern",
  "resetView","setPatch","setPatchBatch","saveFile","loadDefaultFile","loadData","pendingChangeCount","patternMatchesRows","patternIsModified","restorePattern","refreshDataset","snapshotPatternRows","applyPatternRows","captureEditSnapshot","clearEditSnapshot",
  "addRow","removeUnitRow","removeEventRow","effectiveEventPattern","patternEventGroups","eventTemplatePool","terrainPresetPatterns","availableTerrainLocations","eventChangePlan","viableEventTemplate","nextEventRowId","applyEventPlan","changeEventBundle","chooseEventKind","changeEventDay","toggleFrenzyLocation","changeMapEventLocation","mapEventLocationChoices","normalizeMapIndices","locationAt","hiddenUnitIds","visibleSpot","eventRows",
  "resultTableWillBeRewritten","patternEventCapacity","patternDiagnostics","datasetDiagnostics"].map(declaration).join("\n");
const compiled=ts.transpileModule(`
  const emptyIconConfig=()=>({}),renderAll=()=>{},renderMap=()=>{},renderStatus=()=>{},revealEventCard=(rowId,focus,pointerY)=>hooks?.revealEventCard?.(rowId,focus,pointerY);
  const buildTerrainLocations=()=>new Map(),buildIconUnits=()=>[];
  const message=(key,params)=>({key,params}),errorMessage=error=>error;
  const t=key=>key,confirm=async (...args)=>hooks?.confirm ? hooks.confirm(...args) : true;
  const save=async options=>hooks?.save ? hooks.save(options) : "saved-regulation.bin";
  const requests=[];
  const invoke=async (command,args)=>{
    requests.push({command,args});
    if(hooks?.invoke) return hooks.invoke(command,args);
    return command==="save_changes" ? "saved-regulation.bin" : command==="load_dataset" ? savedData ?? state.data : {};
  };
  ${declarations}
  state.data=data;
  state.originalRecords=snapshotPatternRows();
  state.templates={...data,patterns:data.patterns.map(p=>({...p,placements:[...(p.placements ?? [])],flags:[...p.flags]}))};
  if(builtinData) state.templates=structuredClone(builtinData);
  state.builtinRecords=snapshotPatternRows(state.templates);
  return {state,setMode,cancelEdit,selectPattern,setPatch,setPatchBatch,saveFile,loadDefaultFile,loadData,numeric,addRow,removeUnitRow,removeEventRow,changeEventBundle,chooseEventKind,changeEventDay,toggleFrenzyLocation,changeMapEventLocation,patternEventGroups,pendingChangeCount,patternIsModified,restorePattern,requests,patternEventCapacity,datasetDiagnostics};
`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const createEditorFunction=new Function("data","savedData","builtinData","hooks","eventCapacity","eventGroups","eventTemplates","eventTerrainLocations","planEventChange","planEventDayChange","planMapEventLocationChange","usesMapEventLocations","isMapEventUnit","eventTiming","planFrenzyLocations","frenzyEventPositions","frenzyTerrainPositions",compiled);
const createEditor=(data,savedData,builtinData,hooks)=>createEditorFunction(data,savedData,builtinData,hooks,eventCapacity,eventGroups,eventTemplates,eventTerrainLocations,planEventChange,planEventDayChange,planMapEventLocationChange,usesMapEventLocations,isMapEventUnit,eventTiming,planFrenzyLocations,frenzyEventPositions,frenzyTerrainPositions);
const dataset=(value=700)=>({sourcePath:null,patterns:[
  {id:1,terrainId:0,nightlordId:0,flags:[{rowId:10,modifier: value}]},
  {id:2,terrainId:4,nightlordId:0,flags:[{rowId:20,modifier:13000}]}
]});
const start=(data=dataset(),savedData,builtinData,hooks)=>{
  const editor=createEditor(data,savedData,builtinData,hooks);
  editor.selectPattern(1);
  return editor;
};

const capacityDataset=count=>({sourcePath:"imported.bin",locations:[],names:[],patterns:[
  {id:1,terrainId:0,nightlordId:0,placements:[],play:null,
    flags:Array.from({length:count},(_,index)=>({rowId:index+1,modifierSet:index===0?190:3500,modifier:index===0?700:800,eventFlag:0}))}
]});

test("changing a complete event records its companion edits as one cancellable transaction",()=>{
  const data={sourcePath:null,locations:[],names:[],patterns:[
    {id:1,terrainId:0,nightlordId:0,play:null,placements:[
      {rowId:100,locationIndex:null,attachId:500,unitId:4600,variationId:0,modifier:0,mapIndex:0,visible:false}],
      flags:[{rowId:0,modifierSet:190,modifier:705,eventFlag:0},{rowId:1,modifierSet:0,modifier:180,eventFlag:0},
        {rowId:8,modifierSet:3030,modifier:801,eventFlag:7724}]},
    {id:43,terrainId:0,nightlordId:0,play:null,placements:[],flags:[
      {rowId:496,modifierSet:0,modifier:604,eventFlag:8075},{rowId:504,modifierSet:3040,modifier:800,eventFlag:7705},
      {rowId:505,modifierSet:3100,modifier:220,eventFlag:0}]}
  ]};
  const editor=start(data),p=editor.state.data.patterns[0];
  editor.setMode("edit");editor.changeEventBundle(8,"morgott",1);
  assert.equal(editor.patternEventGroups(p)[0].kind,"morgott");
  assert.equal(editor.numeric(p,"flag",1,"eventFlag",0),8075);
  assert.ok(editor.state.additions.size===1 && editor.state.removals.has("spot:100"));
  assert.equal(editor.patternEventCapacity(p).invalidRowId,null);
  editor.cancelEdit();
  assert.deepEqual(p.flags.map(row=>row.rowId),[0,1,8]);
  assert.deepEqual(p.placements.map(row=>row.rowId),[100]);
  assert.equal(editor.state.patches.size,0);assert.equal(editor.state.additions.size,0);assert.equal(editor.state.removals.size,0);
});

test("extra Boss cards set the schedule and the matching night's Boss fields together",()=>{
  const noExtra={rowId:1,playArea1:1001,playArea2:1002,bossId1:4929,bossId2:4860,
    extraBossId1:-1,extraBossId2:-1,bossModifier1:400,bossModifier2:401,extraBossModifier1:0,extraBossModifier2:0};
  const data={sourcePath:null,locations:[],names:[],patterns:[
    {id:1,terrainId:0,nightlordId:0,placements:[],play:noExtra,flags:[
      {rowId:1,modifierSet:190,modifier:705,eventFlag:0},{rowId:2,modifierSet:0,modifier:200,eventFlag:0},
      {rowId:3,modifierSet:3010,modifier:800,eventFlag:7701}]},
    {id:2,terrainId:0,nightlordId:0,placements:[],play:{...noExtra,rowId:2,extraBossId1:4770,extraBossModifier1:800},flags:[
      {rowId:20,modifierSet:0,modifier:120,eventFlag:0},{rowId:21,modifierSet:3000,modifier:800,eventFlag:7700}]}
  ]};
  const editor=start(data),p=editor.state.data.patterns[0];
  editor.setMode("edit");editor.changeEventBundle(3,"extraBoss",1);
  assert.equal(editor.patternEventGroups(p)[0].kind,"extraBoss");
  assert.equal(editor.numeric(p,"play",1,"extraBossId1",-1),4770);
  assert.equal(editor.numeric(p,"play",1,"extraBossModifier1",0),800);
  editor.removeEventRow(3);
  assert.equal(editor.numeric(p,"play",1,"extraBossId1",-1),-1);
  assert.equal(editor.numeric(p,"play",1,"extraBossModifier1",0),0);
  editor.cancelEdit();
  assert.equal(p.flags.some(row=>row.rowId===3),true);
  assert.equal(editor.state.patches.size,0);
});

test("moving and removing a Map Event package restores the camps it replaced in the draft",()=>{
  const camp=(rowId,locationIndex,attachId)=>({rowId,locationIndex,attachId,unitId:3410,variationId:2,modifier:0,mapIndex:rowId===17?0:1,visible:true});
  const template=(id,rowId,locationIndex,attachId,unitId)=>({id,terrainId:0,nightlordId:0,play:null,
    flags:[{rowId:id*10,modifierSet:0,modifier:200,eventFlag:0},{rowId:id*10+1,modifierSet:3010,modifier:800,eventFlag:7701}],
    placements:[{...camp(rowId,locationIndex,attachId),unitId,variationId:0}]});
  const data={sourcePath:null,locations:[],names:[],patterns:[
    {id:1,terrainId:0,nightlordId:0,flags:[],play:null,placements:[camp(17,21,109),camp(18,23,110)]},
    template(11,112,21,109,2080),template(16,160,23,110,2100)]};
  const editor=start(data),p=editor.state.data.patterns[0];editor.setMode("edit");
  editor.changeEventBundle(null,"meteor",1,109);
  assert.equal(editor.numeric(p,"spot",17,"unitId",3410),2080);
  const rowId=editor.patternEventGroups(p)[0].rowId;
  editor.changeEventBundle(rowId,"meteor",1,110);
  assert.equal(editor.numeric(p,"spot",17,"unitId",3410),3410);
  assert.equal(editor.numeric(p,"spot",18,"unitId",3410),2100);
  editor.removeEventRow(rowId);
  assert.deepEqual(p.placements.map(row=>row.rowId),[17,18]);
  assert.equal(editor.numeric(p,"spot",18,"unitId",3410),3410);
  assert.equal(editor.state.patches.size,0);
  assert.equal(editor.state.additions.size,0);
  assert.equal(editor.state.removals.size,0);
});

test("Frenzy position checkboxes support both towers, individual removal and cancelling the complete edit",()=>{
  const data={sourcePath:null,locations:[],names:[],patterns:[{id:1,terrainId:0,nightlordId:0,play:null,placements:[],flags:[
    {rowId:10,modifierSet:0,modifier:140,eventFlag:0},{rowId:11,modifierSet:3080,modifier:801,eventFlag:7727},
    {rowId:12,modifierSet:3500,modifier:0,eventFlag:1044360220}]}]};
  const editor=start(data),p=editor.state.data.patterns[0];editor.setMode("edit");
  editor.toggleFrenzyLocation(11,1044380230,true);
  assert.equal(editor.patternEventGroups(p).length,1);
  assert.deepEqual(new Set(editor.patternEventGroups(p)[0].flags.map(row=>row.eventFlag)),new Set([0,7727,1044360220,1044380230]));
  editor.toggleFrenzyLocation(11,1044360220,false);
  assert.equal(editor.patternEventGroups(p)[0].position,1044380230);
  assert.equal(p.flags.find(row=>row.rowId===11).eventFlag,7727);
  editor.toggleFrenzyLocation(11,1044380230,false);
  assert.equal(editor.patternEventGroups(p).length,0);
  editor.cancelEdit();assert.deepEqual(p.flags.map(row=>row.rowId),[10,11,12]);
  assert.equal(editor.state.patches.size,0);assert.equal(editor.state.additions.size,0);assert.equal(editor.state.removals.size,0);
});

test("shared candidate edits restore camps, retain controllers and cancel together",()=>{
  const camp=(rowId,locationIndex,attachId)=>({rowId,locationIndex,attachId,unitId:3410,variationId:2,modifier:0,mapIndex:rowId-17,visible:true});
  const template=(id,unitId,locationIndex,attachId)=>({id,terrainId:0,nightlordId:0,play:null,
    flags:[{rowId:id*10,modifierSet:0,modifier:200,eventFlag:0},{rowId:id*10+1,modifierSet:3010,modifier:800,eventFlag:7701}],
    placements:[{...camp(id*100,locationIndex,attachId),unitId,variationId:0,mapIndex:0}]});
  const data={sourcePath:null,locations:[],names:[],patterns:[
    {id:1,terrainId:0,nightlordId:0,flags:[],play:null,placements:[camp(17,21,115),camp(18,23,116)]},
    template(11,2080,21,109),template(16,2100,23,110),
    {id:128,terrainId:0,nightlordId:0,play:null,flags:[{rowId:1280,modifierSet:0,modifier:210,eventFlag:0},{rowId:1281,modifierSet:3020,modifier:801,eventFlag:7722}],
      placements:[{...camp(1282,21,109),unitId:2080,variationId:0,mapIndex:0}]}]};
  const editor=start(data),p=editor.state.data.patterns[0];editor.setMode("edit");
  editor.changeEventBundle(null,"meteor",1,109);editor.changeEventBundle(null,"mausoleum",2);
  const flags=structuredClone(p.flags),flagPatches=[...editor.state.patches.values()].filter(patch=>patch.table==="flag");
  assert.ok(editor.patternEventGroups(p).every(group=>group.units.length===2),"Each new map event adds a candidate");
  assert.equal(editor.numeric(p,"spot",18,"unitId",3410),2100);
  editor.changeMapEventLocation(18,null);
  assert.equal(editor.numeric(p,"spot",18,"unitId",3410),3410);
  editor.changeMapEventLocation(17,110);
  assert.equal(editor.numeric(p,"spot",17,"unitId",3410),3410);assert.equal(editor.numeric(p,"spot",17,"attachId",115),115);
  assert.equal(editor.numeric(p,"spot",18,"unitId",3410),2100);assert.equal(editor.numeric(p,"spot",18,"attachId",116),110);
  assert.ok(editor.patternEventGroups(p).every(group=>group.position===110));
  editor.changeMapEventLocation(null,109);
  assert.ok(editor.patternEventGroups(p).every(group=>group.units.length===2));
  editor.changeMapEventLocation(18,null);
  assert.equal(editor.numeric(p,"spot",18,"unitId",3410),3410);assert.equal(editor.numeric(p,"spot",18,"attachId",116),116);
  assert.ok(editor.patternEventGroups(p).every(group=>group.position===109));
  editor.changeMapEventLocation(17,null);assert.ok(editor.patternEventGroups(p).every(group=>group.units.length===1));
  assert.deepEqual(p.flags,flags);assert.deepEqual([...editor.state.patches.values()].filter(patch=>patch.table==="flag"),flagPatches);
  editor.cancelEdit();assert.deepEqual(p.flags,[]);assert.equal(editor.state.patches.size,0);assert.equal(editor.state.additions.size,0);assert.equal(editor.state.removals.size,0);
  assert.deepEqual(p.placements.map(row=>[row.rowId,row.unitId,row.attachId]),[[17,3410,115],[18,3410,116]]);
});

test("choosing an event type keeps the previous date and date edits preserve locations when cancelled",()=>{
  const source=(id,eventFlag)=>({id,terrainId:0,nightlordId:0,play:null,
    flags:[{rowId:id*10,modifierSet:0,modifier:200,eventFlag:0},{rowId:id*10+1,modifierSet:3010,modifier:eventFlag===7701?800:801,eventFlag}],
    placements:[{rowId:id*100,unitId:2080,attachId:109,locationIndex:21,variationId:0,modifier:0,mapIndex:0,visible:true}]});
  const p=source(1,7721),data={sourcePath:null,locations:[],names:[],patterns:[p,source(11,7701)]};
  data.patterns.push({id:43,terrainId:0,nightlordId:0,play:null,placements:[],flags:[
    {rowId:430,modifierSet:0,modifier:604,eventFlag:8075},{rowId:431,modifierSet:3040,modifier:800,eventFlag:7705},{rowId:432,modifierSet:3100,modifier:220,eventFlag:0}]},
    {id:44,terrainId:0,nightlordId:0,play:null,placements:[],flags:[
    {rowId:440,modifierSet:0,modifier:604,eventFlag:8075},{rowId:441,modifierSet:3040,modifier:801,eventFlag:7725},{rowId:442,modifierSet:3100,modifier:220,eventFlag:0}]});
  const editor=start(data);editor.setMode("edit");const units=structuredClone(p.placements);
  editor.changeEventDay(11,1);assert.equal(editor.patternEventGroups(p)[0].day,1);assert.deepEqual(p.placements,units);
  editor.changeEventDay(11,2);assert.equal(editor.patternEventGroups(p)[0].day,2);assert.deepEqual(p.placements,units);
  editor.chooseEventKind(11,"morgott");assert.equal(editor.patternEventGroups(p)[0].kind,"morgott");assert.equal(editor.patternEventGroups(p)[0].day,2);
  editor.cancelEdit();assert.equal(editor.patternEventGroups(p)[0].kind,"meteor");assert.equal(editor.patternEventGroups(p)[0].day,2);
  assert.deepEqual(p.placements,units);assert.equal(editor.state.patches.size,0);assert.equal(editor.state.removals.size,0);
});

test("adding prepended Rise and Frenzy cards targets the new card just like an appended event",()=>{
  for(const kind of ["rise","frenzy","morgott"]) {
    const calls=[];
    const flag=(rowId,modifierSet,modifier,eventFlag)=>({rowId,modifierSet,modifier,eventFlag});
    const data={sourcePath:null,locations:[],names:[],patterns:[
      {id:1,terrainId:0,nightlordId:0,play:null,placements:[],flags:[flag(10,0,180,0),flag(11,3030,800,7704)]},
      {id:2,terrainId:0,nightlordId:0,play:null,flags:[],placements:[
        {rowId:20,unitId:4090,attachId:301,locationIndex:1,variationId:0,modifier:0,mapIndex:0,visible:true}]},
      {id:3,terrainId:0,nightlordId:0,play:null,placements:[],flags:[
        flag(30,0,140,0),flag(31,3080,801,7727),flag(32,3500,0,1044380230)]},
      {id:4,terrainId:0,nightlordId:0,play:null,placements:[],flags:[
        flag(40,0,604,8075),flag(41,3040,800,7705),flag(42,3100,220,0)]}
    ]};
    const editor=start(data,undefined,undefined,{revealEventCard:(rowId,focus,pointerY)=>calls.push({rowId,focus,pointerY})});
    editor.setMode("edit");editor.chooseEventKind(null,kind,480);
    const groups=editor.patternEventGroups(data.patterns[0]),added=groups.find(group=>group.kind===kind);
    assert.ok(added);
    assert.deepEqual(groups.map(group=>group.kind),kind==="morgott" ? ["horde",kind] : [kind,"horde"]);
    assert.equal(editor.state.selectedFlag,added.rowId);
    assert.deepEqual(calls,[{rowId:added.rowId,focus:true,pointerY:480}]);
  }
});

test("Hollow Rise placement and moves restore replaced towers and camps without manufacturing schedules",()=>{
  const unit=(rowId,unitId,attachId,locationIndex,variationId)=>({rowId,unitId,attachId,locationIndex,variationId,modifier:0,mapIndex:0,visible:true});
  const data={sourcePath:null,locations:[],names:[],patterns:[
    {id:1,terrainId:4,nightlordId:0,flags:[],play:null,placements:[unit(8,5115,1150,83,0),unit(9,5110,1153,86,6)]},
    {id:90,terrainId:0,nightlordId:0,flags:[],play:null,placements:[unit(902,4090,307,32,8)]},
    {id:1000,terrainId:4,nightlordId:0,flags:[],play:null,placements:[unit(10001,5110,1150,83,2),unit(10002,5110,1153,86,4)]}]};
  const editor=start(data),p=editor.state.data.patterns[0];editor.setMode("edit");
  editor.chooseEventKind(null,"rise");let group=editor.patternEventGroups(p)[0];assert.ok([1150,1153].includes(group.position));
  editor.changeEventBundle(group.rowId,"rise",1,1150);group=editor.patternEventGroups(p)[0];assert.equal(group.position,1150);
  assert.equal(editor.numeric(p,"spot",8,"unitId",5115),4090);assert.deepEqual(p.flags,[]);
  editor.setPatchBatch(p,[["spot",8,"variationId",0,7]]);
  editor.changeEventBundle(group.rowId,"rise",1,1153);group=editor.patternEventGroups(p)[0];
  assert.equal(group.position,1153);assert.equal(editor.numeric(p,"spot",9,"variationId",6),7);
  assert.equal(editor.numeric(p,"spot",8,"unitId",5115),5115);assert.deepEqual(p.flags,[]);
  editor.removeEventRow(group.rowId);assert.equal(editor.numeric(p,"spot",9,"unitId",5110),5110);
  assert.equal(editor.numeric(p,"spot",9,"variationId",6),6);
  editor.cancelEdit();assert.deepEqual(p.placements.map(u=>[u.unitId,u.attachId,u.variationId]),[[5115,1150,0],[5110,1153,6]]);
  assert.equal(editor.state.patches.size,0);assert.equal(editor.state.additions.size,0);assert.equal(editor.state.removals.size,0);
});

test("Rise cards replace minor bases with matching tower attachments and restore the original base on removal",()=>{
  const unit=(rowId,unitId,attachId,locationIndex,variationId=0)=>({rowId,unitId,attachId,locationIndex,variationId,modifier:0,mapIndex:0,visible:true});
  const data={sourcePath:null,locations:[],names:[],patterns:[
    {id:1,terrainId:0,nightlordId:0,flags:[],play:null,placements:[unit(8,4341,351,29)]},
    {id:90,terrainId:0,nightlordId:0,flags:[],play:null,placements:[unit(90,4090,307,32,8)]},
    {id:2,terrainId:0,nightlordId:0,flags:[],play:null,placements:[unit(20,4100,301,29)]}]};
  const editor=start(data),p=editor.state.data.patterns[0];editor.setMode("edit");
  editor.changeEventBundle(null,"rise",1,301);
  assert.equal(editor.patternEventGroups(p)[0].position,301);assert.deepEqual(p.flags,[]);
  assert.equal(editor.numeric(p,"spot",8,"unitId",4341),4090);
  assert.equal(editor.numeric(p,"spot",8,"attachId",351),301);
  const group=editor.patternEventGroups(p)[0];assert.deepEqual(group.issues,[]);
  editor.removeEventRow(group.rowId);
  assert.equal(editor.numeric(p,"spot",8,"unitId",4341),4341);
  assert.equal(editor.numeric(p,"spot",8,"attachId",351),351);
  assert.equal(editor.state.patches.size,0);assert.equal(editor.state.additions.size,0);assert.equal(editor.state.removals.size,0);
});

test("saving an over-capacity Pattern stops before the dialog and preserves all pending edits",async()=>{
  let dialogs=0;
  const {state,setPatch,saveFile,requests,patternEventCapacity}=start(capacityDataset(21),undefined,undefined,{save:()=>{dialogs++;return "saved.bin";}});
  const p=state.data.patterns[0];
  setPatch(p,"flag",1,"modifier",700,705);
  const patches=[...state.patches];
  await saveFile();
  assert.equal(dialogs,0);assert.equal(requests.length,0);assert.equal(state.busy,false);
  assert.equal(state.message.params.error.code,"errors.eventCapacity");
  assert.deepEqual(state.message.params.error.params,{patternId:1,count:21,limit:20,rowId:21});
  assert.deepEqual([...state.patches],patches);
  assert.equal(patternEventCapacity(p).count,21,"The spawn record occupies a slot too");
});

test("imported overflow is diagnosed, remains editable, and clears after removal or builtin restoration",async()=>{
  const imported=capacityDataset(22),builtin=capacityDataset(10);
  const {state,loadData,datasetDiagnostics,removeEventRow,restorePattern,setMode}=start(imported,imported,builtin);
  await loadData("imported.bin");
  assert.equal(state.message.key,"status.dataLoadedWithIssues");
  assert.equal(state.message.params.patternIds,"1");
  assert.equal(datasetDiagnostics()[0].errors[0].params.rowId,21);
  state.selectedPattern=1;setMode("edit");
  removeEventRow(22);removeEventRow(21);
  assert.equal(datasetDiagnostics().length,0);
  assert.equal(state.data.patterns[0].flags.length,20);
  restorePattern();
  assert.equal(state.data.patterns[0].flags.length,10);
  assert.equal(datasetDiagnostics().length,0);
});

test("event checks use pending fields, additions and deletions, with Cancel restoring their previous state",()=>{
  const {state,setMode,setPatch,addRow,removeEventRow,cancelEdit,patternEventCapacity,datasetDiagnostics}=start(capacityDataset(19));
  const p=state.data.patterns[0];
  setMode("edit");addRow("event");addRow("event");
  assert.equal(patternEventCapacity(p).count,21);
  const added=p.flags.at(-1);
  setPatch(p,"flag",added.rowId,"modifier",added.modifier,0);
  assert.equal(datasetDiagnostics()[0].errors[0].code,"errors.eventTrailingRow");
  removeEventRow(added.rowId);
  assert.equal(datasetDiagnostics().length,0);
  assert.equal(patternEventCapacity(p).count,20);
  cancelEdit();
  assert.equal(patternEventCapacity(p).count,19);
  assert.equal(state.additions.size,0);assert.equal(state.patches.size,0);
});

test("field-only checks retain physical order while structural saves check the rewritten Row ID order",()=>{
  const data=capacityDataset(20),p=data.patterns[0];
  p.flags.splice(19,0,{rowId:21,modifierSet:3500,modifier:0,eventFlag:0});
  const {state,patternEventCapacity}=start(data);
  assert.equal(patternEventCapacity(p).invalidRowId,null);
  state.additions.set("flag:22",{table:"flag",patternId:1,rowId:22});
  p.flags.push({rowId:22,modifierSet:3500,modifier:0,eventFlag:0});
  assert.equal(patternEventCapacity(p).invalidRowId,21);
});

test("imported row-order diagnostics clear only when the corresponding table is rebuilt",()=>{
  const data=capacityDataset(10);
  data.diagnostics=[{code:"errors.flagRowOrder",params:{patternId:1,rowId:11}},{code:"errors.spotRowOrder",params:{patternId:1,rowId:12}}];
  const {state,datasetDiagnostics}=start(data);
  assert.equal(datasetDiagnostics()[0].errors.length,2);
  state.additions.set("flag:11",{table:"flag",patternId:1,rowId:11});
  assert.deepEqual(datasetDiagnostics()[0].errors.map(error=>error.code),["errors.spotRowOrder"]);
  state.restorations.add(1);
  assert.equal(datasetDiagnostics().length,0);
});

test("Cancel removes changes across editor tabs and returns to preview",()=>{
  const {state,setMode,setPatch,setPatchBatch,cancelEdit}=start();
  setMode("edit");
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  setPatchBatch(state.data.patterns[0],[["spot",11,"unitId",3000,3200],["play",12,"bossId1",4770,4820]]);
  cancelEdit();
  assert.equal(state.patches.size,0);
  assert.equal(state.mode,"preview");
  assert.equal(state.selectedPattern,1);
  assert.equal(state.editSnapshot,null);
});

test("Cancel restores completed changes even after reverting a field, preserving other Patterns",()=>{
  const {state,setMode,setPatch,cancelEdit}=start();
  const [first,second]=state.data.patterns;
  setPatch(first,"flag",10,"modifier",700,705);
  setPatch(second,"flag",20,"modifier",13000,13001);
  const before=[...state.patches];
  setMode("edit");
  setPatch(first,"flag",10,"modifier",700,700);
  setPatch(first,"flag",10,"eventFlag",0,7727);
  cancelEdit();
  assert.deepEqual([...state.patches],before);
});

test("Done keeps edits and a later Cancel rolls back only the next editing session",()=>{
  const {state,setMode,setPatch,cancelEdit}=start();
  setMode("edit");
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  setMode("preview");
  assert.equal(state.editSnapshot,null);
  assert.equal(state.patches.get("flag:10:modifier").newValue,705);
  setMode("edit");
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,708);
  setMode("edit");
  cancelEdit();
  assert.equal(state.patches.get("flag:10:modifier").newValue,705);
});

test("switching Patterns starts a fresh editing session without losing earlier edits",()=>{
  const {state,setMode,setPatch,selectPattern,cancelEdit}=start();
  setMode("edit");
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  selectPattern(2);
  assert.equal(state.editSnapshot,null);
  setMode("edit");
  setPatch(state.data.patterns[1],"flag",20,"modifier",13000,13001);
  cancelEdit();
  assert.equal(state.patches.size,1);
  assert.equal(state.patches.get("flag:10:modifier").newValue,705);
  assert.equal(state.selectedPattern,2);
});

test("loading defaults replaces imported data and resets the editing session",async()=>{
  const builtin=dataset(),imported=dataset(705);imported.sourcePath="imported.bin";
  let confirmations=0;
  const {state,setMode,setPatch,loadDefaultFile,requests}=start(imported,builtin,builtin,{
    confirm:()=>{confirmations++;return true;}
  });
  setMode("edit");setPatch(state.data.patterns[0],"flag",10,"modifier",705,708);
  await loadDefaultFile();
  assert.equal(confirmations,1);
  assert.deepEqual(requests.find(request=>request.command==="load_dataset").args,{path:null});
  assert.equal(state.data.sourcePath,null);
  assert.equal(state.data.patterns[0].flags[0].modifier,700);
  assert.equal(state.patches.size,0);
  assert.equal(state.mode,"filter");assert.equal(state.selectedPattern,null);
  assert.equal(state.editSnapshot,null);assert.equal(state.busy,false);
});

test("declining default loading retains edits, while busy loading is ignored",async()=>{
  const {state,setPatch,loadDefaultFile,requests}=start(dataset(),undefined,undefined,{confirm:()=>false});
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  await loadDefaultFile();
  assert.equal(state.patches.size,1);assert.equal(requests.length,0);
  state.busy=true;await loadDefaultFile();
  assert.equal(requests.length,0);
});

for(const input of [null,"imported.bin"]) test(`saving unchanged data preserves the source (${input ?? "builtin"})`,async()=>{
  const data=dataset(705);data.sourcePath=input;
  let options;
  const {state,saveFile,requests}=start(data,undefined,undefined,{
    save:value=>{options=value;return "copy.bin";}
  });
  await saveFile();
  assert.equal(options.defaultPath,input ?? "regulation.bin");
  assert.deepEqual(requests[0],{command:"save_changes",args:{input,output:"copy.bin",patches:[],additions:[],removals:[],restorations:[]}});
  assert.equal(state.message.key,"status.saved");assert.equal(state.busy,false);
});

test("saving without a loaded dataset does not open the save dialog",async()=>{
  let opened=false;
  const {state,saveFile,requests}=start(dataset(),undefined,undefined,{save:()=>{opened=true;}});
  state.data=null;await saveFile();
  assert.equal(opened,false);assert.equal(requests.length,0);
});

test("saving during editing rebases Cancel on the saved file",async()=>{
  const {state,setMode,setPatch,saveFile,cancelEdit,numeric}=start(dataset(),dataset(705));
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,701);
  setMode("edit");
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  await saveFile();
  assert.equal(state.mode,"edit");
  assert.equal(state.patches.size,0);
  const p=state.data.patterns[0];
  setPatch(p,"flag",10,"modifier",705,708);
  cancelEdit();
  assert.equal(state.patches.size,0);
  assert.equal(numeric(p,"flag",10,"modifier",p.flags[0].modifier),705);
});

test("background saving locks parameter changes through the reload and prevents duplicate saves",async()=>{
  let finishWrite,finishRead;
  const write=new Promise(resolve=>{finishWrite=resolve;});
  const read=new Promise(resolve=>{finishRead=resolve;});
  const editor=start(dataset(),undefined,undefined,{invoke:command=>command==="save_changes" ? write : read});
  const {state,setMode,setPatch,saveFile,cancelEdit,restorePattern,addRow,requests}=editor;
  setMode("edit");
  const original=state.data.patterns[0];
  setPatch(original,"flag",10,"modifier",700,705);
  const saving=saveFile();
  assert.equal(state.busy,true);
  await new Promise(resolve=>setImmediate(resolve));
  setPatch(original,"flag",10,"modifier",700,708);
  cancelEdit();restorePattern();addRow("event");
  await saveFile();
  assert.equal(state.mode,"edit");
  assert.equal(state.patches.get("flag:10:modifier").newValue,705);
  assert.equal(requests.filter(request=>request.command==="save_changes").length,1);
  finishWrite("saved-regulation.bin");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.busy,true);
  assert.equal(state.patches.size,1);
  assert.equal(requests.some(request=>request.command==="load_icon_config"),false);
  setPatch(original,"flag",10,"modifier",700,709);
  finishRead(dataset(705));
  await saving;
  assert.equal(state.busy,false);
  assert.equal(state.patches.size,0);
  assert.equal(state.data.patterns[0].flags[0].modifier,705);
  assert.equal(state.editRecordSnapshot,state.originalRecords);
  setPatch(state.data.patterns[0],"flag",10,"modifier",705,708);
  assert.equal(state.patches.get("flag:10:modifier").newValue,708);
});

for(const failedCommand of ["save_changes","load_dataset"]) {
  test(`${failedCommand} failures preserve edits and unlock the editor for retry`,async()=>{
    let fail=true;
    const editor=start(dataset(),undefined,undefined,{invoke:command=>{
      if(fail && command===failedCommand) throw new Error("test failure");
      return command==="save_changes" ? "saved-regulation.bin" : dataset(705);
    }});
    const {state,setMode,setPatch,saveFile}=editor;
    setMode("edit");setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
    const records=state.originalRecords;
    await saveFile();
    assert.equal(state.busy,false);
    assert.equal(state.message.key,"errors.save");
    assert.equal(state.originalRecords,records);
    assert.equal(state.patches.get("flag:10:modifier").newValue,705);
    assert.equal(state.data.patterns[0].flags[0].modifier,700);
    fail=false;
    await saveFile();
    assert.equal(state.message.key,"status.saved");
    assert.equal(state.patches.size,0);
    assert.equal(state.data.patterns[0].flags[0].modifier,705);
  });
}

test("cancelling the save dialog retains edits and restores the previous status",async()=>{
  const {state,setPatch,saveFile,requests}=start(dataset(),undefined,undefined,{save:()=>null});
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  const before=state.message;
  await saveFile();
  assert.equal(state.busy,false);
  assert.equal(state.message,before);
  assert.equal(state.patches.size,1);
  assert.equal(requests.length,0);
});

test("repeated saves default to the imported path and rebase edits while retaining the builtin comparison",async()=>{
  const path="E:/Mods/regulation.bin";
  const imported=dataset();imported.sourcePath=path;
  let saved=structuredClone(imported);
  const dialogs=[];
  const {state,setMode,setPatch,saveFile,requests,patternIsModified,cancelEdit}=start(imported,undefined,undefined,{
    save:options=>{dialogs.push(options);return path;},
    invoke:(command,args)=>{
      if(command==="save_changes") {
        for(const patch of args.patches) saved.patterns.find(p=>p.id===patch.patternId).flags.find(row=>row.rowId===patch.rowId)[patch.field]=patch.newValue;
        return path;
      }
      return structuredClone(saved);
    }
  });
  setMode("edit");
  for(const [oldValue,newValue] of [[700,705],[705,708]]) {
    setPatch(state.data.patterns[0],"flag",10,"modifier",oldValue,newValue);
    await saveFile();
    const request=requests.findLast(request=>request.command==="save_changes");
    assert.equal(request.args.input,path);
    assert.equal(request.args.output,path);
    assert.equal(request.args.patches[0].oldValue,oldValue);
    assert.equal(dialogs.at(-1).defaultPath,path);
    assert.equal(state.data.sourcePath,path);
    assert.equal(state.data.patterns[0].flags[0].modifier,newValue);
    assert.equal(state.patches.size,0);
    assert.equal(patternIsModified(1),true);
  }
  assert.equal(state.builtinRecords.get(1).flags[0].modifier,700);
  setPatch(state.data.patterns[0],"flag",10,"modifier",708,709);
  cancelEdit();
  assert.equal(state.patches.size,0);
  assert.equal(state.data.patterns[0].flags[0].modifier,708);
});

test("saving builtin data keeps regulation.bin as the dialog default",async()=>{
  let options;
  const {state,setPatch,saveFile}=start(dataset(),undefined,undefined,{save:value=>{options=value;return null;}});
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);
  await saveFile();
  assert.equal(options.defaultPath,"regulation.bin");
  assert.equal(state.patches.size,1);
});

const additionDataset=()=>({sourcePath:null,locations:[{index:11,scope:"Surface",category:"Major Base",typeIndex:1}],patterns:[
  {id:1,terrainId:0,nightlordId:0,flags:[{rowId:1,modifierSet:0,modifier:0,eventFlag:0}],placements:[],play:null},
  {id:2,terrainId:4,nightlordId:0,flags:[{rowId:21,modifierSet:500,modifier:801,eventFlag:7727},{rowId:22,modifierSet:160,modifier:13001,eventFlag:0}],
    placements:[],play:{rowId:2,playArea1:11000,playArea2:12000,bossId1:4770,bossId2:4820,extraBossId1:-1,extraBossId2:-1,bossModifier1:800,bossModifier2:801,extraBossModifier1:0,extraBossModifier2:0}},
  {id:3,terrainId:0,nightlordId:0,flags:[{rowId:31,modifierSet:3080,modifier:801,eventFlag:7727},{rowId:32,modifierSet:190,modifier:705,eventFlag:0}],
    placements:[{rowId:40,locationIndex:11,attachId:101,unitId:3000,variationId:0,modifier:0,mapIndex:0,visible:true}],
    play:{rowId:3,playArea1:1000,playArea2:1001,bossId1:4770,bossId2:4820,extraBossId1:-1,extraBossId2:-1,bossModifier1:800,bossModifier2:801,extraBossModifier1:0,extraBossModifier2:0}}
]});

test("new unit and event rows get unique IDs and use templates for the current location and terrain",()=>{
  const {state,setMode,addRow,pendingChangeCount}=start(additionDataset());
  state.selectedLocation=11;setMode("edit");
  addRow("spot");addRow("spot");addRow("event");
  const p=state.data.patterns[0];
  assert.deepEqual(p.placements.map(row=>row.rowId),[41]);
  assert.ok(p.placements.every(row=>row.locationIndex===11 && row.attachId===101));
  const addition=state.additions.get(`flag:${state.selectedFlag}`);
  assert.equal(addition.sourceRowId,31);
  assert.equal(addition.fields.modifierSet,3080);
  assert.equal(pendingChangeCount(),2);
});

test("Cancel removes new rows from every table while preserving previously completed additions",()=>{
  const {state,setMode,addRow,removeUnitRow,cancelEdit,setPatch}=start(additionDataset());
  state.selectedLocation=11;setMode("edit");addRow("spot");setMode("preview");
  const p=state.data.patterns[0],kept=p.placements[0];
  setMode("edit");
  setPatch(p,"spot",kept.rowId,"modifier",0,999);
  removeUnitRow(kept.rowId);addRow("spot");addRow("event");addRow("spawn");addRow("play");
  cancelEdit();
  assert.deepEqual(p.placements,[kept]);
  assert.equal(p.flags.length,1);
  assert.equal(p.play,null);
  assert.equal(state.additions.size,1);
  assert.equal(state.patches.size,0);
  assert.equal(state.mode,"preview");
});

test("missing spawn and shared night-circle/Boss records can be created, with one play row per Pattern",()=>{
  const {state,setMode,addRow}=start(additionDataset());setMode("edit");
  addRow("spawn");addRow("play");addRow("play");
  const p=state.data.patterns[0];
  assert.equal(p.flags.at(-1).modifierSet,190);
  assert.equal(p.flags.at(-1).modifier,705);
  assert.equal(p.play.playArea1,1000);
  assert.equal(state.additions.size,2);
});

test("cloning an edited new unit in another Pattern retains a persisted source and the latest parameter values",()=>{
  const data=additionDataset();data.patterns.push({...data.patterns[0],id:4,flags:[],placements:[]});
  const {state,setMode,selectPattern,addRow,setPatch}=start(data);
  state.selectedLocation=11;setMode("edit");addRow("spot");
  setPatch(state.data.patterns[0],"spot",41,"unitId",3000,3200);
  selectPattern(4);state.selectedLocation=11;setMode("edit");
  addRow("spot");
  assert.equal(state.additions.get("spot:42").sourceRowId,40);
  assert.equal(state.additions.get("spot:42").fields.unitId,3200);
});

test("removing an existing unit deletes its field patches and Cancel restores the unit and earlier changes",()=>{
  const {state,selectPattern,setMode,setPatch,removeUnitRow,cancelEdit,pendingChangeCount}=start(additionDataset());
  selectPattern(3);state.selectedLocation=11;
  const p=state.data.patterns[2],row=p.placements[0];
  setPatch(p,"spot",row.rowId,"modifier",0,500);
  state.terrainLocations.set(0,new Set([11]));
  setMode("edit");removeUnitRow(row.rowId);
  assert.equal(p.placements.length,0);
  assert.equal(state.patches.size,0);
  assert.equal(pendingChangeCount(),1);
  assert.ok(state.terrainLocations.get(0).has(11),"The empty location remains available");
  cancelEdit();
  assert.deepEqual(p.placements,[row]);
  assert.equal(state.removals.size,0);
  assert.equal(state.patches.get("spot:40:modifier").newValue,500);
});

test("removing a newly added unit cancels the addition without scheduling a file deletion",()=>{
  const {state,setMode,addRow,removeUnitRow,pendingChangeCount}=start(additionDataset());
  state.selectedLocation=11;setMode("edit");addRow("spot");removeUnitRow(41);
  assert.equal(pendingChangeCount(),0);
  assert.equal(state.data.patterns[0].placements.length,0);
  assert.equal(state.removals.size,0);
});

test("an empty location can use a bundled template after its last unit is removed from an imported file",()=>{
  const {state,setMode,addRow}=start(additionDataset());
  state.data.patterns[2].placements=[];
  state.selectedLocation=11;setMode("edit");addRow("spot");
  assert.equal(state.data.patterns[0].placements.length,1);
  assert.equal(state.additions.get("spot:41").sourceRowId,40);
});

test("a removed unit can be replaced once and Cancel preserves a previously completed removal",()=>{
  const {state,selectPattern,setMode,removeUnitRow,addRow,cancelEdit}=start(additionDataset());
  selectPattern(3);state.selectedLocation=11;setMode("edit");removeUnitRow(40);setMode("preview");
  setMode("edit");addRow("spot");addRow("spot");
  assert.equal(state.data.patterns[2].placements.length,1);
  assert.equal(state.additions.get("spot:41").sourceRowId,40);
  cancelEdit();
  assert.equal(state.data.patterns[2].placements.length,0);
  assert.equal(state.additions.size,0);
  assert.equal(state.removals.size,1);
});

test("removing one row preserves other records at the location and duplicate visible units are rejected",()=>{
  const data=additionDataset(),p=data.patterns[2];
  const auxiliary={...p.placements[0],rowId:39,unitId:2000,visible:false};p.placements.push(auxiliary);
  const {state,selectPattern,setMode,setPatch,removeUnitRow,addRow}=start(data);
  selectPattern(3);state.selectedLocation=11;setMode("edit");
  addRow("spot");assert.equal(state.additions.size,0);
  setPatch(p,"spot",39,"unitId",2000,3200);
  assert.equal(state.patches.size,0);
  assert.equal(state.message.key,"errors.locationUnitExists");
  removeUnitRow(40);assert.deepEqual(p.placements,[auxiliary]);
  addRow("spot");assert.equal(p.placements.filter(row=>row.unitId!==2000).length,1);
});

test("unit removals alone can be saved and become the new Cancel baseline",async()=>{
  const data=additionDataset(),saved=additionDataset();saved.patterns[2].placements=[];
  const {state,selectPattern,setMode,removeUnitRow,saveFile,cancelEdit,requests}=start(data,saved);
  selectPattern(3);setMode("edit");removeUnitRow(40);await saveFile();
  const request=requests.find(request=>request.command==="save_changes");
  assert.deepEqual(request.args.removals,[{patternId:3,table:"spot",rowId:40}]);
  assert.deepEqual(request.args.additions,[]);
  assert.equal(state.removals.size,0);
  cancelEdit();assert.equal(state.data.patterns[2].placements.length,0);
});

test("added rows can be saved without field patches and become the new Cancel baseline",async()=>{
  const {state,setMode,addRow,saveFile,cancelEdit,requests,pendingChangeCount}=start(additionDataset());
  state.selectedLocation=11;setMode("edit");addRow("spot");
  assert.equal(state.patches.size,0);
  assert.equal(pendingChangeCount(),1);
  await saveFile();
  const request=requests.find(request=>request.command==="save_changes");
  assert.equal(request.args.additions.length,1);
  assert.equal(request.args.additions[0].sourceRowId,40);
  assert.equal(state.additions.size,0);
  cancelEdit();
  assert.equal(state.data.patterns[0].placements.length,1);
});

test("mapIndex conflicts are resolved by ID across different variants and Modifiers, preserving occupied values",()=>{
  const data=additionDataset(),p=data.patterns[0],sample=data.patterns[2].placements[0];
  p.placements=[{...sample,rowId:10,locationIndex:12,mapIndex:0},
    {...sample,rowId:20,locationIndex:13,variationId:1,modifier:999,mapIndex:0},
    {...sample,rowId:30,locationIndex:14,variationId:2,modifier:800,mapIndex:1},
    {...sample,rowId:31,locationIndex:15,unitId:3200,mapIndex:0}];
  const {state,setMode,numeric,cancelEdit}=start(data);setMode("edit");
  assert.deepEqual(p.placements.map(row=>numeric(p,"spot",row.rowId,"mapIndex",row.mapIndex)),[0,2,1,0]);
  assert.equal(state.patches.size,1);
  assert.equal(state.patches.get("spot:20:mapIndex").oldValue,0);
  assert.equal(state.patches.has("spot:40:mapIndex"),false,"Another Pattern may reuse the index");
  cancelEdit();assert.equal(state.patches.size,0);
});

test("adding a unit assigns a free mapIndex even when the existing unit has another variant and Modifier",()=>{
  const data=additionDataset(),p=data.patterns[0],sample=data.patterns[2].placements[0];
  p.placements=[{...sample,rowId:39,locationIndex:12}];
  data.patterns[2].placements[0]={...sample,variationId:1,modifier:999};
  const {state,setMode,addRow,numeric,cancelEdit}=start(data);
  state.selectedLocation=11;setMode("edit");addRow("spot");
  const added=p.placements.find(row=>row.rowId===41);
  assert.equal(added.unitId,3000);assert.equal(added.variationId,1);assert.equal(added.modifier,999);
  assert.equal(numeric(p,"spot",41,"mapIndex",added.mapIndex),1);
  assert.equal(state.patches.get("spot:41:mapIndex").oldValue,0);
  cancelEdit();assert.equal(p.placements.length,1);assert.equal(state.patches.size,0);
});

test("changing a unit ID resolves mapIndex conflicts and exports the automatic change",async()=>{
  const data=additionDataset(),p=data.patterns[2],sample=p.placements[0];
  p.placements.push({...sample,rowId:42,locationIndex:12,unitId:3200,variationId:1,modifier:999});
  const {state,selectPattern,setMode,setPatch,saveFile,numeric,requests}=start(data);
  selectPattern(3);setMode("edit");setPatch(p,"spot",42,"unitId",3200,3000);
  assert.equal(numeric(p,"spot",42,"mapIndex",0),1);
  setPatch(p,"spot",42,"variationId",1,2);setPatch(p,"spot",42,"modifier",999,800);
  assert.equal(numeric(p,"spot",42,"mapIndex",0),1);
  await saveFile();
  const request=requests.find(request=>request.command==="save_changes");
  assert.ok(request.args.patches.some(patch=>patch.rowId===42 && patch.field==="mapIndex" && patch.newValue===1));
});

test("the first added unit starts at mapIndex zero even when the template uses a different index",()=>{
  const data=additionDataset();data.patterns[2].placements[0].mapIndex=7;
  const {state,setMode,addRow}=start(data);state.selectedLocation=11;setMode("edit");addRow("spot");
  assert.equal(state.data.patterns[0].placements[0].mapIndex,0);
  assert.equal(state.additions.get("spot:41").fields.mapIndex,0);
});

test("mapIndex uses the full byte range and an added 257th unit fails without partial changes",()=>{
  const data=additionDataset(),p=data.patterns[0],sample=data.patterns[2].placements[0];
  p.placements=Array.from({length:256},(_,index)=>({...sample,rowId:1000+index,locationIndex:null,variationId:index%8}));
  const {state,setMode,addRow,numeric}=start(data);state.selectedLocation=11;setMode("edit");
  assert.deepEqual(p.placements.map(row=>numeric(p,"spot",row.rowId,"mapIndex",row.mapIndex)),Array.from({length:256},(_,index)=>index));
  const before=[...state.patches];addRow("spot");
  assert.equal(p.placements.length,256);assert.equal(state.additions.size,0);
  assert.equal(state.message.key,"errors.mapIndexLimit");assert.deepEqual([...state.patches],before);
});

test("modified Patterns track field edits, additions and removals, clearing after a revert or Cancel",()=>{
  const {state,setMode,selectPattern,setPatch,addRow,removeUnitRow,cancelEdit,patternIsModified}=start(additionDataset());
  const p=state.data.patterns[0];
  assert.equal(patternIsModified(1),false);assert.equal(patternIsModified(3),false);
  setPatch(p,"flag",1,"modifier",0,800);assert.equal(patternIsModified(1),true);
  setPatch(p,"flag",1,"modifier",0,0);assert.equal(patternIsModified(1),false);
  state.selectedLocation=11;setMode("edit");addRow("spot");assert.equal(patternIsModified(1),true);
  removeUnitRow(p.placements[0].rowId);assert.equal(patternIsModified(1),false);
  addRow("event");assert.equal(patternIsModified(1),true);
  cancelEdit();assert.equal(patternIsModified(1),false);
  selectPattern(3);setMode("edit");removeUnitRow(40);assert.equal(patternIsModified(3),true);
  cancelEdit();assert.equal(patternIsModified(3),false);
});

test("Restore removes completed changes and additions across every editor tab",()=>{
  const {state,setMode,addRow,setPatch,restorePattern,patternIsModified,pendingChangeCount,cancelEdit}=start(additionDataset());
  const p=state.data.patterns[0],original=structuredClone(p);
  state.selectedLocation=11;setMode("edit");
  addRow("spot");addRow("event");addRow("spawn");addRow("play");
  setPatch(p,"flag",1,"modifier",0,800);setMode("preview");
  setMode("edit");setPatch(p,"play",p.play.rowId,"bossId1",4770,4820);setMode("preview");
  assert.equal(patternIsModified(1),true);
  restorePattern();
  assert.deepEqual(p,original);
  assert.equal(state.selectedFlag,null);
  assert.equal(pendingChangeCount(),0);assert.equal(patternIsModified(1),false);
  assert.equal(state.mode,"preview");assert.equal(state.selectedPattern,1);
  setMode("edit");cancelEdit();assert.deepEqual(p,original);
});

test("Restore puts removed units back and preserves every change in other Patterns",()=>{
  const {state,setMode,selectPattern,addRow,removeUnitRow,setPatch,restorePattern,patternIsModified}=start(additionDataset());
  state.selectedLocation=11;setMode("edit");addRow("spot");addRow("event");setMode("preview");
  const keptPatches=[...state.patches],keptAdditions=[...state.additions],kept=structuredClone(state.data.patterns[0]);
  selectPattern(3);setMode("edit");
  const p=state.data.patterns[2],original=structuredClone(p);
  removeUnitRow(40);addRow("event");setPatch(p,"play",3,"bossId1",4770,4820);setMode("preview");
  restorePattern();
  assert.deepEqual(p,original);assert.deepEqual(state.data.patterns[0],kept);
  assert.deepEqual([...state.patches],keptPatches);assert.deepEqual([...state.additions],keptAdditions);
  assert.equal(state.removals.size,0);assert.equal(patternIsModified(3),false);assert.equal(patternIsModified(1),true);
});

test("saved parameters remain modified relative to the builtin and Restore queues a builtin restoration",async()=>{
  const {state,setPatch,setMode,saveFile,restorePattern,patternIsModified,numeric}=start(dataset(),dataset(705));
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);assert.equal(patternIsModified(1),true);
  await saveFile();assert.equal(patternIsModified(1),true);assert.equal(state.patches.size,0);
  const p=state.data.patterns[0];
  setMode("edit");setPatch(p,"flag",10,"modifier",705,708);setMode("preview");
  restorePattern();
  assert.equal(numeric(p,"flag",10,"modifier",p.flags[0].modifier),700);
  assert.equal(patternIsModified(1),false);
  assert.deepEqual([...state.restorations],[1]);
  assert.equal(state.templates.patterns[0].flags[0].modifier,700,"Saving keeps the builtin baseline unchanged");
});

test("Restore ignores clicks while a save or load is busy",()=>{
  const {state,setPatch,restorePattern,patternIsModified}=start();
  setPatch(state.data.patterns[0],"flag",10,"modifier",700,705);state.busy=true;
  restorePattern();assert.equal(patternIsModified(1),true);
  assert.equal(state.patches.get("flag:10:modifier").newValue,705);
});

test("deleting a selected event selects its neighbor and Cancel restores the row and completed field edits",()=>{
  const data=additionDataset(),p=data.patterns[2];
  p.flags.push({rowId:33,modifierSet:3500,modifier:140,eventFlag:1044380230});
  const {state,selectPattern,setMode,setPatch,removeEventRow,cancelEdit}=start(data);
  selectPattern(3);state.selectedFlag=31;
  setPatch(p,"flag",31,"modifier",801,999);setMode("edit");removeEventRow(31);
  assert.deepEqual(p.flags.map(row=>row.rowId),[32]);
  assert.equal(state.selectedFlag,null);assert.equal(state.patches.size,0);
  assert.equal(state.removals.get("flag:31").table,"flag");
  assert.equal(state.removals.get("flag:33").table,"flag","The paired frenzy location is removed with its schedule");
  cancelEdit();
  assert.deepEqual(p.flags.map(row=>row.rowId),[31,32,33]);
  assert.equal(state.removals.size,0);assert.equal(state.patches.get("flag:31:modifier").newValue,999);
});

test("deleting all events keeps spawn rows and allows another event without reusing a removed Row ID",()=>{
  const data=additionDataset(),p=data.patterns[2];p.flags[0].rowId=50;
  const {state,selectPattern,setMode,removeEventRow,addRow,cancelEdit}=start(data);
  selectPattern(3);state.selectedFlag=50;setMode("edit");removeEventRow(50);
  assert.equal(state.selectedFlag,null);assert.deepEqual(p.flags.map(row=>row.rowId),[32]);
  addRow("event");assert.equal(state.selectedFlag,51);
  assert.equal(state.additions.get("flag:51").fields.modifierSet,3080);
  assert.equal(state.removals.size,1);
  cancelEdit();assert.deepEqual(p.flags.map(row=>row.rowId),[50,32]);
});

test("deleting a newly added event clears its patches and Cancel can recover an earlier completed addition",()=>{
  const {state,setMode,setPatch,addRow,removeEventRow,cancelEdit,pendingChangeCount}=start(additionDataset());
  const p=state.data.patterns[0];setMode("edit");addRow("event");
  const row=p.flags.at(-1);
  setPatch(p,"flag",row.rowId,"modifier",row.modifier,999);removeEventRow(row.rowId);
  assert.equal(pendingChangeCount(),0);assert.equal(state.removals.size,0);assert.equal(p.flags.length,1);
  addRow("event");setMode("preview");const kept=p.flags.at(-1);
  setMode("edit");removeEventRow(kept.rowId);assert.equal(pendingChangeCount(),0);cancelEdit();
  assert.equal(state.additions.size,1);assert.deepEqual(p.flags.at(-1),kept);
});

test("Restore recovers completed event deletions while preserving deletions in other Patterns",()=>{
  const {state,selectPattern,setMode,removeEventRow,restorePattern,patternIsModified}=start(additionDataset());
  selectPattern(2);setMode("edit");removeEventRow(21);setMode("preview");
  selectPattern(3);setMode("edit");removeEventRow(31);setMode("preview");restorePattern();
  assert.deepEqual(state.data.patterns[2].flags.map(row=>row.rowId),[31,32]);
  assert.deepEqual(state.data.patterns[1].flags.map(row=>row.rowId),[22]);
  assert.deepEqual([...state.removals.keys()],["flag:21"]);
  assert.equal(patternIsModified(3),false);assert.equal(patternIsModified(2),true);
});

test("event and unit deletions sharing a numeric Row ID remain separate in the saved request",async()=>{
  const data=additionDataset();data.patterns[2].flags[0].rowId=40;
  const {state,selectPattern,setMode,removeEventRow,removeUnitRow,saveFile,requests}=start(data);
  selectPattern(3);state.selectedFlag=40;setMode("edit");removeEventRow(40);removeUnitRow(40);
  assert.deepEqual([...state.removals.keys()],["flag:40","spot:40"]);
  await saveFile();
  assert.deepEqual(requests.find(request=>request.command==="save_changes").args.removals,
    [{patternId:3,table:"flag",rowId:40},{patternId:3,table:"spot",rowId:40}]);
  assert.deepEqual(state.data.patterns[2].flags.map(row=>row.rowId),[32]);
});

test("Cancel keeps a saved event deletion, while Restore recovers the builtin event",async()=>{
  const data=additionDataset(),saved=additionDataset();saved.patterns[2].flags.shift();
  const {state,selectPattern,setMode,removeEventRow,saveFile,cancelEdit,restorePattern,setPatch,requests}=start(data,saved);
  selectPattern(3);setMode("edit");removeEventRow(31);await saveFile();
  assert.deepEqual(requests.find(request=>request.command==="save_changes").args.removals,[{patternId:3,table:"flag",rowId:31}]);
  assert.equal(state.removals.size,0);cancelEdit();
  const p=state.data.patterns[2];setPatch(p,"flag",32,"modifier",705,706);restorePattern();
  assert.deepEqual(p.flags.map(row=>row.rowId),[31,32]);assert.equal(state.patches.size,0);
  assert.deepEqual([...state.restorations],[3]);
});

test("imported differences are modified immediately and Restore recovers builtin rows while preserving other Patterns",async()=>{
  const builtin=additionDataset(),imported=additionDataset();imported.sourcePath="imported.bin";
  const p=imported.patterns[2];p.flags.shift();p.flags[0].modifier=700;
  p.flags.push({rowId:90,modifierSet:500,modifier:800,eventFlag:7727});
  p.placements=[];p.play=null;imported.patterns[1].flags[0].modifier=999;
  const {state,selectPattern,restorePattern,patternIsModified,pendingChangeCount,setMode,setPatch,cancelEdit,saveFile,requests}=start(imported,undefined,builtin);
  assert.equal(patternIsModified(3),true);assert.equal(patternIsModified(2),true);assert.equal(pendingChangeCount(),0);
  selectPattern(3);restorePattern();assert.deepEqual(p,builtin.patterns[2]);
  assert.equal(patternIsModified(3),false);assert.equal(patternIsModified(2),true);assert.equal(pendingChangeCount(),1);
  setMode("edit");setPatch(p,"flag",32,"modifier",705,708);cancelEdit();
  assert.deepEqual(p,builtin.patterns[2]);assert.deepEqual([...state.restorations],[3]);
  await saveFile();const request=requests.find(request=>request.command==="save_changes");
  assert.equal(request.args.input,"imported.bin");assert.deepEqual(request.args.restorations,[3]);assert.deepEqual(request.args.patches,[]);
  assert.equal(state.restorations.size,0);assert.equal(patternIsModified(3),false);assert.equal(patternIsModified(2),true);
});

test("editing after a builtin restoration uses builtin old values and Cancel preserves the completed restoration",async()=>{
  const {state,setMode,setPatch,cancelEdit,restorePattern,patternIsModified,saveFile,requests}=start(dataset(705),undefined,dataset(700));
  restorePattern();const p=state.data.patterns[0];
  setMode("edit");setPatch(p,"flag",10,"modifier",700,708);cancelEdit();
  assert.equal(patternIsModified(1),false);assert.equal(p.flags[0].modifier,700);assert.deepEqual([...state.restorations],[1]);
  setMode("edit");setPatch(p,"flag",10,"modifier",700,708);await saveFile();
  const request=requests.find(request=>request.command==="save_changes");
  assert.deepEqual(request.args.restorations,[1]);assert.equal(request.args.patches[0].oldValue,700);assert.equal(request.args.patches[0].newValue,708);
});

test("setting an imported parameter back to builtin clears its modified indicator but retains the file patch",()=>{
  const {state,setPatch,patternIsModified,pendingChangeCount}=start(dataset(705),undefined,dataset(700));
  assert.equal(patternIsModified(1),true);setPatch(state.data.patterns[0],"flag",10,"modifier",705,700);
  assert.equal(patternIsModified(1),false);assert.equal(pendingChangeCount(),1);assert.equal(state.patches.get("flag:10:modifier").oldValue,705);
});

test("Restore restores builtin terrain and Nightlord metadata and all builtin IDs remain reserved for new rows",()=>{
  const builtin=additionDataset(),imported=additionDataset();imported.patterns[2].terrainId=4;imported.patterns[2].nightlordId=7;
  imported.patterns[2].placements=[];
  const {state,selectPattern,setMode,addRow,restorePattern,patternIsModified}=start(imported,undefined,builtin);
  state.selectedLocation=11;setMode("edit");addRow("spot");assert.ok(state.additions.has("spot:41"));
  selectPattern(3);assert.equal(patternIsModified(3),true);restorePattern();
  assert.equal(state.terrain,0);assert.equal(state.data.patterns[2].nightlordId,0);assert.deepEqual(state.data.patterns[2],builtin.patterns[2]);
});

test("event deletion ignores preview, busy states, missing rows and spawn records",()=>{
  const {state,selectPattern,setMode,removeEventRow,pendingChangeCount}=start(additionDataset());
  selectPattern(3);removeEventRow(31);setMode("edit");state.busy=true;removeEventRow(31);
  state.busy=false;removeEventRow(32);removeEventRow(-1);
  assert.equal(pendingChangeCount(),0);assert.equal(state.data.patterns[2].flags.length,2);
});
