import { notFound } from 'next/navigation';

export default function Page() {
  // This legacy route is intentionally absent from the current information
  // architecture. Keep its folder until a redirect or replacement is chosen.
  notFound();
}
