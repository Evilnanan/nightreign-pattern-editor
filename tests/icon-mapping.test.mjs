import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const bundled=JSON.parse(await readFile(new URL("../data/icon-mapping.json",import.meta.url),"utf8"));
const source=await readFile(new URL("../src/icon-mapping.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const icons=new Function("require","exports","__ICON_FILES__",`${compiled}\nreturn exports;`)(
  name=>{assert.equal(name,"./i18n");return {t:key=>key};}, {}, ["3000.webp","Boss.webp","Evergaol.webp"]);
// Runtime defaults arrive through load_icon_config, rather than a frontend import.
const loadedConfig=()=>({...icons.emptyIconConfig(),mapIconScales:{...bundled.mapIconScales}});
const main=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
const parsed=ts.createSourceFile("main.ts",main,ts.ScriptTarget.ES2022,true);
const declarations=names=>names.map(name=>parsed.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text===name).getText(parsed)).join("\n");
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function artwork(config=loadedConfig(),mode="preview",criteria=new Map()) {
  const location={index:1,scope:"Surface",category:"Major Base",typeIndex:1};
  const pattern={placements:[{rowId:1,locationIndex:1,unitId:3000,variationId:0}]};
  const state={iconConfig:config,mode,criteria};
  const helpers=compile(`
    const {mapIconScale,unitIcon,unitBadge,badgeStyle,baseFrame,baseGlow,baseScale,baseShadow,categoryIcon,defaultBadgeStyle,imageUrl,fileIconStyle,iconFileKey}=icons;
    const html=String,t=key=>key,numeric=(p,table,rowId,field,value)=>value,visibleSpot=()=>true,currentPattern=()=>pattern,mapIconSize=()=>27;
    ${declarations(["iconArtwork","sharedUnitArtwork","filteredPointArtwork","displayedSpot","unresolvedPointIcon","unresolvedPointArtwork","pointArtwork","pointIconSize"])}
    return {pointArtwork,pointIconSize,sharedUnitArtwork};
  `);
  return {...new Function("icons","state","pattern",helpers)(icons,state,pattern),location,pattern};
}

test("map scale defaults come from JSON and match the existing building, Boss and Evergaol sizes",()=>{
  const config=loadedConfig();
  for(const [file,scale] of [["3000.webp",2],["BOSS.PNG",1.2],["Evergaol.jpg",1.5],["Frenzy Tower.webp",1.2],["New Icon.webp",1],[null,1]])
    assert.equal(icons.mapIconScale(config,file),scale);
  config.mapIconScales.boss=137;
  assert.equal(icons.mapIconScale(config,"Boss.webp"),1.37);
  config.mapIconScales={};
  assert.equal(icons.mapIconScale(config,"3000.webp"),1);
});

test("variant map scales override units and asset defaults independently of frame scales",()=>{
  const config=loadedConfig();
  config.unitIconScales[3000]=175;
  config.unitMapIconScales[3000]=100;
  config.variantMapIconScales["3000|0"]=233;
  assert.equal(icons.mapIconScale(config,"3000.webp",3000,0),2.33);
  assert.equal(icons.mapIconScale(config,"3000.webp",3000,1),1);
  assert.equal(icons.mapIconScale(config,"3000.webp",3000),1);
  assert.equal(icons.baseScale(config,3000,0),175);
  delete config.variantMapIconScales["3000|0"];
  assert.equal(icons.mapIconScale(config,"3000.webp",3000,0),1);
  delete config.unitMapIconScales[3000];
  assert.equal(icons.mapIconScale(config,"3000.webp",3000,0),2);
});

test("map rendering and floor spacing use the same arbitrary configured scale",()=>{
  const config=loadedConfig();
  config.unitMapIconScales[3000]=233;
  const editor=artwork(config);
  const result=editor.pointArtwork(editor.location,editor.pattern);
  assert.equal(result.mapScale,2.33);
  assert.match(result.html,/--map-icon-scale:2\.33/);
  assert.equal(editor.pointIconSize(editor.location),27*2.33);
  config.mapIconScales[3000]=145;
  const unresolved=editor.pointArtwork(editor.location,null);
  assert.equal(unresolved.mapScale,1.45);
  assert.match(unresolved.html,/--map-icon-scale:1\.45/);
});

test("filtering resolves a common scale and retains an unresolved point when selected variants have different sizes",()=>{
  const config=loadedConfig();
  config.unitMapIconScales[3000]=180;
  const editor=artwork(config,"filter",new Map([[1,{include:new Set(["3000|0","3000|1"])}]]));
  assert.equal(editor.pointArtwork(editor.location,null).mapScale,1.8);
  config.variantMapIconScales["3000|1"]=110;
  assert.equal(editor.pointArtwork(editor.location,null).mapScale,2);
});

const save=compile(`${declarations(["saveMapIconScale"])}\nreturn saveMapIconScale;`);
const saver=(config,variant=null,invoke=async()=>{})=>{
  const state={iconConfig:config,iconSelectedId:3000,iconSelectedVariation:variant,iconBusy:false};
  const run=new Function("state","invoke","message","errorMessage","renderAll","renderIconStudio",save)(
    state,invoke,(key,params)=>({key,params}),String,()=>{},()=>{});
  return {state,run};
};

test("map scale saves persist explicit 100%, reset inheritance and preserve every other configuration field",async()=>{
  const config=loadedConfig();
  config.unitIconScales[3000]=175;
  config.variantMapIconScales["3000|0"]=233;
  const writes=[];
  const editor=saver(config,null,async(command,args)=>{assert.equal(command,"save_icon_config");writes.push(args.config);});
  await editor.run(100);
  assert.equal(writes[0].unitMapIconScales[3000],100);
  assert.equal(writes[0].unitIconScales[3000],175);
  assert.equal(writes[0].variantMapIconScales["3000|0"],233);
  assert.deepEqual(writes[0].mapIconScales,config.mapIconScales);
  await editor.run(null);
  assert.equal(Object.hasOwn(editor.state.iconConfig.unitMapIconScales,3000),false);
  const variant=saver(editor.state.iconConfig,0);
  await variant.run(null);
  assert.equal(Object.hasOwn(variant.state.iconConfig.variantMapIconScales,"3000|0"),false);
});

test("failed scale writes restore the previous configuration and unlock the editor",async()=>{
  const config=loadedConfig();
  const editor=saver(config,null,async()=>{throw new Error("write failed");});
  await editor.run(230);
  assert.equal(editor.state.iconConfig,config);
  assert.equal(editor.state.iconBusy,false);
  assert.equal(editor.state.iconMessage.key,"errors.saveMapIconScale");
});

test("units inherit their actual primary file's frame, glow and frame scale, with explicit unit and variant overrides",()=>{
  const config=loadedConfig();
  config.fileIconStyles["3000"]={frame:true,glow:true,scale:180};
  assert.equal(icons.baseFrame(config,3000,0),true);
  assert.equal(icons.baseGlow(config,3000,0),true);
  assert.equal(icons.baseScale(config,3000,0),180);
  const editor=artwork(config);
  assert.match(editor.pointArtwork(editor.location,editor.pattern).html,/icon-art-base-layer framed glowing/);
  config.unitIconFrames[3000]=false;
  config.unitIconGlows[3000]=false;
  config.unitIconScales[3000]=100;
  assert.equal(icons.baseFrame(config,3000,0),false);
  assert.equal(icons.baseGlow(config,3000,0),false);
  assert.equal(icons.baseScale(config,3000,0),100);
  config.variantIconFrames["3000|0"]=true;
  assert.equal(icons.baseFrame(config,3000,0),true);
  assert.equal(icons.baseFrame(config,3000,1),false);
  delete config.unitIconScales[3000];
  config.variantIcons["3000|0"]="Boss.webp";
  config.fileIconStyles.boss={scale:240};
  assert.equal(icons.baseScale(config,3000,0),240);
  assert.equal(icons.baseScale(config,3000,1),180);
});

test("category fallback icons and unresolved bases inherit file settings too",()=>{
  const config=loadedConfig();
  config.unitIcons[3000]="Castle.webp";
  config.fileIconStyles.castle={frame:true,glow:true,scale:135};
  const editor=artwork(config);
  assert.match(editor.pointArtwork(editor.location,editor.pattern).html,/framed glowing/);
  config.fileIconStyles["3000"]={frame:true,glow:true,scale:150};
  const unresolved=editor.pointArtwork(editor.location,null);
  assert.match(unresolved.html,/framed glowing/);
  assert.match(unresolved.html,/icon-art-question/);
  editor.location.typeIndex=16;
  config.fileIconStyles.orb={frame:false,glow:true,scale:175};
  const underlevel=editor.pointArtwork(editor.location,null);
  assert.match(underlevel.html,/icon-art-base-layer  glowing/);
  assert.doesNotMatch(underlevel.html,/framed/);
});

test("badges inherit defaults from the badge file and retain higher-priority unit and variant styles",()=>{
  const config=loadedConfig();
  config.unitBadges[3000]="Boss.webp";
  config.fileIconStyles.boss={size:72,frame:true,scale:190,glow:true};
  assert.deepEqual(icons.badgeStyle(config,3000,0),{size:72,frame:true,scale:190,glow:true});
  config.unitBadgeStyles[3000]={size:48,frame:false,scale:100,glow:false};
  assert.deepEqual(icons.badgeStyle(config,3000,0),icons.defaultBadgeStyle);
  config.variantBadgeStyles["3000|0"]={size:60,frame:true,scale:150,glow:false};
  assert.equal(icons.badgeStyle(config,3000,0).size,60);
  assert.equal(icons.badgeStyle(config,3000,1).size,48);
  delete config.unitBadgeStyles[3000];delete config.variantBadgeStyles["3000|0"];
  config.variantBadges["3000|0"]=null;
  assert.deepEqual(icons.badgeStyle(config,3000,0),icons.defaultBadgeStyle);
});

function settingsSaver(config,{file="Boss.webp",variant=null,invoke=async()=>{}}={}) {
  const state={iconConfig:config,iconSelectedId:3000,iconSelectedVariation:variant,iconSelectedFile:file,iconBusy:false};
  const code=compile(`${declarations(["saveFileIconSetting","saveBaseEffect","saveBaseScale","saveBadgeStyle"])}\nreturn {saveFileIconSetting,saveBaseEffect,saveBaseScale,saveBadgeStyle};`);
  const methods=new Function("state","invoke","message","errorMessage","renderAll","renderIconStudio","iconFileKey",code)(
    state,invoke,(key,params)=>({key,params}),String,()=>{},()=>{},icons.iconFileKey);
  return {state,...methods};
}

test("unit controls persist false and 100 as overrides, and reset restores file inheritance",async()=>{
  const config=loadedConfig();config.fileIconStyles["3000"]={frame:true,glow:true,scale:180};
  config.unitBadges[3000]="3000.webp";
  const editor=settingsSaver(config);
  await editor.saveBaseEffect("frame",false);
  await editor.saveBaseEffect("glow",false);
  await editor.saveBaseScale(100);
  await editor.saveBadgeStyle(icons.defaultBadgeStyle);
  assert.equal(editor.state.iconConfig.unitIconFrames[3000],false);
  assert.equal(editor.state.iconConfig.unitIconGlows[3000],false);
  assert.equal(editor.state.iconConfig.unitIconScales[3000],100);
  assert.deepEqual(editor.state.iconConfig.unitBadgeStyles[3000],icons.defaultBadgeStyle);
  await editor.saveBaseEffect("frame",null);
  await editor.saveBaseScale(null);
  await editor.saveBadgeStyle(null);
  assert.equal(icons.baseFrame(editor.state.iconConfig,3000,0),true);
  assert.equal(icons.baseScale(editor.state.iconConfig,3000,0),180);
  assert.equal(icons.badgeStyle(editor.state.iconConfig,3000,0).frame,true);
});

test("file settings save and reset individual fields while retaining unit overrides",async()=>{
  const config=loadedConfig();config.unitIconFrames[3000]=false;config.unitMapIconScales[3000]=100;
  const writes=[];
  const editor=settingsSaver(config,{invoke:async(command,args)=>writes.push(args.config)});
  await editor.saveFileIconSetting("frame",true);
  await editor.saveFileIconSetting("scale",155);
  await editor.saveFileIconSetting("mapScale",175);
  assert.deepEqual(editor.state.iconConfig.fileIconStyles.boss,{frame:true,scale:155});
  assert.equal(editor.state.iconConfig.mapIconScales.boss,175);
  assert.equal(editor.state.iconConfig.unitIconFrames[3000],false);
  assert.equal(editor.state.iconConfig.unitMapIconScales[3000],100);
  assert.deepEqual(config.fileIconStyles,{});
  await editor.saveFileIconSetting("frame",null);
  assert.deepEqual(editor.state.iconConfig.fileIconStyles.boss,{scale:155});
  await editor.saveFileIconSetting("scale",null);
  assert.equal(Object.hasOwn(editor.state.iconConfig.fileIconStyles,"boss"),false);
  assert.equal(writes.length,5);
});

test("file setting write failures restore the previous defaults and preserve unit overrides",async()=>{
  const config=loadedConfig();
  const editor=settingsSaver(config,{invoke:async()=>{throw new Error("write failed");}});
  await editor.saveFileIconSetting("glow",true);
  assert.equal(editor.state.iconConfig,config);
  assert.equal(editor.state.iconBusy,false);
  assert.equal(editor.state.iconMessage.key,"errors.saveIconFileSetting");
});

test("the file configuration page shows inherited defaults and only enables reset for configured properties",()=>{
  const config=loadedConfig();config.fileIconStyles.boss={frame:true,scale:175};
  const state={iconConfig:config,iconSelectedFile:"Boss.webp",iconFileSearch:"",iconBusy:false};
  const studio={innerHTML:"",querySelector:()=>({addEventListener:()=>{}}),querySelectorAll:()=>[]};
  const code=compile(`
    const {fileIconStyle,iconFileKey,mapIconScale,defaultBadgeStyle}=icons;
    const iconFiles=["Boss.webp"],html=String,t=key=>key;
    const iconStudioHeader=()=>"<nav>file settings</nav>",iconArtwork=()=>"",bindIconStudioActions=()=>{},renderIconFileList=()=>{};
    ${declarations(["renderIconFileStudio"])}
    renderIconFileStudio(studio);
  `);
  new Function("icons","state","studio",code)(icons,state,studio);
  assert.match(studio.innerHTML,/data-file-icon-setting="mapScale"[^>]*value="120"/);
  assert.match(studio.innerHTML,/data-file-icon-setting="frame"[^>]*checked/);
  assert.match(studio.innerHTML,/data-file-icon-setting="scale"[^>]*value="175"/);
  assert.match(studio.innerHTML,/data-reset-file-icon-setting="glow"[^>]*disabled/);
  assert.doesNotMatch(studio.innerHTML,/data-reset-file-icon-setting="frame"[^>]*disabled/);
  assert.doesNotMatch(studio.innerHTML,/icon-map-scale-preview/);
  assert.match(studio.innerHTML,/data-file-icon-setting="shadow"[^>]*checked/);
});

test("black map shadow inherits file settings, supports explicit unit and variant overrides and keeps white glow",()=>{
  const config=loadedConfig();
  assert.equal(icons.baseShadow(config,3000,0),true);
  config.fileIconStyles["3000"]={shadow:false,glow:true};
  const editor=artwork(config);
  assert.equal(icons.baseShadow(config,3000,0),false);
  let rendered=editor.pointArtwork(editor.location,editor.pattern).html;
  assert.match(rendered,/icon-no-map-shadow/);
  assert.match(rendered,/glowing/);
  config.unitIconShadows[3000]=true;
  assert.equal(icons.baseShadow(config,3000,0),true);
  rendered=editor.pointArtwork(editor.location,editor.pattern).html;
  assert.doesNotMatch(rendered,/icon-no-map-shadow/);
  config.variantIconShadows["3000|0"]=false;
  assert.equal(icons.baseShadow(config,3000,0),false);
  assert.equal(icons.baseShadow(config,3000,1),true);
  assert.match(editor.pointArtwork(editor.location,editor.pattern).html,/icon-no-map-shadow/);
  assert.match(editor.pointArtwork(editor.location,null).html,/icon-no-map-shadow/);
  // A file's map shadow setting must not be saved as a badge style property.
  config.unitBadges[3000]="3000.webp";
  assert.equal(Object.hasOwn(icons.badgeStyle(config,3000,0),"shadow"),false);
});

test("saving shadow overrides preserves false, true and restoring inheritance",async()=>{
  const config=loadedConfig();
  const editor=settingsSaver(config,{file:"3000.webp"});
  await editor.saveFileIconSetting("shadow",false);
  assert.equal(editor.state.iconConfig.fileIconStyles["3000"].shadow,false);
  await editor.saveBaseEffect("shadow",true);
  assert.equal(editor.state.iconConfig.unitIconShadows[3000],true);
  assert.equal(icons.baseShadow(editor.state.iconConfig,3000,0),true);
  await editor.saveBaseEffect("shadow",null);
  assert.equal(icons.baseShadow(editor.state.iconConfig,3000,0),false);
  const variant=settingsSaver(editor.state.iconConfig,{variant:0});
  await variant.saveBaseEffect("shadow",false);
  assert.equal(variant.state.iconConfig.variantIconShadows["3000|0"],false);
  await editor.saveFileIconSetting("shadow",null);
  assert.equal(icons.baseShadow(editor.state.iconConfig,3000,0),true);
});
