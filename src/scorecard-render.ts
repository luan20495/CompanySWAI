import type {BaselineClaim,MetricResult,RunFact,Scorecard} from "./scorecard.js";
import {describeVersion} from "./company-version.js";

/** Plain-text views of the scorecard for a person at a terminal. Numbers are printed as measured; unknowns say UNKNOWN and why. */

export function fmtMs(value?:number|null){
 if(value==null)return "UNKNOWN";
 const s=Math.round(value/1000);
 if(s<60)return s+"s";
 const m=Math.floor(s/60),h=Math.floor(m/60);
 return h?h+"h "+(m%60)+"m":m+"m "+(s%60)+"s";
}
const num=(n:number)=>n.toLocaleString("en-US");
const pad=(text:string,width:number)=>text.length>=width?text:text+" ".repeat(width-text.length);
const day=(iso?:string)=>iso?iso.replace("T"," ").slice(0,16):"—";

function metricValue(m:MetricResult){
 if(m.status==="NOT_AVAILABLE")return "NOT AVAILABLE ("+m.reason+")";
 if(m.value===null)return "UNKNOWN"+(m.reason?" ("+m.reason+")":"");
 if(m.unit==="ratio")return (m.value*100).toFixed(1)+"%"+(m.numerator!=null&&m.denominator!=null?"  ("+num(m.numerator)+"/"+num(m.denominator)+")":"");
 if(m.unit==="ms")return fmtMs(m.value);
 if(m.unit==="per-run")return m.value+" per run"+(m.numerator!=null&&m.denominator!=null?"  ("+num(m.numerator)+"/"+num(m.denominator)+")":"");
 if(m.unit==="per-hour")return m.value+" /h"+(m.numerator!=null?"  ("+m.numerator+" over "+m.denominator+"h)":"");
 return num(m.value);
}

function tokensLine(card:Scorecard){
 const r=card.runs.reduce((t,run)=>({in:t.in+run.tokens.reported.input,out:t.out+run.tokens.reported.output,cr:t.cr+run.tokens.reported.cacheRead,cc:t.cc+run.tokens.reported.cacheCreation,n:t.n+run.tokens.reported.attempts,ein:t.ein+run.tokens.estimated.input,eout:t.eout+run.tokens.estimated.output,en:t.en+run.tokens.estimated.attempts,u:t.u+run.tokens.unknownAttempts}),{in:0,out:0,cr:0,cc:0,n:0,ein:0,eout:0,en:0,u:0});
 return [
  "  Tokens, provider-reported: in "+num(r.in)+" / out "+num(r.out)+" over "+r.n+" attempt(s)"+(r.cr||r.cc?" (of the input: cache read "+num(r.cr)+", cache creation "+num(r.cc)+")":" (cache split not recorded before Phase 0)"),
  "  Tokens, fixture estimates (dry-run, NOT real usage): in "+num(r.ein)+" / out "+num(r.eout)+" over "+r.en+" attempt(s)",
  "  Tokens unknown (no usage reported, e.g. timeouts): "+r.u+" attempt(s)"
 ];
}

export function renderScorecard(card:Scorecard,options:{failedLimit?:number}={}):string{
 const lines:string[]=[],limit=options.failedLimit??10;
 lines.push("COMPANYSWAI SCORECARD (read-only) — generated "+card.generatedAt+" — state "+card.stateDir);
 lines.push("Checkout: "+describeVersion(card.checkout)+"   Metric catalog v"+card.catalogVersion);
 if(card.program)lines.push("Evolution program: "+card.program.phases.map(p=>p.id+" "+p.status+(p.status!=="NOT_STARTED"?" (owner UAT "+p.ownerUat+")":"")).join(" | "));
 lines.push("Data: "+card.totals.projects+" project(s), "+card.totals.runs+" run(s) in view, activity "+day(card.window.firstActivity)+" → "+day(card.window.lastActivity)+" UTC"+(card.window.since||card.window.until?"  (filter "+(card.window.since??"…")+" → "+(card.window.until??"…")+")":""));
 lines.push("");
 lines.push("NOW");
 const running=card.runs.filter(r=>r.engine.state==="RUNNING");
 if(!running.length)lines.push("  No engine running.");
 for(const r of running)lines.push("  "+r.projectId+": "+(r.engine.running.map(t=>t.role+" on "+t.taskId+" ("+fmtMs(t.elapsedMs)+")").join(", ")||"engine alive, between steps")+"  [pid "+r.engine.pid+"]");
 const interrupted=card.runs.filter(r=>r.engine.state==="INTERRUPTED");
 if(interrupted.length)lines.push("  Interrupted (engine died mid-run, resumable): "+interrupted.map(r=>r.projectId).join(", "));
 lines.push("");
 lines.push("RUNS ("+card.totals.runs+"): "+Object.entries(card.totals.byFinal).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+" "+v).join(" · "));
 const src=(v:string,b:string)=>card.runs.filter(r=>r.planSource.value===v&&r.planSource.basis===b).length;
 lines.push("  Plan source: supplied whole "+(src("supplied-plan","recorded")+src("supplied-plan","derived"))+" (recorded "+src("supplied-plan","recorded")+", derived "+src("supplied-plan","derived")+") · compiled from brief "+(src("brief","recorded")+src("brief","derived"))+" · unknown "+card.runs.filter(r=>r.planSource.value==="unknown").length);
 lines.push("  Company version recorded on "+card.coverage.versionRecorded+"/"+card.totals.runs+" run(s) (runs before Phase 0 have none)");
 lines.push("");
 const failures=card.runs.flatMap(r=>r.failures.map(f=>({...f,projectId:r.projectId}))).sort((a,b)=>(b.at??"").localeCompare(a.at??""));
 lines.push("FAILED — why and who ("+failures.length+" task(s) whose latest attempt failed"+(failures.length>limit?", latest "+limit+" shown":"")+")");
 if(!failures.length)lines.push("  None.");
 for(const f of failures.slice(0,limit))lines.push("  "+day(f.at)+"  "+pad(f.projectId,22)+" "+pad(f.taskId,24)+" "+pad(f.role,18)+" "+f.reason);
 lines.push("");
 const conflicts=card.runs.filter(r=>r.qaConflict);
 lines.push("QA CONFLICTS — reported "+"ACCEPTED but a QA task said FAIL/BLOCKED ("+conflicts.length+"). Phase 0 only detects this; Phase 1 is meant to block it.");
 if(!conflicts.length)lines.push("  None.");
 for(const r of conflicts.slice(0,limit))lines.push("  "+pad(r.projectId,26)+" final "+pad(r.final??"",20)+" QA "+r.qa.filter(q=>q.verdict==="FAIL"||q.verdict==="BLOCKED").map(q=>q.taskId+"="+q.verdict).join(", "));
 if(conflicts.length>limit)lines.push("  … "+(conflicts.length-limit)+" more (use --json)");
 lines.push("");
 const m=(id:string)=>card.metrics.find(x=>x.id===id)!;
 const att=card.runs.reduce((t,r)=>({maker:t.maker+r.attempts.maker,review:t.review+r.attempts.review,failed:t.failed+r.attempts.failed,flight:t.flight+r.attempts.inFlight}),{maker:0,review:0,failed:0,flight:0});
 lines.push("TIME & RESOURCES");
 lines.push("  Attempts (provider calls): "+(att.maker+att.review)+" (maker "+att.maker+", review "+att.review+"), failed "+att.failed+", in flight "+att.flight+"; median attempt "+fmtMs(m("median_attempt_ms").value)+"; capacity pauses (no call made) "+card.coverage.capacityPauses);
 lines.push("  Busy time (any attempt in progress): "+fmtMs((m("accepted_runs_per_busy_hour").denominator??0)*3_600_000)+"; idle time between attempts: "+fmtMs(m("dispatch_gap_ms").value));
 lines.push(...tokensLine(card));
 const est=m("estimated_metered_cost"),billed=m("billed_cost"),subs=card.runs.reduce((n,r)=>n+r.subscriptionAttempts,0);
 lines.push("  Money: billed "+(billed.value===null?"UNKNOWN (no billing source)":billed.value)+"; estimated at configured nominal rates "+(est.value===null?"none":est.value+" (estimate, not a bill)")+"; "+subs+" subscription attempt(s) → UNKNOWN (no per-call price)");
 lines.push("  Human interventions: "+(card.interventions.logExists?card.interventions.total+" recorded since "+day(card.interventions.since)+" ("+Object.entries(card.interventions.byKind).map(([k,v])=>k+" "+v).join(", ")+"), "+card.interventions.attributed+" attributed to a run window, "+card.interventions.unattributed+" not attributable"+(card.interventions.unattributed?" ("+Object.entries(card.interventions.unattributedReasons).map(([k,v])=>k+" "+v).join(", ")+")":"")+"; actors self-declared":"NOT RECORDED — no intervention log yet; earlier interventions are unknown, not zero"));
 lines.push("");
 lines.push("METRICS (catalog v"+card.catalogVersion+"; definitions: docs/evolution/METRICS.md)");
 for(const x of card.metrics)lines.push("  "+pad(x.id,32)+" "+metricValue(x)+(x.coverage?"  [coverage: "+x.coverage+"]":""));
 lines.push("");
 const c=card.coverage;
 lines.push("DATA QUALITY");
 lines.push("  unreadable execution-log lines "+c.unreadableLogLines+" · runs without run state "+c.runsWithoutState+" · without plan "+c.runsWithoutPlan+" · unreadable run/plan files "+c.unreadableRunFiles+" · attempts never finished "+c.attemptsWithoutFinish);
 lines.push("  attempts with estimated (fixture) tokens "+c.estimatedTokenAttempts+" · with unknown tokens "+c.unknownTokenAttempts+" · runs with recorded provenance "+c.provenanceRecorded);
 lines.push("  Release readiness: NOT TRACKED (no feature/release state until Phase 7).");
 return lines.join("\n");
}

export function renderProject(card:Scorecard,run:RunFact):string{
 const lines:string[]=[];
 lines.push("PROJECT "+run.projectId+" — "+(run.final??"no final status")+(run.finalQa?" (final QA "+run.finalQa+")":"")+" · phase "+(run.phase??"—")+" · engine "+run.engine.state);
 lines.push("  Started "+day(run.startedAt)+" · ended "+day(run.endedAt)+" · active "+fmtMs(run.activeMs)+" · plan "+run.planSource.value+" ("+run.planSource.basis+") · lessons in plan "+(run.lessonsInjected.value??"UNKNOWN")+" · company "+describeVersion(run.companyVersion));
 if(run.qaConflict)lines.push("  ⚠ QA CONFLICT: run reported "+run.final+" but QA said "+run.qa.filter(q=>q.verdict!=="PASS").map(q=>q.taskId+"="+q.verdict).join(", "));
 for(const t of run.engine.running)lines.push("  RUNNING: "+t.role+" on "+t.taskId+" for "+fmtMs(t.elapsedMs));
 lines.push("  Tokens reported in "+num(run.tokens.reported.input)+" / out "+num(run.tokens.reported.output)+" ("+run.tokens.reported.attempts+" attempts) · estimated "+run.tokens.estimated.attempts+" · unknown "+run.tokens.unknownAttempts+" · interventions "+(run.interventions??"NOT RECORDED"));
 lines.push("");
 lines.push("  "+pad("TASK",26)+pad("ROLE",19)+pad("TRIES",6)+pad("FIRST",11)+pad("LAST",11)+pad("DONE",6)+pad("REVIEW P/C",11)+pad("QA",9)+pad("WALL",9)+"WHY FAILED");
 for(const t of run.tasks)lines.push("  "+pad(t.taskId,26)+pad(t.role,19)+pad(String(t.attempts),6)+pad(t.firstAttempt??"—",11)+pad(t.lastAttempt??"—",11)+pad(t.done===undefined?"?":t.done?"yes":"no",6)+pad(t.reviews.pass+"/"+t.reviews.changesRequired,11)+pad(t.qa??"—",9)+pad(fmtMs(t.wallMs),9)+(t.lastAttempt==="FAILED"?t.failure??"":""));
 if(run.issues.length)lines.push("","  Data issues: "+run.issues.join("; "));
 if(Object.keys(run.skillsSelected).length)lines.push("  Skills selected (selection only, effect not measured): "+Object.entries(run.skillsSelected).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+" "+v).join(", "));
 return lines.join("\n");
}

export function renderBaseline(card:Scorecard,claims:BaselineClaim[]):string{
 const lines=["BASELINE REPLAY (read-only) — audit claims recomputed from "+card.stateDir+" at "+card.generatedAt,"  window "+day(card.window.firstActivity)+" → "+day(card.window.lastActivity)+" UTC · "+card.totals.runs+" run(s) · "+card.totals.attempts+" attempt(s)",""];
 for(const c of claims)lines.push("  "+c.id+"  "+pad(c.claim,62)+" → "+c.result+(c.basis?"   ["+c.basis+"]":""));
 lines.push("","  Data quality: unreadable log lines "+card.coverage.unreadableLogLines+", runs without plan "+card.coverage.runsWithoutPlan+", estimated-token attempts "+card.coverage.estimatedTokenAttempts+", unknown-token attempts "+card.coverage.unknownTokenAttempts);
 return lines.join("\n");
}
