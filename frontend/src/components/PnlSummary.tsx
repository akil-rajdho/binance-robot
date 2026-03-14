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
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-700';
}

function pnlBg(value: number): string {
  if (value > 0) return 'bg-green-50 border-green-100';
  if (value < 0) return 'bg-red-50 border-red-100';
  return 'bg-gray-50 border-gray-100';
}

interface StatCardProps {
  label: string;
  value: string;
  valueClass?: string;
  bgClass?: string;
}

function StatCard({ label, value, valueClass = 'text-gray-800', bgClass = 'bg-gray-50 border-gray-100' }: StatCardProps) {
  return (
    <div className={`rounded-md border p-3 flex flex-col gap-1 ${bgClass}`}>
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function PnlSummary({ todayPnl, totalPnl, winRate, tradeCount }: Props) {
  const winCount = Math.round(winRate * tradeCount);
  const winRatePct = (winRate * 100).toFixed(0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-700">P&amp;L Summary</h2>
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
          valueClass={winRate >= 0.5 ? 'text-green-600' : 'text-red-500'}
          bgClass={winRate >= 0.5 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}
        />
        <StatCard
          label="Trades"
          value={`${winCount}/${tradeCount}`}
          valueClass="text-gray-700"
          bgClass="bg-gray-50 border-gray-100"
        />
      </div>
    </div>
  );
}
