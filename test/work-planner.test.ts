import assert from "node:assert/strict";
import test from "node:test";
import {planCompanyWork} from "../src/work-planner.js";

test("company planner creates capability driven departments and dependencies",()=>{
 const plan=planCompanyWork({projectId:"shop",objective:"Build a secure commerce web application",capabilities:["backend","web-ui","deployment","security-critical"],complexity:4});
 assert.ok(plan.departments.some(d=>d.name==="backend"));assert.ok(plan.departments.some(d=>d.name==="frontend"));assert.ok(plan.departments.some(d=>d.name==="design"));assert.ok(plan.departments.some(d=>d.name==="platform"));
 const product=plan.tasks.filter(t=>t.department==="product").map(t=>t.id);const architecture=plan.tasks.filter(t=>t.department==="architecture");
 assert.ok(architecture.length>0);assert.ok(architecture.every(t=>product.every(id=>t.dependencies.includes(id))));
 assert.ok(plan.tasks.some(t=>t.reviewer));assert.ok(plan.tasks.some(t=>t.risk==="critical"));
});
