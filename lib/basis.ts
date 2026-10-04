/**
 * 签发依据（Issuance Basis）领域内核。
 *
 * 记录、发现项、签发门禁不再各存一份，而是共同引用同一个“签发依据”版本：
 *  - 修订（数据/单位/来源变更）推进依据版本，携带版本号与操作号；
 *  - 两人同时修订时先到生效，后到依据过期版本号判定为冲突，仅留痕、不进依据；
 *  - 数据、单位或来源一变，关联发现项与已确认门禁失效（stale），需按新依据重算；
 *  - 复核员/核验员确认门禁时绑定依据版本，现场角色越权提交被拒绝；
 *  - 每次写入携带操作号，重试不重复记账（幂等）；
 *  - 写入失败后从最后确认版本恢复；
 *  - 老记录无版本号时补成首版（V1）。
 */

export const ACTOR_ROLES = ['核验员', '复核员', '现场'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/** 可确认门禁的角色：核验员、复核员；现场角色越权。 */
export function canConfirm(role: ActorRole): boolean {
  return role === '核验员' || role === '复核员';
}

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';
export type FindingStatus = '开放' | '补证中' | '已关闭';
export type FindingType = '缺失证据' | '单位不一致' | '时间范围' | '异常波动';
export type GateId = 'evidence' | 'calculation' | 'revisions' | 'methodology';

export type BasisRecord = {
  id: string;
  source: string;
  activity: number;
  unit: string;
  factor: number;
  factorUnit: string;
  timeRange: string;
  evidenceCount: number;
  anomaly: number;
  owner: string;
  status: RecordStatus;
  /** 记录自身的修订计数（每次修订 +1） */
  revision: number;
  /** 该记录最近一次被提交时所处的签发依据版本；老记录无版本号时补 1 */
  version: number;
  /** 最近一次生效写入的操作号 */
  lastOperationId?: string;
};

export type BasisFinding = {
  id: string;
  recordId: string;
  type: FindingType;
  title: string;
  detail: string;
  assignee: string;
  due: string;
  status: FindingStatus;
  /** 该发现项当前结论所绑定的依据版本 */
  basisVersion: number;
  /** 关联记录的数据/单位/来源已变更 → 结论失效，需按新依据重算 */
  stale: boolean;
};

export type IssuanceGate = {
  id: GateId;
  title: string;
  detail: string;
  checked: boolean;
  /** 确认时绑定的依据版本；未确认则为空 */
  confirmedVersion?: number;
  /** 依据版本已推进、原确认过期 → 门禁失效，需按新依据重新确认 */
  stale: boolean;
};

export type RevisionKind = 'revision' | 'confirmGate' | 'finding' | 'verifyRecord';

export type RevisionRecord = {
  operationId: string;
  kind: RevisionKind;
  /** 本次写入后依据所处的版本（修订推进版本；确认/发现项绑定当前版本） */
  version: number;
  recordId?: string;
  gateId?: string;
  findingId?: string;
  changes?: Record<string, unknown>;
  reason?: string;
  actor: string;
  actorRole: ActorRole;
  at: string;
};

export type ConflictRecord = RevisionRecord & {
  status: 'conflict';
  expectedVersion: number;
  currentVersion: number;
  conflictReason: string;
};

export type Basis = {
  /** 当前签发依据版本号 */
  version: number;
  records: BasisRecord[];
  findings: BasisFinding[];
  gates: IssuanceGate[];
  /** 已生效写入流水（审计链） */
  revisions: RevisionRecord[];
  /** 后到的冲突写入（留痕，不进依据） */
  conflicts: ConflictRecord[];
};

export type RevisionChanges = Partial<{
  activity: number;
  unit: string;
  factor: number;
  factorUnit: string;
  source: string;
  timeRange: string;
}>;

export type CommitResult =
  | { ok: true; basis: Basis; revision: RevisionRecord; idempotent?: boolean }
  | { ok: false; reason: 'conflict'; basis: Basis; conflict: ConflictRecord }
  | { ok: false; reason: 'forbidden'; basis: Basis };

export const defaultGates: IssuanceGate[] = [
  { id: 'evidence', title: '证据与计算链完整', detail: '活动数据、排放因子、来源证据与修订说明可追溯。', checked: false, stale: false },
  { id: 'calculation', title: '计算过程复核通过', detail: '单位和换算系数一致，关键公式由核验员确认。', checked: true, stale: false, confirmedVersion: 1 },
  { id: 'revisions', title: '历史修订未覆盖原始数据', detail: '所有数据均有版本号和修订原因。', checked: true, stale: false, confirmedVersion: 1 },
  { id: 'methodology', title: '方法学与监测计划匹配', detail: '项目采用 CMS-052-V01 方法学。', checked: false, stale: false }
];

/** 老数据补版本：缺 version 的记录补成首版 V1，发现项/门禁同理。 */
export function backfillBasis(input: Partial<Basis> & { records: BasisRecord[]; findings?: BasisFinding[]; gates?: IssuanceGate[] }): Basis {
  const version = typeof input.version === 'number' ? input.version : 1;
  const records = input.records.map((record) => ({
    ...record,
    version: typeof record.version === 'number' && record.version >= 1 ? record.version : 1
  }));
  const findings = (input.findings ?? []).map((finding) => ({
    ...finding,
    basisVersion: typeof finding.basisVersion === 'number' && finding.basisVersion >= 1 ? finding.basisVersion : 1,
    stale: finding.stale === true
  }));
  const gates = (input.gates ?? defaultGates).map((gate) => ({
    ...gate,
    checked: gate.checked === true,
    stale: gate.stale === true,
    confirmedVersion: typeof gate.confirmedVersion === 'number' ? gate.confirmedVersion : undefined
  }));
  return { version, records, findings, gates, revisions: input.revisions ? [...input.revisions] : [], conflicts: input.conflicts ? [...input.conflicts] : [] };
}

export function findCommitted(basis: Basis, operationId: string): RevisionRecord | undefined {
  return basis.revisions.find((revision) => revision.operationId === operationId);
}

export function isConflict(basis: Basis, expectedVersion: number): boolean {
  return expectedVersion !== basis.version;
}

/** 数据、单位或来源变更 → 触发关联失效重算。 */
export function affectsData(changes: RevisionChanges): boolean {
  return changes.activity !== undefined || changes.unit !== undefined || changes.source !== undefined;
}

function nowIso(at?: string): string {
  return at ?? new Date().toISOString();
}

/**
 * 修订提交。
 * - 操作号已生效过 → 幂等返回同一结果，重试不重复记账；
 * - 期望版本与当前依据版本不一致 → 后到冲突，仅留痕不进依据；
 * - 生效则推进依据版本，关联发现项与已确认门禁失效。
 */
export function commitRevision(
  basis: Basis,
  op: {
    operationId: string;
    recordId: string;
    expectedVersion: number;
    changes: RevisionChanges;
    reason: string;
    actor: string;
    actorRole: ActorRole;
    at?: string;
  }
): CommitResult {
  const existing = findCommitted(basis, op.operationId);
  if (existing) return { ok: true, basis, revision: existing, idempotent: true };

  if (isConflict(basis, op.expectedVersion)) {
    const conflict: ConflictRecord = {
      operationId: op.operationId,
      kind: 'revision',
      version: op.expectedVersion,
      recordId: op.recordId,
      changes: op.changes as Record<string, unknown>,
      reason: op.reason,
      actor: op.actor,
      actorRole: op.actorRole,
      at: nowIso(op.at),
      status: 'conflict',
      expectedVersion: op.expectedVersion,
      currentVersion: basis.version,
      conflictReason: `依据版本已更新（当前 V${basis.version}），本次修订基于过期 V${op.expectedVersion}，后到未生效。`
    };
    return { ok: false, reason: 'conflict', conflict, basis: { ...basis, conflicts: [...basis.conflicts, conflict] } };
  }

  const nextVersion = basis.version + 1;
  const invalidate = affectsData(op.changes);

  const records = basis.records.map((record) =>
    record.id === op.recordId
      ? {
          ...record,
          ...(op.changes.activity !== undefined ? { activity: op.changes.activity } : {}),
          ...(op.changes.unit !== undefined ? { unit: op.changes.unit } : {}),
          ...(op.changes.factor !== undefined ? { factor: op.changes.factor } : {}),
          ...(op.changes.factorUnit !== undefined ? { factorUnit: op.changes.factorUnit } : {}),
          ...(op.changes.source !== undefined ? { source: op.changes.source } : {}),
          ...(op.changes.timeRange !== undefined ? { timeRange: op.changes.timeRange } : {}),
          revision: record.revision + 1,
          version: nextVersion,
          lastOperationId: op.operationId,
          status: '复核中' as RecordStatus
        }
      : record
  );

  const findings = invalidate
    ? basis.findings.map((finding) => (finding.recordId === op.recordId ? { ...finding, stale: true } : finding))
    : basis.findings;

  const gates = invalidate
    ? basis.gates.map((gate) => (gate.checked ? { ...gate, stale: true } : gate))
    : basis.gates;

  const revision: RevisionRecord = {
    operationId: op.operationId,
    kind: 'revision',
    version: nextVersion,
    recordId: op.recordId,
    changes: op.changes as Record<string, unknown>,
    reason: op.reason,
    actor: op.actor,
    actorRole: op.actorRole,
    at: nowIso(op.at)
  };

  return {
    ok: true,
    revision,
    basis: { ...basis, version: nextVersion, records, findings, gates, revisions: [...basis.revisions, revision] }
  };
}

/**
 * 门禁确认。
 * - 现场角色越权 → 拒绝，不进依据；
 * - 确认绑定当前依据版本（confirmedVersion = basis.version），不推进版本；
 * - 操作号幂等。
 */
export function confirmGate(
  basis: Basis,
  op: { operationId: string; gateId: GateId; expectedVersion: number; actor: string; actorRole: ActorRole; at?: string }
): CommitResult {
  const existing = findCommitted(basis, op.operationId);
  if (existing) return { ok: true, basis, revision: existing, idempotent: true };

  if (!canConfirm(op.actorRole)) {
    return { ok: false, reason: 'forbidden', basis };
  }

  if (isConflict(basis, op.expectedVersion)) {
    const conflict: ConflictRecord = {
      operationId: op.operationId,
      kind: 'confirmGate',
      version: op.expectedVersion,
      gateId: op.gateId,
      actor: op.actor,
      actorRole: op.actorRole,
      at: nowIso(op.at),
      status: 'conflict',
      expectedVersion: op.expectedVersion,
      currentVersion: basis.version,
      conflictReason: `依据版本已更新（当前 V${basis.version}），本次确认基于过期 V${op.expectedVersion}，后到未生效。`
    };
    return { ok: false, reason: 'conflict', conflict, basis: { ...basis, conflicts: [...basis.conflicts, conflict] } };
  }

  const gates = basis.gates.map((gate) =>
    gate.id === op.gateId ? { ...gate, checked: true, confirmedVersion: basis.version, stale: false } : gate
  );

  const revision: RevisionRecord = {
    operationId: op.operationId,
    kind: 'confirmGate',
    version: basis.version,
    gateId: op.gateId,
    actor: op.actor,
    actorRole: op.actorRole,
    at: nowIso(op.at)
  };

  return { ok: true, revision, basis: { ...basis, gates, revisions: [...basis.revisions, revision] } };
}

/** 门禁撤销（取消勾选）：解除绑定。 */
export function unconfirmGate(
  basis: Basis,
  op: { operationId: string; gateId: GateId; expectedVersion: number; actor: string; actorRole: ActorRole; at?: string }
): CommitResult {
  const existing = findCommitted(basis, op.operationId);
  if (existing) return { ok: true, basis, revision: existing, idempotent: true };
  if (!canConfirm(op.actorRole)) return { ok: false, reason: 'forbidden', basis };
  if (isConflict(basis, op.expectedVersion)) {
    const conflict: ConflictRecord = {
      operationId: op.operationId,
      kind: 'confirmGate',
      version: op.expectedVersion,
      gateId: op.gateId,
      actor: op.actor,
      actorRole: op.actorRole,
      at: nowIso(op.at),
      status: 'conflict',
      expectedVersion: op.expectedVersion,
      currentVersion: basis.version,
      conflictReason: `依据版本已更新（当前 V${basis.version}），本次撤销基于过期 V${op.expectedVersion}，后到未生效。`
    };
    return { ok: false, reason: 'conflict', conflict, basis: { ...basis, conflicts: [...basis.conflicts, conflict] } };
  }
  const gates = basis.gates.map((gate) => (gate.id === op.gateId ? { ...gate, checked: false, confirmedVersion: undefined, stale: false } : gate));
  const revision: RevisionRecord = {
    operationId: op.operationId,
    kind: 'confirmGate',
    version: basis.version,
    gateId: op.gateId,
    actor: op.actor,
    actorRole: op.actorRole,
    at: nowIso(op.at)
  };
  return { ok: true, revision, basis: { ...basis, gates, revisions: [...basis.revisions, revision] } };
}

/**
 * 发现项状态流转（发起补证 / 关闭）。
 * - 绑定当前依据版本，清除失效标记（重算完成）；
 * - 操作号幂等。
 */
export function setFindingStatus(
  basis: Basis,
  op: {
    operationId: string;
    findingId: string;
    status: FindingStatus;
    expectedVersion: number;
    actor: string;
    actorRole: ActorRole;
    at?: string;
  }
): CommitResult {
  const existing = findCommitted(basis, op.operationId);
  if (existing) return { ok: true, basis, revision: existing, idempotent: true };

  if (isConflict(basis, op.expectedVersion)) {
    const conflict: ConflictRecord = {
      operationId: op.operationId,
      kind: 'finding',
      version: op.expectedVersion,
      findingId: op.findingId,
      actor: op.actor,
      actorRole: op.actorRole,
      at: nowIso(op.at),
      status: 'conflict',
      expectedVersion: op.expectedVersion,
      currentVersion: basis.version,
      conflictReason: `依据版本已更新（当前 V${basis.version}），本次处置基于过期 V${op.expectedVersion}，后到未生效。`
    };
    return { ok: false, reason: 'conflict', conflict, basis: { ...basis, conflicts: [...basis.conflicts, conflict] } };
  }

  const findings = basis.findings.map((finding) =>
    finding.id === op.findingId ? { ...finding, status: op.status, basisVersion: basis.version, stale: false } : finding
  );
  const revision: RevisionRecord = {
    operationId: op.operationId,
    kind: 'finding',
    version: basis.version,
    findingId: op.findingId,
    actor: op.actor,
    actorRole: op.actorRole,
    at: nowIso(op.at)
  };
  return { ok: true, revision, basis: { ...basis, findings, revisions: [...basis.revisions, revision] } };
}

/** 门禁当前是否有效：已确认、未失效、且绑定版本等于当前依据版本。 */
export function isGateCurrent(gate: IssuanceGate, basis: Basis): boolean {
  return gate.checked && !gate.stale && gate.confirmedVersion === basis.version;
}

/** 发现项是否待处置：未关闭，或虽关闭但已失效（需重算）。 */
export function isFindingActionable(finding: BasisFinding): boolean {
  return finding.status !== '已关闭' || finding.stale;
}

/** 签发就绪：全部门禁当前有效，且无待处置（含失效重算）发现项。 */
export function isIssuanceReady(basis: Basis): boolean {
  return basis.gates.every((gate) => isGateCurrent(gate, basis)) && !basis.findings.some(isFindingActionable);
}

/** 写入失败后，从最后确认版本恢复。 */
export function recoverFromSnapshot(_current: Basis, lastConfirmed: Basis): Basis {
  return lastConfirmed;
}

/** 生成操作号（幂等键）。 */
export function newOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
