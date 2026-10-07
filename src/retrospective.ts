import {ExperienceCandidate} from "./contracts.js";

export function proposeExperience(input:unknown){
 const c=ExperienceCandidate.parse(input);
 if(c.status!=="CANDIDATE") throw new Error("New retrospective lessons must start as CANDIDATE");
 return c;
}
export function canPromote(candidate:ReturnType<typeof proposeExperience>){
 return Boolean(candidate.reviewedBy && candidate.projectsObserved>=2 && candidate.evidence.length>=2);
}
