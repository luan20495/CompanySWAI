import {createHash} from "node:crypto";
import {readFile,readdir,stat} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {TakeoverError,type Snapshot} from "./takeover-probe.js";
import type {TakeoverStore} from "./takeover-store.js";

/**
 * Executed evidence for a takeover. An audit itself runs nothing; results come from runs the OPERATOR made (a gate, a test suite)
 * and recorded here before the audit starts. The engine does not re-run them and does not keep the logs: each record is bound to one
 * commit and carries the sha256 of the log/XML it came from, so a log the operator keeps can be matched to it. A record for another
 * commit is never used. JUnit result files are parsed by the engine, one record per test class and module.
 * Trust: results produced by the audited repository's own build are only as trustworthy as that repository.
 */
export const ExecOutcome=z.enum(["PASS","FAIL","NOT_RUN"]);
export type ExecOutcomeValue=z.infer<typeof ExecOutcome>;
const Count=z.number().int().min(0);
export const ExecRecord=z.object({
 id:z.string().regex(/^[A-Za-z0-9._:$/-]{1,300}$/),kind:z.enum(["gate","junit"]),name:z.string().min(1).max(300),commit:z.string().regex(/^[0-9a-f]{40}$/),
 outcome:ExecOutcome,command:z.string().max(400).optional(),summary:z.string().max(600).default(""),
 counts:z.object({tests:Count,failures:Count,errors:Count,skipped:Count}).optional(),className:z.string().max(300).optional(),
 /** Path prefix of the test module the class belongs to ("backend/", or "" for the repository root): the same class name in two modules is two results. */
 module:z.string().max(300).optional(),
 logSha256:z.string().regex(/^[0-9a-f]{64}$/).optional(),recordedAt:z.string(),recordedBy:z.string().max(100)
}).superRefine((r,ctx)=>{
 if(!r.counts)return;
 if(r.outcome==="PASS"&&r.counts.failures+r.counts.errors>0)ctx.addIssue({code:"custom",message:"outcome PASS contradicts its own counts (failures/errors > 0)"});
 if(r.outcome==="PASS"&&r.counts.tests-r.counts.skipped<=0)ctx.addIssue({code:"custom",message:"outcome PASS but no test ran"});
});
export type ExecRecordValue=z.infer<typeof ExecRecord>;
export const ExecLedger=z.object({version:z.literal(1),records:z.array(ExecRecord)});
export type ExecLedgerValue=z.infer<typeof ExecLedger>;

/** What one run of the audit may use: the records of the audited commit, and how many belonged to other commits (listed, never used). */
export const ExecEvidenceSchema=z.object({records:z.array(ExecRecord),otherCommits:z.number().int().min(0)});
export type ExecEvidence=z.infer<typeof ExecEvidenceSchema>;
export const noExec:ExecEvidence={records:[],otherCommits:0};
export const execHash=(exec:ExecEvidence)=>createHash("sha256").update(JSON.stringify(exec)).digest("hex");

const FILE="verification.json",MAX_XML_BYTES=20_000_000;
const sha=(data:string|Buffer)=>createHash("sha256").update(data).digest("hex");
const slug=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);
const key=(r:ExecRecordValue)=>r.commit+"|"+r.id;

export async function loadLedger(store:TakeoverStore,projectId:string):Promise<ExecLedgerValue>{
 const raw=await store.readData<unknown>(SafeId.parse(projectId),FILE);
 return raw?ExecLedger.parse(raw):{version:1,records:[]};
}
/**
 * Records can only be added before the audit starts (a later one would be silently left out). A record is identified by commit and id, so a run
 * for another commit never replaces this one, and recording the SAME id for the same commit again with a different result is refused unless `replace`.
 */
export async function recordExec(store:TakeoverStore,projectId:string,records:ExecRecordValue[],options:{replace?:boolean}={}):Promise<ExecLedgerValue>{
 const id=SafeId.parse(projectId),existing=await store.load(id);
 if(existing)throw new TakeoverError("Takeover '"+id+"' already started ("+existing.status+"): record executed evidence before `run`, or audit again under a new project id","BAD_STATE");
 const ledger=await loadLedger(store,id),byKey=new Map(ledger.records.map(r=>[key(r),r])),conflicts:string[]=[];
 for(const raw of records){
  const record=ExecRecord.parse(raw),old=byKey.get(key(record));
  if(old&&!options.replace&&(old.logSha256!==record.logSha256||old.outcome!==record.outcome||old.kind!==record.kind))conflicts.push(record.id);
  else byKey.set(key(record),record);
 }
 if(conflicts.length)throw new TakeoverError(conflicts.length+" record(s) already exist for this commit with a different result ("+conflicts.slice(0,5).join(", ")+"): pass --replace to overwrite them deliberately","BAD_STATE");
 const next={version:1 as const,records:[...byKey.values()].sort((a,b)=>key(a).localeCompare(key(b)))};
 await store.writeJson(id,FILE,next);
 return next;
}

export type GateInput={name:string;commit:string;outcome:ExecOutcomeValue;command?:string;summary?:string;log?:string;counts?:ExecRecordValue["counts"];id?:string;by?:string};
export async function gateRecord(input:GateInput,now=new Date()):Promise<ExecRecordValue>{
 const logSha256=input.log?sha(await readFile(input.log)):undefined;
 return ExecRecord.parse({id:input.id??"gate:"+slug(input.name),kind:"gate",name:input.name,commit:input.commit,outcome:input.outcome,command:input.command,summary:input.summary??"",counts:input.counts,logSha256,recordedAt:now.toISOString(),recordedBy:input.by??"operator"});
}

const decode=(text:string)=>text.replace(/&(lt|gt|amp|quot|apos|#36);/g,(_,e:string)=>({lt:"<",gt:">",amp:"&",quot:'"',apos:"'","#36":"$"} as Record<string,string>)[e]);
const attrs=(tag:string)=>Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],decode(m[2]??m[3]??"")]));
const intOf=(v:string|undefined)=>v!=null&&/^\d+$/.test(v.trim())?Number(v):undefined;
/** The module prefix a test source path belongs to, and the class it declares: `backend/src/test/kotlin/a/b/FooTests.kt` -> {module:"backend/", className:"a.b.FooTests"}. */
export function junitClassOfPath(path:string):{module:string;className:string}|undefined{
 const m=/^(?:(.*\/))?src\/test\/(?:kotlin|java)\/(.+)\.(?:kt|java)$/.exec(path);
 return m?{module:m[1]??"",className:m[2].replace(/\//g,".")}:undefined;
}
/** "." and "" mean the repository root; anything else is a prefix ending in a slash. */
export const moduleOf=(text:string)=>{const t=text.trim().replace(/^\.\/?/,"").replace(/^\/+/,"");return t&&!t.endsWith("/")?t+"/":t;};

/**
 * One record per test suite in the TEST-*.xml files of a results directory. FAIL on any failure or error (the attribute OR a <failure>/<error>
 * element, comments and CDATA ignored), PASS only when tests ran and nothing failed, NOT_RUN when every test was skipped or the counts cannot be read.
 */
export async function junitRecords(dir:string,commit:string,module:string,by="operator",now=new Date()):Promise<ExecRecordValue[]>{
 const out:ExecRecordValue[]=[],mod=moduleOf(module);
 for(const name of (await readdir(dir)).filter(n=>/^TEST-.*\.xml$/.test(n)).sort()){
  const path=join(dir,name),size=(await stat(path)).size,fileName=name.replace(/^TEST-|\.xml$/g,"");
  const raw=size>MAX_XML_BYTES?"":await readFile(path,"utf8"),body=raw.replace(/<!--[\s\S]*?-->/g,"").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,""),tags=[...body.matchAll(/<testsuite\b([^>]*)>/g)].map(m=>attrs(m[1]));
  const elementFailure=/<(failure|error)[\s>/]/.test(body),logSha256=size>MAX_XML_BYTES?undefined:sha(raw);
  if(!tags.length){out.push(ExecRecord.parse({id:"junit:"+mod+fileName,kind:"junit",name:fileName,commit,outcome:elementFailure?"FAIL":"NOT_RUN",className:fileName,module:mod,summary:size>MAX_XML_BYTES?"file too large to read":"no <testsuite> element",logSha256,recordedAt:now.toISOString(),recordedBy:by}));continue;}
  const suites=tags.map(a=>({className:a.name??fileName,tests:intOf(a.tests),failures:intOf(a.failures),errors:intOf(a.errors),skipped:intOf(a.skipped)??0}));
  const anyAttributeFailure=suites.some(s=>(s.failures??0)+(s.errors??0)>0);
  for(const s of suites){
   const readable=s.tests!=null&&s.failures!=null&&s.errors!=null;
   const outcome:ExecOutcomeValue=!readable?(elementFailure?"FAIL":"NOT_RUN"):s.failures!+s.errors!>0||(elementFailure&&!anyAttributeFailure)?"FAIL":s.tests!>0&&s.skipped<s.tests!?"PASS":"NOT_RUN";
   const counts=readable?{tests:s.tests!,failures:s.failures!,errors:s.errors!,skipped:s.skipped}:undefined;
   // the counts may say PASS-shaped numbers while the elements say FAIL: keep the verdict, drop the contradicting counts from the PASS check
   const parsed=ExecRecord.safeParse({id:"junit:"+mod+s.className,kind:"junit",name:s.className,commit,outcome,className:s.className,module:mod,counts,summary:readable?s.tests+" tests, "+s.failures+" failed, "+s.errors+" errors, "+s.skipped+" skipped":"counts not readable",logSha256,recordedAt:now.toISOString(),recordedBy:by});
   if(parsed.success)out.push(parsed.data);
   else out.push(ExecRecord.parse({id:"junit:"+mod+fileName+":"+out.length,kind:"junit",name:fileName,commit,outcome:outcome==="PASS"?"NOT_RUN":outcome,className:fileName,module:mod,summary:"record rejected: "+parsed.error.issues[0].message.slice(0,200),logSha256,recordedAt:now.toISOString(),recordedBy:by}));
  }
 }
 return out;
}

/** The records an audit of this commit may use. */
export const usableFor=(ledger:ExecLedgerValue,head:string):ExecEvidence=>({records:ledger.records.filter(r=>r.commit===head),otherCommits:ledger.records.filter(r=>r.commit!==head).length});

export type ExecLookup={byId:Map<string,ExecRecordValue>;byClass:Map<string,ExecRecordValue>};
const classKey=(module:string,className:string)=>module+"|"+className;
export const lookupOf=(exec:ExecEvidence):ExecLookup=>({byId:new Map(exec.records.map(r=>[r.id,r])),byClass:new Map(exec.records.filter(r=>r.kind==="junit"&&r.className).map(r=>[classKey(r.module??"",r.className!),r]))});

/**
 * What the executed results say about one citation. A file maps to the class its path declares, in its own module. A directory counts EVERY
 * JUnit test file under it: PASS only when all of them ran and passed, FAIL when any failed, otherwise NOT_RUN with how many ran. Anything else says nothing.
 */
export function executedFor(lookup:ExecLookup,ref:string,snapshot:Snapshot):{outcome:ExecOutcomeValue;detail:string}|undefined{
 if(ref.startsWith("exec:")){const r=lookup.byId.get(ref.slice(5));return r?{outcome:r.outcome,detail:r.name+(r.summary?": "+r.summary:"")}:undefined;}
 const paths=ref.endsWith("/")?snapshot.tracked.filter(p=>p.startsWith(ref)):[ref],mapped=paths.flatMap(p=>{const c=junitClassOfPath(p);return c?[c]:[]});
 if(!mapped.length)return undefined;
 const hits=mapped.flatMap(c=>{const r=lookup.byClass.get(classKey(c.module,c.className));return r?[r]:[]});
 if(!hits.length)return undefined;
 if(hits.some(r=>r.outcome==="FAIL"))return {outcome:"FAIL",detail:hits.filter(r=>r.outcome==="FAIL").length+" of "+mapped.length+" test class(es) failed"};
 const passed=hits.filter(r=>r.outcome==="PASS").length;
 if(passed===mapped.length)return {outcome:"PASS",detail:passed+" of "+mapped.length+" test class(es) passed"};
 return {outcome:"NOT_RUN",detail:passed+" of "+mapped.length+" test class(es) passed, the rest did not run or were skipped"};
}

/** The block of the evidence pack: gates in full, JUnit classes summarised (they are matched to test files by the engine). Callers sanitise it like any pack data. */
export function execPackText(exec:ExecEvidence):string{
 if(!exec.records.length)return "EXECUTED RESULTS\nNone: nothing was executed for this commit.";
 const gates=exec.records.filter(r=>r.kind==="gate"),junit=exec.records.filter(r=>r.kind==="junit"),sum=(k:"tests"|"failures"|"errors"|"skipped")=>junit.reduce((n,r)=>n+(r.counts?.[k]??0),0),bad=junit.filter(r=>r.outcome==="FAIL"),skipped=junit.filter(r=>r.outcome==="NOT_RUN");
 const one=(t:string)=>t.replace(/\s+/g," ");
 return ["EXECUTED RESULTS (run by the operator for THIS exact commit and recorded before the audit; the audit did not re-run them; cite a gate as exec:<id>)",
  ...gates.map(g=>"- exec:"+g.id+" — "+one(g.name)+" — "+g.outcome+(g.command?" — command: "+one(g.command):"")+(g.summary?" — "+one(g.summary):"")),
  junit.length?"- JUnit: "+junit.length+" test classes, "+sum("tests")+" tests, "+sum("failures")+" failures, "+sum("errors")+" errors, "+sum("skipped")+" skipped. Citing a test file whose class passed counts as executed evidence for that file; a test DIRECTORY counts only when every JUnit class under it passed. The engine matches class names to paths itself."+(bad.length?"\n  FAILED classes: "+bad.map(r=>(r.module??"")+r.className).join(", "):"")+(skipped.length?"\n  not run (all skipped or unreadable): "+skipped.slice(0,40).map(r=>(r.module??"")+r.className).join(", "):""):"- No JUnit results recorded.",
  "Anything not listed here was NOT executed: do not assume it passed. A gate that passed says nothing about one particular item."].join("\n");
}
