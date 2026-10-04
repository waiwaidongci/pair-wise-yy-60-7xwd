import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dispatchAction, fetchEvidence } from './api';
import { mintOpId } from './issuance/engine';
import type { BasisDigest, GateId, Role } from './issuance/types';

type ProjectMeta = {
  project: { id: string; name: string; methodology: string; vintage: string; verifier: string };
  summary: { period: string; reduction: number; evidenceRate: number; openFindings: number; sampled: number };
};

type Notice = { severity: 'success' | 'info' | 'warning' | 'error'; text: string } | null;

/** 写入超时后悬而未决的操作：同操作号重试，或回最后确认版本恢复 */
type PendingWrite = {
  opId: string;
  action: string;
  label: string;
  /** 原始请求体（opId 不变，服务端据此幂等回放） */
  body: Record<string, unknown>;
} | null;

type State = {
  hydrated: boolean;
  meta: ProjectMeta | null;
  basis: BasisDigest | null;
  role: Role;
  actor: string;
  notice: Notice;
  busy: boolean;
  selectedRecordId: string;
  sampledIds: string[];
  pendingWrite: PendingWrite;

  hydrate: () => Promise<void>;
  setRole: (role: Role) => void;
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  resetAll: () => Promise<void>;

  revise: (args: { recordId: string; patch: { activity?: number; unit?: string; source?: string; reason: string; baseVersion: number }; simulateWriteFailure?: boolean }) => Promise<void>;
  supplement: (args: { recordId: string; count: number; note?: string; simulateWriteFailure?: boolean }) => Promise<void>;
  verify: (recordId: string) => Promise<void>;
  findingAction: (findingId: string, mode: 'request' | 'close') => Promise<void>;
  recomputeGate: (gateId: GateId) => Promise<void>;
  confirm: (methodologyPassed: boolean) => Promise<void>;
  release: () => Promise<void>;
  resolveConflict: (conflictOpId: string, resolution: 'abandon' | 'rebase') => Promise<void>;
  retryPending: () => Promise<void>;
  recover: () => Promise<void>;
  clearNotice: () => void;
};

export const roleActors: Record<Role, string> = {
  现场: '徐璐（现场）',
  核验员: '沈楠（核验员）',
  复核员: '韩跃（复核员）'
};

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => {
      const apply = async (
        body: Record<string, unknown>,
        opts: { successText: (basis: BasisDigest) => string; pendingLabel?: string }
      ) => {
        set({ busy: true });
        try {
          const res = await dispatchAction({ actor: get().actor, role: get().role, ...body });
          set({ basis: res.basis });
          if (res.ok) {
            set({ notice: { severity: 'success', text: opts.successText(res.basis) }, pendingWrite: null });
          } else if (res.error?.startsWith('WRITE_TIMEOUT')) {
            const opId = String(body.opId ?? '');
            const pending: PendingWrite = { opId, action: String(body.action), label: opts.pendingLabel ?? '写入超时的操作', body: { ...body } };
            set({ notice: { severity: 'warning', text: `${res.error}（操作号 ${opId}）` }, pendingWrite: pending });
          } else {
            set({ notice: { severity: 'error', text: res.error ?? '操作被拒绝。' } });
          }
        } catch (error) {
          set({ notice: { severity: 'error', text: `网络异常：${error instanceof Error ? error.message : String(error)}` } });
        } finally {
          set({ busy: false });
        }
      };

      return {
        hydrated: false,
        meta: null,
        basis: null,
        role: '核验员',
        actor: roleActors['核验员'],
        notice: null,
        busy: false,
        selectedRecordId: 'ACT-0318',
        sampledIds: ['ACT-0318', 'ACT-0337'],
        pendingWrite: null,

        hydrate: async () => {
          const data = await fetchEvidence();
          set({ meta: { project: data.project, summary: data.summary }, basis: data.basis, hydrated: true });
        },

        setRole: (role) => set({ role, actor: roleActors[role], notice: { severity: 'info', text: `已切换为 ${role}：${roleActors[role]}` } }),
        selectRecord: (id) => set({ selectedRecordId: id }),
        toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),

        clearNotice: () => set({ notice: null }),

        resetAll: async () => {
          set({ busy: true });
          const res = await dispatchAction({ action: 'reset', actor: get().actor, role: get().role });
          set({ basis: res.basis, notice: { severity: 'info', text: '已重置为演示初始依据（V1）。' }, pendingWrite: null, busy: false });
        },

        revise: async ({ recordId, patch, simulateWriteFailure }) => {
          const opId = mintOpId();
          await apply(
            { action: 'revise', recordId, patch, opId, simulateWriteFailure: Boolean(simulateWriteFailure) },
            {
              successText: (b) => `修订已进入签发依据 V${b.basisVersion}，操作号 ${opId}；关联发现项与门禁已按新版本重算。`,
              pendingLabel: `修订 ${recordId}`
            }
          );
        },

        supplement: async ({ recordId, count, note, simulateWriteFailure }) => {
          const opId = mintOpId();
          await apply(
            { action: 'supplement', recordId, evidenceCount: count, note, opId, simulateWriteFailure: Boolean(simulateWriteFailure) },
            { successText: (b) => `补证已进入同一签发依据 V${b.basisVersion}，操作号 ${opId}。`, pendingLabel: `补证 ${recordId}` }
          );
        },

        verify: async (recordId) => {
          const opId = mintOpId();
          await apply(
            { action: 'verify', recordId, opId },
            { successText: (b) => `核验通过，结论绑定依据 V${b.basisVersion}。` }
          );
        },

        findingAction: async (findingId, mode) => {
          const res = await dispatchAction({ action: 'finding', findingId, note: mode === 'close' ? 'close' : 'request', actor: get().actor, role: get().role });
          set({ basis: res.basis });
          if (res.ok) set({ notice: { severity: 'success', text: mode === 'close' ? '发现项已闭环。' : '已发起补证，现场补证后进入同一依据。' } });
          else set({ notice: { severity: 'error', text: res.error ?? '操作被拒绝。' } });
        },

        recomputeGate: async (gateId) => {
          const opId = mintOpId();
          await apply(
            { action: 'gate', gateId, opId },
            { successText: (b) => `门禁已按当前依据 V${b.basisVersion} 重算。` }
          );
        },

        confirm: async (methodologyPassed) => {
          const opId = mintOpId();
          await apply(
            { action: 'confirm', methodologyPassed, opId },
            { successText: (b) => `复核员已确认签发依据 V${b.basisVersion}，并留存该版本快照。` }
          );
        },

        release: async () => {
          const opId = mintOpId();
          await apply(
            { action: 'release', opId },
            { successText: (b) => `放行成功：签发依据 V${b.basisVersion} 全部门禁通过且确认版本一致。` }
          );
        },

        resolveConflict: async (conflictOpId, resolution) => {
          await apply(
            { action: 'resolve-conflict', conflictOpId, resolution },
            {
              successText: (b) => resolution === 'rebase'
                ? `后到修订已基于最新版本重生，进入依据 V${b.basisVersion}。`
                : '后到修订已放弃，未进入签发依据。'
            }
          );
        },

        retryPending: async () => {
          const pending = get().pendingWrite;
          if (!pending) return;
          // 用原操作号、原请求体重放（去掉故障模拟）：服务端按 opId 幂等，不重复记账
          const replayBody: Record<string, unknown> = { ...pending.body, replay: true };
          delete replayBody.simulateWriteFailure;
          await apply(
            replayBody,
            { successText: (b) => `原操作号 ${pending.opId} 重试完成：命中幂等回放，未重复记账，当前依据 V${b.basisVersion}。` }
          );
        },

        recover: async () => {
          const res = await dispatchAction({ action: 'recover', actor: get().actor, role: get().role });
          set({ basis: res.basis });
          if (res.ok) set({ notice: { severity: 'success', text: `已从最后确认版本恢复到 V${res.recoveredToBasis}，其后误记的账已回滚。` }, pendingWrite: null });
          else set({ notice: { severity: 'error', text: res.error ?? '恢复失败。' } });
        }
      };
    },
    {
      name: 'yy60-issuance-basis',
      partialize: (state) => ({ role: state.role, actor: state.actor, selectedRecordId: state.selectedRecordId, sampledIds: state.sampledIds })
    }
  )
);
