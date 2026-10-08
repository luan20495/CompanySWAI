/** Why no provider could be selected: nothing can ever serve this (NONE), everything eligible is busy (BUSY), or eligible ones are cooling down (COOLDOWN until retryAt). */
export type CapacityReason="NONE"|"BUSY"|"COOLDOWN";
export class CapacityUnavailableError extends Error{
 readonly code="CAPACITY_UNAVAILABLE";
 constructor(message="No eligible provider capacity",readonly reason:CapacityReason="NONE",readonly retryAt?:number){super(message);this.name="CapacityUnavailableError";}
}
export class BudgetExceededError extends Error{
 readonly code="BUDGET_EXCEEDED";
 constructor(message:string){super(message);this.name="BudgetExceededError";}
}
