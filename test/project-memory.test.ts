import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ProjectMemoryStore} from "../src/project-memory.js";
import {parseAgentOutput} from "../src/output-parser.js";

test("project memory creates canonical Markdown files",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-mdmem-")),store=new ProjectMemoryStore(root);
 await store.init({projectId:"p",budget:{},tasks:[{id:"a",agentRole:"business-analyst",dependencies:[],system:"s",prompt:"p",inputRefs:[],maxTokens:10,capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1}]});
 await store.recordOutput("p","a","business-analyst","requirements body");
 const req=await readFile(join(root,"p","REQUIREMENTS.md"),"utf8"),plan=await readFile(join(root,"p","PLAN.md"),"utf8");
 assert.match(req,/requirements body/);assert.match(plan,/\*\*a\*\*/);
});
test("structured output parser extracts decisions and handoff",()=>{const p=parseAgentOutput("# Result\n## Decisions\nUse PostgreSQL.\n## Handoff\nBackend implements schema.");assert.equal(p.decision,"Use PostgreSQL.");assert.equal(p.handoff,"Backend implements schema.");});
