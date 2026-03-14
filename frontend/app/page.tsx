'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTrading } from '../src/hooks/useTrading';
import PriceTicker from '../src/components/PriceTicker';
import AlgorithmBrain from '../src/components/AlgorithmBrain';
import PnlSummary from '../src/components/PnlSummary';
import ActivePosition from '../src/components/ActivePosition';
import OrderHistory from '../src/components/OrderHistory';
import ReasoningModal from '../src/components/ReasoningModal';
import Settings from '../src/components/Settings';
import PriceChart from '../src/components/PriceChart';
import AlgorithmReasoning from '../src/components/AlgorithmReasoning';
import { Trade } from '../src/types/trading';

export default function Home() {
  const [reasoningTrade, setReasoningTrade] = useState<Trade | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  } = useTrading();

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

  // Parse daily loss limit from algoState (not directly available, but check if algoState signals it)
  // AlgoState does not have a dailyLossLimitHit field; this would need to be inferred or added later.
  // For now we treat it as false unless a future field is added.
  const dailyLossLimitHit = false;

  const high10min = algoState?.high10min ?? 0;
  const conditionMet = algoState?.conditionMet ?? false;
  const nextOrderPrice = algoState?.nextOrderPrice ?? 0;

  return (
    <div className="min-h-screen bg-[#070B14]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#1E2A3D] bg-[#0A0F1C] px-6 py-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-white">₿ Bitcoin Robot</span>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/history"
              className="rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:bg-[#1E2A3D]"
            >
              History
            </Link>
            <button
              onClick={() => void startBot()}
              disabled={botEnabled && connected}
              className="rounded-full bg-[#1E7CF8] px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            >
              START
            </button>
            <button
              onClick={() => void stopBot()}
              disabled={!botEnabled}
              className="rounded-full border border-[#3d4f63] bg-[#1A2332] px-5 py-2 text-sm font-semibold text-[#94a3b8] transition-all hover:border-red-800/60 hover:bg-red-900/20 hover:text-red-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            >
              STOP
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:bg-[#1E2A3D]"
              aria-label="Settings"
            >
              ⚙
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

      <main className="mx-auto max-w-screen-2xl space-y-4 p-6">
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
        <AlgorithmReasoning />

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

      {/* Modals / Drawers */}
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
      />
    </div>
  );
}
