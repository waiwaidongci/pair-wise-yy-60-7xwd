'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import type { RecordSnapshot } from '@/lib/issuance/types';
import { useCarbonStore } from '@/lib/store';

export function RevisionDialog({ record, onClose }: { record: RecordSnapshot | null; onClose: () => void }) {
  const revise = useCarbonStore((state) => state.revise);
  const busy = useCarbonStore((state) => state.busy);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState('');
  const [concurrent, setConcurrent] = useState(false);
  const [simulateFail, setSimulateFail] = useState(false);

  useEffect(() => {
    if (record) {
      setValue(String(record.activity));
      setUnit(record.unit);
      setReason('');
      setConcurrent(false);
      setSimulateFail(false);
    }
  }, [record]);

  if (!record) return null;

  const numericValue = Number(value);
  const valueChanged = Number.isFinite(numericValue) && numericValue !== record.activity;
  const unitChanged = unit.trim() !== '' && unit.trim() !== record.unit;
  const canSubmit = reason.trim().length > 0 && (valueChanged || unitChanged);

  const submit = async () => {
    await revise({
      recordId: record.id,
      patch: {
        activity: valueChanged ? numericValue : undefined,
        unit: unitChanged ? unit.trim() : undefined,
        reason: reason.trim(),
        // 两人同时修订：勾选后后到者故意基于加载时看到的旧版本提交
        baseVersion: concurrent ? Math.max(1, record.basisVersion - 1) : record.basisVersion
      },
      simulateWriteFailure: simulateFail
    });
    onClose();
  };

  return (
    <Box>
      <Card sx={{ width: 'min(560px, 100%)' }}>
        <CardContent sx={{ p: 2.4 }}>
          <Typography variant="h6" fontWeight={800}>修订活动数据 / 单位</Typography>
          <Typography variant="body2" color="text.secondary" mt={.6}>
            {record.id} 当前依据 V{record.basisVersion}（修订链 R{record.revision}）。修订带新版本与操作号进入统一签发依据，原始版本保留。
          </Typography>
          <TextField
            fullWidth size="small" sx={{ mt: 2 }}
            label={`修订值 / ${record.unit}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <TextField select fullWidth size="small" sx={{ mt: 1.6 }} label="单位（改单位触发换算链重算）" value={unit} onChange={(event) => setUnit(event.target.value)}>
            {[record.unit, 'kWh', 'MWh', 'GJ', 'L', 'kNm3'].filter((item, index, arr) => arr.indexOf(item) === index).map((item) => (
              <MenuItem key={item} value={item}>{item}</MenuItem>
            ))}
          </TextField>
          <TextField fullWidth size="small" sx={{ mt: 1.6 }} label="修订原因（必填）" multiline rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          <Stack spacing={.4} mt={1.5}>
            <FormControlLabel
              control={<Checkbox size="small" checked={concurrent} onChange={(event) => setConcurrent(event.target.checked)} />}
              label={<Typography fontSize={12}>模拟两人同时修订：后到者基于旧版本 V{Math.max(1, record.basisVersion - 1)} 提交（预期：先到生效，后到留冲突且不进依据）</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={simulateFail} onChange={(event) => setSimulateFail(event.target.checked)} />}
              label={<Typography fontSize={12}>模拟写入超时（账本已落、响应丢失），用于验证原操作号重试不重复记账与按确认版本恢复</Typography>}
            />
          </Stack>
          {!reason.trim() && <Alert severity="warning" sx={{ mt: 1 }}>必须填写修订原因。</Alert>}
          {concurrent && <Alert severity="info" sx={{ mt: 1 }}>该提交将携带过期基准版本，服务端判定为冲突并记一笔「冲突留痕」，修订内容不进依据。</Alert>}
          <Stack direction="row" spacing={1} justifyContent="flex-end" mt={2}>
            <Button onClick={onClose}>取消</Button>
            <Button variant="contained" disabled={!canSubmit || busy} onClick={submit}>提交修订（新版本）</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

export function SupplementDialog({ record, onClose }: { record: RecordSnapshot | null; onClose: () => void }) {
  const supplement = useCarbonStore((state) => state.supplement);
  const busy = useCarbonStore((state) => state.busy);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [simulateFail, setSimulateFail] = useState(false);

  useEffect(() => {
    if (record) {
      setCount(1);
      setNote('');
      setSimulateFail(false);
    }
  }, [record]);

  if (!record) return null;

  return (
    <Box>
      <Card sx={{ width: 'min(520px, 100%)' }}>
        <CardContent sx={{ p: 2.4 }}>
          <Typography variant="h6" fontWeight={800}>发起补证</Typography>
          <Typography variant="body2" color="text.secondary" mt={.6}>
            {record.id} 现有证据 {record.evidenceCount} 份 · 依据 V{record.basisVersion}。补证与修订接同一份依据，提交后前进到 V{record.basisVersion + 1}。
          </Typography>
          <TextField fullWidth size="small" type="number" sx={{ mt: 2 }} label="补充证据份数" value={count} onChange={(event) => setCount(Math.max(1, Number(event.target.value)))} />
          <TextField fullWidth size="small" sx={{ mt: 1.6 }} label="补证说明" multiline rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox size="small" checked={simulateFail} onChange={(event) => setSimulateFail(event.target.checked)} />}
            label={<Typography fontSize={12}>模拟写入超时，验证重试不重复补证</Typography>}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end" mt={2}>
            <Button onClick={onClose}>取消</Button>
            <Button variant="contained" disabled={busy || count < 1} onClick={async () => { await supplement({ recordId: record.id, count, note: note || `补充证据 +${count} 份`, simulateWriteFailure: simulateFail }); onClose(); }}>提交补证</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function Box(props: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,25,22,.4)', display: 'grid', placeItems: 'center', padding: 16 }}>
      {props.children}
    </div>
  );
}
