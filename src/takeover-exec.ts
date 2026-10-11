import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {TakeoverError,type Snapshot} from "./takeover-probe.js";
import type {TakeoverStore} from "./takeover-store.js";

/**
 * Executed evidence for a takeover. An audit itself runs nothing; results come from runs the OPERATOR made (a gate, a test suite)
 * and recorded here before the audit starts. The engine does not re-run them and says so: each record is bound to one commit, carries
 * the hash of its log, and a record for another commit is never used. JUnit result files are parsed by the engine, one record per class.
 */
export const ExecOutcome=z.enum(["PASS","FAIL","NOT_RUN"]);
export type ExecOutcomeValue=z.infer<typeof ExecOutcome>;
const Count=z.number().int().min(0);
export const ExecRecord=z.object({
 id:z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/),kind:z.enum(["gate","junit"]),name:z.string().min(1).max(200),commit:z.string().regex(/^[0-9a-f]{40}$/),
 outcome:ExecOutcome,command:z.string().max(400).optional(),summary:z.string().max(600).default(""),
 counts:z.object({tests:Count,failures:Count,errors:Count,skipped:Count}).optional(),className:z.string().max(300).optional(),
 logSha256:z.string().regex(/^[0-9a-f]{64}$/).optional(),recordedAt:z.string(),recordedBy:z.string().max(100)
});
export type ExecRecordValue=z.infer<typeof ExecRecord>;
export const ExecLedger=z.object({version:z.literal(1),records:z.array(ExecRecord)});
export type ExecLedgerValue=z.infer<typeof ExecLedger>;

/** What one run of the audit may use: the records of the audited commit, and how many belonged to other commits (listed, never used). */
export type ExecEvidence={records:ExecRecordValue[];otherCommits:number};
export const noExec:ExecEvidence={records:[],otherCommits:0};

const FILE="verification.json";
const sha=(data:string|Buffer)=>createHash("sha256").update(data).digest("hex");
const slug=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);

export async function loadLedger(store:TakeoverStore,projectId:string):Promise<ExecLedgerValue>{
 const raw=await store.readData<unknown>(SafeId.parse(projectId),FILE);
 return raw?ExecLedger.parse(raw):{version:1,records:[]};
}
/** Records can only be added before the audit starts: an audit already assessed does not change afterwards, so a late record would be silently ignored. */
export async function recordExec(store:TakeoverStore,projectId:string,records:ExecRecordValue[]):Promise<ExecLedgerValue>{
 const id=SafeId.parse(projectId),existing=await store.load(id);
 if(existing)throw new TakeoverError("Takeover '"+id+"' already started ("+existing.status+"): record executed evidence before `run`, or audit again under a new project id","BAD_STATE");
 const ledger=await loadLedger(store,id),byId=new Map(ledger.records.map(r=>[r.id,r]));
 for(const record of records)byId.set(record.id,ExecRecord.parse(record));
 const next={version:1 as const,records:[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id))};
 await store.writeJson(id,FILE,next);
 return next;
}

export type GateInput={name:string;commit:string;outcome:ExecOutcomeValue;command?:string;summary?:string;log?:string;counts?:ExecRecordValue["counts"];id?:string;by?:string};
export async function gateRecord(input:GateInput,now=new Date()):Promise<ExecRecordValue>{
 const logSha256=input.log?sha(await readFile(input.log)):undefined;
 return ExecRecord.parse({id:input.id??"gate:"+slug(input.name),kind:"gate",name:input.name,commit:input.commit,outcome:input.outcome,command:input.command,summary:input.summary??"",counts:input.counts,logSha256,recordedAt:now.toISOString(),recordedBy:input.by??"operator"});
}

const attrs=(tag:string)=>Object.fromEntries([...tag.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
/** One record per JUnit XML file (a test class): PASS when it ran and nothing failed, FAIL on any failure or error, NOT_RUN when every test was skipped. */
export async function junitRecords(dir:string,commit:string,by="operator",now=new Date()):Promise<ExecRecordValue[]>{
 const out:ExecRecordValue[]=[];
 for(const name of (await readdir(dir)).filter(n=>/^TEST-.*\.xml$/.test(n)).sort()){
  const xml=await readFile(join(dir,name),"utf8"),tag=/<testsuite\s([^>]*)>/.exec(xml);
  if(!tag)continue;
  const a=attrs(tag[1]),className=a.name??name.replace(/^TEST-|\.xml$/g,""),tests=Number(a.tests??0),failures=Number(a.failures??0),errors=Number(a.errors??0),skipped=Number(a.skipped??0);
  if(![tests,failures,errors,skipped].every(Number.isInteger))continue;
  const outcome:ExecOutcomeValue=failures+errors>0?"FAIL":tests>0&&skipped>=tests?"NOT_RUN":tests>0?"PASS":"NOT_RUN";
  out.push(ExecRecord.parse({id:"junit:"+className,kind:"junit",name:className,commit,outcome,className,counts:{tests,failures,errors,skipped},summary:tests+" tests, "+failures+" failed, "+errors+" errors, "+skipped+" skipped",logSha256:sha(xml),recordedAt:now.toISOString(),recordedBy:by}));
 }
 return out;
}

/** The records an audit of this commit may use. */
export const usableFor=(ledger:ExecLedgerValue,head:string):ExecEvidence=>({records:ledger.records.filter(r=>r.commit===head),otherCommits:ledger.records.filter(r=>r.commit!==head).length});

/** The JUnit class a test source file declares by its name and location (`.../src/test/kotlin/a/b/FooTests.kt` -> `a.b.FooTests`). */
export const junitClassOfPath=(path:string)=>/(?:^|\/)src\/test\/(?:kotlin|java)\/(.+)\.(?:kt|java)$/.exec(path)?.[1].replace(/\//g,".");

export type ExecLookup={byId:Map<string,ExecRecordValue>;byClass:Map<string,ExecRecordValue>};
export const lookupOf=(exec:ExecEvidence):ExecLookup=>({byId:new Map(exec.records.map(r=>[r.id,r])),byClass:new Map(exec.records.filter(r=>r.kind==="junit"&&r.className).map(r=>[r.className!,r]))});

/**
 * What the executed results say about one citation. A file maps to its own class; a directory to the classes of the test files under it
 * (FAIL if any failed, PASS only when at least one passed and none failed). Anything that was not run says nothing.
 */
export function executedFor(lookup:ExecLookup,ref:string,snapshot:Snapshot):{outcome:ExecOutcomeValue;detail:string}|undefined{
 if(ref.startsWith("exec:")){const r=lookup.byId.get(ref.slice(5));return r?{outcome:r.outcome,detail:r.name+(r.summary?": "+r.summary:"")}:undefined;}
 const paths=ref.endsWith("/")?snapshot.tracked.filter(p=>p.startsWith(ref)):[ref],hits=paths.flatMap(p=>{const c=junitClassOfPath(p),r=c?lookup.byClass.get(c):undefined;return r?[r]:[]});
 if(!hits.length)return undefined;
 if(hits.some(r=>r.outcome==="FAIL"))return {outcome:"FAIL",detail:hits.filter(r=>r.outcome==="FAIL").length+" of "+hits.length+" matching test classes failed"};
 const passed=hits.filter(r=>r.outcome==="PASS").length;
 return passed?{outcome:"PASS",detail:passed+" of "+hits.length+" matching test class(es) passed"}:{outcome:"NOT_RUN",detail:"matching test classes were skipped"};
}

/** The block of the evidence pack: gates in full, JUnit classes summarised (they are matched to test files by the engine). */
export function execPackText(exec:ExecEvidence):string{
 if(!exec.records.length)return "EXECUTED RESULTS\nNone: nothing was executed for this commit.";
 const gates=exec.records.filter(r=>r.kind==="gate"),junit=exec.records.filter(r=>r.kind==="junit"),sum=(k:"tests"|"failures"|"errors"|"skipped")=>junit.reduce((n,r)=>n+(r.counts?.[k]??0),0),bad=junit.filter(r=>r.outcome==="FAIL"),skipped=junit.filter(r=>r.outcome==="NOT_RUN");
 return ["EXECUTED RESULTS (run by the operator for THIS exact commit and recorded before the audit; the audit did not re-run them; cite a gate as exec:<id>)",
  ...gates.map(g=>"- exec:"+g.id+" — "+g.name+" — "+g.outcome+(g.command?" — command: "+g.command:"")+(g.summary?" — "+g.summary:"")),
  junit.length?"- JUnit: "+junit.length+" test classes, "+sum("tests")+" tests, "+sum("failures")+" failures, "+sum("errors")+" errors, "+sum("skipped")+" skipped. Citing a test file (or a specific test directory) whose class passed counts as executed evidence; the engine matches class names to paths itself."+(bad.length?"\n  FAILED classes: "+bad.map(r=>r.className).join(", "):"")+(skipped.length?"\n  not run (all skipped): "+skipped.map(r=>r.className).join(", "):""):"- No JUnit results recorded.",
  "Anything not listed here was NOT executed: do not assume it passed."].join("\n");
}
