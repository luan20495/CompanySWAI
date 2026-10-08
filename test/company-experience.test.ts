import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CompanyExperienceStore} from "../src/company-experience.js";

test("company experience promotes a repeated cross-project lesson only after two projects",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-experience-")),store=new CompanyExperienceStore(join(root,"experience.json")),lesson="Capacity pauses occurred; provision fallback capacity or reduce concurrency before the next comparable run.";
 const base={createdAt:new Date().toISOString(),totalRuns:1,failures:0,paused:1,inputTokens:1,outputTokens:1,actualCost:0,lessons:[lesson]};
 await store.observe({projectId:"p1",...base});assert.deepEqual(await store.validatedLessons(),[]);
 await store.observe({projectId:"p2",...base});assert.deepEqual(await store.validatedLessons(),[lesson]);
});
