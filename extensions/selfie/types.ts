// Shared types for the selfie plugin. Living here (not in index.ts) to avoid
// circular import graphs: dispatch/persona-config/prompt-assembly/classify
// all need SelfieStyle/SelfieCount, and index.ts imports them — if the types
// lived in index.ts, every module would create a cycle through the barrel.

export type SelfieStyle = "cozy" | "glam" | "tease" | "chunyu";
export type SelfieCount = 1 | 6;
