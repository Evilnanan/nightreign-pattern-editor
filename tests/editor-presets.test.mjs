import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
const bundleSource=await readFile(new URL("../src/event-bundles.ts",import.meta.url),"utf8");
const bundleCompiled=ts.transpileModule(bundleSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {eventGroups,eventKindForRow,eventKinds,eventTemplates,eventTerrainLocations,planEventChange,planEventDayChange,planMapEventLocationChange,eventTiming,isInvasionEvent,isMapEventUnit,usesMapEventLocations,frenzyEventPositions,frenzyPositions,frenzyTerrainPositions}=await import(`data:text/javascript;base64,${Buffer.from(bundleCompiled).toString("base64")}`);
const namesSource=await readFile(new URL("../src/entity-names.ts",import.meta.url),"utf8");
const namesCompiled=ts.transpileModule(namesSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const createNames=i18n=>{const exports={};new Function("exports","require",namesCompiled)(exports,()=>i18n);return exports;};
const informationSource=await readFile(new URL("../src/map-information.ts",import.meta.url),"utf8");
const informationCompiled=ts.transpileModule(informationSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {mapInformationValues}=await import(`data:text/javascript;base64,${Buffer.from(informationCompiled).toString("base64")}`);
const parsed=ts.createSourceFile("main.ts",source,ts.ScriptTarget.ES2022,true);
const declaration=name=>{
  const node=parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text===name ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(value=>value.name.getText(parsed)===name));
  assert.ok(node,`Missing ${name}`);
  return node.getText(parsed);
};
const declarations=["state","patchKey","html","hiddenUnitIds","numeric","visibleSpot","locationAt",
  "formattedName","name","unitName","locationName","locationCategory","field","presetOptions",
  "addRowButton","removeRowButton","spotEditor","eventRows","eventEditor","mapEventLocationEditor","mapEventLocationChoices","eventGroupName","eventPositionLocation","eventPositionName","riseUnitOptions","eventBossOptions","effectiveEventPattern","patternEventGroups","eventTemplatePool","terrainPresetPatterns","availableTerrainLocations","eventChangePlan","viableEventTemplate","spawnEditor","circleEditor","bossEditor","informationValues","informationChoiceName","previewSummary","normalizeMapIndices","setPatchBatch"].map(declaration).join("\n");
const catalogs={};
for(const language of ["en","zh-CN"]) catalogs[language]=JSON.parse(await readFile(new URL(`../src/locales/${language}.json`,import.meta.url),"utf8"));
const compiled=ts.transpileModule(`
  const emptyIconConfig=()=>({}),renderAll=()=>{},unitIcon=()=>"icon.webp",terrainName=id=>String(id);
  const localizedName=named=>language==="zh-CN" && named.nameZh ? named.nameZh : named.name;
  const t=(key,values={})=>Object.entries(values).reduce((text,[name,value])=>text.replaceAll("{"+name+"}",String(value)),catalogs[language][key]);
  const {entityLabel,entityName,entitySearchText,findEntityName,unitTypeId,unitTypeName}=createNames({t,localizedName,formatMessage:(descriptor,lang)=>catalogs[lang][descriptor.key],message:key=>({key})});
  ${declarations}
  state.data=data;state.selectedLocation=1;
  state.builtinRecords=new Map(structuredClone(data.patterns).map(p=>[p.id,{...p,placements:p.placements ?? []}]));
  return {state,setPatchBatch,spotEditor,eventEditor,spawnEditor,circleEditor,bossEditor,previewSummary,informationValues,informationChoiceName,eventChangePlan,viableEventTemplate};
`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const createEditor=new Function("data","catalogs","language","createNames","mapInformationValues","eventGroups","eventKindForRow","eventKinds","eventTemplates","eventTerrainLocations","planEventChange","planEventDayChange","planMapEventLocationChange","eventTiming","isInvasionEvent","isMapEventUnit","usesMapEventLocations","frenzyEventPositions","frenzyPositions","frenzyTerrainPositions",compiled);
const dataset=()=>({
  locations:[{index:1,scope:"Surface",name:"Fort",category:"Major Base",typeIndex:1}],
  names:[
    {kind:"spot",id:3000,variation:0,type:"Fort",name:"Captain"},
    {kind:"spot",id:3200,variation:1,type:"Camp",name:"Soldiers"},
    {kind:"special_event",id:3080,variation:7727,name:"Frenzy Tower"},
    {kind:"special_event",id:530,variation:7707,name:"Hollow Frenzy Tower"},
    ...[[4770,"Tibia Mariner"],[4780,"Gaping Dragon"],[4820,"Nameless King"],[4840,"Morgott"]]
      .map(([id,name])=>({kind:"night_boss",id,variation:null,name}))
  ],
  patterns:[
    {id:1,terrainId:0,flags:[{rowId:10,modifierSet:3080,modifier:801,eventFlag:7727},
      {rowId:13,modifierSet:0,modifier:140,eventFlag:0},{rowId:14,modifierSet:3500,modifier:0,eventFlag:1044380230}],
      placements:[{rowId:11,locationIndex:1,attachId:190,unitId:3000,variationId:0,modifier:0}],
      play:{rowId:12,bossId1:4770,bossModifier1:801,bossId2:4820,bossModifier2:800,extraBossId1:-1,extraBossModifier1:0,extraBossId2:-1,extraBossModifier2:0}},
    {id:2,terrainId:4,flags:[{rowId:20,modifierSet:530,modifier:800,eventFlag:7707},
      {rowId:23,modifierSet:0,modifier:140,eventFlag:0},{rowId:24,modifierSet:1000,modifier:0,eventFlag:1046400230}],
      placements:[{rowId:21,locationIndex:1,attachId:190,unitId:3200,variationId:1,modifier:500}],
      play:{rowId:22,bossId1:4780,bossModifier1:800,bossId2:4840,bossModifier2:801,extraBossId1:-1,extraBossModifier1:0,extraBossId2:-1,extraBossModifier2:0}}
  ]
});
const start=(language="en")=>createEditor(dataset(),catalogs,language,createNames,mapInformationValues,eventGroups,eventKindForRow,eventKinds,eventTemplates,eventTerrainLocations,planEventChange,planEventDayChange,planMapEventLocationChange,eventTiming,isInvasionEvent,isMapEventUnit,usesMapEventLocations,frenzyEventPositions,frenzyPositions,frenzyTerrainPositions);
const selected=(markup,attribute)=>{
  const select=[...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match=>match[1].includes(attribute));
  assert.ok(select,`Missing select ${attribute}`);
  const options=[...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
  const chosen=options.filter(match=>/(?:^|\s)selected(?:\s|=|$)/.test(match[1]));
  assert.equal(chosen.length,1,"Exactly one result is selected");
  return {value:/value="([^"]*)"/.exec(chosen[0][1])[1],label:chosen[0][2]};
};
const eventLabel=(markup,rowId)=>{
  const label=new RegExp(`<strong data-event-label="${rowId}">([\\s\\S]*?)</strong>`).exec(markup);
  assert.ok(label,`Missing event card ${rowId}`);
  return label[1];
};
const results=editor=>{
  const p=editor.state.data.patterns[0],bosses=editor.bossEditor(p);
  return [selected(editor.spotEditor(p),'data-spot-preset="11"'),selected(editor.eventEditor(p),'data-event-preset="10"'),
    selected(bosses,'data-boss-preset="bossId1|bossModifier1"'),selected(bosses,'data-boss-preset="bossId2|bossModifier2"')];
};

test("unit, grouped event and regular Boss selectors display their current results",()=>{
  const current=results(start());
  assert.deepEqual(current.map(result=>result.value),["3000|0|0","frenzy","4770|801","4820|800"]);
  assert.match(current[0].label,/Fort - Captain/);
  assert.match(current[1].label,/Frenzy Tower/);
  assert.match(current[2].label,/Tibia Mariner/);
  assert.match(current[3].label,/Nameless King/);
  assert.doesNotMatch(start().bossEditor(start().state.data.patterns[0]),/data-boss-preset="extraBoss/);
});

test("unsaved parameter changes select their matching combinations independently",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  editor.setPatchBatch(p,[["spot",11,"unitId",3000,3200],["spot",11,"variationId",0,1],["spot",11,"modifier",0,500],
    ["flag",10,"modifier",801,800],["flag",10,"eventFlag",7727,7707],
    ["play",12,"bossId1",4770,4780],["play",12,"bossModifier1",801,800]]);
  const current=results(editor);
  assert.deepEqual(current.map(result=>result.value),["3200|1|500","frenzy","4780|800","4820|800"]);
  assert.match(current[0].label,/Camp - Soldiers/);
  assert.equal(current[1].label,"Frenzy Tower");
  assert.match(eventLabel(editor.eventEditor(p),10),/Frenzy Tower/);
  assert.match(current[2].label,/Gaping Dragon/);
});

test("unmatched unit and Boss modifiers remain explicit while event companion fields stay visible",()=>{
  for(const language of ["en","zh-CN"]) {
    const editor=start(language),p=editor.state.data.patterns[0];
    editor.setPatchBatch(p,[["spot",11,"modifier",0,999],["flag",10,"modifier",801,999],["play",12,"bossModifier1",801,999]]);
    const current=results(editor),unknown={value:"",label:language==="en" ? "Unknown" : "未知"};
    for(const index of [0,2]) assert.deepEqual(current[index],unknown);
    assert.equal(current[1].value,"frenzy");
    assert.equal(current[3].value,"4820|800");
    assert.match(editor.spotEditor(p),/value="3200\|1\|500"/);
    assert.match(editor.eventEditor(p),/value="999" data-edit-table="flag"/);
    assert.match(editor.bossEditor(p),/value="4780\|800"/);
  }
});

test("unknown IDs and variants show Unknown, then restore results when parameters are reverted",()=>{
  const editor=start(),p=editor.state.data.patterns[0],before=results(editor);
  editor.setPatchBatch(p,[["spot",11,"variationId",0,999],["flag",10,"eventFlag",7727,999],["play",12,"bossId1",4770,999]]);
  for(const index of [0,1,2]) assert.deepEqual(results(editor)[index],{value:"",label:"Unknown"});
  editor.setPatchBatch(p,[["spot",11,"variationId",0,0],["flag",10,"eventFlag",7727,7727],["play",12,"bossId1",4770,4770]]);
  assert.deepEqual(results(editor),before);
});

test("occupied points show Remove unit and empty points show Add unit",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  assert.match(editor.spotEditor(p),/data-remove-unit="11"/);
  assert.match(editor.spotEditor(p),/<div class="row-heading">[^]*?<button[^>]+class="row-remove"[^>]+data-remove-unit="11"/);
  assert.doesNotMatch(editor.spotEditor(p),/Visible unit|Map icon hidden|Hidden placeholder record/);
  assert.doesNotMatch(editor.spotEditor(p),/data-add-row="spot"/);
  p.placements=[];
  assert.match(editor.spotEditor(p),/data-add-row="spot"/);
  assert.doesNotMatch(editor.spotEditor(p),/data-remove-unit/);
});

test("event cards use localized event names and group companion rows",()=>{
  for(const language of ["en","zh-CN"]) {
    const editor=start(language),p=editor.state.data.patterns[0];
    const markup=editor.eventEditor(p);
    assert.equal(eventLabel(markup,10),language==="en" ? "Frenzy Tower" : "癫火塔");
    assert.match(markup,/data-event-row="10"/);
    assert.doesNotMatch(markup,/data-event-row="13"|data-event-row="14"/);
    assert.match(markup,/Companion flag · Row #13|配套标识 · Row #13/);
    assert.match(markup,/Companion flag · Row #14|配套标识 · Row #14/);
  }
});

test("changing a paired position keeps it in the same event card",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  editor.setPatchBatch(p,[["flag",14,"eventFlag",1044380230,1044360220]]);
  const markup=editor.eventEditor(p);
  assert.equal(eventLabel(markup,10),"Frenzy Tower");
  assert.equal(selected(markup,'data-event-preset="10"').value,"frenzy");
  assert.match(markup,/data-frenzy-position="1044360220" data-frenzy-event="10" checked/);
  assert.doesNotMatch(markup,/data-event-row="14"/);
});

test("dual Frenzy towers render checked locations on one card",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  p.flags.push({rowId:15,modifierSet:3500,modifier:0,eventFlag:1044360220});
  const markup=editor.eventEditor(p);
  assert.equal([...markup.matchAll(/data-event-row="/g)].length,1);
  assert.match(markup,/data-frenzy-position="1044360220" data-frenzy-event="10" checked/);
  assert.match(markup,/data-frenzy-position="1044380230" data-frenzy-event="10" checked/);
  assert.match(markup,/share the event controller/);assert.doesNotMatch(markup,/data-event-position=/);
});

test("unit-only Rise cards show expanded locations and puzzle choices without missing-flag warnings",()=>{
  const editor=start(),p=editor.state.data.patterns[0];p.flags=[];
  const placement=(rowId,unitId,attachId,locationIndex,variationId=0)=>({rowId,unitId,attachId,locationIndex,variationId,modifier:0,mapIndex:0,visible:true});
  p.placements=[placement(11,4090,300,1,7)];
  editor.state.templates={...editor.state.data,patterns:[structuredClone(p),
    {...structuredClone(p),id:3,placements:[placement(30,4100,301,2)]},
    {...structuredClone(p),id:4,placements:[placement(40,4090,307,3,8)]}]};
  const markup=editor.eventEditor(p);
  assert.match(markup,/data-event-row="-14"/);assert.match(markup,/data-event-position="-14"/);
  assert.match(markup,/data-location-preview="location"/);assert.match(markup,/data-preview-value="1"/);
  assert.match(markup,/value="301"/);assert.match(markup,/data-spot-preset="11"/);
  assert.match(markup,/value="4090\|7\|0" selected/);assert.match(markup,/value="4090\|8\|0"/);
  assert.doesNotMatch(markup,/event-issues/);assert.match(markup,/needs no day event/);
});

test("static events omit schedule controls while retaining the imported day flag",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  const firstDay=structuredClone(p);firstDay.id=3;
  Object.assign(firstDay.flags[0],{rowId:30,modifier:800,eventFlag:7707});
  editor.state.templates={...editor.state.data,patterns:[...editor.state.data.patterns,firstDay]};
  const markup=editor.eventEditor(p),select=markup.match(/<select data-event-preset="10">([\s\S]*?)<\/select>/)[1];
  assert.equal([...select.matchAll(/value="frenzy"/g)].length,1);
  assert.equal(selected(markup,'data-event-preset="10"').value,"frenzy");
  assert.doesNotMatch(select,/Day 1|Day 2/);
  assert.doesNotMatch(markup,/data-event-day=/);assert.equal(eventLabel(markup,10),"Frenzy Tower");
  assert.doesNotMatch(markup,/event-static-schedule/);
  assert.doesNotMatch(markup,/<(?:div|label) class="editor-field"><span>Schedule<\/span>/);
  assert.match(markup,/value="7727" data-edit-table="flag"/);
  assert.equal(editor.state.patches.size,0);
});

test("event type choices merge dates while the schedule selector reads the current date",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  p.flags=[{rowId:16,modifierSet:0,modifier:200,eventFlag:0},{rowId:17,modifierSet:3010,modifier:801,eventFlag:7721}];
  p.placements=[{rowId:11,unitId:2100,attachId:110,locationIndex:1,variationId:0,modifier:0,mapIndex:0,visible:true}];
  const first=structuredClone(p);first.id=3;Object.assign(first.flags[1],{modifier:800,eventFlag:7701});
  const maus=structuredClone(p);maus.id=4;Object.assign(maus.flags[0],{modifier:210});Object.assign(maus.flags[1],{modifierSet:3020,eventFlag:7722});
  Object.assign(maus.placements[0],{attachId:111,locationIndex:2});
  const mausFirst=structuredClone(maus);mausFirst.id=5;Object.assign(mausFirst.flags[1],{modifier:800,eventFlag:7702});
  editor.state.templates={...editor.state.data,patterns:[structuredClone(p),first,maus,mausFirst]};
  let markup=editor.eventEditor(p),type=markup.match(/<select data-event-preset="17">([\s\S]*?)<\/select>/)[1];
  const add=markup.match(/<select data-add-event>([\s\S]*?)<\/select>/)[1];
  assert.equal([...type.matchAll(/value="meteor"/g)].length,1);assert.doesNotMatch(type,/Day 1|Day 2|\|/);
  assert.equal([...add.matchAll(/value="mausoleum"/g)].length,1);assert.doesNotMatch(add,/Day 1|Day 2|\|/);
  assert.deepEqual(selected(markup,'data-event-preset="17"'),{value:"meteor",label:"Meteor strike"});
  assert.deepEqual(selected(markup,'data-event-day="17"'),{value:"2",label:"Day 2"});
  assert.equal(eventLabel(markup,17),"Meteor strike");
  editor.setPatchBatch(p,[["flag",17,"eventFlag",7721,7701],["flag",17,"modifier",801,800]]);
  markup=editor.eventEditor(p);assert.equal(selected(markup,'data-event-day="17"').value,"1");
  assert.equal(selected(markup,'data-event-preset="17"').value,"meteor");
});

test("event filters use stable kinds across legacy parameter sets, names and languages",async()=>{
  const csv=await readFile(new URL("../data/pattern_names.csv",import.meta.url),"utf8");
  assert.doesNotMatch(csv,/^special_event,/m);
  for(const language of ["en","zh-CN"]) {
    const editor=start(language),p=editor.state.data.patterns[0];
    for(const [set,flag,kind] of [[3000,7700,"extraBoss"],[505,7720,"extraBoss"],[530,7700,"extraBoss"],[3010,7701,"meteor"],[3010,7721,"meteor"],[520,7705,"gladius"],[3120,7725,"gladius"]]) {
      p.flags=[{rowId:10,modifierSet:set,modifier:800,eventFlag:flag}];
      assert.deepEqual(editor.informationValues(p,"event"),["event:"+kind]);
      assert.equal(editor.informationChoiceName("event","event:"+kind),catalogs[language]["event.kind."+kind]);
    }
    for(const [set,typeFlag,expected] of [[3040,8078,"gnoster"],[3060,8075,"morgott"]]) {
      p.flags=[{rowId:10,modifierSet:set,modifier:801,eventFlag:7725},{rowId:11,modifierSet:0,modifier:601,eventFlag:typeFlag}];
      if(expected==="morgott") p.flags[1].modifier=604;
      assert.deepEqual(editor.informationValues(p,"event"),["event:"+expected]);
    }
  }
});

test("event names and location labels are escaped",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  editor.state.data.locations.push({index:99,name:"<Tower> & name",eventFlag:1044380230});
  assert.match(editor.eventEditor(p),/&lt;Tower&gt; &amp; name/);
});

test("event preview coordinates come from attachment locations rather than numeric flag IDs",()=>{
  const editor=start(),p=editor.state.data.patterns[0];p.flags=[];
  editor.state.data.locations.push({index:23,scope:"Surface",name:"Event site",category:"Minor Base",typeIndex:2});
  p.flags=[{rowId:16,modifierSet:0,modifier:200,eventFlag:0},{rowId:17,modifierSet:3010,modifier:800,eventFlag:7701}];
  p.placements=[{rowId:11,unitId:2100,attachId:110,locationIndex:23,variationId:0,modifier:0,mapIndex:0,visible:true}];
  const markup=editor.eventEditor(p);
  assert.match(markup,/data-map-event-position="11" data-location-preview="location"/);
  assert.match(markup,/value="110" selected data-preview-value="23"/);
  assert.equal(editor.state.patches.size,0);
});

test("meteor and mausoleum use one editable candidate card with previews and protected last location",()=>{
  const editor=start("zh-CN"),p=editor.state.data.patterns[0];
  p.flags=[{rowId:16,modifierSet:0,modifier:200,eventFlag:0},{rowId:17,modifierSet:3010,modifier:800,eventFlag:7701},
    {rowId:18,modifierSet:0,modifier:210,eventFlag:0},{rowId:19,modifierSet:3020,modifier:801,eventFlag:7722}];
  p.placements=[{rowId:11,unitId:2100,attachId:110,locationIndex:1,variationId:0,modifier:0,mapIndex:0,visible:true}];
  let markup=editor.eventEditor(p);
  assert.equal([...markup.matchAll(/data-map-event-locations tabindex="0">/g)].length,1);
  assert.equal([...markup.matchAll(/data-map-event-position=/g)].length,1);
  assert.match(markup,/用于：陨石 \/ 移动灵庙/);assert.match(markup,/data-add-map-event-location data-location-preview="location"/);
  assert.match(markup,/<strong>地图事件点位<\/strong>/);
  assert.equal([...markup.matchAll(/data-set-map-event-locations>设置点位<\/button>/g)].length,2);
  assert.match(markup,/候选点位不足：已配置 2 个地图事件，但只有 1 个候选点位。请再添加 1 个点位。/);
  assert.match(markup,/data-remove-map-event-location="11"[^>]*disabled/);
  assert.doesNotMatch(markup,/data-event-position="(?:17|19)"/);
  editor.state.data.locations.push({index:23,scope:"Surface",name:"Second site",category:"Major Base",typeIndex:1});
  p.placements.push({...p.placements[0],rowId:15,unitId:2080,attachId:109,locationIndex:23});
  markup=editor.eventEditor(p);
  assert.equal([...markup.matchAll(/data-map-event-position=/g)].length,2);
  assert.doesNotMatch(markup,/data-remove-map-event-location="11"[^>]*disabled/);
  assert.match(markup,/value="109" selected data-preview-value="23"/);
  assert.doesNotMatch(markup,/候选点位不足/);
  p.placements.pop();
  assert.match(editor.eventEditor(p),/候选点位不足/);
  assert.equal(editor.state.patches.size,0);
});

test("adding a map event finds another terrain-compatible candidate when its template point is used",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  p.flags=[{rowId:16,modifierSet:0,modifier:200,eventFlag:0},{rowId:17,modifierSet:3010,modifier:800,eventFlag:7701}];
  p.placements=[{rowId:11,unitId:2100,attachId:110,locationIndex:1,variationId:0,modifier:0,mapIndex:0,visible:true}];
  const maus=structuredClone(p);maus.id=3;Object.assign(maus.flags[0],{modifier:210});Object.assign(maus.flags[1],{modifierSet:3020,eventFlag:7702});
  const alternate=structuredClone(p);alternate.id=4;Object.assign(alternate.placements[0],{rowId:40,attachId:111,locationIndex:2});
  editor.state.templates={...editor.state.data,patterns:[structuredClone(p),maus,alternate]};
  const template={pattern:maus,group:eventGroups(maus)[0]};
  assert.ok(editor.viableEventTemplate(p,null,template));
  const plan=editor.eventChangePlan(p,null,template);
  assert.equal(plan.error,undefined);assert.equal(plan.units.add.length,1);
  assert.equal(plan.units.add[0].locationIndex,2);assert.deepEqual(plan.units.remove,[]);
  assert.equal(p.placements.length,1,"Planning does not mutate the current pool");
  editor.state.templates.patterns.pop();
  assert.equal(editor.viableEventTemplate(p,null,template),false,"No independent point is available");
  p.placements.push({...p.placements[0],rowId:41,attachId:111,locationIndex:2});
  assert.equal(editor.viableEventTemplate(p,null,template),true,"Prepared locations are sufficient without a new point");
  assert.deepEqual(editor.eventChangePlan(p,null,template).units,{update:[],add:[],remove:[]});
});

test("fixed Frenzy locations expose hover preview without changing their selection",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  editor.state.data.locations.push({index:118,scope:"Surface",name:"North",category:"Frenzy Tower",typeIndex:8,eventFlag:1044380230},
    {index:119,scope:"Surface",name:"South",category:"Frenzy Tower",typeIndex:8,eventFlag:1044360220});
  const markup=editor.eventEditor(p);
  assert.match(markup,/data-hover-location="118"/);assert.match(markup,/data-hover-location="119"/);
  assert.match(markup,/data-frenzy-position="1044380230" data-frenzy-event="10" checked/);
  assert.equal(editor.state.patches.size,0);
});

test("complete events have one delete action and a separate add control",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  const markup=editor.eventEditor(p);
  const actions=[...markup.matchAll(/<div class="editor-row-actions">([\s\S]*?)<\/div>/g)];
  assert.equal(actions.length,1);
  assert.match(markup,/<div class="row-heading">[^]*?<button[^>]+class="row-remove"[^>]+data-remove-event="10"/);
  assert.match(actions[0][1],/data-add-event/);assert.doesNotMatch(actions[0][1],/data-remove-event/);
  assert.equal([...markup.matchAll(/data-event-row="/g)].length,1);
  assert.match(markup,/data-event-preset="10"/);
  assert.ok(markup.indexOf('data-add-event')>markup.lastIndexOf('data-remove-event='));
  p.flags=[];
  assert.match(editor.eventEditor(p),/data-add-event/);assert.doesNotMatch(editor.eventEditor(p),/data-remove-event/);
});

test("spawn and both night-circle lists keep numerical order when another value is selected",()=>{
  const editor=start(),[p,other]=editor.state.data.patterns;
  p.flags.push({rowId:15,modifierSet:190,modifier:705,eventFlag:0});
  other.flags.push({rowId:25,modifierSet:160,modifier:13001,eventFlag:0});
  p.play.playArea1=1002;p.play.playArea2=1000;other.play.playArea1=1001;other.play.playArea2=1002;
  const extra=structuredClone(p);extra.id=3;extra.flags.push({rowId:35,modifierSet:190,modifier:700,eventFlag:0});extra.play.playArea1=1000;extra.play.playArea2=1001;
  const third=structuredClone(extra);third.id=4;third.flags.at(-1).modifier=708;third.play.playArea1=1001;third.play.playArea2=1002;
  editor.state.templates={...editor.state.data,patterns:[structuredClone(p),extra,third,structuredClone(other)]};
  const order=(markup,field)=>{
    const select=[...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match=>match[1].includes(`data-edit-field="${field}"`));
    return [...select[2].matchAll(/value="(\d+)"/g)].map(match=>Number(match[1]));
  };
  assert.deepEqual(order(editor.spawnEditor(p),"modifier"),[700,705,708]);
  for(const field of ["playArea1","playArea2"]) assert.deepEqual(order(editor.circleEditor(p),field),[1000,1001,1002]);
  editor.setPatchBatch(p,[["flag",15,"modifier",705,13001],["play",12,"playArea1",1002,1001],["play",12,"playArea2",1000,1002]]);
  assert.deepEqual(order(editor.spawnEditor(p),"modifier"),[700,705,708,13001]);
  for(const field of ["playArea1","playArea2"]) assert.deepEqual(order(editor.circleEditor(p),field),[1000,1001,1002]);
  assert.match(editor.spawnEditor(p),/data-location-picker="spawn"/);
  assert.match(editor.circleEditor(p),/data-location-picker="circle1"/);assert.match(editor.circleEditor(p),/data-location-picker="circle2"/);
});

test("a manually entered unknown circle value stays selected at its numeric position",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  p.play.playArea1=1000;p.play.playArea2=1002;
  const other=editor.state.data.patterns[1];other.play.playArea1=1000;other.play.playArea2=1002;
  editor.state.templates=structuredClone(editor.state.data);
  editor.setPatchBatch(p,[["play",12,"playArea1",1000,1001]]);
  const markup=editor.circleEditor(p);
  const select=[...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match=>match[1].includes('data-edit-field="playArea1"'));
  assert.deepEqual([...select[2].matchAll(/value="(\d+)"/g)].map(match=>Number(match[1])),[1000,1001]);
  assert.deepEqual(selected(markup,'data-edit-field="playArea1"'),{value:"1001",label:"ID 1001"});
  assert.match(markup,/role="option" aria-selected="true" tabindex="-1" data-position-value="1001">ID 1001<\/button>/);
});

test("spawn and circle choices use immutable terrain presets and preserve only the imported outlier",()=>{
  const editor=start(),p=editor.state.data.patterns[0];p.terrainId=1;
  p.flags=[{rowId:15,modifierSet:190,modifier:703,eventFlag:0}];p.play.playArea1=1009;p.play.playArea2=1023;
  const builtin=structuredClone(p);builtin.flags[0].modifier=700;builtin.play.playArea1=1003;
  const other=structuredClone(builtin);other.id=3;other.terrainId=0;other.flags[0].modifier=702;other.play.playArea1=1009;other.play.playArea2=1010;
  const hollow=structuredClone(builtin);hollow.id=4;hollow.terrainId=4;hollow.flags[0].modifierSet=160;hollow.flags[0].modifier=13001;hollow.play.playArea1=11000;hollow.play.playArea2=12000;
  editor.state.templates={...editor.state.data,patterns:[builtin,other,hollow]};
  const values=(markup,field)=>[...markup.match(new RegExp(`<select[^>]*data-edit-field="${field}"[^>]*>([\\s\\S]*?)<\\/select>`))[1].matchAll(/value="(\d+)"/g)].map(match=>Number(match[1]));
  assert.deepEqual(values(editor.spawnEditor(p),"modifier"),[700,703]);
  assert.deepEqual(values(editor.circleEditor(p),"playArea1"),[1003,1009]);assert.deepEqual(values(editor.circleEditor(p),"playArea2"),[1023]);
  editor.setPatchBatch(p,[["flag",15,"modifier",703,700],["play",12,"playArea1",1009,1003]]);
  assert.deepEqual(values(editor.spawnEditor(p),"modifier"),[700]);assert.deepEqual(values(editor.circleEditor(p),"playArea1"),[1003]);
  assert.equal(builtin.flags[0].modifier,700);assert.equal(builtin.play.playArea1,1003);
});

test("known event names come from locales regardless of legacy names or parameter sets",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  editor.state.data.names.push({kind:"special_event_pattern",id:p.id,variation:null,name:"Legacy override"});
  assert.match(editor.previewSummary(p),/Frenzy Tower/);assert.doesNotMatch(editor.previewSummary(p),/Legacy override/);
  editor.setPatchBatch(p,[["flag",10,"modifierSet",3080,530],["flag",10,"eventFlag",7727,7707]]);
  assert.match(editor.previewSummary(p),/Frenzy Tower/);assert.doesNotMatch(editor.previewSummary(p),/Hollow Frenzy Tower/);
});

test("preview resolves invasion names from the active type flag",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  editor.state.data.names.push({kind:"special_event",id:3060,variation:7705,name:"Day 1 Gnoster Plague",nameZh:"第一天虫群"});
  editor.setPatchBatch(p,[["flag",10,"modifierSet",3080,3040],["flag",10,"modifier",801,800],
    ["flag",10,"eventFlag",7727,7705],["flag",13,"modifier",140,601],["flag",13,"eventFlag",0,8078]]);
  assert.match(editor.previewSummary(p),/Gnoster plague/);assert.doesNotMatch(editor.previewSummary(p),/Day 1 Gnoster Plague/);
  assert.doesNotMatch(editor.previewSummary(p),/Morgott/);
});

test("preview lists every configured event with its schedule and groups companion records",()=>{
  for(const language of ["en","zh-CN"]) {
    const editor=start(language),p=editor.state.data.patterns[0];
    p.flags.push({rowId:30,modifierSet:3010,modifier:800,eventFlag:7701},
      {rowId:31,modifierSet:0,modifier:200,eventFlag:0},
      {rowId:32,modifierSet:3010,modifier:801,eventFlag:7721},
      {rowId:33,modifierSet:3020,modifier:800,eventFlag:7702},
      {rowId:34,modifierSet:0,modifier:210,eventFlag:0});
    p.placements.push({rowId:35,locationIndex:1,attachId:191,unitId:4090,variationId:0,modifier:0});
    p.play.extraBossId2=4840;
    const markup=editor.previewSummary(p);
    const rows=[...markup.matchAll(/<li>(.*?)<\/li>/g)].map(match=>match[1]);
    assert.equal(rows.length,6,"Two meteors, a mausoleum, a rise, a Frenzy event and an extra Boss");
    const messages=catalogs[language];
    assert.ok(rows.some(row=>row.includes(messages["event.kind.meteor"]) && row.includes(messages["event.day1"])));
    assert.ok(rows.some(row=>row.includes(messages["event.kind.meteor"]) && row.includes(messages["event.day2"])));
    for(const kind of ["mausoleum","rise"]) assert.ok(rows.some(row=>row.includes(messages[`event.kind.${kind}`].replaceAll("'","&#39;")) && !row.includes("<span>")));
    assert.ok(rows.some(row=>row.includes(messages["event.kind.frenzy"]) && !row.includes("<span>")));
    assert.doesNotMatch(markup,/Present from the start|开局存在/);
    assert.ok(rows.some(row=>row.includes(messages["event.kind.extraBoss"]) && row.includes(messages["event.day2"])));
    const card=markup.slice(0,markup.indexOf('<div class="detail-section">'));
    assert.doesNotMatch(card,/<li>|preview-events/);
    for(const key of ["ui.spawn","ui.night1Circle","ui.night2Circle"]) assert.ok(!markup.includes(messages[key]));
  }
});

test("preview reads unsaved changes for every event and removes deleted events",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  p.flags.push({rowId:30,modifierSet:3010,modifier:800,eventFlag:7701},
    {rowId:31,modifierSet:0,modifier:200,eventFlag:0});
  editor.setPatchBatch(p,[["flag",30,"modifier",800,801],["flag",30,"eventFlag",7701,7721]]);
  assert.match(editor.previewSummary(p),/<li><strong>Meteor strike<\/strong><span>Day 2<\/span><\/li>/);
  assert.match(editor.previewSummary(p),/Frenzy Tower/);
  p.flags=p.flags.filter(row=>![30,31].includes(row.rowId));
  assert.doesNotMatch(editor.previewSummary(p),/Meteor strike/);
  assert.equal([...editor.previewSummary(p).matchAll(/<li>/g)].length,1);
});

test("preview shows the empty event message when no events are configured",()=>{
  const editor=start(),p=editor.state.data.patterns[0];
  p.flags=[];
  assert.match(editor.previewSummary(p),/No special event/);
  assert.doesNotMatch(editor.previewSummary(p),/preview-events|<li>/);
});
