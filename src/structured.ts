import {section} from "./output-parser.js";

/**
 * Parsers for the structured sections agents emit (research evidence, requirements, QA traceability,
 * architecture review). They only parse; src/validators.ts decides what is acceptable.
 */
const lines=(body?:string)=>(body??"").split(/\r?\n/);
const isNoneText=(text?:string)=>!text||/^\s*(none|n\/a|no conflicts?)\.?\s*$/i.test(text);

// ---------------------------------------------------------------- research evidence
export const CLAIM_KINDS=["FACT","ASSUMPTION","INFERENCE","RECOMMENDATION"] as const;
export type ClaimKind=(typeof CLAIM_KINDS)[number];
export type Authority="HIGH"|"MEDIUM"|"LOW";
export type ResearchSource={id:string;title:string;url:string;retrieved?:string;authority?:string;published?:string};
export type ResearchClaim={id:string;kind:ClaimKind;topic?:string;text:string;cites:string[];from:string[];basedOn:string[]};
export type ResearchConflict={a:string;b:string;topic?:string;resolution?:string};
export type ParsedResearch={sources:ResearchSource[];claims:ResearchClaim[];conflicts:ResearchConflict[];malformed:string[]};

const ids=(raw?:string)=>(raw??"").split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
const field=(parts:string[],name:string)=>{const hit=parts.find(p=>new RegExp("^"+name+"\\s*:","i").test(p.trim()));return hit?hit.slice(hit.indexOf(":")+1).trim():undefined;};

export function parseResearch(text:string):ParsedResearch{
 const out:ParsedResearch={sources:[],claims:[],conflicts:[],malformed:[]};
 for(const raw of lines(section(text,"Sources"))){
  const line=raw.trim();if(!line.startsWith("-"))continue;
  // - [S1] Title | url | retrieved: 2026-10-08 | authority: HIGH | published: 2026-03-01
  const match=line.match(/^-\s*\[(S\d+)\]\s*(.*)$/);
  if(!match){out.malformed.push(line);continue;}
  const parts=match[2].split("|").map(p=>p.trim());
  out.sources.push({id:match[1],title:parts[0]??"",url:parts[1]??"",retrieved:field(parts.slice(2),"retrieved"),authority:field(parts.slice(2),"authority")?.toUpperCase(),published:field(parts.slice(2),"published")});
 }
 for(const raw of lines(section(text,"Claims"))){
  const line=raw.trim();if(!line.startsWith("-"))continue;
  // - [C1] FACT [topic: pricing]: statement | cites: S1,S2      (INFERENCE: | from: C1)  (RECOMMENDATION: | based-on: C1)
  const match=line.match(/^-\s*\[(C\d+)\]\s*(FACT|ASSUMPTION|INFERENCE|RECOMMENDATION)\b\s*(?:\[topic:\s*([^\]]+)\])?\s*:\s*(.*)$/i);
  if(!match){out.malformed.push(line);continue;}
  const parts=match[4].split("|").map(p=>p.trim());
  out.claims.push({id:match[1],kind:match[2].toUpperCase() as ClaimKind,topic:match[3]?.trim().toLowerCase(),text:parts[0]??"",cites:ids(field(parts.slice(1),"cites")),from:ids(field(parts.slice(1),"from")),basedOn:ids(field(parts.slice(1),"based-on"))});
 }
 const conflictBody=section(text,"Conflicts");
 if(!isNoneText(conflictBody))for(const raw of lines(conflictBody)){
  const line=raw.trim();if(!line.startsWith("-"))continue;
  const match=line.match(/^-\s*(C\d+)\s+(?:vs\.?|versus|and)\s+(C\d+)\s*(.*)$/i);
  if(!match){out.malformed.push(line);continue;}
  const parts=match[3].split("|").map(p=>p.trim());
  out.conflicts.push({a:match[1],b:match[2],topic:field(parts,"topic")?.toLowerCase(),resolution:field(parts,"resolution")});
 }
 return out;
}

/** Two FACT claims on the same topic that say different things from different evidence. */
export function detectConflicts(claims:ResearchClaim[]){
 const found:Array<[string,string,string]>=[];
 const facts=claims.filter(c=>c.kind==="FACT"&&c.topic);
 for(let i=0;i<facts.length;i++)for(let j=i+1;j<facts.length;j++){
  const a=facts[i],b=facts[j];
  if(a.topic!==b.topic)continue;
  const same=a.text.trim().toLowerCase()===b.text.trim().toLowerCase();
  const sharedSource=a.cites.some(c=>b.cites.includes(c));
  if(!same&&!sharedSource)found.push([a.id,b.id,a.topic!]);
 }
 return found;
}

// ---------------------------------------------------------------- requirements
export type Requirement={id:string;basis:ClaimKind;text:string;evidence:string[];acceptance:Array<{id:string;text:string}>};
export type ParsedRequirements={requirements:Requirement[];malformed:string[]};

export function parseRequirements(text:string):ParsedRequirements{
 const out:ParsedRequirements={requirements:[],malformed:[]};let current:Requirement|undefined;
 for(const raw of lines(section(text,"Requirements"))){
  if(!raw.trim())continue;
  const ac=raw.match(/^\s+[-*]\s*\[(AC-[\w.-]+)\]\s*(.+)$/);
  if(ac){if(current)current.acceptance.push({id:ac[1],text:ac[2].trim()});else out.malformed.push(raw.trim());continue;}
  const req=raw.match(/^[-*]\s*\[(REQ-[\w.-]+)\]\s*(?:\*\*)?(FACT|ASSUMPTION|INFERENCE|RECOMMENDATION)(?:\*\*)?\s*:\s*(.+?)\s*$/i);
  if(req){
   // Evidence for a requirement is its explicit "(basis: …)" clause, or any reference to the brief, an upstream artifact, or a source/claim ID.
   const clause=req[3].match(/\((?:basis|evidence|source)s?\s*:\s*([^)]*)\)/i),refs=req[3].match(/\b(?:brief|product-plan|research|[CS]\d+)\b/gi)??[];
   current={id:req[1],basis:req[2].toUpperCase() as ClaimKind,text:req[3].replace(/\s*\((?:basis|evidence|source)s?\s*:[^)]*\)\s*$/i,"").trim(),evidence:[...ids(clause?.[1]),...refs.map(r=>r.toLowerCase())],acceptance:[]};out.requirements.push(current);continue;
  }
  if(/^[-*]\s/.test(raw.trim()))out.malformed.push(raw.trim());
 }
 return out;
}

// ---------------------------------------------------------------- QA traceability
export const QA_STATUSES=["PASS","FAIL","BLOCKED","NOT_APPLICABLE"] as const;
export type QaStatus=(typeof QA_STATUSES)[number];
/** `owner` names the upstream task whose work the finding is about (required on FAIL, so rework goes to the right maker). */
export type QaTest={requirementId:string;testId?:string;status:QaStatus;text:string;evidence?:string;owner?:string};
export type ParsedQa={overall?:QaStatus;overallText:string;tests:QaTest[];malformed:string[]};

export function parseQa(text:string):ParsedQa{
 const out:ParsedQa={overallText:"",tests:[],malformed:[]};
 const statusBody=(section(text,"QA Status")??"").trim();
 const first=statusBody.split(/\r?\n/).map(l=>l.trim()).find(Boolean)??"";
 out.overallText=first;
 const head=first.replace(/^[-*\s]+/,"").match(/^(PASS|FAIL|BLOCKED|NOT_APPLICABLE)\b/i);
 if(head)out.overall=head[1].toUpperCase() as QaStatus;
 for(const raw of lines(section(text,"Traceability"))){
  const line=raw.trim();if(!line.startsWith("-"))continue;
  // - [REQ-1] -> [T-1] PASS: description | evidence: ...      - [REQ-2] -> NOT_APPLICABLE: reason
  const match=line.match(/^-\s*\[(REQ-\d+)\]\s*(?:->|→)\s*(?:\[(T-\d+)\]\s*)?(PASS|FAIL|BLOCKED|NOT_APPLICABLE)\s*:\s*(.*)$/i);
  if(!match){out.malformed.push(line);continue;}
  const parts=match[4].split("|").map(p=>p.trim());
  out.tests.push({requirementId:match[1],testId:match[2],status:match[3].toUpperCase() as QaStatus,text:parts[0]??"",evidence:field(parts.slice(1),"evidence"),owner:field(parts.slice(1),"owner")});
 }
 return out;
}
/** The overall QA status the individual results imply. */
export function impliedQaStatus(tests:QaTest[]):QaStatus{
 if(tests.some(t=>t.status==="FAIL"))return "FAIL";
 if(tests.some(t=>t.status==="BLOCKED"))return "BLOCKED";
 if(tests.length&&tests.every(t=>t.status==="NOT_APPLICABLE"))return "NOT_APPLICABLE";
 return "PASS";
}

// ---------------------------------------------------------------- architecture review
export const ARCH_STATUSES=["PASS","RISK","FAIL"] as const;
export type ArchStatus=(typeof ARCH_STATUSES)[number];
export type ArchCategoryResult={category:string;status:ArchStatus;note:string};
export type ParsedArchitectureReview={categories:ArchCategoryResult[];unresolvedRisks:string[];decisions:string[];malformed:string[]};

export function parseArchitectureReview(text:string):ParsedArchitectureReview{
 const out:ParsedArchitectureReview={categories:[],unresolvedRisks:[],decisions:[],malformed:[]};
 for(const raw of lines(section(text,"Architecture Review"))){
  const line=raw.trim();if(!line.startsWith("-"))continue;
  // - modularity: PASS — note
  const match=line.match(/^-\s*([a-z][a-z-]*)\s*:\s*(PASS|RISK|FAIL)\b\s*[—–-]?\s*(.*)$/i);
  if(!match){out.malformed.push(line);continue;}
  out.categories.push({category:match[1].toLowerCase(),status:match[2].toUpperCase() as ArchStatus,note:match[3].trim()});
 }
 const risks=section(text,"Unresolved Risks");
 if(!isNoneText(risks))out.unresolvedRisks=lines(risks).map(l=>l.trim()).filter(l=>/^[-*]/.test(l)).map(l=>l.replace(/^[-*]\s*/,""));
 const decisions=section(text,"Decisions");
 if(!isNoneText(decisions))out.decisions=lines(decisions).map(l=>l.trim()).filter(l=>/^[-*]/.test(l)).map(l=>l.replace(/^[-*]\s*/,""));
 return out;
}
