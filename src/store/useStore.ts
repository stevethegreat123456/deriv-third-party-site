import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MarketData {
  symbol: string;
  name: string;
  currentPrice: number;
  currentDigit: number;
  streak: number;
  streakHistory: number[];
}

export interface Trade {
  id: string;
  timestamp: number;
  market: string;
  contractId: number;
  buyPrice: number;
  result: 'won' | 'lost' | 'pending';
  pnl: number;
  entryTick?: string;
  exitTick?: string;
  entryDigit?: number;
  exitDigit?: number;
}

export interface TradingSession {
  id: string;
  timestamp: number;
  pnl: number;
  wins: number;
  losses: number;
  tradeLog: Trade[];
}

export interface Settings {
  apiToken: string;
  globalStake: number;
  targetStreak: number;
  strategy: 'streak' | 'dual';
  takeProfit: number;
  stopLoss: number;
  useSchedule: boolean;
  startTime: string;
  stopTime: string;
}

interface AppState {
  connectionStatus: 'disconnected' | 'connected';
  setConnectionStatus: (status: 'disconnected' | 'connected') => void;
  balance: number | null;
  setBalance: (balance: number) => void;
  settings: Settings;
  setSettings: (settings: Partial<Settings>) => void;
  isRunning: boolean;
  setIsRunning: (isRunning: boolean) => void;
  markets: Record<string, MarketData>;
  updateMarket: (symbol: string, data: Partial<MarketData>) => void;
  tradeLog: Trade[];
  addTrade: (trade: Trade) => void;
  updateTrade: (id: string, trade: Partial<Trade>) => void;
  sessionPnL: number;
  wins: number;
  losses: number;
  maxConsecutiveLosses: number;
  currentConsecutiveLosses: number;
  digitDistribution: number[];
  incrementDigit: (digit: number) => void;
  pastSessions: TradingSession[];
  saveAndResetSession: () => void;
  deleteSession: (id: string) => void;
  bulkUpdateMarkets: (updates: Record<string, Partial<MarketData>>) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      connectionStatus: 'disconnected',
      setConnectionStatus: (status) => set({ connectionStatus: status }),
      balance: null,
      setBalance: (balance) => set({ balance }),
      settings: {
        apiToken: '',
        globalStake: 1,
        targetStreak: 3,
        strategy: 'streak',
        takeProfit: 10,
        stopLoss: 20,
        useSchedule: false,
        startTime: '08:00',
        stopTime: '17:00'
      },
      setSettings: (newSettings) =>
        set((state) => ({ settings: { ...state.settings, ...newSettings } })),
      isRunning: false,
      setIsRunning: (run) => set({ isRunning: run }),
      markets: {
        'R_10': { symbol: 'R_10', name: 'Volatility 10 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
        'R_25': { symbol: 'R_25', name: 'Volatility 25 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
        'R_50': { symbol: 'R_50', name: 'Volatility 50 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
        'R_75': { symbol: 'R_75', name: 'Volatility 75 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
        'R_100': { symbol: 'R_100', name: 'Volatility 100 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] }
      },
      updateMarket: (symbol, data) =>
        set((state) => ({
          markets: {
            ...state.markets,
            [symbol]: { ...state.markets[symbol], ...data },
          },
        })),
      bulkUpdateMarkets: (updates) => 
        set((state) => {
          const newMarkets = { ...state.markets };
          for (const [symbol, data] of Object.entries(updates)) {
            newMarkets[symbol] = { ...newMarkets[symbol], ...data };
          }
          return { markets: newMarkets };
        }),
      tradeLog: [],
      addTrade: (trade) =>
        set((state) => {
          let newWins = state.wins;
          let newLosses = state.losses;
          let newCurrentConsecutiveLosses = state.currentConsecutiveLosses;
          let newMaxConsecutiveLosses = state.maxConsecutiveLosses;
          
          if (trade.result === 'won') {
              newWins++;
              newCurrentConsecutiveLosses = 0;
          } else if (trade.result === 'lost') {
              newLosses++;
              newCurrentConsecutiveLosses++;
              if (newCurrentConsecutiveLosses > newMaxConsecutiveLosses) {
                  newMaxConsecutiveLosses = newCurrentConsecutiveLosses;
              }
          }

          return {
            tradeLog: [trade, ...state.tradeLog].slice(0, 100),
            sessionPnL: state.sessionPnL + (trade.result === 'won' || trade.result === 'lost' ? trade.pnl : 0),
            wins: newWins,
            losses: newLosses,
            maxConsecutiveLosses: newMaxConsecutiveLosses,
            currentConsecutiveLosses: newCurrentConsecutiveLosses
          };
        }),
      updateTrade: (id, update) => set((state) => {
        const index = state.tradeLog.findIndex(t => t.id === id);
        if (index === -1) return state;
        const newTrades = [...state.tradeLog];
        const oldTrade = newTrades[index];
        const newTrade = { ...oldTrade, ...update };
        newTrades[index] = newTrade;
        
        let newPnL = state.sessionPnL;
        let newWins = state.wins;
        let newLosses = state.losses;
        let newMaxConsecutiveLosses = state.maxConsecutiveLosses;
        let newCurrentConsecutiveLosses = state.currentConsecutiveLosses;
        
        if (oldTrade.result === 'pending' && newTrade.result !== 'pending') {
            newPnL += newTrade.pnl;
            if (newTrade.result === 'won') {
                newWins++;
                newCurrentConsecutiveLosses = 0;
            }
            if (newTrade.result === 'lost') {
                newLosses++;
                newCurrentConsecutiveLosses++;
                if (newCurrentConsecutiveLosses > newMaxConsecutiveLosses) {
                    newMaxConsecutiveLosses = newCurrentConsecutiveLosses;
                }
            }
        }

        return {
            tradeLog: newTrades,
            sessionPnL: newPnL,
            wins: newWins,
            losses: newLosses,
            maxConsecutiveLosses: newMaxConsecutiveLosses,
            currentConsecutiveLosses: newCurrentConsecutiveLosses
        };
      }),
      sessionPnL: 0,
      wins: 0,
      losses: 0,
      maxConsecutiveLosses: 0,
      currentConsecutiveLosses: 0,
      digitDistribution: Array(10).fill(0),
      incrementDigit: (digit) =>
        set((state) => {
          const newDist = [...state.digitDistribution];
          newDist[digit]++;
          return { digitDistribution: newDist };
        }),
      pastSessions: [],
      saveAndResetSession: () => set((state) => {
        if (state.tradeLog.length === 0) {
          return { sessionPnL: 0, wins: 0, losses: 0, maxConsecutiveLosses: 0, currentConsecutiveLosses: 0, digitDistribution: Array(10).fill(0) };
        }
        
        const newSession: TradingSession = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          pnl: state.sessionPnL,
          wins: state.wins,
          losses: state.losses,
          tradeLog: [...state.tradeLog]
        };

        return { 
          pastSessions: [newSession, ...state.pastSessions],
          sessionPnL: 0, 
          wins: 0, 
          losses: 0, 
          maxConsecutiveLosses: 0,
          currentConsecutiveLosses: 0,
          tradeLog: [], 
          digitDistribution: Array(10).fill(0) 
        };
      }),
      deleteSession: (id) => set((state) => ({ pastSessions: state.pastSessions.filter(s => s.id !== id) }))
    }),
    {
      name: 'deriv-bot-storage',
      partialize: (state) => ({ 
        settings: state.settings, 
        pastSessions: state.pastSessions,
        sessionPnL: state.sessionPnL,
        wins: state.wins,
        losses: state.losses,
        maxConsecutiveLosses: state.maxConsecutiveLosses,
        currentConsecutiveLosses: state.currentConsecutiveLosses,
        tradeLog: state.tradeLog,
        digitDistribution: state.digitDistribution
      }),
    }
  )
);
