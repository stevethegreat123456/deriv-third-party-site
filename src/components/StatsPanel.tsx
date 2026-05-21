import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

export function StatsPanel() {
  const sessionPnL = useStore(state => state.sessionPnL);
  const sessionWins = useStore(state => state.wins);
  const sessionLosses = useStore(state => state.losses);
  
  const [allTimeStats, setAllTimeStats] = useState({
    pnl: 0,
    wins: 0,
    losses: 0,
    totalTrades: 0,
    winRate: 0,
    maxConsecutiveLosses: 0,
    currentConsecutiveLosses: 0,
    loaded: false
  });

  const sessionMaxConsecutiveLosses = useStore(state => state.maxConsecutiveLosses);
  const sessionCurrentConsecutiveLosses = useStore(state => state.currentConsecutiveLosses);
  const saveAndResetSession = useStore(state => state.saveAndResetSession);
  const takeProfit = useStore(state => state.settings.takeProfit);
  const stopLoss = useStore(state => state.settings.stopLoss);

  // Re-fetch all time stats periodically or on new trades
  useEffect(() => {
    const fetchStats = () => {
      fetch('/api/stats/all-time')
        .then(res => res.json())
        .then(data => {
          if (!data.error) {
            setAllTimeStats({
              pnl: data.pnl,
              wins: data.wins,
              losses: data.losses,
              totalTrades: data.totalTrades,
              winRate: data.winRate,
              maxConsecutiveLosses: data.maxConsecutiveLosses,
              currentConsecutiveLosses: data.currentConsecutiveLosses,
              loaded: true
            });
          }
        })
        .catch(console.error);
    };

    fetchStats();
    // Re-fetch every 10 seconds to keep it updated as the bot trades
    const intervalId = setInterval(fetchStats, 10000);
    return () => clearInterval(intervalId);
  }, []);

  const displayPnL = allTimeStats.loaded ? allTimeStats.pnl : sessionPnL;
  const displayWins = allTimeStats.loaded ? allTimeStats.wins : sessionWins;
  const displayLosses = allTimeStats.loaded ? allTimeStats.losses : sessionLosses;
  const displayTotalTrades = allTimeStats.loaded ? allTimeStats.totalTrades : (sessionWins + sessionLosses);
  const displayWinRate = allTimeStats.loaded 
    ? allTimeStats.winRate 
    : (displayTotalTrades === 0 ? 0 : (sessionWins / displayTotalTrades) * 100);

  const displayMaxConsecutiveLosses = allTimeStats.loaded ? allTimeStats.maxConsecutiveLosses : sessionMaxConsecutiveLosses;
  const displayCurrentConsecutiveLosses = allTimeStats.loaded ? allTimeStats.currentConsecutiveLosses : sessionCurrentConsecutiveLosses;

  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">All-Time Performance</div>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Total PnL</div>
          <div className={`mt-1 font-mono text-[18px] font-bold ${displayPnL >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
             {displayPnL >= 0 ? '+' : ''}${displayPnL.toFixed(2)}
          </div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Win Rate</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7]">{displayWinRate.toFixed(1)}%</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Trades</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7]">{displayTotalTrades}</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Wins/Losses</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-[#e4e4e7]"><span className="text-[#00ff9c]">{displayWins}</span> / <span className="text-[#ff4b4b]">{displayLosses}</span></div>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
            <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Max Cons. Losses</div>
            <div className="mt-1 font-mono text-[18px] font-bold text-[#ff4b4b]">{displayMaxConsecutiveLosses}</div>
          </div>
          <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
            <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Cur. Cons. Losses</div>
            <div className="mt-1 font-mono text-[18px] font-bold text-[#ff4b4b]">{displayCurrentConsecutiveLosses}</div>
          </div>
        </div>
      </div>
      
      <div className="mt-auto border border-[#27272a] p-3 rounded text-sm bg-black/20">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#ff4b4b]">Circuit Breakers</div>
        <div className="text-xs mt-2 flex justify-between">
          <span>Take Profit</span><span className="text-[#00ff9c]">${takeProfit.toFixed(2)}</span>
        </div>
        <div className="text-xs mt-1 flex justify-between">
          <span>Stop Loss</span><span className="text-[#ff4b4b]">-${stopLoss.toFixed(2)}</span>
        </div>
      </div>

      <button 
        onClick={saveAndResetSession}
        className="w-full mt-2 py-2 text-[10px] font-mono uppercase tracking-widest text-[#a1a1aa] border border-[#27272a] rounded bg-black/20 hover:bg-[#27272a] hover:text-[#e4e4e7] transition-colors"
      >
        Save & Flush Memory
      </button>
    </div>
  );
}
