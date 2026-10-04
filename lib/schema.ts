import { z } from 'zod';

export const actorRoleSchema = z.enum(['核验员', '复核员', '现场']);
export type ActorRole = z.infer<typeof actorRoleSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  methodology: z.string(),
  vintage: z.string(),
  verifier: z.string()
});

export const summarySchema = z.object({
  period: z.string(),
  reduction: z.number(),
  evidenceRate: z.number(),
  openFindings: z.number(),
  sampled: z.number()
});

export const recordSchema = z.object({
  id: z.string(),
  source: z.string(),
  activity: z.number(),
  unit: z.string(),
  factor: z.number(),
  factorUnit: z.string(),
  timeRange: z.string(),
  evidenceCount: z.number(),
  anomaly: z.number(),
  owner: z.string(),
  status: z.enum(['待核验', '复核中', '已核验', '需补证']),
  revision: z.number(),
  version: z.number(),
  lastOperationId: z.string().optional()
});

export const findingSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  type: z.enum(['缺失证据', '单位不一致', '时间范围', '异常波动']),
  title: z.string(),
  detail: z.string(),
  assignee: z.string(),
  due: z.string(),
  status: z.enum(['开放', '补证中', '已关闭']),
  basisVersion: z.number(),
  stale: z.boolean()
});

export const gateSchema = z.object({
  id: z.enum(['evidence', 'calculation', 'revisions', 'methodology']),
  title: z.string(),
  detail: z.string(),
  checked: z.boolean(),
  confirmedVersion: z.number().optional(),
  stale: z.boolean()
});

export const revisionSchema = z.object({
  operationId: z.string(),
  kind: z.enum(['revision', 'confirmGate', 'finding', 'verifyRecord']),
  version: z.number(),
  recordId: z.string().optional(),
  gateId: z.enum(['evidence', 'calculation', 'revisions', 'methodology']).optional(),
  findingId: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  actor: z.string(),
  actorRole: actorRoleSchema,
  at: z.string()
});

export const conflictSchema = revisionSchema.extend({
  status: z.literal('conflict'),
  expectedVersion: z.number(),
  currentVersion: z.number(),
  conflictReason: z.string()
});

export const basisSchema = z.object({
  version: z.number(),
  records: z.array(recordSchema),
  findings: z.array(findingSchema),
  gates: z.array(gateSchema),
  revisions: z.array(revisionSchema),
  conflicts: z.array(conflictSchema)
});

export const evidenceResponseSchema = z.object({
  project: projectSchema,
  summary: summarySchema,
  basis: basisSchema
});

export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;
export type Basis = z.infer<typeof basisSchema>;
export type BasisRecord = z.infer<typeof recordSchema>;
export type BasisFinding = z.infer<typeof findingSchema>;
export type IssuanceGate = z.infer<typeof gateSchema>;
export type RevisionRecord = z.infer<typeof revisionSchema>;
export type ConflictRecord = z.infer<typeof conflictSchema>;

/** 客户端 → 服务端：签发依据写入操作。 */
export const operationSchema = z.object({
  kind: z.enum(['revision', 'confirmGate', 'unconfirmGate', 'finding']),
  operationId: z.string().min(1),
  expectedVersion: z.number(),
  actor: z.string(),
  actorRole: actorRoleSchema,
  recordId: z.string().optional(),
  gateId: z.enum(['evidence', 'calculation', 'revisions', 'methodology']).optional(),
  findingId: z.string().optional(),
  status: z.enum(['开放', '补证中', '已关闭']).optional(),
  changes: z
    .object({
      activity: z.number().optional(),
      unit: z.string().optional(),
      factor: z.number().optional(),
      factorUnit: z.string().optional(),
      source: z.string().optional(),
      timeRange: z.string().optional()
    })
    .optional(),
  reason: z.string().optional()
});

export type BasisOperation = z.infer<typeof operationSchema>;

/** 服务端 → 客户端：写入结果。 */
export const operationResultSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum(['conflict', 'forbidden']).optional(),
  idempotent: z.boolean().optional(),
  basis: basisSchema,
  revision: revisionSchema.optional(),
  conflict: conflictSchema.optional()
});

export type OperationResult = z.infer<typeof operationResultSchema>;
