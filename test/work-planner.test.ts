import assert from "node:assert/strict";
import test from "node:test";
import {planCompanyWork} from "../src/work-planner.js";

test("MD planner resolves artifact dependencies and reviewer",async()=>{
 const plan=await planCompanyWork({projectId:"shop",objective:"Build a secure commerce web application",capabilities:["backend","web-ui","deployment","security-critical"],complexity:4});
 const roles=plan.tasks.map(t=>t.agentRole);
 assert.ok(roles.includes("backend-engineer"));assert.ok(roles.includes("frontend-engineer"));assert.ok(roles.includes("ux-ui-designer"));assert.ok(roles.includes("devops-sre"));
 const ba=plan.tasks.find(t=>t.agentRole==="business-analyst")!,tech=plan.tasks.find(t=>t.agentRole==="tech-lead")!,frontend=plan.tasks.find(t=>t.agentRole==="frontend-engineer")!;
 assert.ok(ba.dependencies.includes("product-lead"));assert.ok(tech.dependencies.includes("business-analyst"));assert.ok(frontend.dependencies.includes("ux-ui-designer"));
 assert.equal(frontend.reviewer,"reviewer");assert.ok(plan.tasks.some(t=>t.risk==="critical"));
});
