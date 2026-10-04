// 统一签发依据（Issuance Basis）领域模型
// 记录、发现项、门禁挂在同一份按版本演进的依据上，修订带版本号与全局操作号。

export type Role = '现场' | '核验员' | '复核员';

export type OpType =
  | '补首版'
  | '修订'
  | '补证'
  | '核验通过'
  | '冲突留痕'
  | '门禁重算'
  | '确认依据'
  | '签发放行'
  | '恢复';

/** 修订会触动依据的字段；只改这些字段之外的内容不算新依据 */
export type ChangeKind = '数据' | '单位' | '来源';

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';

export type FindingType = '缺失证据' | '单位不一致' | '时间范围' | '异常波动';

export type FindingStatus = '开放' | '补证中' | '已关闭';

/** 依据失效后发现项不删除，标记失效原因留痕 */
export type FindingInvalidReason = '数据变更' | '单位变更' | '来源变更' | null;

export type Finding = {
  id: string;
  recordId: string;
  type: FindingType;
  title: string;
  detail: string;
  assignee: string;
  due: string;
  status: FindingStatus;
  /** 规则自动生成的发现项；手工发现项重算时不重生 */
  auto: boolean;
  /** 生效时所挂的依据版本；依据一变即失效 */
  basisVersion: number;
  invalidReason: FindingInvalidReason;
};

export type RecordSnapshot = {
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
  /** 记录修订链号（仅展示修订历史长度） */
  revision: number;
  /** 最近一次改变该记录的全局依据版本；老记录无版本号时补成首版 1 */
  basisVersion: number;
  /** 已核验所绑定的依据版本；依据失效后回到 复核中 */
  verifiedAtBasis: number | null;
};

export type GateId = 'evidence' | 'calculation' | 'revisions' | 'methodology';

export type GateStatus = '待重算' | '未通过' | '已通过';

export type Gate = {
  id: GateId;
  title: string;
  /** evidence / calculation / revisions 由规则自动重算；methodology 需复核员确认 */
  auto: boolean;
  status: GateStatus;
  detail: string;
  /** 最近一次通过所绑定的依据版本 */
  passedAtBasis: number | null;
  /** 失效后待重算的原因 */
  staleReason: string | null;
};

export type LedgerEntry = {
  seq: number;
  opId: string;
  type: OpType;
  actor: string;
  role: Role;
  at: string;
  recordId?: string;
  /** 操作后形成的依据版本 */
  basisVersion?: number;
  fromVersion?: number;
  toVersion?: number;
  note?: string;
};

export type ConflictEntry = {
  opId: string;
  recordId: string;
  actor: string;
  at: string;
  /** 后到者基于的旧版本 */
  baseVersion: number;
  /** 先到者已经生效的新版本 */
  currentVersion: number;
  patch: RevisionPatch;
  status: '待处理' | '已放弃' | '已重生';
};

export type Confirmation = {
  basisVersion: number;
  reviewer: string;
  at: string;
  opId: string;
};

export type RevisionPatch = {
  activity?: number;
  unit?: string;
  source?: string;
  reason: string;
  /** 乐观锁：提交者加载记录时的依据版本，与当前版本不一致即冲突 */
  baseVersion?: number;
};

export type SubmitInput = {
  type: '修订' | '补证';
  recordId: string;
  actor: string;
  role: Role;
  /** 幂等键：同一操作号重试不重复记账 */
  opId: string;
  at?: string;
  patch?: RevisionPatch;
  evidenceCount?: number;
  note?: string;
};

export type SubmitResult =
  | { outcome: 'accepted'; seq: number; basisVersion: number; recordId: string; opId: string; at: string }
  | { outcome: 'conflict'; seq: number; recordId: string; opId: string; baseVersion: number; currentVersion: number; at: string }
  | { outcome: 'rejected'; reason: string; opId?: string };

export type ConfirmResult =
  | { outcome: 'confirmed'; basisVersion: number; seq: number; opId: string; at: string }
  | { outcome: 'rejected'; reason: string; opId?: string };

export type ReleaseResult =
  | { outcome: 'released'; basisVersion: number; seq: number; opId: string; at: string }
  | { outcome: 'rejected'; reason: string; opId?: string };

export type BasisState = {
  records: RecordSnapshot[];
  findings: Finding[];
  gates: Gate[];
  ledger: LedgerEntry[];
  conflicts: ConflictEntry[];
  /** 当前签发依据版本，每次有效修订/补证单调递增 */
  basisVersion: number;
  /** 全局操作号，单调递增，冲突也占号 */
  opSeq: number;
  confirmation: Confirmation | null;
  /** 最后确认版本的快照，写入失败后从这里恢复（服务端内部保留，不外发） */
  confirmedSnapshot: BasisState | null;
  recoveries: { at: string; restoredToBasis: number; seq: number }[];
};

/** GET 接口外发的依据形态（不含恢复快照） */
export type BasisDigest = Omit<BasisState, 'confirmedSnapshot'> & {
  confirmedSnapshot: null;
};
