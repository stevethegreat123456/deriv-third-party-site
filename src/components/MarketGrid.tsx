import React from 'react';
import { useStore, MarketData } from '../store/useStore';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
      {Object.values(markets).map(market => (
        <MarketCard 
          key={market.symbol} 
          market={market} 
          targetStreak={settings.strategy === 'dual' ? 3 : settings.targetStreak} 
          strategy={settings.strategy}
        />
      ))}
    </div>
  );
}

const MarketCard: React.FC<{ market: MarketData, targetStreak: number, strategy: string }> = ({ market, targetStreak, strategy }) => {
  const isTickActive = strategy === 'dual' ? (market.currentDigit === 4 || market.currentDigit === 5) : (market.currentDigit === 0 || market.currentDigit === 1);

  // Render digit history boxes (last 5)
  // Ensure we show exactly 5 blocks
  const history = [...market.streakHistory];
  while (history.length < 5) history.unshift(-1); // Pad with -1 or empty
  
  return (
    <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div className="font-semibold text-[14px]">{market.name}</div>
        <div className="text-[10px] text-[#00ff9c] flex items-center gap-1">
          <div className="w-1.5 h-1.5 bg-[#00ff9c] rounded-full animate-pulse" /> SCANNING
        </div>
      </div>
      
      <div className="font-mono text-[20px] font-bold">
        {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
      </div>
      
      <div className="flex gap-1 mt-1">
        {history.map((digit, i) => {
          const isHighlight = strategy === 'dual' ? (digit === 4 || digit === 5) : (digit === 0 || digit === 1);
          if (digit === -1) return <div key={i} className="w-6 h-6 flex items-center justify-center font-mono text-[12px] rounded bg-white/5 border border-[#27272a]" />;
          return (
            <div 
              key={i} 
              className={`w-6 h-6 flex items-center justify-center font-mono text-[12px] rounded border ${isHighlight ? 'bg-[#00ff9c]/10 text-[#00ff9c] border-[#00ff9c]' : 'bg-white/5 border-[#27272a]'}`}
            >
              {digit}
            </div>
          );
        })}
      </div>
      
      <div className="flex items-center gap-1.5 mt-1">
        {Array.from({ length: targetStreak }).map((_, i) => (
          <div 
            key={i} 
            className={`w-2.5 h-2.5 rounded-full border ${i < market.streak ? 'bg-[#ff4b4b] border-[#ff4b4b] shadow-[0_0_8px_#ff4b4b]' : 'bg-transparent border-[#27272a]'}`}
          />
        ))}
        <span className={`text-[10px] font-semibold uppercase tracking-wider ml-1 ${market.streak >= targetStreak ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'}`}>
          {market.streak >= targetStreak ? 'EXECUTING...' : `STREAK: ${market.streak}/${targetStreak}`}
        </span>
      </div>
    </div>
  );
}
