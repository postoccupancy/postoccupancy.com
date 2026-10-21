import type { Metadata } from 'next';
import { DocsPage } from '@/layouts/docs/page';
import Content from '@/content/lab/dsp-for-artists.mdx';
import { getPage } from '@/content/site';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { lessons } from '@/lib/dsp-for-artists/course';

const page = getPage('/lab/dsp-for-artists');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return (
    <DocsPage title={page.title} section="Lab">
      <Content />
      <Box component="section" aria-labelledby="course-lessons" sx={{mt:5}}>
        <Typography id="course-lessons" component="h2" variant="h2" sx={{mb:2}}>Workshop lessons</Typography>
        <Box sx={{display:'grid',gap:1.5}}>{lessons.map(lesson=><Box key={lesson.slug} sx={{border:1,borderColor:'divider',borderRadius:1.5,p:2}}><Typography variant="overline">Lesson {lesson.number}</Typography><Typography component="h3" variant="h6">{lesson.title}</Typography><Typography variant="body2" color="text.secondary" sx={{my:1}}>{lesson.summary}</Typography><NextLink href={`/lab/dsp-for-artists/${lesson.slug}`}><Button component="span" size="small">Open lesson</Button></NextLink></Box>)}</Box>
      </Box>
    </DocsPage>
  );
}
