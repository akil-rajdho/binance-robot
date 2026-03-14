'use client';

interface Props {
  todayPnl: number;
  totalPnl: number;
  winRate: number; // 0-1
  tradeCount: number;
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlColor(value: number): string {
  if (value > 0) return 'text-green-400';
  if (value < 0) return 'text-red-400';
  return 'text-[#e2e8f0]';
}

function pnlBg(value: number): string {
  if (value > 0) return 'bg-green-900/30 border-green-800';
  if (value < 0) return 'bg-red-900/30 border-red-800';
  return 'bg-[#0D1421] border-[#1E2A3D]';
}

interface StatCardProps {
  label: string;
  value: string;
  valueClass?: string;
  bgClass?: string;
}

function StatCard({ label, value, valueClass = 'text-[#e2e8f0]', bgClass = 'bg-[#0D1421] border-[#1E2A3D]' }: StatCardProps) {
  return (
    <div className={`rounded-md border p-3 flex flex-col gap-1 ${bgClass}`}>
      <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function PnlSummary({ todayPnl, totalPnl, winRate, tradeCount }: Props) {
  const winCount = Math.round(winRate * tradeCount);
  const winRatePct = (winRate * 100).toFixed(0);

  return (
    <div className="rounded-lg border border-[#1E2A3D] bg-[#111827] p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[#e2e8f0]">P&amp;L Summary</h2>
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Today P&L"
          value={formatPnl(todayPnl)}
          valueClass={pnlColor(todayPnl)}
          bgClass={pnlBg(todayPnl)}
        />
        <StatCard
          label="Total P&L"
          value={formatPnl(totalPnl)}
          valueClass={pnlColor(totalPnl)}
          bgClass={pnlBg(totalPnl)}
        />
        <StatCard
          label="Win Rate"
          value={`${winRatePct}%`}
          valueClass={winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}
          bgClass={winRate >= 0.5 ? 'bg-green-900/30 border-green-800' : 'bg-red-900/30 border-red-800'}
        />
        <StatCard
          label="Trades"
          value={`${winCount}/${tradeCount}`}
          valueClass="text-[#e2e8f0]"
          bgClass="bg-[#0D1421] border-[#1E2A3D]"
        />
      </div>
    </div>
  );
}
