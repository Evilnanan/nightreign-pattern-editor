export const eventResultCapacity = 20;

type EventRow = { rowId:number; modifier:number; eventFlag:number };

// Rows must be supplied in the order that will be written to the PARAM.
export function eventCapacity(rows:readonly EventRow[]) {
  const count=rows.filter(row=>row.modifier!==0 || row.eventFlag!==0).length;
  let used=0;
  let invalidRowId:number|null=null;
  for(const row of rows) {
    // The game checks the limit before deciding whether this row occupies a slot.
    if(used>=eventResultCapacity) {invalidRowId=row.rowId;break;}
    if(row.modifier!==0 || row.eventFlag!==0) used++;
  }
  return {count,limit:eventResultCapacity,invalidRowId};
}
