export type AppliesContext={capabilities:string[];complexity:number;tags:string[]};

/**
 * Evaluates the small `appliesWhen` language used in Markdown: terms joined by `|` (any match applies).
 * Terms: `always`, `capability:<name>`, `signal:<tag>`, `complexity>=<n>`; a bare term inherits the previous term's
 * kind, so `capability:backend|mobile` means backend OR mobile.
 */
export function appliesWhen(expression:string,context:AppliesContext):boolean{
 let kind:"capability"|"signal"="capability";
 const tags=new Set(context.tags.map(t=>t.toLowerCase()));
 for(const raw of expression.split("|")){
  const term=raw.trim();if(!term)continue;
  if(term==="always")return true;
  const complexity=term.match(/^complexity>=(\d+)$/);
  if(complexity){if(context.complexity>=Number(complexity[1]))return true;continue;}
  let name=term;
  if(term.startsWith("capability:")){kind="capability";name=term.slice("capability:".length);}
  else if(term.startsWith("signal:")){kind="signal";name=term.slice("signal:".length);}
  if(kind==="capability"?context.capabilities.includes(name):tags.has(name.toLowerCase()))return true;
 }
 return false;
}
