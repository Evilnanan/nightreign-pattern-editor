import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../src/boss-label-layout.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {placeBossLabels}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const centre=rect=>({x:rect.x+rect.width/2,y:rect.y+rect.height/2});
const icon=label=>({locationId:label.id,x:label.x-label.iconWidth/2,y:label.y-label.iconHeight/2,width:label.iconWidth,height:label.iconHeight});
const collides=(a,b)=>a.x+2<b.x+b.width-2 && a.x+a.width-2>b.x+2 && a.y+1<b.y+b.height-1 && a.y+a.height-1>b.y+1;
const core=rect=>({x:rect.x+rect.width*.12,y:rect.y+rect.height*.12,width:rect.width*.76,height:rect.height*.76});
const staysWithIcon=label=>{
  const artwork=icon(label);
  assert.ok(Math.abs(centre(label.rect).x-label.x)<=label.iconWidth/2+.01);
  assert.ok(label.rect.x<=artwork.x+artwork.width && label.rect.x+label.rect.width>=artwork.x &&
    label.rect.y<=artwork.y+artwork.height && label.rect.y+label.rect.height>=artwork.y,"The caption stays attached to its own icon");
  const visible=label.artwork ?? core(artwork);
  assert.ok(label.rect.x<visible.x+visible.width && label.rect.x+label.rect.width>visible.x &&
    label.rect.y<visible.y+visible.height && label.rect.y+label.rect.height>visible.y,"Transparent image padding does not count as contact");
};

test("English preview #1 names stay associated with their own Boss and Evergaol",()=>{
  const labels=[
    {id:39,x:380.6,y:326.5,width:87,height:18,iconWidth:40.5,iconHeight:40.5,overlap:14},
    {id:44,x:538.6,y:310.4,width:100,height:34,iconWidth:40.5,iconHeight:40.5,overlap:14},
    {id:55,x:470.5,y:325.1,width:100,height:34,iconWidth:32.4,iconHeight:32.4},
  ];
  const placed=placeBossLabels(labels,labels.map(icon),854,854);
  for(const label of placed) {
    staysWithIcon(label);
    const caption=centre(label.rect),distance=Math.hypot(caption.x-label.x,caption.y-label.y);
    for(const other of labels) if(other.id!==label.id)
      assert.ok(distance<=Math.hypot(caption.x-other.x,caption.y-other.y)+Math.min(label.iconWidth,label.iconHeight)/4);
    assert.equal(label.fallback,false);
    for(const other of placed) if(label.id!==other.id)assert.equal(collides(label.rect,other.rect),false);
  }
  const leonine=placed.find(label=>label.id===55),nox=placed.find(label=>label.id===39);
  assert.ok(Math.abs(centre(leonine.rect).x-leonine.x)<Math.abs(centre(leonine.rect).x-nox.x));
});

test("English preview #0 Lake captions stay attached without reversing icon order",()=>{
  const labels=[
    {id:28,x:387.6,y:592.8,width:84,height:18,iconWidth:54,iconHeight:54},
    {id:48,x:369.9,y:609.7,width:100,height:34,iconWidth:32.4,iconHeight:32.4},
  ];
  const placed=placeBossLabels(labels,labels.map(icon),854,854);
  const tower=placed.find(label=>label.id===28),boss=placed.find(label=>label.id===48);
  assert.ok(Math.abs(centre(tower.rect).x-tower.x)<=tower.iconWidth*.35+.01);
  staysWithIcon(tower);staysWithIcon(boss);
  assert.ok(centre(tower.rect).y<centre(boss.rect).y);
  assert.equal(collides(tower.rect,boss.rect),false);
  assert.ok(placed.every(label=>!label.fallback));
});

test("Mistwood Evergaol uses nearby space without covering neighbouring portraits",()=>{
  const labels=[
    {id:43,x:673.31856,y:415.804968,width:73,height:18,iconWidth:40.5,iconHeight:40.5,overlap:14},
    {id:54,x:651.30288,y:431.718624,width:89,height:18,iconWidth:32.3906,iconHeight:32.3906},
  ];
  const icons=[...labels.map(icon),{locationId:24,x:633.633132,y:332.992152,width:54,height:54}];
  const placed=placeBossLabels(labels,icons,852,852),gaol=placed.find(label=>label.id===43);
  staysWithIcon(gaol);
  assert.equal(gaol.fallback,false);
  for(const artwork of icons)if(artwork.locationId!==gaol.id)assert.equal(collides(gaol.rect,core(artwork)),false);
});

test("preview #0 Godskin Apostle avoids the camp badge while staying attached in narrow gaps",()=>{
  const fixtures=[
    {size:854,gaol:{x:654.0625,y:396.546875,width:40.5,height:40.5},
      artwork:{x:660.4832,y:403.2146,width:27.4116,height:27.1646},
      camp:{locationId:24,x:634.625,y:333.9844,width:54,height:54,artwork:{x:638,y:347.7254,width:46.5268,height:26.7589},
        badge:{x:664.6617,y:362.7258,width:22.0203,height:24.9348}},
      boss:{locationId:54,x:636.1016,y:416.5234,width:32.3906,height:32.3906,artwork:{x:638.5931,y:419.7625,width:27.9058,height:25.9125}}},
    {size:694,gaol:{x:530.6094,y:321.4688,width:34.5,height:34.5},
      artwork:{x:536.0789,y:327.1486,width:23.3506,height:23.1402},
      camp:{locationId:24,x:514.5625,y:270.375,width:46,height:46,artwork:{x:517.4375,y:282.0804,width:39.6339,height:22.7946},
        badge:{x:540.1402,y:294.8488,width:18.7664,height:21.2502}},
      boss:{locationId:54,x:516.1875,y:337.8438,width:27.5938,height:27.5938,artwork:{x:518.3101,y:340.6031,width:23.7731,height:22.075}}},
  ];
  for(const {size,gaol,artwork,camp,boss} of fixtures) {
    const label={id:43,...centre(gaol),width:100,height:30,iconWidth:gaol.width,iconHeight:gaol.height,artwork,overlap:14};
    const neighbour={id:54,...centre(boss),width:100,height:30,iconWidth:boss.width,iconHeight:boss.height,artwork:boss.artwork};
    const [placed]=placeBossLabels([label,neighbour],[{...icon(label),artwork},camp,boss],size,size);
    staysWithIcon(placed);
    assert.equal(placed.fallback,false,"A nearby slot avoids both the badge above and the Boss below");
    for(const rect of [camp.artwork,camp.badge,boss.artwork]) {
      const w=Math.min(placed.rect.x+placed.rect.width-2,rect.x+rect.width)-Math.max(placed.rect.x+2,rect.x);
      const h=Math.min(placed.rect.y+placed.rect.height-1,rect.y+rect.height)-Math.max(placed.rect.y+1,rect.y);
      assert.ok(w<=3 || h<=2,"Only harmless edge contact is allowed with foreign artwork or badges");
    }
  }
});

test("short Chinese captions stay centred below clear portraits instead of minimising necessary contact",()=>{
  const fixtures=[
    {id:51,x:286.7656,y:203.375,width:30,artwork:{x:272.0163,y:189.2041,width:30.3662,height:28.3418}},
    {id:48,x:369.875,y:609.7188,width:30,artwork:{x:356.1713,y:596.7625,width:27.9058,height:25.9125}},
    {id:54,x:652.2969,y:432.7188,width:43,artwork:{x:637.5476,y:418.5479,width:30.3662,height:28.3418}},
  ];
  for(const scale of [1,.5,.3125]) for(const fixture of fixtures) {
    const label={...fixture,width:fixture.width*scale,height:16*scale,iconWidth:32.3906,iconHeight:32.3906,scale};
    const [placed]=placeBossLabels([label],[{...icon(label),artwork:fixture.artwork}],854,854);
    staysWithIcon(placed);
    assert.equal(placed.fallback,false);
    assert.ok(Math.abs(centre(placed.rect).x-centre(fixture.artwork).x)<.001,"An empty lower slot stays horizontally centred");
    assert.ok(Math.abs(placed.rect.y-(fixture.artwork.y+fixture.artwork.height-8*scale))<.001,
      "Small required contact does not make an upper or diagonal slot preferable");
  }
});

test("Northwest Lake Evergaol keeps its caption attached and avoids nearby buildings",()=>{
  const label={id:38,x:295.454004,y:538.240776,width:116,height:18,iconWidth:40.5,iconHeight:40.5,overlap:14};
  const icons=[icon(label),
    {locationId:12,x:210.961044,y:529.35174,width:54,height:54},
    {locationId:13,x:245.905824,y:442.265412,width:54,height:54},
    {locationId:111,x:313.637328,y:545.371104,width:27,height:27},
  ];
  const [placed]=placeBossLabels([label],icons,852,852);
  staysWithIcon(placed);
  assert.equal(placed.fallback,false);
  for(const artwork of icons)if(artwork.locationId!==placed.id)assert.equal(collides(placed.rect,core(artwork)),false);
});

test("free space above wins over covering artwork when other edges are blocked",()=>{
  const label={id:1,x:200,y:200,width:90,height:18,iconWidth:40,iconHeight:40,overlap:14};
  const icons=[icon(label),{x:130,y:210,width:140,height:50},{x:70,y:180,width:90,height:50},{x:254,y:180,width:90,height:50}];
  const [placed]=placeBossLabels([label],icons,500,500);
  staysWithIcon(placed);
  assert.ok(centre(placed.rect).y<placed.y);
  assert.equal(placed.fallback,false);
});

test("attachment wins when another icon occupies every nearby free position",()=>{
  const label={id:1,x:200,y:200,width:100,height:18,iconWidth:40,iconHeight:40,overlap:14};
  const foreign={locationId:2,x:140,y:140,width:120,height:120,artwork:{x:140,y:140,width:120,height:120}};
  const icons=[icon(label),foreign];
  const [placed]=placeBossLabels([label],icons,500,500);
  staysWithIcon(placed);
  assert.ok(Math.abs(centre(placed.rect).y-label.y)<=label.iconHeight/2);
  assert.equal(placed.fallback,true);
});

test("different transparent margins still produce overlap with the visible artwork at each zoom",()=>{
  for(const scale of [1,.5,.3125]) {
    const artwork={x:182,y:186,width:40,height:34};
    const label={id:1,x:200,y:200,width:100*scale,height:18*scale,iconWidth:90,iconHeight:100,artwork,scale};
    const [placed]=placeBossLabels([label],[{...icon(label),artwork}],500,500);
    staysWithIcon(placed);
    const w=Math.min(placed.rect.x+placed.rect.width-2*scale,artwork.x+artwork.width)-Math.max(placed.rect.x+2*scale,artwork.x);
    const h=Math.min(placed.rect.y+placed.rect.height-scale,artwork.y+artwork.height)-Math.max(placed.rect.y+scale,artwork.y);
    assert.ok(w>=3*scale && h>=3*scale,"The visible text body overlaps the icon at fixed screen depth");
    assert.equal(placed.fallback,false);
  }
});

test("layout is deterministic regardless of the input order",()=>{
  const labels=[
    {id:1,x:200,y:200,width:100,height:34,iconWidth:32,iconHeight:32},
    {id:2,x:260,y:203,width:100,height:34,iconWidth:40,iconHeight:40},
    {id:3,x:215,y:225,width:80,height:18,iconWidth:32,iconHeight:32},
  ];
  const icons=labels.map(icon);
  assert.deepEqual(placeBossLabels(labels,icons,500,500),placeBossLabels([...labels].reverse(),[...icons].reverse(),500,500));
});

test("Great Hollow floor names remain on their assigned side and in floor order",()=>{
  for(const side of [-1,1]) {
    const labels=[200,232,264].map((y,id)=>({id,x:250,y,width:120,height:18,iconWidth:32,iconHeight:32,side}));
    const placed=placeBossLabels(labels,labels.map(icon),600,600);
    for(const label of placed) {
      if(side===-1)assert.ok(label.rect.x+label.rect.width<=label.x-label.iconWidth/2+4);
      else assert.ok(label.rect.x>=label.x+label.iconWidth/2-4);
      assert.equal(label.fallback,false);
    }
    assert.ok(placed.every((label,index)=>index===0 || centre(label.rect).y>centre(placed[index-1].rect).y));
  }
});

test("crowded fallback keeps every name local and visible within the map",()=>{
  const labels=Array.from({length:6},(_,id)=>({id,x:180,y:180,width:120,height:34,iconWidth:32,iconHeight:32}));
  const placed=placeBossLabels(labels,labels.map(icon),400,400);
  assert.equal(placed.length,labels.length);
  assert.ok(placed.some(label=>label.fallback));
  for(const label of placed)assert.ok(Math.abs(centre(label.rect).x-label.x)<=label.iconWidth*.35+.01);
  const [edge]=placeBossLabels([{id:9,x:398,y:398,width:90,height:34,iconWidth:32,iconHeight:32}],[],400,400);
  assert.ok(edge.rect.x>=6 && edge.rect.y>=6 && edge.rect.x+edge.rect.width<=394 && edge.rect.y+edge.rect.height<=394);
});
