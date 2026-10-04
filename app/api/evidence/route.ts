import { NextResponse } from 'next/server';
import { evidenceResponseSchema } from '@/lib/schema';
import {
  changeFindingStatus,
  confirmBasis,
  recoverFromLastConfirmed,
  recomputeGate,
  release,
  resolveConflict,
  submitChange,
  verifyRecord
} from '@/lib/issuance/engine';
import { buildSeedBasis, projectMeta } from '@/lib/issuance/seed';
import type { BasisDigest, BasisState } from '@/lib/issuance/types';

// 进程内唯一签发依据：记录、发现项、门禁、账本、冲突、确认快照都在这一份上
let basis: BasisState = buildSeedBasis();

function digest(state: BasisState): BasisDigest {
  return {
    records: state.records,
    findings: state.findings,
    gates: state.gates,
    ledger: state.ledger,
    conflicts: state.conflicts,
    basisVersion: state.basisVersion,
    opSeq: state.opSeq,
    confirmation: state.confirmation,
    confirmedSnapshot: null,
    recoveries: state.recoveries
  };
}

function payload(state: BasisState) {
  const openFindings = state.findings.filter((item) => !item.invalidReason && item.status !== '已关闭').length;
  return evidenceResponseSchema.parse({
    ...projectMeta,
    summary: { ...projectMeta.summary, openFindings },
    basis: digest(state)
  });
}

function ok(state: BasisState, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, basis: payload(state).basis, ...extra });
}

function fail(state: BasisState, reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, basis: payload(state).basis, error: reason, ...extra }, { status: 200 });
}

export async function GET() {
  return NextResponse.json(payload(basis));
}

type ActionBody = {
  action?: string;
  role?: BasisState['ledger'][number]['role'];
  actor?: string;
  opId?: string;
  recordId?: string;
  patch?: { activity?: number; unit?: string; source?: string; reason: string; baseVersion?: number };
  evidenceCount?: number;
  note?: string;
  findingId?: string;
  gateId?: 'evidence' | 'calculation' | 'revisions' | 'methodology';
  methodologyPassed?: boolean;
  resolution?: 'abandon' | 'rebase';
  conflictOpId?: string;
  /** 模拟写入超时：账本已落但响应丢失，用于验证重试幂等与恢复 */
  simulateWriteFailure?: boolean;
};

export async function POST(request: Request) {
  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return fail(basis, '请求体不是合法 JSON。');
  }

  const actor = body.actor || '当前用户';
  const role = body.role ?? '核验员';

  switch (body.action) {
    case 'reset':
      basis = buildSeedBasis();
      return ok(basis, { reset: true });

    case 'revise': {
      const replaying = Boolean(body.opId) && basis.ledger.some((entry) => entry.opId === body.opId);
      if (!replaying && (!body.recordId || !body.patch?.reason)) return fail(basis, '缺少记录号或修订原因。');
      const patch = body.patch ?? { reason: '' };
      const { state, result } = submitChange(basis, {
        type: '修订',
        recordId: body.recordId ?? '',
        actor,
        role,
        opId: body.opId ?? '',
        patch: {
          activity: patch.activity,
          unit: patch.unit,
          source: patch.source,
          reason: patch.reason,
          baseVersion: patch.baseVersion
        }
      });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      if (body.simulateWriteFailure) {
        return NextResponse.json({
          ok: false,
          written: false,
          error: 'WRITE_TIMEOUT：写入响应超时，结果未知（账本可能已落）。可用原操作号重试，或从最后确认版本恢复。',
          opId: body.opId,
          basis: payload(basis).basis
        }, { status: 200 });
      }
      return ok(basis, { result });
    }

    case 'supplement': {
      const replaying = Boolean(body.opId) && basis.ledger.some((entry) => entry.opId === body.opId);
      if (!replaying && !body.recordId) return fail(basis, '缺少记录号。');
      const { state, result } = submitChange(basis, {
        type: '补证',
        recordId: body.recordId ?? '',
        actor,
        role,
        opId: body.opId ?? '',
        evidenceCount: body.evidenceCount,
        note: body.note
      });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      if (body.simulateWriteFailure) {
        return NextResponse.json({
          ok: false,
          written: false,
          error: 'WRITE_TIMEOUT：写入响应超时，结果未知（账本可能已落）。可用原操作号重试，或从最后确认版本恢复。',
          opId: body.opId,
          basis: payload(basis).basis
        }, { status: 200 });
      }
      return ok(basis, { result });
    }

    case 'verify': {
      if (!body.recordId) return fail(basis, '缺少记录号。');
      const { state, result } = verifyRecord(basis, { recordId: body.recordId, actor, role, opId: body.opId });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      return ok(basis, { result });
    }

    case 'finding': {
      if (!body.findingId) return fail(basis, '缺少发现项编号。');
      const mode = body.note === 'close' ? 'close' as const : 'request' as const;
      const { state, result } = changeFindingStatus(basis, { findingId: body.findingId, mode, actor, role, opId: body.opId });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      return ok(basis, { result });
    }

    case 'gate': {
      if (!body.gateId) return fail(basis, '缺少门禁编号。');
      const { state, result } = recomputeGate(basis, { gateId: body.gateId, actor, role, opId: body.opId });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      return ok(basis, { result });
    }

    case 'confirm': {
      const { state, result } = confirmBasis(basis, {
        reviewer: actor,
        role,
        methodologyPassed: body.methodologyPassed ?? true,
        opId: body.opId
      });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      return ok(basis, { result });
    }

    case 'release': {
      const { state, result } = release(basis, { actor, role, opId: body.opId });
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      return ok(basis, { result });
    }

    case 'resolve-conflict': {
      if (!body.conflictOpId || !body.resolution) return fail(basis, '缺少冲突操作号或处理方式。');
      const { state, result } = resolveConflict(basis, body.conflictOpId, body.resolution, actor, role);
      basis = state;
      if (result.outcome === 'rejected') return fail(basis, result.reason, { result });
      return ok(basis, { result });
    }

    case 'recover': {
      if (!basis.confirmedSnapshot) return fail(basis, '尚无复核确认版本，无法恢复。');
      basis = recoverFromLastConfirmed(basis);
      return ok(basis, { recoveredToBasis: basis.basisVersion });
    }

    default:
      return fail(basis, `未知操作：${body.action ?? '(空)'}。`);
  }
}
