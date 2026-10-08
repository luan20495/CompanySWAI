import assert from "node:assert/strict";
import test from "node:test";
import {runBenchmark} from "../src/benchmark.js";

test("the deterministic benchmark project passes every invariant and reports its metrics",async()=>{
 const report=await runBenchmark();
 assert.deepEqual(report.failures,[]);assert.equal(report.ok,true);
 assert.equal(report.agents.declared,11);assert.equal(report.tasks.succeeded,report.tasks.planned);assert.equal(report.tasks.failed,0);
 assert.ok(report.reviews.revisions>=1&&report.reviews.runs>report.tasks.planned,"double review plus a forced revision");
 assert.ok(report.retries>=1&&report.failovers>=1);
 assert.deepEqual(report.resume.firstRunFailed,["qa-engineer"]);assert.equal(report.resume.correct,true);assert.equal(report.resume.duplicateWork,0);
 assert.ok(Object.keys(report.providers).length>=2);
 assert.ok(report.gates.passed>0&&report.gates.failed===0&&report.gates.worktreeCommits>0);
 assert.equal(report.traceability.qa,"PASS");assert.ok(report.traceability.requirements>0&&report.traceability.citations>0&&report.traceability.decisions>0);
 assert.ok(report.final.status.startsWith("ACCEPTED"));assert.ok(report.runtimeMs>0&&report.usage.inputTokens>0&&report.usage.knownCost>0);
});
