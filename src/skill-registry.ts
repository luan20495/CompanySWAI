import {createHash} from "node:crypto";
import {z} from "zod";
import {SafeId} from "./ids.js";

/**
 * Canonical skill registry model. A skill is Markdown plus frontmatter metadata; it is never a permanent agent.
 * External skills are untrusted input: they are vendored/adapted into `skills/dynamic/`, pinned to a source commit,
 * scanned for unsafe instructions, size-limited, and only injected when a task's signals and role policy ask for them.
 */

/** Licences we may redistribute. A skill with any other licence cannot be vendored or adapted. */
export const ALLOWED_LICENSES=["MIT","Apache-2.0","BSD-2-Clause","BSD-3-Clause","ISC","CC0-1.0","CC-BY-4.0","LicenseRef-CompanySWAI"] as const;
export const SKILL_DECISIONS=["NATIVE","USE-AS-IS","VENDOR-PIN","ADAPT"] as const;
export const RISK_LEVELS=["low","medium","high"] as const;

/** Hard limits that keep skills cheap: the core body, one reference, and the total a single task may receive. */
export const MAX_SKILL_BODY_CHARS=3200;
export const MAX_REFERENCE_CHARS=4000;
export const SKILL_CONTEXT_BUDGET_CHARS=7000;
/** Rough model-token estimate used only for reporting (chars / 4); never used for billing. */
export const estimateTokens=(chars:number)=>Math.ceil(chars/4);
export const contextClass=(chars:number)=>chars<=1500?"small":chars<=2600?"medium":"large";

const SemVer=z.string().regex(/^\d+\.\d+\.\d+$/,"version must be MAJOR.MINOR.PATCH");
const Commit=z.string().regex(/^[0-9a-f]{40}$/,"sourceCommit must be a full 40-character commit SHA");
const ReferenceFile=z.string().regex(/^[a-z0-9][a-z0-9._-]*\.md$/,"reference files are plain file names inside skills/references/<skill>/");

export const SkillReference=z.object({
 file:ReferenceFile,
 /** Same activation vocabulary as skills: the reference is loaded only when one of these fires. */
 capabilities:z.array(z.string()).default([]),keywords:z.array(z.string().min(1)).default([]),tags:z.array(z.string()).default([])
}).refine(r=>r.capabilities.length+r.keywords.length+r.tags.length>0,{message:"a reference needs at least one activation signal"});

export const SkillMeta=z.object({
 name:SafeId,
 version:SemVer,
 description:z.string().min(10).max(240),
 /** Role policy: only these agents can ever receive the skill ("*" means every agent). */
 appliesTo:z.array(z.string()).min(1),
 capabilities:z.array(z.string()).default([]),
 keywords:z.array(z.string().min(1)).default([]),
 tags:z.array(z.string()).default([]),
 minComplexity:z.number().int().min(1).optional(),
 /** Provenance. */
 source:z.string().min(1),sourceCommit:Commit.optional(),upstreamPath:z.string().optional(),
 /** Further upstream works the skill adapts (each pinned and licensed). */
 alsoFrom:z.array(z.object({source:z.string().regex(/^https:\/\/\S+$/),sourceCommit:Commit,upstreamPath:z.string().min(1),license:z.enum(ALLOWED_LICENSES)})).default([]),
 license:z.enum(ALLOWED_LICENSES),decision:z.enum(SKILL_DECISIONS),attribution:z.string().optional(),
 /** Safety declarations. A skill never persists credentials, so `requiresCredentials` must stay false. */
 riskLevel:z.enum(RISK_LEVELS),
 requiresNetwork:z.boolean().default(false),requiresBrowser:z.boolean().default(false),
 requiresExternalBinary:z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).default([]),
 requiresCredentials:z.boolean().default(false),
 /** Of several skills in one overlap group only the best-matching one is injected. */
 overlapGroup:SafeId.optional(),preference:z.number().int().default(0),
 /** A review method (code review, security review, verification) that a reviewer may carry for any reviewed work when its signals fire. */
 reviewMethod:z.boolean().default(false),
 /** The sections / evidence the skill expects the agent to put in its output. */
 outputContract:z.array(z.string().min(1)).default([]),
 references:z.array(SkillReference).default([])
}).superRefine((m,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:"custom",message});
 if(m.decision==="NATIVE"){if(m.source!=="companyswai")issue("a NATIVE skill has source 'companyswai'");}
 else{
  if(!/^https:\/\/\S+$/.test(m.source))issue("an external skill needs an https source URL");
  if(!m.sourceCommit)issue("an external skill must be pinned to a sourceCommit");
  if(!m.upstreamPath)issue("an external skill must name its upstreamPath");
  if(!m.attribution)issue("an external skill must carry licence attribution");
 }
 if(m.requiresCredentials)issue("skills may not require credentials (credentials are never given to skills)");
 if(m.requiresNetwork&&m.riskLevel==="low")issue("a skill that needs network access is at least riskLevel medium");
 if(m.requiresExternalBinary.length&&m.riskLevel==="low")issue("a skill that needs an external binary is at least riskLevel medium");
 if(!m.capabilities.length&&!m.keywords.length&&!m.tags.length&&m.minComplexity==null)issue("a skill declares no activation signal");
});
export type SkillMetaValue=z.infer<typeof SkillMeta>;

/** What a task records about one skill it received: enough for a reviewer to see exactly what shaped the work. */
export const SkillUse=z.object({
 name:SafeId,version:z.string(),source:z.string(),sourceCommit:z.string().optional(),license:z.string(),decision:z.string(),riskLevel:z.string(),
 matched:z.array(z.string()).default([]),contextChars:z.number().int().nonnegative(),references:z.array(z.string()).default([]),
 /** External binaries the skill's recommended tooling needs (guidance still applies when they are absent). */
 requiresExternalBinary:z.array(z.string()).default([])
});
export type SkillUseValue=z.infer<typeof SkillUse>;
export const SkillTrace=z.object({
 used:z.array(SkillUse).default([]),
 skipped:z.array(z.object({name:z.string(),reason:z.string()})).default([]),
 warnings:z.array(z.string()).default([]),
 budgetChars:z.number().int().nonnegative(),usedChars:z.number().int().nonnegative()
});
export type SkillTraceValue=z.infer<typeof SkillTrace>;

// ---------------------------------------------------------------------------------------------------------------
// Static safety scan. Skill text is injected into model prompts, so instructions that tell an agent to do something
// unsafe, to obey outside content, or that embed secrets are rejected at load time (fail closed).
// ---------------------------------------------------------------------------------------------------------------
export type SkillFinding={rule:string;line:number;text:string};
const NEGATION=/\b(never|do not|don't|dont|must not|mustn't|avoid|refuse|forbid|forbidden|prohibit|prohibited|no\s+\w*\s*(?:use|run)|not allowed|instead of|rather than|unsafe|dangerous|red flag|anti-?pattern|reject|flag)\b/i;
const RULES:Array<{rule:string;pattern:RegExp;always?:boolean}>=[
 {rule:"pipe-to-shell",pattern:/\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i},
 {rule:"destructive-delete",pattern:/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|\.\.|\*)/i},
 {rule:"force-push",pattern:/\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i},
 {rule:"hard-reset",pattern:/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f[a-z]*d|checkout\s+--\s+\.)/i},
 {rule:"privilege-escalation",pattern:/\bsudo\b|\bchmod\s+(-R\s+)?7[0-7][0-7]\b|\bchown\s+-R\b/i},
 {rule:"global-install",pattern:/\b(npm|pnpm|yarn)\s+(i|install|add)\s+(-g|--global)\b|\bpip3?\s+install\b(?![^\n]*(--target|-r\s|\.venv|venv))|\bbrew\s+install\b|\bapt(-get)?\s+install\b|\bgem\s+install\b/i},
 {rule:"credential-read",pattern:/(~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)?\/?\.(ssh|aws|gnupg|kube|docker\/config\.json|npmrc|netrc)\b|\bprintenv\b|\bcat\s+[^\n]*\.env\b|\bsecurity\s+find-generic-password\b/i},
 {rule:"telemetry",pattern:/\b(telemetry|analytics\.[a-z]+|posthog|segment\.io|sentry\.io\/api|mixpanel)\b[^\n]*(send|post|upload|report|track)|\b(send|post|upload|report|track)\b[^\n]*\b(telemetry|usage data)\b/i},
 {rule:"upload-code",pattern:/\b(upload|send|post)\b[^\n]{0,60}\b(source code|the repo(sitory)?|findings|secrets?)\b[^\n]{0,40}\b(to|at)\s+https?:\/\//i},
 {rule:"disable-safety",pattern:/--dangerously-skip-permissions|--no-verify\b|--insecure\b|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0|\bset\s+\+e\b|\bchmod\s+\+x\s+[^\n]*&&\s*\.\//i},
 {rule:"prompt-injection",pattern:/ignore (all |any |the )?(previous|prior|above|system) (instructions|rules|prompts?)|disregard (the |all |your )?(system|previous|company) (prompt|instructions|rules)|you are now (in )?(developer|dan|god) mode|reveal (your )?system prompt/i,always:true},
 {rule:"secret-literal",pattern:/\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,always:true}
];

/**
 * Lines that *forbid* a behaviour ("never run rm -rf /") are fine; lines that *instruct* it are findings. Secrets and
 * injection phrases are findings even in forbidding lines. Fenced code blocks are scanned line by line without the
 * negation exemption (a code block is an instruction to run it).
 */
export function scanSkillText(text:string):SkillFinding[]{
 const findings:SkillFinding[]=[];let fenced=false;
 text.split(/\r?\n/).forEach((line,index)=>{
  if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;return;}
  for(const {rule,pattern,always} of RULES){
   if(!pattern.test(line))continue;
   if(!always&&!fenced&&NEGATION.test(line))continue;
   findings.push({rule,line:index+1,text:line.trim().slice(0,160)});
  }
 });
 return findings;
}

export class SkillRejectedError extends Error{
 constructor(readonly skill:string,readonly problems:string[]){super("Skill '"+skill+"' rejected: "+problems.join("; "));this.name="SkillRejectedError";}
}

export const bodyHash=(text:string)=>createHash("sha256").update(text.replace(/\s+/g," ").trim().toLowerCase()).digest("hex");

/** True when `file` is a plain reference name that stays inside the skill's own reference directory. */
export const isConfinedReference=(file:string)=>ReferenceFile.safeParse(file).success&&!file.includes("..");

// ---------------------------------------------------------------------------------------------------------------
// Catalog-level validation (duplicates, undeclared overlap, size, safety).
// ---------------------------------------------------------------------------------------------------------------
export type RegistrySkill=SkillMetaValue&{body:string;referenceBodies:Record<string,string>};

const signalSet=(s:SkillMetaValue)=>new Set([...s.capabilities.map(c=>"c:"+c),...s.keywords.map(k=>"k:"+k.toLowerCase()),...s.tags.map(t=>"t:"+t.toLowerCase())]);
const jaccard=(a:Set<string>,b:Set<string>)=>{let inter=0;for(const x of a)if(b.has(x))inter++;const union=a.size+b.size-inter;return union?inter/union:0;};

/** Problems that make a single skill unusable (safety, size, references). */
export function validateSkill(skill:RegistrySkill):string[]{
 const problems:string[]=[];
 if(skill.body.length>MAX_SKILL_BODY_CHARS)problems.push("core body is "+skill.body.length+" chars (max "+MAX_SKILL_BODY_CHARS+"); move detail into references loaded on demand");
 if(skill.body.length<120)problems.push("core body is too short to be useful");
 for(const f of scanSkillText(skill.body))problems.push("unsafe content ["+f.rule+"] line "+f.line+": "+f.text);
 for(const ref of skill.references){
  const text=skill.referenceBodies[ref.file];
  if(text==null){problems.push("reference "+ref.file+" is declared but missing");continue;}
  if(text.length>MAX_REFERENCE_CHARS)problems.push("reference "+ref.file+" is "+text.length+" chars (max "+MAX_REFERENCE_CHARS+")");
  for(const f of scanSkillText(text))problems.push("unsafe content ["+f.rule+"] in reference "+ref.file+" line "+f.line+": "+f.text);
 }
 return problems;
}

/** Problems between skills: identical bodies, identical upstream, and heavily overlapping skills with no declared group. */
export function validateCatalog(skills:RegistrySkill[]):string[]{
 const problems:string[]=[],hashes=new Map<string,string>(),upstream=new Map<string,string>();
 for(const s of skills){
  const h=bodyHash(s.body);if(hashes.has(h))problems.push("duplicate skill: "+s.name+" has the same body as "+hashes.get(h));else hashes.set(h,s.name);
  if(s.upstreamPath){const key=s.source+"#"+s.upstreamPath;if(upstream.has(key))problems.push("duplicate skill: "+s.name+" and "+upstream.get(key)+" adapt the same upstream "+key);else upstream.set(key,s.name);}
 }
 for(let i=0;i<skills.length;i++)for(let j=i+1;j<skills.length;j++){
  const a=skills[i],b=skills[j];
  if(a.overlapGroup&&a.overlapGroup===b.overlapGroup)continue;
  const sa=signalSet(a),sb=signalSet(b);
  if(sa.size>=3&&sb.size>=3&&jaccard(sa,sb)>=0.6&&a.appliesTo.some(r=>r==="*"||b.appliesTo.includes(r)||b.appliesTo.includes("*")))
   problems.push("undeclared overlap: "+a.name+" and "+b.name+" activate on nearly the same signals; declare a shared overlapGroup or merge them");
 }
 return problems;
}
