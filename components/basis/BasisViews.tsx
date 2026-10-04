'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography
} from '@mui/material';
import {
  AddLinkOutlined,
  AutorenewOutlined,
  FactCheckOutlined,
  GppGoodOutlined,
  SendOutlined,
  WarningAmberOutlined
} from '@mui/icons-material';
import { useCarbonStore } from '@/lib/store';
import type { Finding, Gate, RecordSnapshot } from '@/lib/issuance/types';

export function gateColor(status: Gate['status']): 'success' | 'warning' | 'error' | 'default' {
  if (status === '已通过') return 'success';
  if (status === '待重算') return 'warning';
  if (status === '未通过') return 'error';
  return 'default';
}

export function RecordVersionTag({ record }: { record: RecordSnapshot }) {
  return (
    <Stack direction="row" spacing={.5} flexWrap="wrap" useFlexGap>
      <Chip size="small" label={`依据 V${record.basisVersion}`} sx={{ height: 18, fontSize: 9.5, fontWeight: 800 }} color="primary" variant={record.verifiedAtBasis === record.basisVersion ? 'filled' : 'outlined'} />
      <Chip size="small" label={`修订链 R${record.revision}`} sx={{ height: 18, fontSize: 9.5 }} variant="outlined" />
      {record.verifiedAtBasis !== null && (
        <Chip
          size="small"
          label={`核验@V${record.verifiedAtBasis}${record.verifiedAtBasis !== record.basisVersion ? '（已过期）' : ''}`}
          sx={{ height: 18, fontSize: 9.5 }}
          color={record.verifiedAtBasis === record.basisVersion ? 'success' : 'warning'}
          variant={record.verifiedAtBasis === record.basisVersion ? 'filled' : 'outlined'}
        />
      )}
    </Stack>
  );
}

function StatusChip({ status }: { status: RecordSnapshot['status'] }) {
  return (
    <Chip
      size="small"
      label={status}
      color={status === '已核验' ? 'success' : status === '需补证' ? 'warning' : status === '复核中' ? 'info' : 'default'}
      variant={status === '已核验' ? 'filled' : 'outlined'}
    />
  );
}

export function FindingRow({ finding, onAction }: { finding: Finding; onAction?: (mode: 'request' | 'close') => void }) {
  const invalid = finding.invalidReason !== null;
  const closed = finding.status === '已关闭';
  return (
    <Box sx={{ borderTop: '1px solid #edf0ef', py: 1.2, opacity: invalid || closed ? .62 : 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Stack direction="row" spacing={.8} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography fontSize={12} fontWeight={700} sx={{ textDecoration: closed ? 'line-through' : 'none' }}>{finding.title}</Typography>
          <Chip size="small" label={finding.auto ? '规则生成' : '人工'} sx={{ height: 17, fontSize: 9 }} variant="outlined" />
          <Chip size="small" label={`挂 V${finding.basisVersion}`} sx={{ height: 17, fontSize: 9 }} variant="outlined" />
        </Stack>
        <Chip
          size="small"
          label={invalid ? `已失效·${finding.invalidReason}` : finding.status}
          color={closed ? 'success' : invalid ? 'warning' : finding.status === '补证中' ? 'info' : 'error'}
        />
      </Stack>
      <Typography fontSize={10.5} color="text.secondary" mt={.5}>{finding.detail}</Typography>
      <Typography fontSize={10} color="text.secondary" mt={.3}>{finding.assignee} · 截止 {finding.due} · {finding.recordId}</Typography>
      {invalid && (
        <Typography fontSize={10} color="secondary.main" mt={.3}>依据发生{finding.invalidReason}，该发现项已从门禁与签发判断中摘除，留痕保留；新版本按规则重算。</Typography>
      )}
      {!invalid && !closed && onAction && (
        <Stack direction="row" spacing={.7} mt={.8}>
          <Button size="small" onClick={() => onAction('request')}>发起补证</Button>
          <Button size="small" variant="contained" onClick={() => onAction('close')}>闭环关闭</Button>
        </Stack>
      )}
    </Box>
  );
}

function LedgerCard({ title, limit }: { title: string; limit?: number }) {
  const ledger = useCarbonStore((state) => state.basis?.ledger ?? []);
  const shown = limit ? ledger.slice(-limit).reverse() : [...ledger].reverse();
  return (
    <Card elevation={0} variant="outlined">
      <CardContent>
        <Typography fontWeight={800} fontSize={14} mb={1}>{title}</Typography>
        {shown.length === 0 && <Typography fontSize={11.5} color="text.secondary">暂无操作。</Typography>}
        {shown.map((entry) => (
          <Stack key={`${entry.seq}-${entry.opId}`} direction="row" spacing={1.1} sx={{ borderTop: '1px solid #edf0ef', py: .9 }} alignItems="flex-start">
            <Chip size="small" label={`#${entry.seq}`} sx={{ height: 17, fontSize: 9.5, minWidth: 34 }} variant="outlined" />
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={.7} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography fontSize={11.5} fontWeight={750}>{entry.type}</Typography>
                <Chip size="small" label={entry.role} sx={{ height: 16, fontSize: 8.5 }} />
                {entry.basisVersion !== undefined && <Chip size="small" label={`V${entry.basisVersion}`} color="primary" sx={{ height: 16, fontSize: 8.5 }} />}
              </Stack>
              <Typography fontSize={10.5} color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                {entry.actor} · {entry.opId}{entry.recordId ? ` · ${entry.recordId}` : ''}
              </Typography>
              {entry.note && <Typography fontSize={10.5} mt={.2}>{entry.note}</Typography>}
            </Box>
          </Stack>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------- 总览 ----------------

export function OverviewView({ onRevise }: { onRevise: (record: RecordSnapshot) => void }) {
  const basis = useCarbonStore((state) => state.basis)!;
  const meta = useCarbonStore((state) => state.meta);
  const selectedId = useCarbonStore((state) => state.selectedRecordId);
  const selectRecord = useCarbonStore((state) => state.selectRecord);
  const findings = basis.findings;

  const selected = basis.records.find((record) => record.id === selectedId) ?? basis.records[0];
  const liveFindings = findings.filter((item) => !item.invalidReason && item.status !== '已关闭');
  const totalReduction = basis.records.reduce(
    (total, record) => total + (record.activity * record.factor) / (record.unit === 'kWh' ? 1000 : record.unit === 'L' ? 1000 : 1),
    0
  );

  const stats = [
    { label: '当前减排量', value: totalReduction.toFixed(0), unit: 'tCO₂e', note: `依据 V${basis.basisVersion} 实时重算` },
    { label: '生效发现项', value: `${liveFindings.length}`, unit: '项', note: `失效 ${findings.filter((item) => item.invalidReason).length} 项留痕` },
    { label: '通过门禁', value: `${basis.gates.filter((gate) => gate.status === '已通过' && gate.passedAtBasis === basis.basisVersion).length} / 4`, unit: '', note: `全部绑定 V${basis.basisVersion} 才可放行` },
    { label: '操作号水位', value: `#${basis.opSeq}`, unit: '', note: '冲突也占号，拒绝不占号' }
  ];

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 1.4, mb: 2 }}>
        {stats.map((item) => (
          <Card elevation={0} variant="outlined" key={item.label}>
            <CardContent sx={{ p: 1.8, '&:last-child': { pb: 1.8 } }}>
              <Typography variant="caption" color="text.secondary">{item.label}</Typography>
              <Stack direction="row" alignItems="baseline" spacing={.6} mt={.5}>
                <Typography variant="h5" fontWeight={850}>{item.value}</Typography>
                <Typography fontSize={12} color="text.secondary">{item.unit}</Typography>
              </Stack>
              <Typography fontSize={11} color="text.secondary" mt={.7}>{item.note}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.5fr) minmax(320px, .8fr)' }, gap: 1.5 }}>
        <Card elevation={0} variant="outlined">
          <Stack sx={{ p: 1.6 }}>
            <Box>
              <Typography fontWeight={800} fontSize={14}>统一签发依据 · 记录清单</Typography>
              <Typography fontSize={11} color="text.secondary">记录不再各存一份：核验结论、发现项与门禁全部挂在当前依据版本上（{meta?.project.name}）</Typography>
            </Box>
          </Stack>
          <Divider />
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ minWidth: 880 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1.6fr .9fr .9fr 1.2fr .7fr', gap: 1, px: 1.7, py: 1, bgcolor: '#f7f9f8', color: 'text.secondary', fontSize: 11, fontWeight: 750 }}>
                <span>数据来源</span><span>活动数据</span><span>排放因子</span><span>依据/核验版本</span><span>状态</span>
              </Box>
              {basis.records.map((record) => (
                <Box
                  key={record.id} role="button" tabIndex={0}
                  onClick={() => selectRecord(record.id)}
                  sx={{ display: 'grid', gridTemplateColumns: '1.6fr .9fr .9fr 1.2fr .7fr', gap: 1, px: 1.7, py: 1.2, borderTop: '1px solid #e8ecea', cursor: 'pointer', bgcolor: selected.id === record.id ? '#eff7f3' : 'white', '&:hover': { bgcolor: '#f6faf8' } }}
                >
                  <Box>
                    <Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography>
                    <Typography fontSize={10} color="text.secondary">{record.id} · {record.owner}</Typography>
                  </Box>
                  <Box>
                    <Typography fontSize={12}>{record.activity.toLocaleString()} {record.unit}</Typography>
                    <Typography fontSize={10} color={Math.abs(record.anomaly) > 5 ? 'secondary.main' : 'text.secondary'}>异常 {record.anomaly > 0 ? '+' : ''}{record.anomaly}%</Typography>
                  </Box>
                  <Typography fontSize={12}>{record.factor} <small>{record.factorUnit}</small></Typography>
                  <Box><RecordVersionTag record={record} /></Box>
                  <StatusChip status={record.status} />
                </Box>
              ))}
            </Box>
          </Box>
        </Card>

        <Stack spacing={1.5}>
          <Card elevation={0} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800} fontSize={14}>计算链（依据 V{selected.basisVersion}）</Typography>
                <Chip size="small" label={selected.id} />
              </Stack>
              <Box sx={{ mt: 1.4, p: 1.3, bgcolor: '#f4f7f5', fontFamily: 'monospace', borderRadius: 1, fontSize: 11 }}>
                <Box>活动数据 = {selected.activity.toLocaleString()} {selected.unit}</Box>
                <Box mt={.6}>排放因子 = {selected.factor} {selected.factorUnit}</Box>
                <Box mt={.6}>换算系数 = {selected.unit === 'kWh' || selected.unit === 'L' ? 0.001 : 1}</Box>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ color: '#14644f', fontWeight: 800 }}>
                  减排量 = {((selected.activity * selected.factor) / (selected.unit === 'kWh' || selected.unit === 'L' ? 1000 : 1)).toFixed(2)} tCO₂e
                </Box>
              </Box>
              <Stack direction="row" spacing={1} mt={1.4}>
                <Button size="small" variant="outlined" startIcon={<AutorenewOutlined />} onClick={() => onRevise(selected)}>修订（新版本+操作号）</Button>
              </Stack>
            </CardContent>
          </Card>
          <LedgerCard title="最近操作流水" limit={6} />
        </Stack>
      </Box>
    </Box>
  );
}

// ---------------- 核验 ----------------

export function VerifyView({ onRevise, onSupplement }: { onRevise: (record: RecordSnapshot) => void; onSupplement: (record: RecordSnapshot) => void }) {
  const basis = useCarbonStore((state) => state.basis)!;
  const role = useCarbonStore((state) => state.role);
  const busy = useCarbonStore((state) => state.busy);
  const sampledIds = useCarbonStore((state) => state.sampledIds);
  const toggleSample = useCarbonStore((state) => state.toggleSample);
  const verify = useCarbonStore((state) => state.verify);
  const findingAction = useCarbonStore((state) => state.findingAction);
  const resolveConflict = useCarbonStore((state) => state.resolveConflict);

  const live = basis.findings.filter((item) => !item.invalidReason && item.status !== '已关闭');
  const invalid = basis.findings.filter((item) => item.invalidReason);
  const openConflicts = basis.conflicts.filter((item) => item.status === '待处理');

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 380px' }, gap: 1.5 }}>
      <Stack spacing={1.5}>
        <Card elevation={0} variant="outlined">
          <Stack sx={{ p: 1.6 }}>
            <Box>
              <Typography fontWeight={800} fontSize={14}>证据矩阵与核验（同一依据）</Typography>
              <Typography fontSize={11} color="text.secondary">
                核验「通过」会绑定当前依据 V{basis.basisVersion}；数据/单位/来源一旦变化，记录回复核中、旧核验结论过期。
              </Typography>
            </Box>
          </Stack>
          <Divider />
          {basis.records.map((record) => {
            const recordFindings = live.filter((item) => item.recordId === record.id);
            const verifiedFresh = record.status === '已核验' && record.verifiedAtBasis === record.basisVersion;
            return (
              <Box key={record.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '22px minmax(220px, 1.3fr) 1.05fr auto' }, alignItems: 'center', gap: 1.2, px: 1.6, py: 1.2, borderTop: '1px solid #edf0ef' }}>
                <input type="checkbox" checked={sampledIds.includes(record.id)} onChange={() => toggleSample(record.id)} aria-label={`抽样 ${record.id}`} />
                <Box>
                  <Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography>
                  <Typography fontSize={10} color="text.secondary">{record.id} · 证据 {record.evidenceCount} 份 · {record.timeRange}</Typography>
                  <Box mt={.6}><RecordVersionTag record={record} /></Box>
                </Box>
                <Box>
                  <Stack direction="row" spacing={.6} mb={.5}>
                    <StatusChip status={record.status} />
                    {verifiedFresh && <Chip size="small" color="success" label="核验版本有效" />}
                    {record.status === '已核验' && record.verifiedAtBasis !== record.basisVersion && (
                      <Chip size="small" color="warning" icon={<WarningAmberOutlined fontSize="small" />} label="旧核验结论，需重新核验" />
                    )}
                  </Stack>
                  {recordFindings.length > 0 && (
                    <Typography fontSize={10.5} color="secondary.main">{recordFindings.map((item) => item.title).join('；')}</Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={.6} flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="outlined" startIcon={<AddLinkOutlined sx={{ fontSize: 15 }} />} onClick={() => onSupplement(record)}>补证</Button>
                  <Button size="small" variant="outlined" onClick={() => onRevise(record)}>修订</Button>
                  <Button
                    size="small" variant="contained"
                    disabled={busy || recordFindings.length > 0 || record.status === '需补证' || verifiedFresh || role === '现场'}
                    onClick={() => verify(record.id)}
                  >
                    核验通过
                  </Button>
                </Stack>
              </Box>
            );
          })}
        </Card>

        {openConflicts.length > 0 && (
          <Card elevation={0} variant="outlined">
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <WarningAmberOutlined color="error" fontSize="small" />
                <Typography fontWeight={800} fontSize={14}>并发修订冲突（先到生效，后到留痕未进依据）</Typography>
              </Stack>
              {openConflicts.map((conflict) => (
                <Box key={conflict.opId} sx={{ borderTop: '1px solid #edf0ef', py: 1.1 }}>
                  <Stack direction="row" spacing={.8} flexWrap="wrap" useFlexGap alignItems="center">
                    <Chip size="small" label={conflict.recordId} />
                    <Typography fontSize={11.5} fontWeight={700}>{conflict.actor} 的后到修订</Typography>
                    <Chip size="small" color="error" variant="outlined" label={`基于 V${conflict.baseVersion}`} />
                    <Typography fontSize={11}>→ 当前已是 V{conflict.currentVersion}</Typography>
                  </Stack>
                  <Typography fontSize={10.5} color="text.secondary" mt={.5}>原因：{conflict.patch.reason}</Typography>
                  <Stack direction="row" spacing={.8} mt={.8}>
                    <Button size="small" disabled={busy || role === '现场'} onClick={() => resolveConflict(conflict.opId, 'rebase')}>基于最新版本重生（再占一个操作号）</Button>
                    <Button size="small" color="inherit" onClick={() => resolveConflict(conflict.opId, 'abandon')}>放弃该修订</Button>
                  </Stack>
                </Box>
              ))}
            </CardContent>
          </Card>
        )}
      </Stack>

      <Stack spacing={1.5}>
        <Card elevation={0} variant="outlined">
          <CardContent>
            <Typography fontWeight={800} fontSize={14} mb={.4}>发现项闭环</Typography>
            <Typography fontSize={10.5} color="text.secondary" mb={1}>生效 {live.length} 项；失效留痕 {invalid.length} 项。现场可发起补证，关闭需核验/复核角色。</Typography>
            {basis.findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} onAction={(mode) => findingAction(finding.id, mode)} />
            ))}
          </CardContent>
        </Card>
        {role === '现场' && (
          <Alert severity="info">当前为现场角色：可以补证，修订与核验会被服务端拒绝。</Alert>
        )}
      </Stack>
    </Box>
  );
}

// ---------------- 签发 ----------------

export function IssuanceView() {
  const basis = useCarbonStore((state) => state.basis)!;
  const role = useCarbonStore((state) => state.role);
  const busy = useCarbonStore((state) => state.busy);
  const recomputeGate = useCarbonStore((state) => state.recomputeGate);
  const confirm = useCarbonStore((state) => state.confirm);
  const release = useCarbonStore((state) => state.release);

  const liveFindings = basis.findings.filter((item) => !item.invalidReason && item.status !== '已关闭');
  const staleGates = basis.gates.filter((gate) => gate.status !== '已通过' || gate.passedAtBasis !== basis.basisVersion);
  const confirmedFresh = basis.confirmation?.basisVersion === basis.basisVersion;
  const canRelease = confirmedFresh && staleGates.length === 0;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 400px' }, gap: 1.5 }}>
      <Stack spacing={1.5}>
        <Card elevation={0} variant="outlined">
          <CardContent>
            <Typography fontWeight={800} fontSize={14}>签发门禁（全部绑定当前依据 V{basis.basisVersion}）</Typography>
            <Typography fontSize={11} color="text.secondary" mt={.3}>
              数据/单位/来源一变，关联门禁按新版本自动重算；复核员在旧版本的确认与人工门禁过期，拿旧结论不能放行。
            </Typography>
            {basis.gates.map((gate) => {
              const fresh = gate.status === '已通过' && gate.passedAtBasis === basis.basisVersion;
              return (
                <Box key={gate.id} sx={{ display: 'flex', gap: 1.3, alignItems: 'flex-start', borderTop: '1px solid #edf0ef', py: 1.4 }}>
                  <GppGoodOutlined color={fresh ? 'success' : gate.status === '待重算' ? 'warning' : 'error'} fontSize="small" style={{ marginTop: 2 }} />
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={.8} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontSize={12.5} fontWeight={750}>{gate.title}</Typography>
                      <Chip size="small" label={gate.auto ? '规则门禁' : '复核门禁'} sx={{ height: 17, fontSize: 9 }} variant="outlined" />
                      <Chip size="small" label={gate.status} color={gateColor(gate.status)} sx={{ height: 18, fontSize: 10 }} />
                      {gate.passedAtBasis !== null && (
                        <Chip size="small" label={`通过@V${gate.passedAtBasis}`} sx={{ height: 17, fontSize: 9 }} color={gate.passedAtBasis === basis.basisVersion ? 'success' : 'warning'} variant="outlined" />
                      )}
                    </Stack>
                    <Typography fontSize={10.5} color="text.secondary" mt={.4}>{gate.detail || gate.staleReason || '尚未判定。'}</Typography>
                    {gate.staleReason && gate.status !== '已通过' && (
                      <Typography fontSize={10.5} color="secondary.main" mt={.3}>{gate.staleReason}</Typography>
                    )}
                  </Box>
                  {gate.auto && gate.status !== '已通过' && (
                    <Button size="small" variant="outlined" disabled={busy || role === '现场'} onClick={() => recomputeGate(gate.id)}>
                      {gate.status === '待重算' ? '按当前依据重算' : '重新判定'}
                    </Button>
                  )}
                </Box>
              );
            })}
          </CardContent>
        </Card>

        <Card elevation={0} variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography fontWeight={800} fontSize={14}>复核确认与签发放行</Typography>
              <Chip size="small" label={role} />
            </Stack>
            <Box sx={{ mt: 1.3, p: 1.4, border: '1px solid', borderColor: confirmedFresh ? 'success.light' : 'divider', borderRadius: 1, bgcolor: confirmedFresh ? '#f1f8f4' : '#fafafa' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
                <Box>
                  <Typography fontSize={12.5} fontWeight={750}>复核员确认</Typography>
                  <Typography fontSize={11} color="text.secondary">
                    {basis.confirmation
                      ? `已确认 V${basis.confirmation.basisVersion}（${basis.confirmation.reviewer}）${confirmedFresh ? '，与当前依据一致' : '，已落后当前依据，确认失效'}`
                      : '尚未确认。确认时绑定依据版本并留存恢复快照。'}
                  </Typography>
                  {liveFindings.length > 0 && <Typography fontSize={10.5} color="secondary.main" mt={.3}>仍有 {liveFindings.length} 个生效发现项，确认会被拒绝。</Typography>}
                </Box>
                <Button
                  size="small"
                  variant={confirmedFresh ? 'outlined' : 'contained'}
                  disabled={busy || role !== '复核员'}
                  onClick={() => confirm(true)}
                  startIcon={<FactCheckOutlined fontSize="small" />}
                >
                  {confirmedFresh ? '重新确认当前版本' : '确认当前依据版本'}
                </Button>
              </Stack>
            </Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} mt={1.3} flexWrap="wrap" useFlexGap>
              <Box>
                <Typography fontSize={12.5} fontWeight={750}>签发放行</Typography>
                <Typography fontSize={11} color="text.secondary">
                  {canRelease ? `全部门禁在 V${basis.basisVersion} 通过且确认版本一致，可以放行。` : `放行被门禁拦截：${staleGates.length > 0 ? `${staleGates.length} 项门禁未在当前版本通过` : ''}${staleGates.length > 0 && !confirmedFresh ? '；' : ''}${!confirmedFresh ? '复核确认缺失或版本过期' : ''}`}
                </Typography>
              </Box>
              <Button
                size="small"
                color={canRelease ? 'success' : 'inherit'}
                variant={canRelease ? 'contained' : 'outlined'}
                disabled={busy || !canRelease || role === '现场'}
                startIcon={<SendOutlined fontSize="small" />}
                onClick={release}
              >
                放行签发
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Stack spacing={1.5}>
        <Card elevation={0} variant="outlined">
          <CardContent>
            <Typography fontWeight={800} fontSize={14} mb={1}>签发就绪度</Typography>
            <LinearProgress
              variant="determinate"
              value={(basis.gates.filter((gate) => fresh(gate, basis.basisVersion)).length / 4) * 70 + (confirmedFresh ? 30 : 0)}
              sx={{ height: 8, borderRadius: 4 }}
            />
            <Typography fontSize={11} color="text.secondary" mt={1}>
              门禁 {(basis.gates.filter((gate) => fresh(gate, basis.basisVersion)).length)}/4 · 复核确认 {confirmedFresh ? '已绑定' : '未绑定'} · 生效发现项 {liveFindings.length}
            </Typography>
          </CardContent>
        </Card>
        <RecoveryCard />
        <LedgerCard title="操作号账本" />
      </Stack>
    </Box>
  );
}

function fresh(gate: Gate, basisVersion: number) {
  return gate.status === '已通过' && gate.passedAtBasis === basisVersion;
}

function RecoveryCard() {
  const basis = useCarbonStore((state) => state.basis)!;
  const recover = useCarbonStore((state) => state.recover);
  const busy = useCarbonStore((state) => state.busy);
  return (
    <Card elevation={0} variant="outlined">
      <CardContent>
        <Typography fontWeight={800} fontSize={14} mb={.6}>写入失败恢复</Typography>
        <Typography fontSize={11} color="text.secondary">
          恢复点：{basis.confirmation ? `复核确认 V${basis.confirmation.basisVersion} 的快照` : '尚无确认版本（需先由复核员确认）'}。
          恢复会回滚确认点之后误记的账；重试携带原操作号，不重复记账。
        </Typography>
        {basis.recoveries.length > 0 && (
          <Box mt={1}>
            {basis.recoveries.slice(-3).reverse().map((item) => (
              <Typography key={item.seq} fontSize={10.5} color="text.secondary">操作号 #{item.seq}：恢复至 V{item.restoredToBasis}</Typography>
            ))}
          </Box>
        )}
        <Button size="small" variant="outlined" sx={{ mt: 1.2 }} disabled={busy || !basis.confirmation} onClick={recover}>
          从最后确认版本恢复
        </Button>
      </CardContent>
    </Card>
  );
}
