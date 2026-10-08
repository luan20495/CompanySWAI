import {parseReviewVerdict} from "./output-parser.js";
import {parseFilePatches} from "./repo-workspace.js";
import {QA_STATUSES,detectConflicts,impliedQaStatus,parseArchitectureReview,parseQa,parseRequirements,parseResearch} from "./structured.js";

/**
 * Deterministic output validators. Agents' RULES.md name the validators that apply to their answers; the runtime
 * enforces them (one repair round, then the attempt fails). A validator never calls a model.
 */
export type ValidationContext={params:Record<string,unknown>;requirementIds?:string[];/** URLs the research connectors really retrieved for this task; external sources must be among them. */retrievedUrls?:string[];now?:number};
export type ValidatorResult={problems:string[];notes:string[]};
type Validator=(text:string,ctx:ValidationContext)=>ValidatorResult;

const DAY_MS=86_400_000;
const isoDate=/^\d{4}-\d{2}-\d{2}/;
const time=(value?:string)=>value&&isoDate.test(value)?Date.parse(value.slice(0,10)):NaN;
const result=(problems:string[]=[],notes:string[]=[]):ValidatorResult=>({problems,notes});

const researchEvidence:Validator=(text,ctx)=>{
 const problems:string[]=[],notes:string[]=[],parsed=parseResearch(text);
 const external=ctx.params.externalResearch===true,maxAgeDays=Number(ctx.params.maxSourceAgeDays??730);
 for(const line of parsed.malformed)problems.push("malformed research line: "+line.slice(0,120));
 const sources=new Map<string,(typeof parsed.sources)[number]>();
 for(const source of parsed.sources){
  if(sources.has(source.id))problems.push("duplicate source id "+source.id);sources.set(source.id,source);
  const web=/^https?:\/\/\S+$/i.test(source.url),internal=/^(brief|repo):\S+$/i.test(source.url);
  if(!web&&!internal)problems.push("source "+source.id+" needs an http(s) URL or a brief:/repo: reference");
  if(web&&!external)problems.push("source "+source.id+" is an external URL but no research connector retrieved external sources for this project; cite only brief:/repo: references");
  if(web&&external&&ctx.retrievedUrls&&!ctx.retrievedUrls.includes(source.url))problems.push("source "+source.id+" ("+source.url+") was not retrieved by a research connector; cite only the RETRIEVED SOURCES");
  if(!source.title)problems.push("source "+source.id+" has no title");
  if(!["HIGH","MEDIUM","LOW"].includes(source.authority??""))problems.push("source "+source.id+" needs authority: HIGH|MEDIUM|LOW");
  if(web&&Number.isNaN(time(source.retrieved)))problems.push("source "+source.id+" needs retrieved: YYYY-MM-DD");
 }
 const stale=new Set<string>();
 for(const source of parsed.sources){
  const published=time(source.published),retrieved=Number.isNaN(time(source.retrieved))?(ctx.now??Date.now()):time(source.retrieved);
  if(!Number.isNaN(published)&&(retrieved-published)/DAY_MS>maxAgeDays){stale.add(source.id);notes.push("stale source "+source.id+" (published "+source.published+", limit "+maxAgeDays+" days)");}
 }
 const claims=new Map<string,(typeof parsed.claims)[number]>();
 if(!parsed.claims.length)problems.push("no claims: every research finding must be a labelled FACT, ASSUMPTION, INFERENCE or RECOMMENDATION");
 for(const claim of parsed.claims){
  if(claims.has(claim.id))problems.push("duplicate claim id "+claim.id);claims.set(claim.id,claim);
  if(!claim.text)problems.push("claim "+claim.id+" has no text");
 }
 for(const claim of parsed.claims){
  const unknownCites=claim.cites.filter(id=>!sources.has(id));
  if(unknownCites.length)problems.push("claim "+claim.id+" cites unknown source(s) "+unknownCites.join(", "));
  if(claim.kind==="FACT"){
   if(!claim.cites.length)problems.push("uncited FACT "+claim.id+": every factual claim must cite at least one source");
   else if(claim.cites.filter(id=>sources.has(id)).every(id=>stale.has(id)))problems.push("FACT "+claim.id+" relies only on stale sources");
  }
  if(claim.kind==="INFERENCE"){
   if(!claim.from.length)problems.push("INFERENCE "+claim.id+" must name the claims it follows from (from: C1,C2)");
   for(const id of claim.from)if(!claims.has(id))problems.push("INFERENCE "+claim.id+" references unknown claim "+id);
  }
  if(claim.kind==="RECOMMENDATION"){
   if(!claim.basedOn.length)problems.push("RECOMMENDATION "+claim.id+" must name its basis (based-on: C1)");
   for(const id of claim.basedOn)if(!claims.has(id))problems.push("RECOMMENDATION "+claim.id+" references unknown claim "+id);
  }
 }
 const listed=new Set(parsed.conflicts.map(c=>[c.a,c.b].sort().join("~")));
 for(const conflict of parsed.conflicts)for(const id of [conflict.a,conflict.b])if(!claims.has(id))problems.push("conflict references unknown claim "+id);
 for(const [a,b,topic] of detectConflicts(parsed.claims))if(!listed.has([a,b].sort().join("~")))problems.push("unacknowledged conflict between "+a+" and "+b+" on topic '"+topic+"': list it under ## Conflicts with a resolution");
 return result(problems,notes);
};

const requirementsIds:Validator=text=>{
 const problems:string[]=[],parsed=parseRequirements(text),seen=new Set<string>(),acSeen=new Set<string>();
 for(const line of parsed.malformed)problems.push("malformed requirements line: "+line.slice(0,120));
 if(!parsed.requirements.length)problems.push("no requirements: list each as '- [REQ-001] FACT|ASSUMPTION|INFERENCE|RECOMMENDATION: text (basis: …)'");
 for(const req of parsed.requirements){
  if(seen.has(req.id))problems.push("duplicate requirement id "+req.id);seen.add(req.id);
  if(!req.acceptance.length)problems.push(req.id+" has no testable acceptance criterion ('  - [AC-001.1] Given … When … Then …')");
  if(req.basis==="FACT"&&!req.evidence.length)problems.push(req.id+" is a FACT but names no basis (basis: brief, S1, C2, …)");
  for(const ac of req.acceptance){if(acSeen.has(ac.id))problems.push("duplicate acceptance criterion id "+ac.id);acSeen.add(ac.id);}
 }
 return result(problems);
};

const qaTraceability:Validator=(text,ctx)=>{
 const problems:string[]=[],notes:string[]=[],parsed=parseQa(text),known=new Set(ctx.requirementIds??[]);
 for(const line of parsed.malformed)problems.push("malformed traceability line: "+line.slice(0,120));
 if(!parsed.overall)problems.push("## QA Status must start with one of "+QA_STATUSES.join("|"));
 if(!parsed.tests.length)problems.push("## Traceability links no requirement to any test result");
 const covered=new Set<string>(),testIds=new Set<string>(),perRequirement=new Map<string,number>();
 for(const test of parsed.tests){
  covered.add(test.requirementId);if(test.status==="PASS"||test.status==="FAIL")perRequirement.set(test.requirementId,(perRequirement.get(test.requirementId)??0)+1);
  if(known.size&&!known.has(test.requirementId))problems.push("traceability references unknown requirement "+test.requirementId);
  if(test.testId){if(testIds.has(test.testId))problems.push("duplicate test id "+test.testId);testIds.add(test.testId);}
  else if(test.status!=="NOT_APPLICABLE")problems.push(test.requirementId+" "+test.status+" needs a test id ([T-001])");
  if((test.status==="PASS"||test.status==="FAIL")&&!test.evidence)problems.push((test.testId??test.requirementId)+" "+test.status+" needs '| evidence: …'");
 }
 if(known.size){for(const id of known)if(!covered.has(id))problems.push("requirement "+id+" has no test or NOT_APPLICABLE/BLOCKED classification");}
 else notes.push("no requirement IDs were available to check coverage");
 const minTests=Number(ctx.params.minTestsPerRequirement??1);
 if(minTests>1)for(const [id,count] of perRequirement)if(count<minTests)problems.push("requirement "+id+" has "+count+" executed test(s); this QA depth requires at least "+minTests);
 if(parsed.overall&&parsed.tests.length){
  const implied=impliedQaStatus(parsed.tests);
  if(parsed.overall!==implied)problems.push("## QA Status says "+parsed.overall+" but the individual results imply "+implied);
 }
 return result(problems,notes);
};

const architectureReview:Validator=(text,ctx)=>{
 const problems:string[]=[],parsed=parseArchitectureReview(text),required=(ctx.params.architectureCategories as string[]|undefined)??[];
 for(const line of parsed.malformed)problems.push("malformed architecture review line: "+line.slice(0,120));
 const seen=new Map<string,string>();
 for(const c of parsed.categories){
  if(seen.has(c.category))problems.push("category "+c.category+" reviewed twice");seen.set(c.category,c.status);
  if(required.length&&!required.includes(c.category))problems.push("category "+c.category+" does not apply to this project");
 }
 for(const category of required)if(!seen.has(category))problems.push("missing architecture review category: "+category);
 const failing=[...seen.entries()].filter(([,s])=>s==="FAIL").map(([c])=>c),risky=[...seen.values()].filter(s=>s==="RISK").length;
 if(failing.length&&parseReviewVerdict(text)!=="CHANGES_REQUIRED")problems.push("categories "+failing.join(", ")+" are FAIL, so the verdict must be CHANGES_REQUIRED");
 if(risky&&!parsed.unresolvedRisks.length)problems.push("categories marked RISK must be listed under ## Unresolved Risks");
 return result(problems);
};

const codeDelivery:Validator=(text,ctx)=>{
 if(ctx.params.workspaceConfigured!==true)return result();
 return parseFilePatches(text).length?result():result(["a workspace is configured but no code was delivered: emit complete ```file <path>``` blocks in ## Deliverables"]);
};

export const VALIDATORS:Record<string,Validator>={
 "research-evidence":researchEvidence,"requirements-ids":requirementsIds,"qa-traceability":qaTraceability,"architecture-review":architectureReview,"code-delivery":codeDelivery
};
export const isKnownValidator=(name:string)=>Object.prototype.hasOwnProperty.call(VALIDATORS,name);

export function runValidators(names:string[],text:string,ctx:ValidationContext):ValidatorResult{
 const problems:string[]=[],notes:string[]=[];
 for(const name of names){
  if(!isKnownValidator(name))throw new Error("Unknown output validator '"+name+"' (known: "+Object.keys(VALIDATORS).join(", ")+")");
  const out=VALIDATORS[name](text,ctx);problems.push(...out.problems);notes.push(...out.notes);
 }
 return {problems,notes};
}
