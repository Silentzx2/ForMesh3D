'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WorkspaceShell } from '@/features/workspace/WorkspaceShell';

export default function WorkspacePage() {
  const router = useRouter();

  // Bare /workspace always opens the Generate tool; never show an empty dashboard
  useEffect(() => {
    router.replace('/workspace/generate');
  }, [router]);

  return <WorkspaceShell />;
}
