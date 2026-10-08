import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileApprovalStore} from "../src/approval-store.js";
import {LocalRepoWorkspace} from "../src/repo-workspace.js";

test("approval can use persisted pending estimate",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-approval-")),store=new FileApprovalStore(root);
 await store.request("p","t",1.25);const approved=await store.approve("p","t",undefined,"owner");
 assert.equal(approved.estimatedCost,1.25);assert.equal((await store.loadRequest("p","t"))?.status,"APPROVED");assert.equal(await store.covers("p","t",1.2),true);
});
test("workspace transaction restores files when a deterministic check fails",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-txn-")),path=join(root,"a.txt");await writeFile(path,"old","utf8");
 const ws=new LocalRepoWorkspace(root);
 await assert.rejects(()=>ws.transaction([{path:"a.txt",content:"new"},{path:"new.txt",content:"created"}],[{cmd:"node",args:["-e","process.exit(2)"]}]));
 assert.equal(await readFile(path,"utf8"),"old");
 await assert.rejects(()=>readFile(join(root,"new.txt"),"utf8"));
});
