import assert from "node:assert/strict";
import test from "node:test";
import {parseAgentOutput,parseReviewVerdict} from "../src/output-parser.js";

test("structured output parser extracts blocker evidence and review verdict",()=>{
 const text="CHANGES_REQUIRED\n\n## Blockers\nMissing migration plan.\n## Evidence\nNo rollback test.";
 const parsed=parseAgentOutput(text);assert.equal(parsed.blockers,"Missing migration plan.");assert.equal(parsed.evidence,"No rollback test.");assert.equal(parseReviewVerdict(text),"CHANGES_REQUIRED");
});
