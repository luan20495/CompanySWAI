import assert from "node:assert/strict";
import test from "node:test";
import {appendFile,readFile,readdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {compliant,plan,selectorFor,task,tmpState,usage} from "./helpers.js";

test("a log line truncated by a crash is skipped, preserved, and never blocks resume or duplicates finished work",async()=>{
 const state=await tmpState();let calls=0;
 const selector=selectorFor(()=>{calls++;return usage(compliant("v"+calls));});
 const p=plan("trunc",[task("a"),task("b",{dependencies:["a"]})]);
 await new ProjectOrchestrator(selector,state).run(p);
 const callsBefore=calls,logPath=join(state.root,"executions","trunc","records.jsonl");
 await appendFile(logPath,'{"id":"half-written","projectId":"trunc","taskId":"c","agentRole":"x","prov');
 const again=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(again.skipped.sort(),["a","b"]);assert.equal(calls,callsBefore,"no successful task is repeated");
 assert.equal(await state.executions.corruptLines("trunc"),1);
 assert.match(await readFile(join(state.root,"executions","trunc","records.corrupt.jsonl"),"utf8"),/half-written/);
 await state.executions.append({id:"n",projectId:"trunc",taskId:"z",agentRole:"x",provider:"p",model:"m",status:"STARTED",startedAt:new Date().toISOString()});
 assert.ok((await state.executions.list("trunc")).some(r=>r.id==="n"),"appends after a torn line stay readable");
});

test("a corrupt or truncated checkpoint is quarantined and the run still completes",async()=>{
 const state=await tmpState(),p=plan("cp",[task("a")]);
 await new ProjectOrchestrator(selectorFor(()=>usage(compliant())),state).run(p);
 const file=join(state.root,"checkpoints","cp","a.json");
 await writeFile(file,'{"taskId":"a","at":"2026-01-01T0');
 assert.equal(await state.checkpoints.load("cp","a"),undefined);
 assert.ok((await readdir(join(state.root,"checkpoints","cp"))).some(f=>f.endsWith(".corrupt")));
 let calls=0;
 const summary=await new ProjectOrchestrator(selectorFor(()=>{calls++;return usage(compliant());}),state).run(p);
 assert.deepEqual(summary.skipped,["a"]);assert.equal(calls,0);
});

test("a checkpoint corrupted before the task finishes does not stop the task from completing",async()=>{
 const state=await tmpState();
 await state.checkpoints.save("cp2",{taskId:"a",at:new Date().toISOString(),status:"REVIEW",completed:[],remaining:[],artifactRefs:[],decisionRefs:[],compactContext:""});
 await writeFile(join(state.root,"checkpoints","cp2","a.json"),"garbage");
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(compliant())),state).run(plan("cp2",[task("a")]));
 assert.deepEqual(summary.completed,["a"]);
});
