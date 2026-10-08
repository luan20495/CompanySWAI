import assert from "node:assert/strict";
import test from "node:test";
import {composeCompany} from "../src/company.js";
import {routeTask} from "../src/capacity.js";

test("MD company activates only relevant agents",async()=>{
 const plan=await composeCompany({capabilities:["mobile","performance-critical"],complexity:4,mobileSkills:["flutter","dart"]});
 const roles=plan.flatMap(x=>x.agents.map(a=>a.role));
 assert.ok(roles.includes("mobile-engineer"));assert.ok(!roles.includes("backend-engineer"));assert.ok(!roles.includes("frontend-engineer"));
 assert.ok(roles.includes("product-lead"));assert.ok(roles.includes("tech-lead"));assert.ok(roles.includes("qa-engineer"));assert.ok(roles.includes("reviewer"));
});
test("router ignores unavailable provider",()=>{const demand={capabilities:["coding"],estimatedInputTokens:1000,estimatedOutputTokens:1000};const chosen=routeTask([{provider:"a",model:"x",state:"OUT_OF_CREDIT",capabilities:["coding"],contextWindow:10000,maxConcurrency:1},{provider:"b",model:"y",state:"AVAILABLE",capabilities:["coding"],contextWindow:10000,maxConcurrency:1}],demand);assert.equal(chosen?.provider,"b");});
