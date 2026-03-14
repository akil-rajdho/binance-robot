'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../src/contexts/AuthContext';
import { useTrading } from '../src/hooks/useTrading';
import PriceTicker from '../src/components/PriceTicker';
import AlgorithmBrain from '../src/components/AlgorithmBrain';
import PnlSummary from '../src/components/PnlSummary';
import ActivePosition from '../src/components/ActivePosition';
import OrderHistory from '../src/components/OrderHistory';
import ReasoningModal from '../src/components/ReasoningModal';
import Settings from '../src/components/Settings';
import DeployTerminal, { API_URL as DEPLOY_API_URL } from '../src/components/DeployTerminal';
import PriceChart from '../src/components/PriceChart';
import AlgorithmReasoning from '../src/components/AlgorithmReasoning';
import { Trade } from '../src/types/trading';

export default function Home() {
  const { token, logout, updateActivity } = useAuth();
  const router = useRouter();
  const [reasoningTrade, setReasoningTrade] = useState<Trade | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployLines, setDeployLines] = useState<string[]>([]);
  const [deployRunning, setDeployRunning] = useState(false);

  const fetchDeployLogs = useCallback(() => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${DEPLOY_API_URL}/deploy/logs`, { headers })
      .then(r => r.json())
      .then((data: { lines?: string[]; running?: boolean }) => {
        setDeployLines(data.lines ?? []);
        setDeployRunning(data.running ?? false);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!deployOpen) return;
    fetchDeployLogs();
    const id = setInterval(fetchDeployLogs, 2000);
    return () => clearInterval(id);
  }, [deployOpen, fetchDeployLogs]);

  const {
    connected,
    currentPrice,
    algoState,
    candles,
    activeTrade,
    trades,
    todayPnl,
    totalPnl,
    winRate,
    startBot,
    stopBot,
    updateSettings,
    refetchTrades,
  } = useTrading(token, updateActivity);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const botEnabled = algoState?.botEnabled ?? false;

  // Determine status badge
  let statusBadge: React.ReactNode;
  if (botEnabled && connected) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-3 py-1 text-sm font-medium text-green-400">
        <span className="text-green-400">●</span> RUNNING
      </span>
    );
  } else if (botEnabled && !connected) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-900/30 px-3 py-1 text-sm font-medium text-yellow-400">
        <span className="text-yellow-400">●</span> PAUSED
      </span>
    );
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-sm font-medium text-gray-400">
        <span className="text-gray-400">●</span> STOPPED
      </span>
    );
  }

  const dailyLossLimitHit = false;

  const high10min = algoState?.high10min ?? 0;
  const conditionMet = algoState?.conditionMet ?? false;
  const nextOrderPrice = algoState?.nextOrderPrice ?? 0;

  return (
    <div className="min-h-screen bg-[#070B14]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#1E2A3D] bg-[#0A0F1C] px-3 py-3 shadow-lg md:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            {/* Short title on mobile, full title on desktop */}
            <span className="text-lg font-bold text-white md:text-xl">
              <span className="md:hidden">₿ BTC Bot</span>
              <span className="hidden md:inline">₿ Bitcoin Robot</span>
            </span>
            {statusBadge}
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* History link — hidden on mobile (use bottom nav) */}
            <Link
              href="/history"
              className="hidden md:inline-flex rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:bg-[#1E2A3D]"
            >
              History
            </Link>
            <button
              onClick={() => {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;
                fetch(`${DEPLOY_API_URL}/deploy/run`, { method: 'POST', headers }).catch(() => {});
                setDeployLines([]);
                setDeployOpen(true);
              }}
              disabled={deployRunning}
              className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:bg-[#1E2A3D] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deployRunning && <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />}
              Deploy
            </button>
            <button
              onClick={() => void startBot()}
              disabled={botEnabled && connected}
              className="min-h-[44px] rounded-full bg-[#1E7CF8] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 md:px-5"
            >
              START
            </button>
            <button
              onClick={() => void stopBot()}
              disabled={!botEnabled}
              className="min-h-[44px] rounded-full border border-[#3d4f63] bg-[#1A2332] px-4 py-2 text-sm font-semibold text-[#94a3b8] transition-all hover:border-red-800/60 hover:bg-red-900/20 hover:text-red-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 md:px-5"
            >
              STOP
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:bg-[#1E2A3D]"
              aria-label="Settings"
            >
              ⚙
            </button>
            <button
              onClick={handleLogout}
              className="min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:border-red-800/60 hover:bg-red-900/20 hover:text-red-400"
              aria-label="Logout"
              title="Logout"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 11l3-3-3-3M13 8H6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Daily loss limit banner */}
      {dailyLossLimitHit && (
        <div className="bg-red-900/30 border border-red-800 px-6 py-2 text-center text-sm font-medium text-red-300">
          ⚠ Daily loss limit reached
        </div>
      )}

      <main className="mx-auto max-w-screen-2xl space-y-4 p-2 pb-20 md:p-6 md:pb-6">
        {/* Row 1: PriceTicker | PnlSummary | AlgorithmBrain */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <PriceTicker
            currentPrice={currentPrice}
            high10min={high10min}
            conditionMet={conditionMet}
            nextOrderPrice={nextOrderPrice}
            botEnabled={botEnabled}
            connected={connected}
          />
          <PnlSummary
            todayPnl={todayPnl}
            totalPnl={totalPnl}
            winRate={winRate}
            tradeCount={trades.length}
          />
          <AlgorithmBrain algoState={algoState} />
        </div>

        {/* Row 2: PriceChart (full width) */}
        <div>
          <PriceChart
            candles={candles}
            high10min={high10min}
            trades={trades}
          />
        </div>

        {/* Row 2b: Algorithm Reasoning */}
        <AlgorithmReasoning token={token} onActivity={updateActivity} />

        {/* Row 3: ActivePosition (1/3) | OrderHistory (2/3) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-1">
            <ActivePosition algoState={algoState} />
          </div>
          <div className="md:col-span-2">
            <OrderHistory
              trades={trades}
              onWhyClick={(trade) => setReasoningTrade(trade)}
            />
          </div>
        </div>

      </main>

      {/* Bottom navigation — mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-[#1E2A3D] bg-[#0A0F1C] py-2 md:hidden">
        <Link
          href="/"
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-4 text-[#1E7CF8]"
        >
          <span className="text-xl">📊</span>
          <span className="text-xs font-medium">Dashboard</span>
        </Link>
        <Link
          href="/history"
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-4 text-[#94a3b8]"
        >
          <span className="text-xl">📜</span>
          <span className="text-xs font-medium">History</span>
        </Link>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-4 text-[#94a3b8]"
        >
          <span className="text-xl">⚙️</span>
          <span className="text-xs font-medium">Settings</span>
        </button>
      </nav>

      {/* Modals / Drawers */}
      <DeployTerminal
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        token={token}
        lines={deployLines}
        running={deployRunning}
      />
      <ReasoningModal
        trade={reasoningTrade}
        onClose={() => setReasoningTrade(null)}
      />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={async (s) => {
          await updateSettings(s);
          await refetchTrades();
        }}
        currentEntryOffset={algoState?.entryOffset}
        token={token}
        onActivity={updateActivity}
      />
    </div>
  );
}
