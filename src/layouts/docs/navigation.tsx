'use client';

import { useId, useState } from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { groups, type NavigationGroup, type SitePage } from '@/content/site';

function PageLink({ page, pathname, onNavigate }: {
  page: SitePage;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = pathname === page.href;
  const descendantActive = page.children?.some((child) => child.href === pathname) ?? false;
  const [childrenOpen, setChildrenOpen] = useState(active || descendantActive);
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <Box sx={{display:'flex',alignItems:'center'}}><ListItemButton component={NextLink} href={page.href} onClick={onNavigate} selected={active} aria-current={active ? 'page' : undefined} sx={{borderRadius:1,minHeight:36,py:.75,px:1.5,pl:2.75,fontSize:13,lineHeight:1.6,fontWeight:active?600:400,color:active?'primary.main':'text.secondary','&.Mui-selected':{bgcolor:'rgba(54, 91, 76, 0.07)'},'&.Mui-selected:hover':{bgcolor:'rgba(54, 91, 76, 0.11)'}}}>{page.title}</ListItemButton>{page.children&&<ListItemButton component="button" aria-label={`${childrenOpen?'Collapse':'Expand'} ${page.title}`} aria-expanded={childrenOpen} onClick={()=>setChildrenOpen(value=>!value)} sx={{minWidth:34,maxWidth:34,p:.5,borderRadius:1}}>{childrenOpen?<ExpandMore sx={{fontSize:17}}/>:<ChevronRight sx={{fontSize:17}}/>}</ListItemButton>}</Box>
      {page.children&&<Collapse in={childrenOpen||descendantActive} timeout={0}><List disablePadding>{page.children.map(child=><Box component="li" key={child.href} sx={{listStyle:'none'}}><ListItemButton component={NextLink} href={child.href} onClick={onNavigate} selected={pathname===child.href} aria-current={pathname===child.href?'page':undefined} sx={{pl:4.5,py:.6,minHeight:32,fontSize:12.5,color:pathname===child.href?'primary.main':'text.secondary'}}>{child.title}</ListItemButton></Box>)}</List></Collapse>}
    </Box>
  );
}

function Section({ group, pathname, onNavigate }: {
  group: NavigationGroup;
  pathname: string;
  onNavigate: () => void;
}) {
  const id = useId();
  const [state, setState] = useState({ pathname, open: true });
  // Reveal the active section when arriving via history or an in-content link.
  if (state.pathname !== pathname) {
    setState({ pathname, open: group.items.some((page) => page.href === pathname || page.children?.some((child) => child.href === pathname)) || state.open });
  }

  return (
    <Box component="li" sx={{ listStyle: 'none', mt: 1.75 }}>
      <ListItemButton
        component="button"
        type="button"
        aria-expanded={state.open}
        aria-controls={id}
        onClick={() => setState({ pathname, open: !state.open })}
        sx={{ width: '100%', borderRadius: 1, px: 1.5, py: 0.75, gap: 1, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'text.primary' }}
      >
        <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>{group.title}</Box>
        {state.open ? <ExpandMore sx={{ fontSize: 17, color: 'text.secondary' }} /> : <ChevronRight sx={{ fontSize: 17, color: 'text.secondary' }} />}
      </ListItemButton>
      <Collapse in={state.open} timeout={0}>
        <List id={id} disablePadding>
          {group.items.map((page) => <PageLink key={page.href} page={page} pathname={pathname} onNavigate={onNavigate} />)}
        </List>
      </Collapse>
    </Box>
  );
}

export function DocsNavigation({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <Box component="nav" aria-label="Main navigation" sx={{ px: 1.5, pb: 3 }}>
      <List disablePadding>
        {groups.map((group) => <Section key={group.id} group={group} pathname={pathname} onNavigate={onNavigate} />)}
      </List>
    </Box>
  );
}
