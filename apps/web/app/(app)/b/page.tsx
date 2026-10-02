import { redirect } from 'next/navigation';
import { BoardEmpty } from '@/components/board/board-empty';
import { defaultBoardId } from '@/lib/board';
import { createClient } from '@/lib/supabase/server';

// Opens the board with the most ads.
export default async function Boards() {
  const id = await defaultBoardId(await createClient());
  if (id) redirect(`/b/${id}`);
  return <BoardEmpty />;
}
