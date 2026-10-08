import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileApprovalStore} from "../src/approval-store.js";

test("approval can use persisted pending estimate",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-approval-")),store=new FileApprovalStore(root);
 await store.request("p","t",1.25);const approved=await store.approve("p","t",undefined,"owner");
 assert.equal(approved.estimatedCost,1.25);assert.equal((await store.loadRequest("p","t"))?.status,"APPROVED");assert.equal(await store.covers("p","t",1.2),true);
});
