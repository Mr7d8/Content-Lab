import { redirect } from 'next/navigation';
import { BoardEmpty } from '@/components/board/board-empty';
import { accessSummary } from '@/lib/access';
import { defaultBoardId } from '@/lib/board';
import { createClient } from '@/lib/supabase/server';

// Opens the board with the most ads.
export default async function Boards() {
  const supabase = await createClient();
  const id = await defaultBoardId(supabase);
  if (id) redirect(`/b/${id}`);
  return <BoardEmpty access={await accessSummary(supabase)} />;
}
