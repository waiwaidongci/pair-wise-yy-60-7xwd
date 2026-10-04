import {
  activeFindings,
  deriveFindings,
  diffRecord,
  evaluateGates,
  expireManualGates,
  initialGates,
  invalidateFindings,
  invalidateGates
} from './rules';
import type {
  BasisState,
  ConfirmResult,
  ConflictEntry,
  Finding,
  Gate,
  GateId,
  LedgerEntry,
  RecordSnapshot,
  ReleaseResult,
  Role,
  SubmitInput,
  SubmitResult
} from './types';

// 深拷贝只用于状态快照，结构均为可序列化数据
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const now = () => new Date().toISOString();

let opCounter = 0;
/** 操作号：全局唯一、单调；冲突、拒绝不占号（拒绝未入账），冲突留痕占号 */
export function mintOpId() {
  opCounter += 1;
  return `OP-${Date.now().toString(36).toUpperCase()}-${String(opCounter).padStart(3, '0')}`;
}

export type InitialInput = {
  records: Array<Omit<RecordSnapshot, 'basisVersion' | 'verifiedAtBasis'> & { basisVersion?: number; verifiedAtBasis?: number | null }>;
  findings?: Array<Omit<Finding, 'basisVersion' | 'invalidReason' | 'auto'> & { basisVersion?: number; auto?: boolean }>;
};

/**
 * 建立首版签发依据：
 * 老记录无依据版本号时补成首版（revision 仅为修订链长度），发现项挂首版，门禁按首版重算。
 */
export function createBasis({ records: rawRecords, findings: rawFindings = [] }: InitialInput): BasisState {
  const records: RecordSnapshot[] = rawRecords.map((record) => ({
    ...record,
    basisVersion: typeof record.basisVersion === 'number' && record.basisVersion >= 1 ? record.basisVersion : 1,
    verifiedAtBasis: record.verifiedAtBasis ?? null
  }));
  const findings: Finding[] = deriveFindings(
    records,
    rawFindings.map((finding) => ({
      ...finding,
      auto: finding.auto ?? false,
      basisVersion: finding.basisVersion ?? 1,
      invalidReason: null
    }))
  );
  const gates = initialGates(records, findings, 1);

  let state: BasisState = {
    records,
    findings,
    gates,
    ledger: [],
    conflicts: [],
    basisVersion: 1,
    opSeq: 0,
    confirmation: null,
    confirmedSnapshot: null,
    recoveries: []
  };

  // 老记录补首版逐笔记账
  for (const record of records) {
    if (typeof rawRecords.find((raw) => raw.id === record.id)?.basisVersion !== 'number') {
      state = appendLedger(state, {
        opId: mintOpId(),
        type: '补首版',
        actor: '系统',
        role: '核验员',
        at: now(),
        recordId: record.id,
        basisVersion: 1,
        toVersion: 1,
        note: `老记录无版本号，补成首版 V1（修订链长度 ${record.revision}）`
      });
    }
  }

  return state;
}

function appendLedger(state: BasisState, entry: Omit<LedgerEntry, 'seq'>): BasisState {
  return { ...state, opSeq: state.opSeq + 1, ledger: [...state.ledger, { ...entry, seq: state.opSeq + 1 }] };
}

function findIdempotent(state: BasisState, opId: string): LedgerEntry | undefined {
  return state.ledger.find((entry) => entry.opId === opId);
}

function replayResult(entry: LedgerEntry): SubmitResult {
  if (entry.type === '冲突留痕') {
    return { outcome: 'conflict', seq: entry.seq, recordId: entry.recordId!, opId: entry.opId, baseVersion: entry.fromVersion!, currentVersion: entry.toVersion!, at: entry.at };
  }
  return { outcome: 'accepted', seq: entry.seq, basisVersion: entry.basisVersion!, recordId: entry.recordId!, opId: entry.opId, at: entry.at };
}

/**
 * 修订 / 补证统一入口，接成同一份签发依据：
 * - 修订带版本号与操作号；两人同时修订同一依据版本时，先到生效、后到留冲突且不进依据；
 * - 数据/单位/来源变化，关联发现项与门禁失效并等待重算；
 * - 同一 opId 重试直接回放首次结果，不重复记账。
 */
export function submitChange(prev: BasisState, input: SubmitInput): { state: BasisState; result: SubmitResult } {
  const at = input.at ?? now();

  // 幂等：同一操作号重试，回放首次结果，不重复记账（优先于角色校验，保证重放结果稳定）
  const prior = findIdempotent(prev, input.opId);
  if (prior) return { state: prev, result: replayResult(prior) };

  // 现场角色只能补证；现场越权修订直接拒绝（拒绝不占操作号、不进账本）
  if (input.role === '现场' && input.type === '修订') {
    return { state: prev, result: { outcome: 'rejected', reason: '现场角色无权修订活动数据，仅可提交补证。', opId: input.opId } };
  }

  const record = prev.records.find((item) => item.id === input.recordId);
  if (!record) {
    return { state: prev, result: { outcome: 'rejected', reason: `记录 ${input.recordId} 不存在。`, opId: input.opId } };
  }

  if (input.type === '修订') {
    const patch = input.patch!;
    const baseVersion = record.basisVersion;

    // 乐观锁：后到者基于的版本已不是当前生效版本 → 留冲突，不进依据
    if (typeof patch.baseVersion === 'number' && patch.baseVersion !== baseVersion) {
      const conflict: ConflictEntry = {
        opId: input.opId,
        recordId: input.recordId,
        actor: input.actor,
        at,
        baseVersion: patch.baseVersion,
        currentVersion: baseVersion,
        patch: { activity: patch.activity, unit: patch.unit, source: patch.source, reason: patch.reason },
        status: '待处理'
      };
      let state: BasisState = { ...prev, conflicts: [...prev.conflicts, conflict] };
      state = appendLedger(state, {
        opId: input.opId,
        type: '冲突留痕',
        actor: input.actor,
        role: input.role,
        at,
        recordId: input.recordId,
        basisVersion: baseVersion,
        fromVersion: patch.baseVersion,
        toVersion: baseVersion,
        note: `两人同时修订：后到者基于 V${patch.baseVersion}，先到者已生效 V${baseVersion}；后到修订留冲突，未进入签发依据`
      });
      return { state, result: { outcome: 'conflict', seq: state.opSeq, recordId: input.recordId, opId: input.opId, baseVersion: patch.baseVersion, currentVersion: baseVersion, at } };
    }

    const kinds = diffRecord(record, patch);
    if (kinds.length === 0) {
      return { state: prev, result: { outcome: 'rejected', reason: '修订内容与当前依据一致，没有数据/单位/来源变化。', opId: input.opId } };
    }

    const newBasisVersion = prev.basisVersion + 1;
    const updatedRecord: RecordSnapshot = {
      ...record,
      activity: patch.activity ?? record.activity,
      unit: patch.unit ?? record.unit,
      source: patch.source ?? record.source,
      basisVersion: newBasisVersion,
      revision: record.revision + 1,
      // 依据一变，原先绑定旧版本的核验结论不再可靠：回到复核中
      status: '复核中',
      verifiedAtBasis: null
    };

    const records = prev.records.map((item) => (item.id === record.id ? updatedRecord : item));
    // 关联发现项失效 → 按新记录版本重算 → 自动门禁失效并在新版本立即重算；人工门禁随版本过期待重认
    let findings = invalidateFindings(prev.findings, record.id, kinds);
    findings = deriveFindings(records, findings);
    let gates = invalidateGates(prev.gates, { affectedRecordIds: [record.id], changeKinds: kinds, basisVersion: newBasisVersion });
    gates = evaluateGates(gates, records, findings, newBasisVersion);
    gates = expireManualGates(gates, newBasisVersion);

    let state: BasisState = {
      ...prev,
      records,
      findings,
      gates,
      basisVersion: newBasisVersion,
      confirmation: prev.confirmation?.basisVersion === newBasisVersion ? prev.confirmation : null
    };
    state = appendLedger(state, {
      opId: input.opId,
      type: '修订',
      actor: input.actor,
      role: input.role,
      at,
      recordId: record.id,
      basisVersion: newBasisVersion,
      fromVersion: baseVersion,
      toVersion: newBasisVersion,
      note: `${kinds.join('/')}变更：${patch.reason}`
    });
    return { state, result: { outcome: 'accepted', seq: state.opSeq, basisVersion: newBasisVersion, recordId: record.id, opId: input.opId, at } };
  }

  // 补证：与修订接同一份依据，补证同样前进依据版本并触发关联重算
  const add = input.evidenceCount ?? 0;
  if (add <= 0) {
    return { state: prev, result: { outcome: 'rejected', reason: '补证份数必须大于 0。', opId: input.opId } };
  }
  const newBasisVersion = prev.basisVersion + 1;
  const baseVersion = record.basisVersion;
  const updatedRecord: RecordSnapshot = {
    ...record,
    evidenceCount: record.evidenceCount + add,
    basisVersion: newBasisVersion,
    status: record.status === '需补证' ? '复核中' : record.status
  };
  let records = prev.records.map((item) => (item.id === record.id ? updatedRecord : item));

  // 证据补齐：该记录生效中的「缺失证据」发现项关闭；其余发现项不失效
  let findings = prev.findings.map((finding) =>
    finding.recordId === record.id && finding.type === '缺失证据' && !finding.invalidReason && finding.status !== '已关闭' && updatedRecord.evidenceCount >= 2
      ? { ...finding, status: '已关闭' as const }
      : finding
  );
  findings = deriveFindings(records, findings);
  // 补证属于来源要素变化：自动门禁在新版本立即重算；人工门禁随版本过期待重认
  let gates = invalidateGates(prev.gates, { affectedRecordIds: [record.id], changeKinds: ['来源'], basisVersion: newBasisVersion });
  gates = evaluateGates(gates, records, findings, newBasisVersion);
  gates = expireManualGates(gates, newBasisVersion);

  let state: BasisState = {
    ...prev,
    records,
    findings,
    gates,
    basisVersion: newBasisVersion,
    confirmation: prev.confirmation?.basisVersion === newBasisVersion ? prev.confirmation : null
  };
  state = appendLedger(state, {
    opId: input.opId,
    type: '补证',
    actor: input.actor,
    role: input.role,
    at,
    recordId: record.id,
    basisVersion: newBasisVersion,
    fromVersion: baseVersion,
    toVersion: newBasisVersion,
    note: input.note ?? `补充证据 +${add} 份`
  });
  return { state, result: { outcome: 'accepted', seq: state.opSeq, basisVersion: newBasisVersion, recordId: record.id, opId: input.opId, at } };
}

/** 核验员核验记录：核验结论绑定当前依据版本；依据前进后绑定自动作废（回到复核中，见修订逻辑） */
export function verifyRecord(
  prev: BasisState,
  args: { recordId: string; actor: string; role: Role; opId?: string; at?: string }
): { state: BasisState; result: ConfirmResult } {
  const at = args.at ?? now();
  const opId = args.opId ?? mintOpId();
  const prior = findIdempotent(prev, opId);
  if (prior) return { state: prev, result: { outcome: 'confirmed', basisVersion: prior.basisVersion!, seq: prior.seq, opId: prior.opId, at: prior.at } };

  if (args.role !== '核验员' && args.role !== '复核员') {
    return { state: prev, result: { outcome: 'rejected', reason: '仅核验员/复核员可以出具核验结论。', opId } };
  }
  const record = prev.records.find((item) => item.id === args.recordId);
  if (!record) return { state: prev, result: { outcome: 'rejected', reason: '记录不存在。', opId } };
  if (record.status === '需补证') return { state: prev, result: { outcome: 'rejected', reason: '该记录处于需补证状态，不能核验通过。', opId } };
  if (activeFindings(prev.findings).some((finding) => finding.recordId === record.id)) {
    return { state: prev, result: { outcome: 'rejected', reason: '该记录存在生效发现项，先闭环再核验。', opId } };
  }

  const records = prev.records.map((item) =>
    item.id === args.recordId ? { ...item, status: '已核验' as const, verifiedAtBasis: prev.basisVersion } : item
  );
  let state = appendLedger({ ...prev, records }, {
    opId,
    type: '核验通过',
    actor: args.actor,
    role: args.role,
    at,
    recordId: args.recordId,
    basisVersion: prev.basisVersion,
    note: `核验通过，结论绑定依据 V${prev.basisVersion}`
  });
  return { state, result: { outcome: 'confirmed', basisVersion: prev.basisVersion, seq: state.opSeq, opId, at } };
}

/**
 * 发现项补证/闭环（不前进依据版本，但会在当前版本重评自动门禁）：
 * - 现场只能发起补证；闭环关闭需核验员/复核员；
 * - 已随依据失效的发现项不能再操作；
 * - 闭环后自动门禁按当前依据重新判定，绑定当前依据版本。
 */
export function changeFindingStatus(
  prev: BasisState,
  args: { findingId: string; mode: 'request' | 'close'; actor: string; role: Role; opId?: string; at?: string }
): { state: BasisState; result: ConfirmResult } {
  const at = args.at ?? now();
  const opId = args.opId ?? mintOpId();
  if (args.mode === 'close' && args.role === '现场') {
    return { state: prev, result: { outcome: 'rejected', reason: '现场角色不能关闭发现项，需核验员/复核员闭环。', opId } };
  }
  const finding = prev.findings.find((item) => item.id === args.findingId);
  if (!finding) return { state: prev, result: { outcome: 'rejected', reason: '发现项不存在。', opId } };
  if (finding.invalidReason) return { state: prev, result: { outcome: 'rejected', reason: '该发现项已随依据变化失效，不能再操作。', opId } };

  const findings = prev.findings.map((item) =>
    item.id === args.findingId ? { ...item, status: args.mode === 'close' ? '已关闭' as const : '补证中' as const } : item
  );
  const gates = args.mode === 'close'
    ? evaluateGates(prev.gates, prev.records, findings, prev.basisVersion)
    : prev.gates;
  let state = appendLedger({ ...prev, findings, gates }, {
    opId,
    type: args.mode === 'close' ? '门禁重算' : '补证',
    actor: args.actor,
    role: args.role,
    at,
    recordId: finding.recordId,
    basisVersion: prev.basisVersion,
    note: args.mode === 'close' ? `闭环发现项 ${finding.id}，门禁按 V${prev.basisVersion} 重评` : `发现项 ${finding.id} 发起补证（不前进依据版本）`
  });
  return { state, result: { outcome: 'confirmed', basisVersion: prev.basisVersion, seq: state.opSeq, opId, at } };
}

/** 失效门禁重算：核验员执行，按当前依据版本重新判定 */
export function recomputeGate(
  prev: BasisState,
  args: { gateId: GateId; actor: string; role: Role; opId?: string; at?: string }
): { state: BasisState; result: ConfirmResult } {
  const at = args.at ?? now();
  const opId = args.opId ?? mintOpId();
  if (args.role !== '核验员' && args.role !== '复核员') {
    return { state: prev, result: { outcome: 'rejected', reason: '仅核验员可以重算门禁。', opId } };
  }
  const gate = prev.gates.find((item) => item.id === args.gateId);
  if (!gate) return { state: prev, result: { outcome: 'rejected', reason: '门禁不存在。', opId } };
  if (!gate.auto) return { state: prev, result: { outcome: 'rejected', reason: '人工门禁由复核员确认，不走自动重算。', opId } };

  const gates = evaluateGates(prev.gates, prev.records, prev.findings, prev.basisVersion, args.gateId);
  const after = gates.find((item) => item.id === args.gateId)!;
  let state = appendLedger({ ...prev, gates }, {
    opId,
    type: '门禁重算',
    actor: args.actor,
    role: args.role,
    at,
    basisVersion: prev.basisVersion,
    note: `重算「${gate.title}」@V${prev.basisVersion} → ${after.status}`
  });
  return { state, result: { outcome: 'confirmed', basisVersion: prev.basisVersion, seq: state.opSeq, opId, at } };
}

/**
 * 复核员确认签发依据：绑定当前依据版本，并留存该版本快照供写入失败后恢复。
 * 前提：无生效发现项；自动门禁全部在当前版本通过（人工门禁随确认一并重认）。
 */
export function confirmBasis(
  prev: BasisState,
  args: { reviewer: string; role: Role; methodologyPassed: boolean; opId?: string; at?: string }
): { state: BasisState; result: ConfirmResult } {
  const at = args.at ?? now();
  const opId = args.opId ?? mintOpId();

  const prior = findIdempotent(prev, opId);
  if (prior?.type === '确认依据') {
    return { state: prev, result: { outcome: 'confirmed', basisVersion: prior.basisVersion!, seq: prior.seq, opId: prior.opId, at: prior.at } };
  }

  if (args.role !== '复核员') {
    return { state: prev, result: { outcome: 'rejected', reason: '仅复核员可以确认签发依据。', opId } };
  }

  const live = activeFindings(prev.findings);
  if (live.length > 0) {
    return { state: prev, result: { outcome: 'rejected', reason: `尚有 ${live.length} 个生效发现项未闭环，不能确认依据。`, opId } };
  }
  const staleAuto = prev.gates.filter((gate) => gate.auto && gate.status !== '已通过');
  if (staleAuto.length > 0) {
    return { state: prev, result: { outcome: 'rejected', reason: `自动门禁未在 V${prev.basisVersion} 通过：${staleAuto.map((gate) => gate.title).join('、')}。`, opId } };
  }

  const gates: Gate[] = prev.gates.map((gate) =>
    gate.id === 'methodology'
      ? { ...gate, status: args.methodologyPassed ? '已通过' : '未通过', passedAtBasis: args.methodologyPassed ? prev.basisVersion : null, staleReason: null }
      : gate
  );
  if (!args.methodologyPassed) {
    return { state: prev, result: { outcome: 'rejected', reason: '复核员未确认方法学与监测计划匹配，不能确认依据。', opId } };
  }

  // 快照必须包含本次确认本身：恢复回来后仍是「已确认 Vn」状态；快照内不再嵌套快照
  const confirmation = { basisVersion: prev.basisVersion, reviewer: args.reviewer, at, opId };
  const preState: BasisState = { ...prev, gates };
  const snapshot = clone({ ...preState, confirmation, confirmedSnapshot: null });
  let state: BasisState = { ...preState, confirmation, confirmedSnapshot: snapshot };
  state = appendLedger(state, {
    opId,
    type: '确认依据',
    actor: args.reviewer,
    role: args.role,
    at,
    basisVersion: prev.basisVersion,
    note: `确认签发依据 V${prev.basisVersion}（含方法学门禁）`
  });
  return { state, result: { outcome: 'confirmed', basisVersion: prev.basisVersion, seq: state.opSeq, opId, at } };
}

/**
 * 签发放行：必须存在绑定当前依据版本的复核确认，且全部门禁在当前版本通过。
 * 核验员拿着旧结论不能放行。
 */
export function release(
  prev: BasisState,
  args: { actor: string; role: Role; opId?: string; at?: string }
): { state: BasisState; result: ReleaseResult } {
  const at = args.at ?? now();
  const opId = args.opId ?? mintOpId();

  const prior = findIdempotent(prev, opId);
  if (prior?.type === '签发放行') {
    return { state: prev, result: { outcome: 'released', basisVersion: prior.basisVersion!, seq: prior.seq, opId: prior.opId, at: prior.at } };
  }

  if (args.role !== '复核员' && args.role !== '核验员') {
    return { state: prev, result: { outcome: 'rejected', reason: '当前角色无权签发放行。', opId } };
  }

  if (!prev.confirmation || prev.confirmation.basisVersion !== prev.basisVersion) {
    return {
      state: prev,
      result: { outcome: 'rejected', reason: `复核确认绑定 V${prev.confirmation?.basisVersion ?? '-'}，当前依据 V${prev.basisVersion}；依据已变，旧结论不得放行。`, opId }
    };
  }
  const pending = prev.gates.filter((gate) => gate.status !== '已通过' || gate.passedAtBasis !== prev.basisVersion);
  if (pending.length > 0) {
    return { state: prev, result: { outcome: 'rejected', reason: `门禁未在 V${prev.basisVersion} 全部通过：${pending.map((gate) => gate.title).join('、')}。`, opId } };
  }

  const state = appendLedger(prev, {
    opId,
    type: '签发放行',
    actor: args.actor,
    role: args.role,
    at,
    basisVersion: prev.basisVersion,
    note: `依据 V${prev.basisVersion} 放行签发`
  });
  return { state, result: { outcome: 'released', basisVersion: prev.basisVersion, seq: state.opSeq, opId, at } };
}

/**
 * 写入失败恢复：从最后确认版本的快照恢复。
 * 失败之后误记的账（含冲突留痕）随快照一并回滚；恢复本身记账；重试使用原 opId 不重复记账。
 */
export function recoverFromLastConfirmed(prev: BasisState, at = now()): BasisState {
  if (!prev.confirmedSnapshot) return prev;
  const restoredToBasis = prev.confirmedSnapshot.basisVersion;
  const snapshot = clone(prev.confirmedSnapshot);
  snapshot.recoveries = [...prev.recoveries];
  const seq = snapshot.opSeq + 1;
  snapshot.opSeq = seq;
  snapshot.ledger = [...snapshot.ledger, {
    seq,
    opId: `RCV-${seq}`,
    type: '恢复',
    actor: '系统',
    role: '核验员',
    at,
    basisVersion: restoredToBasis,
    fromVersion: prev.basisVersion,
    toVersion: restoredToBasis,
    note: `写入失败，从最后确认版本 V${restoredToBasis} 恢复，回滚其后 ${Math.max(prev.opSeq - snapshot.opSeq + 1, 0)} 笔记账`
  }];
  snapshot.recoveries = [...snapshot.recoveries, { at, restoredToBasis, seq }];
  return snapshot;
}

export function hasConfirmedSnapshot(state: BasisState): boolean {
  return state.confirmedSnapshot !== null;
}

/** 冲突处理：放弃，或由冲突发起方基于最新版本重新提交（rebase 后占新操作号） */
export function resolveConflict(
  prev: BasisState,
  opId: string,
  resolution: 'abandon' | 'rebase',
  actor: string,
  role: Role,
  at = now()
): { state: BasisState; result: SubmitResult } {
  const conflict = prev.conflicts.find((item) => item.opId === opId);
  if (!conflict || conflict.status !== '待处理') {
    return { state: prev, result: { outcome: 'rejected', reason: '冲突不存在或已处理。' } };
  }
  if (resolution === 'abandon') {
    return {
      state: { ...prev, conflicts: prev.conflicts.map((item) => (item.opId === opId ? { ...item, status: '已放弃' as const } : item)) },
      result: { outcome: 'rejected', reason: '后到修订已放弃，未进入签发依据。', opId }
    };
  }
  const record = prev.records.find((item) => item.id === conflict.recordId);
  if (!record) return { state: prev, result: { outcome: 'rejected', reason: '关联记录不存在。', opId } };

  const { state, result } = submitChange(prev, {
    type: '修订',
    recordId: conflict.recordId,
    actor,
    role,
    opId: `${opId}-RB`,
    at,
    patch: { ...conflict.patch, baseVersion: record.basisVersion }
  });
  if (result.outcome === 'accepted') {
    return {
      state: { ...state, conflicts: state.conflicts.map((item) => (item.opId === opId ? { ...item, status: '已重生' as const } : item)) },
      result
    };
  }
  return { state, result };
}
