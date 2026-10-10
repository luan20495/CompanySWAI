import type {AgentView,BlockerView,HandoffView,LogEntry,QaView,ReviewsView,StatusView,TaskDetail,TaskView,UsageView} from "./operator.js";

/** Plain-text renderers for the operator interface. Concise by default; the evidence/full variants are opt-in. */
const clip=(text:string,limit:number)=>text.length>limit?text.slice(0,limit-1)+"…":text;
const pad=(text:string,width:number)=>text.length>=width?text:text+" ".repeat(width-text.length);
const none=(lines:string[])=>lines.length?lines:["- none"];
const width=(items:string[],min=6)=>Math.max(min,...items.map(x=>x.length))+2;

export function duration(ms:number|undefined){
 if(ms===undefined||!Number.isFinite(ms))return "?";
 const s=Math.max(0,Math.round(ms/1000));
 if(s<60)return s+"s";
 const m=Math.floor(s/60);if(m<60)return m+"m";
 const h=Math.floor(m/60);return h+"h"+String(m%60).padStart(2,"0")+"m";
}
const stateLabel=(state:string)=>state.replace(/_/g," ");

export function renderProjects(rows:Array<{projectId:string;engine:string;phase?:string;final?:string;done:number;total:number;running:number}>){
 if(!rows.length)return "No projects.";
 return ["PROJECTS",...rows.map(r=>"- "+pad(r.projectId,28)+pad(r.engine,13)+pad(r.phase??"-",14)+(r.total?r.done+"/"+r.total+" tasks done":"no plan")+(r.running?", "+r.running+" running":"")+(r.final?"  final "+r.final:""))].join("\n");
}

export function renderStatus(view:StatusView,implicit=false){
 const lines=["PROJECT: "+view.projectId+(implicit?"  (the only project)":"")];
 const engine=view.engine;
 lines.push("ENGINE: "+engine.state+(engine.state==="RUNNING"?" (pid "+engine.pid+", up "+duration(engine.elapsedMs)+")":engine.state==="INTERRUPTED"?" — the engine process is gone; `resume` continues from the log":"")+(view.phase?"  PHASE: "+view.phase:""));
 if(view.stopped)lines.push("STOPPED: "+view.stopped);
 if(view.final)lines.push("FINAL: "+view.final.status+(view.final.reasons.length?" — "+view.final.reasons.join("; "):"")+(view.final.risks.length?" | risks: "+view.final.risks.join("; "):"")+" | QA "+view.final.qa.status);
 const c=view.tasks.counts;
 const stuck=c.BLOCKED+c.PAUSED+c.AWAITING_APPROVAL+c.INTERRUPTED;
 const parts=[c.RUNNING&&c.RUNNING+" running",c.READY&&c.READY+" ready",c.WAITING&&c.WAITING+" waiting",stuck&&stuck+" blocked"].filter(Boolean);
 lines.push("PROGRESS: "+view.progress+(view.tasks.total?" ("+(parts.join(", ")||"nothing pending")+"; no percentage: tasks differ in size)":""));
 lines.push("ETA: "+(view.etaSecondsEstimate===undefined?"unknown (no deterministic estimate)":view.tasks.done===view.tasks.total?"complete":"~"+duration(view.etaSecondsEstimate*1000)+" ESTIMATE (critical path at planned provider speed; ignores queueing, retries and rework)"));
 if(view.projectApprovalPending)lines.push("APPROVAL: the project estimate needs approval before any task runs");
 const shown=[...view.running,...view.ready,...view.waiting,...view.blocked],w=width(shown.map(t=>t.running?.role||t.agentRole),10),iw=width(shown.map(t=>t.id));
 lines.push("","RUNNING",...none(view.running.map(t=>"- "+pad(t.running?.role||t.agentRole,w)+pad(t.id,iw)+clip(t.title,40)+" — "+(t.running?.step??"")+", "+duration(t.running?.elapsedMs)+(t.running?.provider?", "+t.running.provider+"/"+t.running.model:""))));
 lines.push("","READY",...none(view.ready.map(t=>"- "+pad(t.agentRole,w)+pad(t.id,iw)+clip(t.title,40)+" — next step: "+t.stage)));
 lines.push("","WAITING",...none(view.waiting.map(t=>"- "+pad(t.agentRole,w)+pad(t.id,iw)+t.reason)));
 lines.push("","BLOCKED",...none(view.blocked.map(t=>"- "+pad(t.agentRole,w)+pad(t.id,iw)+stateLabel(t.state)+(t.reason?": "+clip(t.reason,200):""))));
 lines.push("","NEXT",...none(view.next.map(n=>"- "+n)));
 lines.push("","DONE: "+(c.DONE?c.DONE+" task(s)":"none"));
 if(view.corruptLogLines)lines.push("WARNING: "+view.corruptLogLines+" unreadable execution-log line(s) were quarantined");
 return lines.join("\n");
}

export function renderTasks(tasks:TaskView[]){
 if(!tasks.length)return "No tasks (no persisted plan).";
 const w=width(tasks.map(t=>t.agentRole),10),iw=width(tasks.map(t=>t.id));
 return ["TASKS",...tasks.map(t=>"- "+pad(t.id,iw)+pad(stateLabel(t.state),19)+pad(t.agentRole,w)+clip(t.title,44)+(t.state==="WAITING"?"  ← "+t.waitingOn.map(x=>x.taskId).join(","):"")+(t.state==="READY"||t.state==="RUNNING"?"  ["+t.stage+"]":""))].join("\n");
}

export function renderTask(detail:TaskDetail){
 const t=detail.task,lines=[
  "TASK: "+t.id+" — "+t.title,
  "OWNER: "+t.agentRole+" ("+t.department+")"+(t.reviewRole?"   REVIEWER: "+t.reviewRole+" ["+t.reviewLevel+"]":""),
  "STATE: "+stateLabel(t.state)+"   STAGE: "+t.stage+(t.reason?"\nWHY: "+t.reason:""),
  "DEPENDS ON: "+(t.dependencies.length?t.dependencies.join(", "):"nothing")+(t.waitingOn.length?"   (unfinished: "+t.waitingOn.map(w=>w.taskId+" "+w.state).join(", ")+")":""),
  "PRODUCES: "+(t.produces.join(", ")||"-"),
  "EXECUTIONS: "+t.attempts+" maker, "+t.reviewRuns+" review   VERSIONS: "+t.makerVersions+"   REVIEW: "+(t.reviewVerdicts.length?t.reviewVerdicts.map(v=>"slot "+v.slot+" "+v.verdict).join(", "):"none yet"),
  ...(t.running?["RUNNING: "+t.running.role+" — "+t.running.step+", "+duration(t.running.elapsedMs)+(t.running.provider?", "+t.running.provider+"/"+t.running.model:"")]:[]),
  ...(t.lastActivityAt?["LAST ACTIVITY: "+t.lastActivityAt]:[])
 ];
 const e=detail.evidence;
 if(!e)return lines.concat(["","(add --evidence for artifacts, gates, commits, attempts and log tail)"]).join("\n");
 const list=(label:string,items:string[])=>[label+":",...none(items.map(x=>"- "+x))];
 lines.push("","EVIDENCE",
  ...list("input artifacts",e.inputArtifacts),
  ...list("output artifacts",e.outputArtifacts.map(a=>a.id+" ["+a.kind+"] "+a.title+" ("+a.chars+" chars, "+a.createdAt+")")),
  ...list("handoffs out",e.handoffsOut.map(h=>h.id+" → "+h.to)),
  ...list("handoffs in",e.handoffsIn.map(h=>h.id+" ← "+h.from+" ("+h.fromTask+")")),
  ...list("decisions",e.decisions.map(d=>clip(d,200))),
  ...list("blockers",e.blockers.map(b=>clip(b,200))),
  ...list("gates",e.gates.map(g=>g.name+": "+g.status+(g.detail?" — "+clip(g.detail,160):""))),
  ...list("changed files",e.changedFiles),
  ...list("git commits",e.commits.map(c=>c.sha+" (in repository: "+c.inRepository+")")),
  ...(e.baseSha?["base sha: "+e.baseSha]:[]),
  ...list("reviews",e.reviews.map(r=>r.verdict+" by "+r.reviewerRole+" "+r.createdAt+(r.firstLine?" — "+r.firstLine:""))),
  ...list("execution attempts",e.attempts.map(a=>a.id.slice(0,8)+" "+a.taskId+" "+a.role+" "+a.status+" "+a.startedAt+(a.finishedAt?" → "+a.finishedAt:"")+" "+a.provider+"/"+a.model+" tokens "+a.inputTokens+"/"+a.outputTokens+(a.cost!=null?" cost "+a.cost:a.billing==="subscription"?" subscription":" cost unknown")+(a.error?" ERROR: "+a.error:""))),
  ...(e.checkpoint?["checkpoint: "+e.checkpoint.status+" at "+e.checkpoint.at+(e.checkpoint.remaining.length?" remaining: "+e.checkpoint.remaining.join("; "):"")]:[]),
  ...list("log tail",e.logTail.map(l=>l.ts+" "+l.text)),
  "full logs: "+e.logLocation);
 return lines.join("\n");
}

export function renderAgents(agents:AgentView[]){
 if(!agents.length)return "No agents (no persisted plan).";
 const out=["AGENTS"];
 for(const a of agents){
  out.push("- "+pad(a.role,24)+pad(a.state,9)+(a.current?a.current.taskId+" — "+a.current.step+", "+duration(a.current.elapsedMs)+(a.current.provider?", "+a.current.provider+"/"+a.current.model:""):a.assignments.map(x=>x.taskId+(x.kind==="review"?" (review)":"")+" "+x.state+(x.step?" ("+x.step+")":"")).join(", ")||"no tasks"));
  if(a.waitingFor.length&&a.state!=="RUNNING")out.push("    waiting for: "+a.waitingFor.join(", "));
  if(a.pendingHandoffsIn.length)out.push("    pending handoff in: "+a.pendingHandoffsIn.map(h=>h.fromRole+"("+h.fromTask+") → "+h.forTask).join(", "));
  if(a.outputs.length)out.push("    produced: "+clip(a.outputs.join("; "),160));
  if(a.lastActivityAt)out.push("    last activity: "+a.lastActivityAt);
 }
 return out.join("\n");
}

export function renderHandoffs(handoffs:HandoffView[],detail:boolean){
 if(!handoffs.length)return "No handoffs recorded.";
 if(!detail)return ["HANDOFFS (oldest first; use --latest or a task filter for full detail)",...handoffs.map(h=>"- "+pad(h.task,width(handoffs.map(x=>x.task)))+pad(h.from+" → "+h.to,width(handoffs.map(x=>x.from+" → "+x.to)))+pad(h.status,10)+clip(h.summary.replace(/\s+/g," "),80))].join("\n");
 return handoffs.map(h=>[
  "HANDOFF: "+h.id,"FROM: "+h.from,"TO: "+h.to+(h.receivers.length?" ("+h.receivers.map(r=>r.taskId+" "+r.state).join(", ")+")":""),"TASK: "+h.task+"   STATUS: "+h.status+"   AT: "+h.createdAt,
  "INPUT: "+(h.input.join(", ")||"-"),
  "OUTPUT: "+(h.output.map(o=>o.ref+(o.kind?" ["+o.kind+"]":"")+(o.title?" "+o.title:"")).join(", ")||"-"),
  "DECISIONS: "+(h.decisions.length?h.decisions.map(d=>clip(d,200)).join(" | "):"none"),
  "EVIDENCE: "+(h.evidence.length?h.evidence.map(d=>clip(d,160)).join(" | "):"none"),
  "BLOCKERS: "+(h.blockers.length?h.blockers.map(d=>clip(d,200)).join(" | "):"none"),
  "NEXT EXPECTED ACTION: "+h.nextExpectedAction,"SUMMARY: "+clip(h.summary.replace(/\s+/g," "),600)
 ].join("\n")).join("\n\n");
}

export function renderBlockers(blockers:BlockerView[]){
 return ["BLOCKERS",...none(blockers.map(b=>"- "+(b.taskId?pad(b.taskId,width(blockers.map(x=>x.taskId??"")))+"":"")+(b.agentRole?pad(b.agentRole,width(blockers.map(x=>x.agentRole??""))):"")+"["+b.kind+"] "+clip(b.text,240)))].join("\n");
}

export function renderReviews(v:ReviewsView){
 const out=["REVIEWS",...none(v.tasks.map(t=>"- "+pad(t.taskId,width(v.tasks.map(x=>x.taskId)))+pad(stateLabel(t.state),19)+"reviewer "+pad(t.reviewRole,width(v.tasks.map(x=>x.reviewRole)))+(t.level?pad("["+t.level+"]",13):"")+"stage "+pad(t.stage,11)+"latest: "+(t.slots.length?t.slots.map(s=>s.verdict).join(","):"not reviewed yet")+"  rounds "+t.rounds+(t.changesRequested?", changes requested "+t.changesRequested+"x":"")))];
 out.push("","GATES",...none(v.gates.map(g=>"- "+pad(g.taskId,width(v.gates.map(x=>x.taskId)))+pad(g.gate,width(v.gates.map(x=>x.gate)))+g.status+(g.detail?" — "+clip(g.detail,120):""))));
 return out.join("\n");
}

export function renderQa(v:QaView){
 const out=["QA","RESULT: "+(v.qa?v.qa.overall+" (by "+v.qa.taskId+" at "+v.qa.at+")":"not run")+(v.final?"   FINAL GATE: "+v.final+(v.required?" (required)":""):"")+(v.state?"   QA TASK: "+stateLabel(v.state):"")];
 out.push("REQUIREMENTS: "+v.requirements.tested+"/"+v.requirements.total+" have at least one test"+(v.requirements.untested.length?" (untested: "+v.requirements.untested.join(", ")+")":""));
 out.push("REWORK: "+v.rework.rounds+" round(s) used"+(v.rework.limit!=null?" of "+v.rework.limit:"")+(v.rework.pending.length?"; pending: "+v.rework.pending.map(p=>p.taskId).join(", "):""));
 const bad=v.tests.filter(t=>t.status==="FAIL"||t.status==="BLOCKED");
 out.push("","FAILING / BLOCKED TESTS",...none(bad.map(t=>"- "+(t.id??"?")+" ["+t.requirementId+"] "+t.status+": "+t.text+(t.evidence?" | "+t.evidence:""))));
 out.push("","TESTS: "+v.tests.length+" total — "+["PASS","FAIL","BLOCKED","NOT_APPLICABLE"].map(s=>v.tests.filter(t=>t.status===s).length+" "+s).join(", "));
 return out.join("\n");
}

export function renderLogs(entries:LogEntry[],options:{tail:number;full:boolean;total:number;location:string}){
 if(!entries.length)return "No matching log entries.";
 const shown=entries.slice(-options.tail);
 const out=["LOG (latest "+shown.length+" of "+options.total+(options.full?", full":", concise — add --full for raw model output and all events")+")"];
 for(const e of shown){
  out.push(e.ts+" "+(e.taskId?pad(e.taskId,width(shown.map(x=>x.taskId??""))):"")+e.text);
  if(options.full&&e.body)out.push(...e.body.split("\n").map(l=>"    | "+l));
 }
 out.push("sources: "+options.location);
 return out.join("\n");
}

export function renderUsage(u:UsageView){
 return ["USAGE",
  "TOKENS: "+u.tokens.input+" in / "+u.tokens.output+" out   MODEL CALLS (finished): "+u.modelCalls,
  "COST: "+u.knownCost+" known metered"+(u.subscriptionRuns?" + "+u.subscriptionRuns+" subscription run(s), no per-token price":"")+(u.unknownCostRuns?" + "+u.unknownCostRuns+" run(s) with unknown cost":""),
  "RETRIES: "+u.retries+"   FAILOVERS: "+u.failovers,
  "PROVIDERS: "+(Object.entries(u.providers).map(([k,n])=>k+"×"+n).join(", ")||"-"),
  "BY AGENT:",...none(u.byAgent.map(a=>"- "+pad(a.role,24)+a.calls+" call(s), "+a.inputTokens+"/"+a.outputTokens+" tokens")),
  "(account-level session/weekly usage is not known to CompanySWAI; read it from the provider)"].join("\n");
}
