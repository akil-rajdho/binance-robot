'use client';

import { useState } from 'react';
import { useTrading } from '../src/hooks/useTrading';
import PriceTicker from '../src/components/PriceTicker';
import AlgorithmBrain from '../src/components/AlgorithmBrain';
import PnlSummary from '../src/components/PnlSummary';
import ActivePosition from '../src/components/ActivePosition';
import OrderHistory from '../src/components/OrderHistory';
import ReasoningModal from '../src/components/ReasoningModal';
import Settings from '../src/components/Settings';
import PriceChart from '../src/components/PriceChart';
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
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
        <span className="text-green-500">●</span> RUNNING
      </span>
    );
  } else if (botEnabled && !connected) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
        <span className="text-orange-500">●</span> PAUSED
      </span>
    );
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-gray-900">₿ Bitcoin Robot</span>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void startBot()}
              disabled={botEnabled && connected}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              START
            </button>
            <button
              onClick={() => void stopBot()}
              disabled={!botEnabled}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              STOP
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              aria-label="Settings"
            >
              ⚙
            </button>
          </div>
        </div>
      </header>

      {/* Daily loss limit banner */}
      {dailyLossLimitHit && (
        <div className="bg-red-600 px-6 py-2 text-center text-sm font-medium text-white">
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
      />
    </div>
  );
}
