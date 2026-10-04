import { NextResponse } from 'next/server';
import {
  backfillBasis,
  commitRevision,
  confirmGate,
  unconfirmGate,
  setFindingStatus,
  type Basis
} from '@/lib/basis';
import { defaultRecords, defaultFindings } from '@/lib/seed';
import { operationSchema, operationResultSchema } from '@/lib/schema';

export const dynamic = 'force-dynamic';

const project = {
  id: 'CN-ER-2026-041',
  name: '临港工业园区能效提升项目',
  methodology: 'CMS-052-V01',
  vintage: '2026 监测年度',
  verifier: '华碳认证 · 核验组 B'
};

const summary = {
  period: '2026 年第三监测期',
  reduction: 18426,
  evidenceRate: 92,
  openFindings: 3,
  sampled: 18
};

/**
 * 服务端持有权威签发依据（内存态）。
 * 所有写入经同一内核规则判定：先到生效、后到留冲突不进依据、越权拒绝、操作号幂等。
 */
let basis: Basis = backfillBasis({ records: defaultRecords, findings: defaultFindings, version: 1 });

export async function GET() {
  return NextResponse.json({ project, summary, basis });
}

export async function POST(request: Request) {
  // 演示用：模拟写入失败（服务端未推进版本，客户端应回滚到最后确认版本）。
  if (request.headers.get('x-simulate-failure') === '1') {
    return NextResponse.json({ error: 'simulated write failure' }, { status: 500 });
  }

  const body = operationSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ accepted: false, reason: 'conflict', basis }, { status: 400 });
  }
  const op = body.data;

  let result;
  switch (op.kind) {
    case 'revision':
      result = commitRevision(basis, {
        operationId: op.operationId,
        recordId: op.recordId!,
        expectedVersion: op.expectedVersion,
        changes: op.changes ?? {},
        reason: op.reason ?? '',
        actor: op.actor,
        actorRole: op.actorRole
      });
      break;
    case 'confirmGate':
      result = confirmGate(basis, {
        operationId: op.operationId,
        gateId: op.gateId!,
        expectedVersion: op.expectedVersion,
        actor: op.actor,
        actorRole: op.actorRole
      });
      break;
    case 'unconfirmGate':
      result = unconfirmGate(basis, {
        operationId: op.operationId,
        gateId: op.gateId!,
        expectedVersion: op.expectedVersion,
        actor: op.actor,
        actorRole: op.actorRole
      });
      break;
    case 'finding':
      result = setFindingStatus(basis, {
        operationId: op.operationId,
        findingId: op.findingId!,
        status: op.status ?? '开放',
        expectedVersion: op.expectedVersion,
        actor: op.actor,
        actorRole: op.actorRole
      });
      break;
  }

  if (result.ok) {
    basis = result.basis;
    return NextResponse.json(
      operationResultSchema.parse({
        accepted: true,
        idempotent: result.idempotent === true,
        basis: result.basis,
        revision: result.revision
      })
    );
  }

  if (result.reason === 'conflict') {
    basis = result.basis; // 冲突留痕（conflicts 追加），但不进依据
    return NextResponse.json(
      operationResultSchema.parse({
        accepted: false,
        reason: 'conflict',
        basis: result.basis,
        conflict: result.conflict
      }),
      { status: 409 }
    );
  }

  // 越权拒绝：依据不变。
  return NextResponse.json(
    operationResultSchema.parse({ accepted: false, reason: 'forbidden', basis: result.basis }),
    { status: 403 }
  );
}
