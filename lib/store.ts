import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  backfillBasis,
  commitRevision,
  confirmGate,
  unconfirmGate,
  setFindingStatus,
  recoverFromSnapshot,
  newOperationId,
  isGateCurrent,
  type ActorRole,
  type Basis,
  type GateId,
  type RevisionChanges
} from '@/lib/basis';
import { defaultRecords, defaultFindings } from '@/lib/seed';
import { submitOperation } from '@/lib/api';
import type { BasisOperation } from '@/lib/schema';

export type { ActorRole } from '@/lib/basis';

const ACTOR = '沈楠';

const initialBasis = backfillBasis({ records: defaultRecords, findings: defaultFindings, version: 1 });

export type Notice = { severity: 'success' | 'info' | 'warning' | 'error'; message: string } | null;

type PendingOp = { op: BasisOperation; optimistic: (basis: Basis) => Basis } | null;

type State = {
  basis: Basis;
  lastConfirmedBasis: Basis;
  selectedRecordId: string;
  sampledIds: string[];
  currentRole: ActorRole;
  simulateFailure: boolean;
  notice: Notice;
  pendingOp: PendingOp;

  hydrate: (serverBasis: Basis) => void;
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  setRole: (role: ActorRole) => void;
  setSimulateFailure: (value: boolean) => void;
  clearNotice: () => void;

  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;

  reviseValue: (id: string, value: number, reason: string) => Promise<void>;
  requestEvidence: (findingId: string) => Promise<void>;
  closeFinding: (findingId: string) => Promise<void>;
  toggleGate: (gateId: GateId) => Promise<void>;
  retryLastOperation: () => Promise<void>;
};

/** 同一套内核规则用于本地乐观预算与服务端权威提交。 */
function applyOptimistic(basis: Basis, op: BasisOperation): Basis {
  switch (op.kind) {
    case 'revision': {
      const result = commitRevision(basis, {
        operationId: op.operationId,
        recordId: op.recordId!,
        expectedVersion: op.expectedVersion,
        changes: op.changes ?? {},
        reason: op.reason ?? '',
        actor: op.actor,
        actorRole: op.actorRole
      });
      return result.ok ? result.basis : basis;
    }
    case 'confirmGate': {
      const result = confirmGate(basis, {
        operationId: op.operationId,
        gateId: op.gateId!,
        expectedVersion: op.expectedVersion,
        actor: op.actor,
        actorRole: op.actorRole
      });
      return result.ok ? result.basis : basis;
    }
    case 'unconfirmGate': {
      const result = unconfirmGate(basis, {
        operationId: op.operationId,
        gateId: op.gateId!,
        expectedVersion: op.expectedVersion,
        actor: op.actor,
        actorRole: op.actorRole
      });
      return result.ok ? result.basis : basis;
    }
    case 'finding': {
      const result = setFindingStatus(basis, {
        operationId: op.operationId,
        findingId: op.findingId!,
        status: op.status ?? '开放',
        expectedVersion: op.expectedVersion,
        actor: op.actor,
        actorRole: op.actorRole
      });
      return result.ok ? result.basis : basis;
    }
  }
}

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => {
      /** 统一写入：乐观推进 → 服务端权威判定 → 成功/冲突/越权/失败 对账。 */
      async function runOperation(op: BasisOperation, optimistic: (basis: Basis) => Basis) {
        const { simulateFailure } = get();
        const snapshot = get().lastConfirmedBasis;
        // 乐观推进（立即反映到 UI）；失败时据此回滚。
        set({ basis: optimistic(get().basis), notice: null });
        try {
          const result = await submitOperation(op, simulateFailure);
          if (result.accepted) {
            const confirmed = backfillBasis(result.basis);
            set({
              basis: confirmed,
              lastConfirmedBasis: confirmed,
              pendingOp: null,
              notice: {
                severity: 'success',
                message: result.idempotent
                  ? `操作 ${op.operationId.slice(0, 8)} 已生效（重试未重复记账）。`
                  : `已写入签发依据 V${confirmed.version}，操作号 ${op.operationId.slice(0, 8)}。`
              }
            });
          } else if (result.reason === 'conflict') {
            const reconciled = backfillBasis(result.basis);
            const conflict = result.conflict;
            set({
              basis: reconciled,
              lastConfirmedBasis: reconciled,
              pendingOp: null,
              notice: {
                severity: 'warning',
                message: `检测到并发修订：${conflict?.conflictReason ?? '依据版本已更新，本次未生效。'}（已保留为冲突，不进依据）`
              }
            });
          } else {
            // 越权拒绝：依据不变。
            const reconciled = backfillBasis(result.basis);
            set({
              basis: reconciled,
              notice: { severity: 'error', message: `越权提交已拒绝：当前角色「${op.actorRole}」无权执行该操作。` }
            });
          }
        } catch {
          // 写入失败：从最后确认版本恢复，保留操作号以便幂等重试。
          set({
            basis: recoverFromSnapshot(get().basis, snapshot),
            pendingOp: { op, optimistic },
            notice: { severity: 'error', message: '写入失败：已从最后确认版本恢复。可重试，重试不重复记账。' }
          });
        }
      }

      return {
        basis: initialBasis,
        lastConfirmedBasis: initialBasis,
        selectedRecordId: 'ACT-0318',
        sampledIds: ['ACT-0318', 'ACT-0337'],
        currentRole: '核验员',
        simulateFailure: false,
        notice: null,
        pendingOp: null,

        hydrate: (serverBasis) => {
          const normalized = backfillBasis(serverBasis);
          set({ basis: normalized, lastConfirmedBasis: normalized });
        },
        selectRecord: (id) => set({ selectedRecordId: id }),
        toggleSample: (id) =>
          set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((x) => x !== id) : [...state.sampledIds, id] })),
        setRole: (role) => set({ currentRole: role }),
        setSimulateFailure: (value) => set({ simulateFailure: value }),
        clearNotice: () => set({ notice: null }),

        startCorrection: (id) =>
          set((state) => ({
            basis: {
              ...state.basis,
              records: state.basis.records.map((record) => (record.id === id ? { ...record, status: '复核中' } : record))
            }
          })),
        verifyRecord: (id) =>
          set((state) => ({
            basis: {
              ...state.basis,
              records: state.basis.records.map((record) => (record.id === id ? { ...record, status: '已核验' } : record))
            }
          })),
        batchVerify: () =>
          set((state) => ({
            basis: {
              ...state.basis,
              records: state.basis.records.map((record) =>
                state.sampledIds.includes(record.id) && record.status !== '需补证' ? { ...record, status: '已核验' } : record
              )
            }
          })),

        reviseValue: async (id, value, reason) => {
          const state = get();
          const record = state.basis.records.find((item) => item.id === id);
          if (!record) return;
          const changes: RevisionChanges = { activity: value };
          const op: BasisOperation = {
            kind: 'revision',
            operationId: newOperationId(),
            expectedVersion: state.basis.version,
            recordId: id,
            changes,
            reason,
            actor: ACTOR,
            actorRole: state.currentRole
          };
          await runOperation(op, (basis) => applyOptimistic(basis, op));
        },

        requestEvidence: async (findingId) => {
          const state = get();
          const op: BasisOperation = {
            kind: 'finding',
            operationId: newOperationId(),
            expectedVersion: state.basis.version,
            findingId,
            status: '补证中',
            actor: ACTOR,
            actorRole: state.currentRole
          };
          await runOperation(op, (basis) => applyOptimistic(basis, op));
        },

        closeFinding: async (findingId) => {
          const state = get();
          const op: BasisOperation = {
            kind: 'finding',
            operationId: newOperationId(),
            expectedVersion: state.basis.version,
            findingId,
            status: '已关闭',
            actor: ACTOR,
            actorRole: state.currentRole
          };
          await runOperation(op, (basis) => applyOptimistic(basis, op));
        },

        toggleGate: async (gateId) => {
          const state = get();
          const gate = state.basis.gates.find((item) => item.id === gateId);
          if (!gate) return;
          // 已有效（确认且绑定当前依据版本）→ 撤销；否则含失效重算 → 重新确认并绑定新版本。
          const nextKind = isGateCurrent(gate, state.basis) ? 'unconfirmGate' : 'confirmGate';
          const op: BasisOperation = {
            kind: nextKind,
            operationId: newOperationId(),
            expectedVersion: state.basis.version,
            gateId,
            actor: ACTOR,
            actorRole: state.currentRole
          };
          await runOperation(op, (basis) => applyOptimistic(basis, op));
        },

        retryLastOperation: async () => {
          const pending = get().pendingOp;
          if (!pending) return;
          // 复用同一操作号重试：服务端幂等，不重复记账。
          await runOperation(pending.op, pending.optimistic);
        }
      };
    },
    { name: 'yy60-carbon-evidence-basis' }
  )
);
