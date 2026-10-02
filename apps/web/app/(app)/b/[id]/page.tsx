import { notFound } from 'next/navigation';
import { Board } from '@/components/board/board';
import { loadBoard } from '@/lib/board';
import { createClient } from '@/lib/supabase/server';

export default async function BoardPage(props: PageProps<'/b/[id]'>) {
  const { id } = await props.params;
  const data = await loadBoard(await createClient(), id);
  if (!data) notFound();
  return <Board data={data} />;
}
