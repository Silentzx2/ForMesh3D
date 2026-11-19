'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getApiClient } from '@/services/apiClient';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircle,
  CheckmarkCircle01Icon,
  Clock,
  ExternalLink,
  LoaderCircle,
  ChevronDown,
  Box,
} from '@hugeicons/core-free-icons';

const STATUS_CONFIG = {
  completed: { icon: CheckmarkCircle01Icon, color: 'text-emerald-400', label: 'Completed' },
  generating: { icon: LoaderCircle, color: 'text-primary', label: 'Running' },
  processing: { icon: LoaderCircle, color: 'text-primary', label: 'Running' },
  queued: { icon: Clock, color: 'text-primary', label: 'Queued' },
  failed: { icon: AlertCircle, color: 'text-rose-400', label: 'Failed' },
  cancelled: { icon: AlertCircle, color: 'text-zinc-400', label: 'Cancelled' },
} as const;

interface RecentJob {
  id: string;
  job_id?: string;
  status: string;
  feature?: string;
  model_preference?: string;
  progress?: number;
  created_at?: string;
  error?: string;
}

export function RecentJobsChip() {
  const router = useRouter();
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const client = getApiClient();
      const data = await client.getJobsHistory({ limit: 10 });
      const list = (data.jobs ?? []).map((j: any) => ({
        id: j.job_id || j.id,
        status: j.status,
        feature: j.feature,
        model_preference: j.model_preference,
        progress: j.progress,
        created_at: j.created_at,
        error: j.error,
      }));
      setJobs(list);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const iv = setInterval(loadJobs, 8000);
    return () => clearInterval(iv);
  }, [loadJobs]);

  const running = jobs.filter(
    (j) => j.status === 'processing' || j.status === 'running' || j.status === 'queued'
  ).length;
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  const handleJobClick = (jobId: string) => {
    setOpen(false);
    router.push(`/workspace/jobs/${jobId}`);
  };

  const statusCfg = (status: string) => {
    const key = status === 'processing' ? 'generating' : status;
    return STATUS_CONFIG[key as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.queued;
  };

  return (
    <div className="relative inline-block">
      {/* Chip button */}
      <button
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-1.5 h-6 px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all duration-200"
        aria-label="Recent jobs"
      >
        <HugeiconsIcon icon={Clock} size={12} className="w-3 h-3 text-zinc-400 group-hover:text-primary" />
        <span className="text-[9px] font-semibold text-zinc-300 group-hover:text-white whitespace-nowrap">
          Jobs
        </span>
        {running > 0 && (
          <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_6px_rgba(255,204,102,0.8)] animate-pulse" />
        )}
        <HugeiconsIcon
          icon={ChevronDown}
          size={10}
          className={`w-2.5 h-2.5 text-zinc-500 group-hover:text-primary transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-1.5 w-80 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100 flex flex-col"
        >
          {/* Header bar */}
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={Box} size={14} className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">Recent Jobs</span>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                router.push('/workspace/jobs');
              }}
              className="text-[10px] text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.05] transition-colors"
            >
              All Jobs
            </button>
          </div>

          {/* Summary pills */}
          <div className="px-3 py-2 flex gap-2">
            <span className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${
              running > 0
                ? 'bg-primary/20 text-primary border-primary/30'
                : 'bg-white/[0.03] text-zinc-500 border-white/[0.08]'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${running > 0 ? 'bg-primary animate-pulse' : 'bg-zinc-700'}`} />
              <span>{running} Live</span>
            </span>
            <span className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${
              completed > 0
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-white/[0.03] text-zinc-500 border-white/[0.08]'
            }`}>
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={12} className="w-2.5 h-2.5" />
              <span>{completed} Done</span>
            </span>
            <span className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${
              failed > 0
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                : 'bg-white/[0.03] text-zinc-500 border-white/[0.08]'
            }`}>
              <HugeiconsIcon icon={AlertCircle} size={12} className="w-2.5 h-2.5" />
              <span>{failed} Failed</span>
            </span>
          </div>

          {/* Job list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-center">
                <HugeiconsIcon icon={LoaderCircle} size={14} className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="p-3 text-center text-[10px] text-zinc-500">No recent jobs</div>
            ) : (
              jobs.slice(0, 6).map((job) => {
                const isRun = job.status === 'processing' || job.status === 'running' || job.status === 'queued';
                const isDone = job.status === 'completed';
                const isErr = job.status === 'failed';
                const cfg = statusCfg(job.status);
                const shortId = job.id.slice(0, 8);
                return (
                  <button
                    key={job.id}
                    onClick={() => handleJobClick(job.id)}
                    className="w-full text-left px-3 py-2.5 transition-colors hover:bg-white/[0.04] border-b border-white/[0.03] last:border-0 flex items-center gap-2 group"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full ${
                        isRun ? 'bg-primary animate-pulse' : isDone ? 'bg-emerald-400' : 'bg-rose-400'
                      }`} />
                      <span className="font-mono text-[9px] text-white truncate">{shortId}...</span>
                      <span className={`ml-auto text-[9px] font-bold capitalize ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-[9px] text-zinc-500 truncate">
                      {job.feature || '3D Generation'}
                    </div>
                    {isRun && job.progress !== undefined && (
                      <div className="w-full h-1 mt-1 rounded-full bg-white/[0.08] overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                        />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/[0.06]">
            <button
              onClick={() => {
                setOpen(false);
                router.push(`/workspace/jobs`);
              }}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-semibold border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors text-zinc-300 hover:text-white"
            >
              <HugeiconsIcon icon={ExternalLink} size={12} className="w-2.5 h-2.5" />
              Open Jobs View
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
