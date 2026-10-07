import {z} from "zod";

export const SafeId=z.string()
 .min(1)
 .max(128)
 .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/,"IDs may contain only letters, numbers, dot, underscore and dash");

export type SafeIdValue=z.infer<typeof SafeId>;
