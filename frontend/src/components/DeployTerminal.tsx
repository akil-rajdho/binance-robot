'use client';

import { useEffect, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | null;
  lines: string[];
  running: boolean;
}

export default function DeployTerminal({ open, onClose, token: _token, lines, running }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const hasError = lines.some(l =>
    l.toLowerCase().includes('error') ||
    l.toLowerCase().includes('failed') ||
    l.toLowerCase().includes('fatal')
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-xl border border-[#1E2A3D] bg-[#0D1421] shadow-2xl flex flex-col max-h-[80vh]">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1E2A3D] px-5 py-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">Deploy Log</h2>
              {running && (
                <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  deploying…
                </span>
              )}
              {!running && lines.length > 0 && (
                <span className={`text-xs font-medium ${hasError ? 'text-red-400' : 'text-green-400'}`}>
                  {hasError ? '✗ failed' : '✓ complete'}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-[#94a3b8] hover:bg-[#1A2332] hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 2l12 12M14 2L2 14" />
              </svg>
            </button>
          </div>

          {/* Terminal output */}
          <div className="flex-1 overflow-y-auto px-5 py-4 font-mono text-xs leading-relaxed">
            {lines.length === 0 ? (
              <p className="text-[#4b5563]">
                {running ? 'Starting deploy…' : 'No deploy output yet.'}
              </p>
            ) : (
              lines.map((line, i) => {
                const isError =
                  line.toLowerCase().includes('error') ||
                  line.toLowerCase().includes('failed') ||
                  line.toLowerCase().includes('fatal');
                const isHeader = line.startsWith('===');
                return (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all mb-0.5 ${
                      isError ? 'text-red-400' : isHeader ? 'text-yellow-300 font-bold mt-2' : 'text-green-400'
                    }`}
                  >
                    {line}
                  </div>
                );
              })
            )}
            {running && <span className="text-yellow-400 animate-pulse">▋</span>}
            <div ref={bottomRef} />
          </div>

        </div>
      </div>
    </>
  );
}

export { API_URL };
