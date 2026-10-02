// Port of nightreign-derandomizer/src/app/model.cpp. Keep its mode weights,
// block order and use of the same first SFMT draw for both lotteries.
type PatternBlock={weight:number;first:number;count:number};

export function firstSeedDraw(seed:number):number {
  const state=new Uint32Array(624);
  state[0]=seed>>>0;
  for(let i=1;i<state.length;i++) {
    const previous=state[i-1];
    state[i]=(Math.imul(1812433253,previous^(previous>>>30))+i)>>>0;
  }
  let parity=(state[0]&1)^(state[3]&331998852);
  for(const shift of [16,8,4,2,1]) parity^=parity>>>shift;
  if(!(parity&1)) state[0]^=1;
  // Only the first draw is consumed. The remaining generateAll() iterations
  // never change word 0, so compute that word directly in the game's order.
  return (state[0]^(state[0]<<8)^(state[617]<<24)^(state[616]>>>8)^
    ((state[488]>>>11)&0xDFFFFFEF)^(state[620]<<18))>>>0;
}

export function patternNightlord(pattern:number):number|null {
  if(!Number.isInteger(pattern)) return null;
  if(pattern>=0 && pattern<=319) return Math.floor(pattern/40);
  if(pattern>=1000 && pattern<=1079) return Math.floor((pattern-1000)/10);
  if(pattern>=1080 && pattern<=1139) return 8;
  if(pattern>=1140 && pattern<=1199) return 9;
  return null;
}

export function patternBlocks(nightlord:number,deepOfNight:boolean):PatternBlock[] {
  if(!Number.isInteger(nightlord) || nightlord<0 || nightlord>9) return [];
  const blocks:PatternBlock[]=[];
  const add=(weight:number,first:number,count:number)=>blocks.push({weight,first,count});
  if(nightlord<8) {
    const base=nightlord*40;
    add(deepOfNight?7600:8400,base,20);
    for(const offset of [20,25,30,35]) add(deepOfNight?600:400,base+offset,5);
    if(deepOfNight) {add(3800,1000+nightlord*10,5);add(1800,1005+nightlord*10,5);}
  } else {
    const base=nightlord===8?1080:1140;
    add(deepOfNight?5800:7652,base,20);
    for(const offset of [20,25,30]) add(deepOfNight?600:323,base+offset,5);
    add(deepOfNight?1800:1056,base+35,20);
    add(deepOfNight?600:323,base+55,5);
  }
  return blocks;
}

function patternFromDraw(blocks:PatternBlock[],draw:number):number|null {
  const total=blocks.reduce((sum,block)=>sum+block.weight,0);
  const pick=draw%total;
  let accumulated=0;
  for(const block of blocks) {
    accumulated+=block.weight;
    if(accumulated>pick) return block.first+draw%block.count;
  }
  return null;
}

export function patternForSeed(nightlord:number,deepOfNight:boolean,seed:number):number|null {
  return patternFromDraw(patternBlocks(nightlord,deepOfNight),firstSeedDraw(seed));
}

export function isPatternReachable(pattern:number,deepOfNight:boolean):boolean {
  const owner=patternNightlord(pattern);
  return owner!==null && patternBlocks(owner,deepOfNight).some(block=>pattern>=block.first && pattern<block.first+block.count);
}

export function findPatternSeed(pattern:number,deepOfNight:boolean,start:number,stride:number,exclude:number|null=null):number|null {
  const owner=patternNightlord(pattern);
  if(owner===null || !isPatternReachable(pattern,deepOfNight)) return null;
  const blocks=patternBlocks(owner,deepOfNight);
  let seed=start>>>0;
  const step=(stride|1)>>>0;
  // An odd stride visits every uint32 value once, including across overflow.
  for(let drawn=0;drawn<0x100000000;drawn++) {
    if(seed!==exclude && patternFromDraw(blocks,firstSeedDraw(seed))===pattern) return seed;
    seed=(seed+step)>>>0;
  }
  return null;
}

export function formatPatternSeed(seed:number):string {
  return `0x${(seed>>>0).toString(16).toUpperCase().padStart(8,"0")}`;
}

export type SeedRequest={requestId:number;pattern:number;deepOfNight:boolean;start:number;stride:number;exclude:number|null};
export type SeedResponse={requestId:number;seed:number|null};
