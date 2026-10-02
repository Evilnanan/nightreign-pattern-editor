import { findPatternSeed, type SeedRequest, type SeedResponse } from "./pattern-seeds";

self.addEventListener("message",(event:MessageEvent<SeedRequest>)=>{
  const {requestId,pattern,deepOfNight,start,stride,exclude}=event.data;
  const response:SeedResponse={requestId,seed:findPatternSeed(pattern,deepOfNight,start,stride,exclude)};
  self.postMessage(response);
});
