import ky from 'ky';
import { basisDigestSchema, evidenceResponseSchema, type BasisDigest } from './schema';
import type { GateId, Role } from './issuance/types';

const client = ky.create({ timeout: 10_000, retry: { limit: 1 } });

export async function fetchEvidence() {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

type ActionBody = {
  action?: string;
  actor: string;
  role: Role;
  opId?: string;
  [key: string]: unknown;
};

export type ActionResponse = {
  ok: boolean;
  basis: BasisDigest;
  error?: string;
  written?: boolean;
  result?: unknown;
  recoveredToBasis?: number;
  reset?: boolean;
};

export async function dispatchAction(body: ActionBody): Promise<ActionResponse> {
  const raw = await client.post('/api/evidence', { json: body }).json<unknown>() as Record<string, unknown>;
  const basis = basisDigestSchema.parse(raw.basis);
  return {
    ok: Boolean(raw.ok),
    basis,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    written: raw.written === undefined ? undefined : Boolean(raw.written),
    result: raw.result,
    recoveredToBasis: typeof raw.recoveredToBasis === 'number' ? raw.recoveredToBasis : undefined,
    reset: Boolean(raw.reset)
  };
}

export type { GateId };
