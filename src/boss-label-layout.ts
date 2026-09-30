export type LabelRect = {x:number;y:number;width:number;height:number};
export type IconRect = LabelRect & {locationId?:number;artwork?:LabelRect;badge?:LabelRect};
export type BossLabel = {id:number;x:number;y:number;width:number;height:number;iconWidth:number;iconHeight:number;side?:number;scale?:number;overlap?:number;artwork?:LabelRect};
export type PlacedBossLabel = BossLabel & {rect:LabelRect;fallback:boolean};
const portraitOverlap=4;
const artworkContact=8;

// Ignore the text box's padding and halo. Small edge overlaps are harmless.
const overlaps=(a:LabelRect,b:LabelRect,aScale=1,bScale=1) => a.x+2*aScale < b.x+b.width-2*bScale && a.x+a.width-2*aScale > b.x+2*bScale &&
  a.y+aScale < b.y+b.height-bScale && a.y+a.height-aScale > b.y+bScale;
const blocksName=(name:LabelRect,icon:IconRect) => {
  // Most portraits have transparent edges; only test the central artwork.
  const insetX=icon.width*.12,insetY=icon.height*.12;
  const w=Math.max(0,Math.min(name.x+name.width,icon.x+icon.width-insetX)-Math.max(name.x,icon.x+insetX));
  const h=Math.max(0,Math.min(name.y+name.height,icon.y+icon.height-insetY)-Math.max(name.y,icon.y+insetY));
  return w>6 && h>3 && w*h>name.width*name.height*.2;
};
const artworkRect=(icon:IconRect):LabelRect=>icon.artwork ??
  {x:icon.x+icon.width*.12,y:icon.y+icon.height*.12,width:icon.width*.76,height:icon.height*.76};
const artworkOverlap=(name:LabelRect,artwork:LabelRect,scale:number,allowedContact=0) => {
  const w=Math.max(0,Math.min(name.x+name.width-2*scale,artwork.x+artwork.width)-Math.max(name.x+2*scale,artwork.x));
  const h=Math.max(0,Math.min(name.y+name.height-scale,artwork.y+artwork.height)-Math.max(name.y+scale,artwork.y));
  if(w<=3*scale || h<=2*scale) return 0;
  const contactArea=Math.min(name.width-4*scale,artwork.width)*allowedContact;
  return Math.max(0,w*h-contactArea)/Math.min((name.width-4*scale)*(name.height-2*scale),artwork.width*artwork.height);
};

// Work in the board's unscaled pixels so dragging and zooming preserve both
// the label-to-portrait association and the gaps between names.
export function placeBossLabels(labels:BossLabel[], icons:IconRect[], width:number, height:number):PlacedBossLabel[] {
  const margin=6;
  const entries=[...labels].sort((a,b)=>a.y-b.y || a.x-b.x || a.id-b.id).map(label=>{
    const clamp=(x:number,y:number):LabelRect => ({
      x:Math.max(margin,Math.min(width-label.width-margin,x)),
      y:Math.max(margin,Math.min(height-label.height-margin,y)),
      width:label.width,height:label.height
    });
    const ownArtwork=artworkRect({x:label.x-label.iconWidth/2,y:label.y-label.iconHeight/2,
      width:label.iconWidth,height:label.iconHeight,artwork:label.artwork});
    const centerX=(label.side ? label.x : ownArtwork.x+ownArtwork.width/2)-label.width/2;
    const centerY=(label.side ? label.y : ownArtwork.y+ownArtwork.height/2)-label.height/2;
    const overlap=label.overlap ?? portraitOverlap;
    const below=label.y+label.iconHeight/2-overlap;
    const left=label.x-label.iconWidth/2+overlap-label.width;
    const right=label.x+label.iconWidth/2-overlap;
    // Names touch an edge of their own icon or sit on its artwork. Reject
    // positions that make the caption appear to belong to a neighbouring name.
    // Great Hollow floor names retain their designated side of the Tower.
    const candidates:{rect:LabelRect;preference:number}[]=[];
    const add=(x:number,y:number,preference:number)=>{
      const rect=clamp(x,y);
      if(!label.side) {
        const scale=label.scale ?? 1;
        const w=Math.min(rect.x+rect.width-2*scale,ownArtwork.x+ownArtwork.width)-Math.max(rect.x+2*scale,ownArtwork.x);
        const h=Math.min(rect.y+rect.height-scale,ownArtwork.y+ownArtwork.height)-Math.max(rect.y+scale,ownArtwork.y);
        // Attachment is mandatory: text overlaps the visible artwork, rather
        // than merely touching a transparent edge of the image rectangle.
        if(w<Math.min(4*scale,ownArtwork.width/2,(rect.width-4*scale)/2) ||
          h<Math.min(4*scale,ownArtwork.height/2,(rect.height-2*scale)/2)) return;
      }
      if(!candidates.some(candidate=>candidate.rect.x===rect.x && candidate.rect.y===rect.y))
        candidates.push({rect,preference});
    };
    if(label.side) {
      const x=label.side===-1 ? left : right;
      add(x,centerY,0);
      add(x,centerY-label.height-2,2);
      add(x,centerY+label.height+2,2);
    } else {
      const contact=artworkContact*(label.scale ?? 1);
      const above=ownArtwork.y+contact-label.height;
      const edgeBelow=ownArtwork.y+ownArtwork.height-contact;
      for(const [y,preference] of [[edgeBelow,0],[above,1],[below,2],[centerY,3]]) {
        add(centerX,y,preference);
        const shift=ownArtwork.width*.2;
        add(centerX-shift,y,preference+.5);
        add(centerX+shift,y,preference+.5);
      }
      // Sideways adjustments keep the caption centre within its own icon.
      // Wide names must not be pushed a whole text width away from the icon.
      for(const x of [centerX-ownArtwork.width*.35,centerX+ownArtwork.width*.35]) {
        add(x,centerY,2.5);
        for(const shift of [.25,.5]) {
          add(x,centerY-ownArtwork.height*shift,3.5);
          add(x,centerY+ownArtwork.height*shift,3.5);
        }
      }
      // Nearby artwork edges provide slots that a fixed set of offsets can
      // miss, especially in the narrow gap between a badge and another Boss.
      // Keep these adjustments local and ignore the same tiny edge overlaps
      // as the collision checks.
      const scale=label.scale ?? 1;
      const minX=centerX-ownArtwork.width*.35,maxX=centerX+ownArtwork.width*.35;
      const edgePositions:number[]=[];
      for(const icon of icons) {
        if(icon.locationId===label.id) continue;
        for(const artwork of [artworkRect(icon),...(icon.badge ? [icon.badge] : [])]) {
          if(artwork.x+artwork.width<minX || artwork.x>maxX+label.width ||
            artwork.y+artwork.height<ownArtwork.y-label.height || artwork.y>ownArtwork.y+ownArtwork.height+label.height) continue;
          for(const y of [artwork.y-label.height+2*scale,artwork.y+artwork.height-2*scale]) {
            edgePositions.push(y);
            for(const x of [centerX,minX,maxX]) add(x,y,4);
          }
          for(const x of [artwork.x-label.width+3*scale,artwork.x+artwork.width-3*scale]) {
            if(x<minX || x>maxX) continue;
            for(const y of [edgeBelow,above,centerY]) add(x,y,4);
          }
        }
      }
      const edges=[...new Set(edgePositions)].sort((a,b)=>a-b);
      for(let i=1;i<edges.length;i++) if(edges[i]-edges[i-1]<=4*scale)
        for(const x of [centerX,minX,maxX]) add(x,(edges[i]+edges[i-1])/2,4);
      // Map-edge clamping can make every regular slot impossible. Stay on
      // the nearest part of the icon instead of moving away to avoid a clash.
      if(!candidates.length) candidates.push({rect:clamp(centerX,centerY),preference:3});
    }
    return {label,candidates:candidates.map(candidate=>{
      let cost=label.side ? candidate.preference : candidate.preference*.01,occludesIcon=false,ambiguous=false;
      for(const icon of icons) {
        if(label.side) {
          // Preserve the intentional Tower floor layout and artwork overlap.
          if(icon.locationId!==label.id && blocksName(candidate.rect,icon)) {cost+=1000;occludesIcon=true;}
        } else {
          // Badges have their own visible bounds: do not fill the transparent
          // gap between a building's artwork and its lower-right badge.
          const scale=label.scale ?? 1;
          const own=icon.locationId===label.id;
          // The required small contact with our own artwork is harmless.
          // Comparing its exact area makes short captions drift diagonally
          // just to cover a few fewer pixels, even when below is clear.
          const overlap=Math.max(artworkOverlap(candidate.rect,artworkRect(icon),scale,own ? (artworkContact-1)*scale : 0),
            icon.badge ? artworkOverlap(candidate.rect,icon.badge,scale) : 0);
          if(own) cost+=100*overlap;
          else if(overlap>.04) {cost+=20000+15000*overlap;occludesIcon=true;}
        }
      }
      if(!label.side) {
        const cx=candidate.rect.x+candidate.rect.width/2,cy=candidate.rect.y+candidate.rect.height/2;
        const distance=Math.hypot(cx-label.x,cy-label.y);
        ambiguous=labels.some(other=>other.id!==label.id &&
          Math.hypot(cx-other.x,cy-other.y)+Math.min(label.iconWidth,label.iconHeight)/4<distance);
        if(ambiguous) cost+=3000;
      }
      return {...candidate,cost,occludesIcon,ambiguous};
    }),choice:0};
  });
  const pairCost=(a:typeof entries[number],ar:LabelRect,b:typeof entries[number],br:LabelRect)=>{
    let cost=overlaps(ar,br,a.label.scale,b.label.scale) ? 5000 : 0;
    // Closely stacked icons must not have their label order reversed, even
    // when one name is centred and the other is below its icon.
    const dy=a.label.y-b.label.y;
    if(Math.abs(a.label.x-b.label.x)<=(a.label.iconWidth+b.label.iconWidth)/2+margin &&
      Math.abs(dy)>Math.min(a.label.iconHeight,b.label.iconHeight)/4 &&
      dy*((ar.y+ar.height/2)-(br.y+br.height/2))<0) cost+=10000;
    return cost;
  };
  // Consider all preferred positions together and revisit earlier choices.
  // Otherwise a Tower can claim the only space below a nearby Boss before
  // that Boss has had a chance to place its name.
  for(let pass=0;pass<12;pass++) {
    let changed=false;
    for(const entry of entries) {
      const score=(candidate:typeof entry.candidates[number])=>candidate.cost+entries.reduce((cost,other)=>
        cost+(other===entry ? 0 : pairCost(entry,candidate.rect,other,other.candidates[other.choice].rect)),0);
      let best=entry.choice,bestScore=score(entry.candidates[best]);
      entry.candidates.forEach((candidate,index)=>{
        const candidateScore=score(candidate);
        if(candidateScore<bestScore) {best=index;bestScore=candidateScore;}
      });
      if(best!==entry.choice) {entry.choice=best;changed=true;}
    }
    if(!changed) break;
  }
  return entries.map(entry=>{
    const candidate=entry.candidates[entry.choice];
    const fallback=candidate.occludesIcon || candidate.ambiguous || entries.some(other=>other!==entry &&
      pairCost(entry,candidate.rect,other,other.candidates[other.choice].rect)>0);
    return {...entry.label,rect:candidate.rect,fallback};
  });
}
