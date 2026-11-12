import { redirect } from 'next/navigation';
import { homepage } from '@/content/site';

export default function Page() {
  redirect(homepage);
}
