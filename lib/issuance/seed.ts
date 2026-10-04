import { createBasis } from './engine';
import type { BasisState } from './types';

const seedRecords = [
  { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中' as const, revision: 3 },
  { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.11, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验' as const, revision: 2, verifiedAtBasis: 1 as number | null },
  { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.68, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证' as const, revision: 4 },
  { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验' as const, revision: 1, verifiedAtBasis: 1 as number | null },
  { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验' as const, revision: 1 }
];

// 人工发现项（历史遗留）；自动发现项由规则在首版依据上重算生成
const seedFindings = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据' as const, title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放' as const },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动' as const, title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中' as const },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致' as const, title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放' as const }
];

export function buildSeedBasis(): BasisState {
  return createBasis({ records: seedRecords, findings: seedFindings });
}

export const projectMeta = {
  project: {
    id: 'CN-ER-2026-041',
    name: '临港工业园区能效提升项目',
    methodology: 'CMS-052-V01',
    vintage: '2026 监测年度',
    verifier: '华碳认证 · 核验组 B'
  },
  summary: {
    period: '2026 年第三监测期',
    reduction: 18426,
    evidenceRate: 92,
    sampled: 18
  }
};
