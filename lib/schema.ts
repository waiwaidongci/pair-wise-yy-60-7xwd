import { z } from 'zod';

const roleSchema = z.enum(['现场', '核验员', '复核员']);

const recordSchema = z.object({
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
  basisVersion: z.number(),
  verifiedAtBasis: z.number().nullable()
});

const findingSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  type: z.enum(['缺失证据', '单位不一致', '时间范围', '异常波动']),
  title: z.string(),
  detail: z.string(),
  assignee: z.string(),
  due: z.string(),
  status: z.enum(['开放', '补证中', '已关闭']),
  auto: z.boolean(),
  basisVersion: z.number(),
  invalidReason: z.enum(['数据变更', '单位变更', '来源变更']).nullable()
});

const gateSchema = z.object({
  id: z.enum(['evidence', 'calculation', 'revisions', 'methodology']),
  title: z.string(),
  auto: z.boolean(),
  status: z.enum(['待重算', '未通过', '已通过']),
  detail: z.string(),
  passedAtBasis: z.number().nullable(),
  staleReason: z.string().nullable()
});

const ledgerEntrySchema = z.object({
  seq: z.number(),
  opId: z.string(),
  type: z.enum(['补首版', '修订', '补证', '核验通过', '冲突留痕', '门禁重算', '确认依据', '签发放行', '恢复']),
  actor: z.string(),
  role: roleSchema,
  at: z.string(),
  recordId: z.string().optional(),
  basisVersion: z.number().optional(),
  fromVersion: z.number().optional(),
  toVersion: z.number().optional(),
  note: z.string().optional()
});

const conflictSchema = z.object({
  opId: z.string(),
  recordId: z.string(),
  actor: z.string(),
  at: z.string(),
  baseVersion: z.number(),
  currentVersion: z.number(),
  patch: z.object({
    activity: z.number().optional(),
    unit: z.string().optional(),
    source: z.string().optional(),
    reason: z.string()
  }),
  status: z.enum(['待处理', '已放弃', '已重生'])
});

const confirmationSchema = z.object({
  basisVersion: z.number(),
  reviewer: z.string(),
  at: z.string(),
  opId: z.string()
}).nullable();

export const basisDigestSchema = z.object({
  records: z.array(recordSchema),
  findings: z.array(findingSchema),
  gates: z.array(gateSchema),
  ledger: z.array(ledgerEntrySchema),
  conflicts: z.array(conflictSchema),
  basisVersion: z.number(),
  opSeq: z.number(),
  confirmation: confirmationSchema,
  confirmedSnapshot: z.null(),
  recoveries: z.array(z.object({ at: z.string(), restoredToBasis: z.number(), seq: z.number() }))
});

export const evidenceResponseSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    methodology: z.string(),
    vintage: z.string(),
    verifier: z.string()
  }),
  summary: z.object({
    period: z.string(),
    reduction: z.number(),
    evidenceRate: z.number(),
    openFindings: z.number(),
    sampled: z.number()
  }),
  basis: basisDigestSchema
});

export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;
export type BasisDigest = z.infer<typeof basisDigestSchema>;
