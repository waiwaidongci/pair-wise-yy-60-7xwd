import type { ChangeKind, Finding, Gate, GateStatus, RecordSnapshot, RevisionPatch } from './types';

/** 单位与排放因子应配套，单位一变换算链即断 */
const expectedFactorUnit: Record<string, string> = {
  kWh: 'tCO2/MWh',
  GJ: 'tCO2/GJ',
  L: 'kgCO2/L',
  kNm3: 'tCO2/kNm3'
};

/** 依据期固定为整月覆盖，缺覆盖即时间范围发现项 */
const FULL_PERIOD = '2026-07-01 至 07-31';

/** 比对新旧记录，判断本次修订触动了哪些依据要素 */
export function diffRecord(before: RecordSnapshot, patch: RevisionPatch): ChangeKind[] {
  const kinds: ChangeKind[] = [];
  if (typeof patch.activity === 'number' && patch.activity !== before.activity) kinds.push('数据');
  if (patch.unit && patch.unit !== before.unit) kinds.push('单位');
  if (patch.source && patch.source !== before.source) kinds.push('来源');
  return kinds;
}

/** 依据要素变化后，关联的生效发现项一律失效（已关闭/已失效的留作历史） */
export function invalidateFindings(findings: Finding[], recordId: string, kinds: ChangeKind[]): Finding[] {
  return findings.map((finding) => {
    if (finding.recordId !== recordId || finding.status === '已关闭' || finding.invalidReason) return finding;
    if (kinds.includes('数据')) return { ...finding, invalidReason: '数据变更' };
    if (kinds.includes('单位')) return { ...finding, invalidReason: '单位变更' };
    if (kinds.includes('来源')) return { ...finding, invalidReason: '来源变更' };
    return finding;
  });
}

type ActiveRule = { id: string; make: () => Omit<Finding, 'basisVersion'> };

/** 依据当前记录算出全部生效规则；自动发现项按记录版本编号，修订后即换一代 */
function activeRulesFor(record: RecordSnapshot): ActiveRule[] {
  const rules: ActiveRule[] = [];
  if (record.evidenceCount < 2) {
    rules.push({
      id: `AUTO-EV-${record.id}-v${record.basisVersion}`,
      make: () => ({
        id: `AUTO-EV-${record.id}-v${record.basisVersion}`,
        recordId: record.id,
        type: '缺失证据',
        title: `${record.source} 证据份数不足`,
        detail: `当前仅 ${record.evidenceCount} 份证据，至少需要 2 份来源可追溯材料。`,
        assignee: record.owner,
        due: '10-10',
        status: '开放',
        auto: true,
        invalidReason: null
      })
    });
  }
  if (expectedFactorUnit[record.unit] && expectedFactorUnit[record.unit] !== record.factorUnit) {
    rules.push({
      id: `AUTO-UNIT-${record.id}-v${record.basisVersion}`,
      make: () => ({
        id: `AUTO-UNIT-${record.id}-v${record.basisVersion}`,
        recordId: record.id,
        type: '单位不一致',
        title: `${record.id} 单位与排放因子不配套`,
        detail: `活动数据单位为 ${record.unit}，排放因子应为 ${expectedFactorUnit[record.unit]}，当前为 ${record.factorUnit}。`,
        assignee: record.owner,
        due: '10-10',
        status: '开放',
        auto: true,
        invalidReason: null
      })
    });
  }
  if (record.timeRange !== FULL_PERIOD) {
    rules.push({
      id: `AUTO-TIME-${record.id}-v${record.basisVersion}`,
      make: () => ({
        id: `AUTO-TIME-${record.id}-v${record.basisVersion}`,
        recordId: record.id,
        type: '时间范围',
        title: `${record.id} 时间范围未覆盖整期`,
        detail: `当前为 ${record.timeRange}，应覆盖 ${FULL_PERIOD}。`,
        assignee: record.owner,
        due: '10-10',
        status: '开放',
        auto: true,
        invalidReason: null
      })
    });
  }
  if (Math.abs(record.anomaly) > 5) {
    rules.push({
      id: `AUTO-ANOM-${record.id}-v${record.basisVersion}`,
      make: () => ({
        id: `AUTO-ANOM-${record.id}-v${record.basisVersion}`,
        recordId: record.id,
        type: '异常波动',
        title: `${record.source} 异常波动 ${record.anomaly > 0 ? '+' : ''}${record.anomaly}%`,
        detail: '波动超出 ±5% 阈值，需要项目方说明原因并留痕。',
        assignee: record.owner,
        due: '10-10',
        status: '开放',
        auto: true,
        invalidReason: null
      })
    });
  }
  return rules;
}

/**
 * 按当前记录重算自动发现项：
 * 命中规则的自动项以当前记录版本重生（新版本新编号）；
 * 上一代仍开放、规则不再命中的自动项标记失效；手工发现项不动。
 */
export function deriveFindings(records: RecordSnapshot[], previous: Finding[]): Finding[] {
  const activeIds = new Set<string>();
  const additions: Finding[] = [];

  for (const record of records) {
    for (const rule of activeRulesFor(record)) {
      activeIds.add(rule.id);
      if (!previous.some((item) => item.id === rule.id)) {
        additions.push({ ...rule.make(), basisVersion: record.basisVersion });
      }
    }
  }

  const carried = previous.map((finding) => {
    if (!finding.auto) return finding;
    if (finding.invalidReason || finding.status === '已关闭') return finding;
    // 编号属于某条记录的某一代；当前代数已变且新一代不再命中 → 旧代失效
    const owner = records.find((record) => finding.id.includes(`-${record.id}-v`));
    if (owner && !activeIds.has(finding.id)) {
      return { ...finding, invalidReason: '数据变更' as const };
    }
    return finding;
  });

  return [...carried, ...additions];
}

/** 仍生效（未失效、未关闭）的发现项，参与门禁计算与签发判断 */
export function activeFindings(findings: Finding[]): Finding[] {
  return findings.filter((item) => !item.invalidReason && item.status !== '已关闭');
}

const gateMeta: { id: Gate['id']; title: string; auto: boolean }[] = [
  { id: 'evidence', title: '证据与计算链完整', auto: true },
  { id: 'calculation', title: '计算过程复核通过', auto: true },
  { id: 'revisions', title: '历史修订未覆盖原始数据', auto: true },
  { id: 'methodology', title: '方法学与监测计划匹配', auto: false }
];

function evaluateAutoGate(id: Gate['id'], records: RecordSnapshot[], findings: Finding[], basisVersion: number): Pick<Gate, 'status' | 'detail' | 'passedAtBasis' | 'staleReason'> {
  const live = activeFindings(findings);
  if (id === 'evidence') {
    const missing = live.filter((item) => item.type === '缺失证据');
    return {
      status: missing.length === 0 ? '已通过' : '未通过',
      detail: missing.length === 0 ? '全部记录证据份数满足要求，来源可追溯。' : `${missing.length} 条记录证据不足。`,
      passedAtBasis: missing.length === 0 ? basisVersion : null,
      staleReason: null
    };
  }
  if (id === 'calculation') {
    const bad = live.filter((item) => item.type === '单位不一致' || item.type === '时间范围');
    const factorMismatch = records.filter((record) => expectedFactorUnit[record.unit] !== undefined && expectedFactorUnit[record.unit] !== record.factorUnit);
    const ok = bad.length === 0 && factorMismatch.length === 0;
    return {
      status: ok ? '已通过' : '未通过',
      detail: ok ? '单位、换算系数与时间范围一致。' : '存在单位换算链或时间范围未闭合项。',
      passedAtBasis: ok ? basisVersion : null,
      staleReason: null
    };
  }
  // revisions
  const unresolved = records.filter((record) => record.status === '需补证');
  const unversioned = records.filter((record) => !Number.isFinite(record.basisVersion) || record.basisVersion < 1);
  const ok = unresolved.length === 0 && unversioned.length === 0;
  return {
    status: ok ? '已通过' : '未通过',
    detail: ok ? '所有记录均带版本号，修订链可追溯，原始数据未被覆盖。' : '存在需补证记录或无版本号老记录。',
    passedAtBasis: ok ? basisVersion : null,
    staleReason: null
  };
}

/** 首次建账时直接算出自动门禁结果（修订链已带版本即通过） */
export function initialGates(records: RecordSnapshot[], findings: Finding[], basisVersion: number): Gate[] {
  return gateMeta.map((meta) => {
    const base: Gate = {
      id: meta.id,
      title: meta.title,
      auto: meta.auto,
      status: '未通过',
      detail: '',
      passedAtBasis: null,
      staleReason: null
    };
    if (!meta.auto) return base;
    return { ...base, ...evaluateAutoGate(meta.id, records, findings, basisVersion) };
  });
}

/**
 * 数据/单位/来源变化后关联门禁失效：自动门禁止于「待重算」，等核验员显式重算；
 * 人工门禁（methodology）不随记录字段变化失效，只在依据版本前进、确认过期时由复核员重认。
 */
export function invalidateGates(
  gates: Gate[],
  args: { affectedRecordIds: string[]; changeKinds: ChangeKind[]; basisVersion: number }
): Gate[] {
  if (args.changeKinds.length === 0) return gates;
  return gates.map((gate) => {
    if (!gate.auto) return gate;
    return {
      ...gate,
      status: '待重算',
      passedAtBasis: null,
      staleReason: `关联记录 ${args.affectedRecordIds.join('、')} 依据变化（${args.changeKinds.join('/')}），V${args.basisVersion} 待重算`
    };
  });
}

/** 核验员对失效门禁执行重算：按当前依据重新判定，绑定当前依据版本 */
export function evaluateGates(gates: Gate[], records: RecordSnapshot[], findings: Finding[], basisVersion: number, only?: Gate['id']): Gate[] {
  return gates.map((gate) => {
    if (!gate.auto) return gate;
    if (only && gate.id !== only) return gate;
    // 只有待重算（或未通过）的门禁参与重算；已通过且版本正确的不动
    if (gate.status === '已通过' && gate.passedAtBasis === basisVersion) return gate;
    return { ...gate, ...evaluateAutoGate(gate.id, records, findings, basisVersion) };
  });
}

/** 依据版本前进后，复核员此前在旧版本通过的人工门禁回到待重算 */
export function expireManualGates(gates: Gate[], basisVersion: number): Gate[] {
  return gates.map((gate) => {
    if (gate.auto) return gate;
    if (gate.status === '已通过' && gate.passedAtBasis !== basisVersion) {
      return { ...gate, status: '待重算', passedAtBasis: null, staleReason: `确认于 V${gate.passedAtBasis}，当前依据 V${basisVersion}，需复核员重认` };
    }
    return gate;
  });
}

export type { GateStatus };
