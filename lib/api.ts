import ky from 'ky';
import { evidenceResponseSchema, operationResultSchema, type BasisOperation, type OperationResult } from './schema';

const client = ky.create({ timeout: 10_000, retry: { limit: 0 } });

export async function fetchEvidence(): Promise<import('./schema').EvidenceResponse> {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

/**
 * 提交签发依据写入（修订 / 门禁确认 / 发现项处置）。
 * 携带操作号（幂等键）与期望依据版本；服务端据此判定先到生效 / 后到冲突 / 越权拒绝。
 * simulateFailure 用于演示“写入失败 → 从最后确认版本恢复”。
 */
export async function submitOperation(op: BasisOperation, simulateFailure = false): Promise<OperationResult> {
  const response = await client
    .post('/api/evidence', {
      json: op,
      headers: simulateFailure ? { 'x-simulate-failure': '1' } : undefined
    })
    .json<unknown>();
  return operationResultSchema.parse(response);
}
