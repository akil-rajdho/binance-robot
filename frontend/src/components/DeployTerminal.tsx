'use client';

import { useState, useEffect, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080';

interface Props {
  token: string | null;
  deployToken?: string;
  onActivity?: () => void;
}

export default function DeployTerminal({ token, onActivity }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Poll logs while open
  useEffect(() => {
    if (!open) return;
    const fetchLogs = () => {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      onActivity?.();
      fetch(`${API_URL}/deploy/logs`, { headers })
        .then(r => r.json())
        .then((data: { lines?: string[]; running?: boolean }) => {
          setLines(data.lines ?? []);
          setRunning(data.running ?? false);
        })
        .catch(() => {});
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 2000);
    return () => clearInterval(id);
  }, [open, token, onActivity]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, open]);

  return (
    <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1A2332] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">Deploy Log</span>
          {running && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              running
            </span>
          )}
          {!running && lines.length > 0 && (
            <span className="text-xs text-green-400">
              {lines[lines.length - 1]?.includes('error') ? '✗ failed' : '✓ done'}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-[#4b5563] transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Terminal */}
      {open && (
        <div className="border-t border-[#1E2A3D]">
          <div className="bg-[#0D1421] px-4 py-3 h-64 overflow-y-auto font-mono text-xs leading-relaxed">
            {lines.length === 0 ? (
              <p className="text-[#4b5563]">No deploy output yet. Trigger a deploy to see logs here.</p>
            ) : (
              lines.map((line, i) => (
                <div key={i} className={`whitespace-pre-wrap break-all ${
                  line.includes('error') || line.includes('Error') || line.includes('failed')
                    ? 'text-red-400'
                    : line.startsWith('===')
                    ? 'text-yellow-400 font-bold'
                    : 'text-green-400'
                }`}>
                  {line}
                </div>
              ))
            )}
            {running && (
              <div className="text-yellow-400 animate-pulse mt-1">▋</div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
