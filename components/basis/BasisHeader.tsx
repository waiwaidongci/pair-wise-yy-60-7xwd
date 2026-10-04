'use client';

import { Alert, Button, Chip, MenuItem, Select, Stack, Typography } from '@mui/material';
import { HistoryOutlined, RestartAltOutlined } from '@mui/icons-material';
import type { Role } from '@/lib/issuance/types';
import { useCarbonStore } from '@/lib/store';

const roles: Role[] = ['现场', '核验员', '复核员'];

const roleColor: Record<Role, string> = {
  现场: '#9a6b1f',
  核验员: '#12664f',
  复核员: '#34508a'
};

export function BasisHeader() {
  const basis = useCarbonStore((state) => state.basis);
  const role = useCarbonStore((state) => state.role);
  const actor = useCarbonStore((state) => state.actor);
  const setRole = useCarbonStore((state) => state.setRole);
  const notice = useCarbonStore((state) => state.notice);
  const clearNotice = useCarbonStore((state) => state.clearNotice);
  const busy = useCarbonStore((state) => state.busy);
  const pendingWrite = useCarbonStore((state) => state.pendingWrite);
  const retryPending = useCarbonStore((state) => state.retryPending);
  const recover = useCarbonStore((state) => state.recover);
  const resetAll = useCarbonStore((state) => state.resetAll);

  const openConflicts = basis?.conflicts.filter((item) => item.status === '待处理') ?? [];
  const confirmation = basis?.confirmation ?? null;

  return (
    <Stack spacing={1.2} mb={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.5}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`签发依据 V${basis?.basisVersion ?? 1}`} sx={{ bgcolor: '#12664f', color: 'white', fontWeight: 800 }} />
          <Chip size="small" label={`操作号 #${basis?.opSeq ?? 0}`} variant="outlined" />
          <Chip
            size="small"
            icon={<HistoryOutlined style={{ fontSize: 14 }} />}
            label={confirmation ? `复核确认 @ V${confirmation.basisVersion}` : '复核未确认'}
            variant={confirmation ? 'filled' : 'outlined'}
            color={confirmation ? 'success' : 'warning'}
          />
          {openConflicts.length > 0 && (
            <Chip size="small" color="error" label={`${openConflicts.length} 个并发冲突待处理（未进依据）`} />
          )}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Select size="small" value={role} onChange={(event) => setRole(event.target.value as Role)} sx={{ fontSize: 12, '.MuiSelect-select': { py: .6 } }}>
            {roles.map((item) => (
              <MenuItem key={item} value={item} sx={{ fontSize: 12 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: roleColor[item], marginRight: 8 }} />
                {item}
              </MenuItem>
            ))}
          </Select>
          <Typography fontSize={11.5} color="text.secondary" sx={{ display: { xs: 'none', lg: 'block' } }}>{actor}</Typography>
          <Button size="small" variant="outlined" startIcon={<RestartAltOutlined />} onClick={resetAll} disabled={busy}>重置演示</Button>
        </Stack>
      </Stack>

      {notice && (
        <Alert
          severity={notice.severity}
          onClose={clearNotice}
          sx={{ '& .MuiAlert-message': { fontSize: 12.5 } }}
        >
          {notice.text}
        </Alert>
      )}

      {pendingWrite && (
        <Alert
          severity="warning"
          variant="filled"
          sx={{ '& .MuiAlert-message': { fontSize: 12.5, width: '1' } }}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" color="inherit" variant="outlined" disabled={busy} onClick={retryPending}>
                原操作号重试（不重复记账）
              </Button>
              <Button size="small" color="inherit" onClick={recover}>
                从最后确认版本恢复
              </Button>
            </Stack>
          }
        >
          「{pendingWrite.label}」写入结果未知（操作号 {pendingWrite.opId}）。
          可原样重试——服务端识别同一操作号只回放首次结果；或回滚到最后复核确认版本。
        </Alert>
      )}
    </Stack>
  );
}
