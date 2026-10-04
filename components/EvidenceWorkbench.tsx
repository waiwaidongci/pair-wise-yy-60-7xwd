'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AccountTreeOutlined,
  AssessmentOutlined,
  DashboardOutlined,
  FindInPageOutlined,
  MenuOutlined,
  NotificationsNoneOutlined
} from '@mui/icons-material';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  LinearProgress,
  Stack,
  Toolbar,
  Typography
} from '@mui/material';
import { useCarbonStore } from '@/lib/store';
import type { RecordSnapshot } from '@/lib/issuance/types';
import { BasisHeader } from './basis/BasisHeader';
import { RevisionDialog, SupplementDialog } from './basis/BasisDialogs';
import { IssuanceView, OverviewView, VerifyView } from './basis/BasisViews';

const drawerWidth = 232;

type View = 'overview' | 'verify' | 'issuance';

const titles: Record<View, { title: string; desc: string }> = {
  overview: { title: '监测期总览', desc: '记录、发现项与门禁共用同一份按版本演进的签发依据。' },
  verify: { title: '证据与抽样核验', desc: '补证与修订同时发生时也只进同一依据：带版本与操作号，先到生效、后到留冲突。' },
  issuance: { title: '签发准备', desc: '复核确认绑定依据版本；数据一变门禁失效重算，旧结论不得放行。' }
};

export default function EvidenceWorkbench({ initialView }: { initialView: View }) {
  const [view] = useState<View>(initialView);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [reviseTarget, setReviseTarget] = useState<RecordSnapshot | null>(null);
  const [supplementTarget, setSupplementTarget] = useState<RecordSnapshot | null>(null);

  const hydrated = useCarbonStore((state) => state.hydrated);
  const hydrate = useCarbonStore((state) => state.hydrate);
  const basis = useCarbonStore((state) => state.basis);
  const meta = useCarbonStore((state) => state.meta);
  const notice = useCarbonStore((state) => state.notice);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const liveFindings = basis?.findings.filter((item) => !item.invalidReason && item.status !== '已关闭') ?? [];

  const nav = [
    { id: 'overview' as const, label: '监测期总览', href: '/', icon: DashboardOutlined },
    { id: 'verify' as const, label: '证据与抽样核验', href: '/verify', icon: FindInPageOutlined },
    { id: 'issuance' as const, label: '签发准备', href: '/issuance', icon: AssessmentOutlined }
  ];

  const navDrawer = (
    <Box sx={{ width: drawerWidth, bgcolor: '#f8faf9', height: '100%' }}>
      <Box sx={{ p: 2.2, pt: 3 }}>
        <Typography variant="overline" color="text.secondary">当前项目</Typography>
        <Typography fontWeight={800} fontSize={13} mt={.5}>{meta?.project.name ?? '临港工业园区能效提升项目'}</Typography>
        <Typography variant="caption" color="text.secondary">{meta?.project.id ?? 'CN-ER-2026-041'}</Typography>
      </Box>
      <Divider />
      <List sx={{ px: 1, py: 1.2 }}>
        {nav.map(({ id, label, href, icon: Icon }) => (
          <ListItemButton key={id} component={Link} href={href} selected={view === id} sx={{ borderRadius: 1, mb: .4, '&.Mui-selected': { bgcolor: '#e4f1ec', color: '#12664f' } }}>
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13, fontWeight: view === id ? 750 : 500 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ p: 2, mt: 2 }}>
        <Box sx={{ p: 1.3, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'white' }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <AccountTreeOutlined color="primary" fontSize="small" />
            <Typography fontSize={12} fontWeight={750}>统一签发依据</Typography>
          </Stack>
          <Typography fontSize={11} color="text.secondary">
            当前 V{basis?.basisVersion ?? 1} · 操作号 #{basis?.opSeq ?? 0}
          </Typography>
          <Typography fontSize={10.5} color="text.secondary" mt={.6}>
            修订/补证 → 发现项与门禁失效重算 → 复核确认绑定版本 → 放行
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: '#173a31', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
        <Toolbar sx={{ minHeight: '62px !important', gap: 1.4 }}>
          <IconButton color="inherit" sx={{ display: { md: 'none' } }} onClick={() => setMobileOpen(true)}><MenuOutlined /></IconButton>
          <Box sx={{ width: 36, height: 36, borderRadius: 1, border: '1px solid #80b6a6', display: 'grid', placeItems: 'center' }}>
            <AccountTreeOutlined fontSize="small" />
          </Box>
          <Box>
            <Typography fontSize={15} fontWeight={800}>碳减排项目核验与签发依据</Typography>
            <Typography fontSize={10} color="#a9c5bc">MRV Evidence · Versioned Issuance Basis</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${liveFindings.length} 项生效发现`} sx={{ color: '#ffdda7', borderColor: '#a87935', bgcolor: 'rgba(255,255,255,.05)' }} variant="outlined" />
          <IconButton color="inherit"><NotificationsNoneOutlined /></IconButton>
          <Avatar sx={{ width: 30, height: 30, bgcolor: '#e1a45d', fontSize: 12 }}>核</Avatar>
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px', boxSizing: 'border-box', borderRightColor: '#dce4e0' } }}>{navDrawer}</Drawer>
      <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px' } }}>{navDrawer}</Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, bgcolor: '#f2f5f3', pt: '62px' }}>
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1640, mx: 'auto' }}>
          <Box mb={1.6}>
            <Typography variant="overline" color="text.secondary" fontWeight={750}>
              {meta?.project.id ?? 'CN-ER-2026-041'} / {meta?.summary.period ?? '第三监测期'} · 依据 V{basis?.basisVersion ?? 1}
            </Typography>
            <Typography variant="h5" fontWeight={850} mt={.3}>{titles[view].title}</Typography>
            <Typography variant="body2" color="text.secondary" mt={.5}>{titles[view].desc}</Typography>
          </Box>

          {!hydrated && <LinearProgress sx={{ mb: 2 }} />}
          {hydrated && basis && (
            <>
              <BasisHeader />
              {view === 'overview' && <OverviewView onRevise={setReviseTarget} />}
              {view === 'verify' && <VerifyView onRevise={setReviseTarget} onSupplement={setSupplementTarget} />}
              {view === 'issuance' && <IssuanceView />}
            </>
          )}
          {hydrated && !basis && (
            <Typography color="text.secondary">依据加载失败，请刷新重试。{notice ? ` ${notice.text}` : ''}</Typography>
          )}
        </Box>
      </Box>

      {reviseTarget && <RevisionDialog record={reviseTarget} onClose={() => setReviseTarget(null)} />}
      {supplementTarget && <SupplementDialog record={supplementTarget} onClose={() => setSupplementTarget(null)} />}
    </Box>
  );
}
