import { Server } from "socket.io";
import WebSocket from "ws";
import { getDb } from "./firebaseAdmin.ts";

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const HISTORY_SIZE = 5;

interface MarketState {
  symbol: string;
  price: number;
  digit: number;
  streak: number;
  history: Int8Array;
  historyIndex: number;
  precompiledPrefix: string;
  precompiledSuffix: string;
}

const markets = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const marketStates: Record<string, MarketState> = {};

markets.forEach(symbol => {
  marketStates[symbol] = {
    symbol,
    price: 0,
    digit: 0,
    streak: 0,
    history: new Int8Array(HISTORY_SIZE).fill(-1),
    historyIndex: 0,
    precompiledPrefix: `{"buy":1,"price":`,
    precompiledSuffix: `,"basis":"stake","contract_type":"DIGITOVER","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"1"},"req_id":`
  };
});

let ws: WebSocket | null = null;
let isRunning = false;
let currentSettings: any = null;

let globalCurrentStake = 1;
let isTradeActive = false;
let sessionPnL = 0;
let lastLostSymbol: string | null = null;
let cumulativeLoss = 0;
let stopScheduledAndWaitingForRecovery = false;
let deadlockTimeoutId: any = null;
let lastTradeAttemptTime = 0; // Added to prevent concurrent signal processing

let expectedCallbacks = 0;
let batchPnL = 0;
let batchSymbol: string | null = null;

let pendingUpdates: Record<string, any> = {};
let batchTimeout: any = null;

let pendingContracts: Record<number, { customId: string, symbol: string }> = {}; 
let reqIdToSymbol: Record<number, string> = {};
let pingInterval: any = null;
let reqIdCounter = Math.floor(Date.now() / 1000);

let ioServer: Server | null = null;

async function saveSettings(settings: any) {
  try {
    const db = getDb();
    if (!db) return;
    await db.collection("bot_data").doc("settings").set({ ...settings, updatedAt: new Date() });
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

async function saveState() {
  try {
    const db = getDb();
    if (!db) return;
    await db.collection("bot_data").doc("state").set({
      isRunning,
      globalCurrentStake,
      sessionPnL,
      cumulativeLoss,
      lastLostSymbol: lastLostSymbol || null,
      updatedAt: new Date()
    }, { merge: true });
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

function postMessage(event: any) {
  if (ioServer) {
    ioServer.emit('bot_event', event);
  }
}

let lastCheckedMinute: string | null = null;
const scheduleInterval = setInterval(() => {
  if (!currentSettings || !currentSettings.useSchedule) return;

  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const current = `${hh}:${mm}`;

  if (lastCheckedMinute !== current) {
    lastCheckedMinute = current;

    if (currentSettings.startTime && current === currentSettings.startTime) {
      if (!isRunning) {
        isRunning = true;
        globalCurrentStake = currentSettings.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        lastLostSymbol = null;
        markets.forEach(m => { marketStates[m].streak = 0; });
        connect();
        postMessage({ type: 'SCHEDULE_START' });
      }
    }

    if (currentSettings.stopTime && current === currentSettings.stopTime) {
      if (isRunning) {
        if (cumulativeLoss > 0) {
          stopScheduledAndWaitingForRecovery = true;
        } else {
          isRunning = false;
          markets.forEach(m => { marketStates[m].streak = 0; });
          postMessage({ type: 'SCHEDULE_STOP' });
        }
      }
    }
  }
}, 1000);

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('{"ping":1}');
      }
    }, 10000);

    if (currentSettings?.apiToken) {
      ws.send(JSON.stringify({ authorize: currentSettings.apiToken }));
    } else {
      postMessage({ type: 'STATUS', status: 'connected' });
      subscribeToTicks();
    }
  });

  ws.on('message', (messageBuffer) => {
    const data = JSON.parse(messageBuffer.toString());

    if (data.error) {
      postMessage({ type: 'ERROR', message: data.error.message });
      if (data.echo_req && data.echo_req.req_id) {
         const reqId = data.echo_req.req_id;
         if (reqIdToSymbol[reqId]) {
           delete reqIdToSymbol[reqId];
           isTradeActive = false;
           if (deadlockTimeoutId) {
             clearTimeout(deadlockTimeoutId);
             deadlockTimeoutId = null;
           }
         }
      }
      return;
    }

    if (data.msg_type === 'authorize') {
      postMessage({ type: 'STATUS', status: 'connected' });
      ws?.send('{"balance":1,"subscribe":1}');
      subscribeToTicks();
      ws?.send('{"proposal_open_contract":1,"subscribe":1}');
    }

    if (data.msg_type === 'balance') {
      postMessage({ type: 'BALANCE', balance: data.balance.balance });
    }

    if (data.msg_type === 'tick') {
      handleTick(data.tick);
    }

    if (data.msg_type === 'buy') {
      handleBuy(data.buy, data.echo_req);
    }

    if (data.msg_type === 'proposal_open_contract') {
      handleContractUpdate(data.proposal_open_contract);
    }

    if (data.msg_type === 'topup_virtual') {
      ws?.send('{"balance":1}');
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    postMessage({ type: 'STATUS', status: 'disconnected' });
    if (isRunning) {
      setTimeout(connect, 2000);
    }
  });
}

function subscribeToTicks() {
  markets.forEach(symbol => {
    ws?.send(JSON.stringify({ ticks: symbol }));
  });
}

function handleTick(tickInfo: any) {
  const symbol = tickInfo.symbol;
  const state = marketStates[symbol];
  if (!state) return;

  const price = tickInfo.quote;
  const pipSize = tickInfo.pip_size || 4;
  const digit = Math.round(price * Math.pow(10, pipSize)) % 10;

  state.price = price;
  state.digit = digit;

  postMessage({ type: 'DIGIT_STAT', digit });

  const prevDigit = state.history[(state.historyIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE];
  const prevPrevDigit = state.history[(state.historyIndex - 2 + HISTORY_SIZE) % HISTORY_SIZE];

  if (currentSettings && currentSettings.strategy === 'dual') {
    if (digit === 4 || digit === 5) {
      if ((prevDigit === 4 || prevDigit === 5) && (prevPrevDigit === 4 || prevPrevDigit === 5)) {
        state.streak = 3;
      } else if (prevDigit === 4 || prevDigit === 5) {
        state.streak = 2;
      } else {
        state.streak = 1;
      }
    } else {
      state.streak = 0;
    }
  } else {
    if (digit === 0 || digit === 1) {
      state.streak += 1;
    } else {
      state.streak = 0;
    }
  }

  state.history[state.historyIndex] = digit;
  state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;

  queueUpdate(symbol, state);

  if (isRunning && currentSettings) {
    const now = Date.now();
    if (!isTradeActive && (now - lastTradeAttemptTime > 1000)) {
      if (currentSettings.strategy === 'dual') {
        if (prevPrevDigit !== -1 && prevDigit !== -1) {
          const combined = `${prevPrevDigit}${prevDigit}${digit}`;
          if (['444', '445', '454', '455', '544', '545', '554', '555'].includes(combined)) {
            isTradeActive = true;
            lastTradeAttemptTime = now;
            executeDualTrade(symbol);
          }
        }
      } else {
        if (state.streak === currentSettings.targetStreak) {
          state.streak = 0;
          if (lastLostSymbol === symbol && globalCurrentStake > currentSettings.globalStake) {
            return;
          }
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeBuy(symbol);
        }
      }
    }
  }
}

function queueUpdate(symbol: string, state: MarketState) {
  const unwrappedHistory = new Array(HISTORY_SIZE);
  for (let i = 0; i < HISTORY_SIZE; i++) {
    unwrappedHistory[i] = state.history[(state.historyIndex + i) % HISTORY_SIZE];
  }

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    currentDigit: state.digit,
    streak: state.streak,
    streakHistory: unwrappedHistory
  };

  if (!batchTimeout) {
    batchTimeout = setTimeout(() => {
      postMessage({ type: 'MARKET_UPDATES', updates: pendingUpdates });
      pendingUpdates = {};
      batchTimeout = null;
    }, 250);
  }
}

function executeBuy(symbol: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  const state = marketStates[symbol];
  const stake = globalCurrentStake;

  expectedCallbacks = 1;
  batchPnL = 0;
  batchSymbol = symbol;
  
  reqIdToSymbol[reqId] = symbol;

  const rawPayloadString = `${state.precompiledPrefix}${stake},"parameters":{"amount":${stake}${state.precompiledSuffix}${reqId}}`;
  
  ws.send(rawPayloadString);

  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  deadlockTimeoutId = setTimeout(() => {
    if (!isTradeActive) return;
    
    const customId = reqId.toString();
    const pnl = -stake;
    
    postMessage({
      type: 'TRADE_RESULT',
      id: customId,
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });

    cumulativeLoss += Math.abs(pnl);
    
    const safeYield = currentSettings?.strategy === 'dual' ? 0.41 : 0.21;
    const targetProfit = currentSettings.globalStake * safeYield;
    const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
    globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;

    lastLostSymbol = symbol;
    isTradeActive = false;
    sessionPnL += pnl;
    
    if (currentSettings && isRunning) {
      if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      }
    }
  }, 10000);
}

function executeDualTrade(symbol: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId1 = reqIdCounter++;
  const reqId2 = reqIdCounter++;
  const stake = globalCurrentStake;

  expectedCallbacks = 2;
  batchPnL = 0;
  batchSymbol = symbol;

  reqIdToSymbol[reqId1] = symbol;
  reqIdToSymbol[reqId2] = symbol;

  const payload1 = `{"buy":1,"price":${stake},"parameters":{"amount":${stake},"basis":"stake","contract_type":"DIGITUNDER","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"4"},"req_id":${reqId1}}`;
  const payload2 = `{"buy":1,"price":${stake},"parameters":{"amount":${stake},"basis":"stake","contract_type":"DIGITOVER","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"5"},"req_id":${reqId2}}`;

  ws.send(payload1);
  ws.send(payload2);

  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId1.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0,
    }
  });

  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId2.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0,
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  deadlockTimeoutId = setTimeout(() => {
    if (!isTradeActive) return;
    
    // Simplistic handling for timeout in a batch
    // We just reset everything so it can continue
    isTradeActive = false;
    expectedCallbacks = 0;
    batchPnL = 0;
    
    postMessage({
      type: 'TRADE_RESULT',
      id: reqId1.toString(),
      result: 'lost',
      pnl: 0,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });
    postMessage({
      type: 'TRADE_RESULT',
      id: reqId2.toString(),
      result: 'lost',
      pnl: 0,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });
  }, 10000);
}

function handleBuy(buyInfo: any, echo_req: any) {
  const contractId = buyInfo.contract_id;
  const reqId = echo_req.req_id;
  if (reqId) {
    const symbol = reqIdToSymbol[reqId];
    if (symbol) {
      pendingContracts[contractId] = { customId: reqId.toString(), symbol };
      delete reqIdToSymbol[reqId];
    }
  }
}

function handleContractUpdate(contract: any) {
  if (!contract.is_expired && !contract.is_sold) return;

  const pending = pendingContracts[contract.contract_id];
  if (!pending) return;

  const { customId, symbol } = pending;
  const pnl = Number(contract.profit) || 0;
  const isWin = pnl > 0;

  const entryTickStr = contract.entry_tick_display_value || String(contract.entry_tick || '');
  const exitTickStr = contract.exit_tick_display_value || String(contract.exit_tick || '');
  const entryDigit = entryTickStr ? parseInt(entryTickStr.slice(-1), 10) : undefined;
  const exitDigit = exitTickStr ? parseInt(exitTickStr.slice(-1), 10) : undefined;

  postMessage({
    type: 'TRADE_RESULT',
    id: customId,
    result: isWin ? 'won' : 'lost',
    pnl: pnl,
    entryTick: entryTickStr,
    exitTick: exitTickStr,
    entryDigit,
    exitDigit
  });

  delete pendingContracts[contract.contract_id];
  sessionPnL += pnl;
  batchPnL += pnl;
  expectedCallbacks -= 1;

  if (expectedCallbacks <= 0) {
    if (deadlockTimeoutId) {
      clearTimeout(deadlockTimeoutId);
      deadlockTimeoutId = null;
    }
  
    const batchWin = batchPnL > 0;

    if (batchWin) {
      globalCurrentStake = currentSettings.globalStake;
      cumulativeLoss = 0;
      lastLostSymbol = null;
      
      if (stopScheduledAndWaitingForRecovery) {
        isRunning = false;
        stopScheduledAndWaitingForRecovery = false;
        markets.forEach(m => { marketStates[m].streak = 0; });
        postMessage({ type: 'SCHEDULE_STOP' });
      }
    } else {
      cumulativeLoss += Math.abs(batchPnL);
      
      const safeYield = currentSettings?.strategy === 'dual' ? 0.41 : 0.21;
      const targetProfit = currentSettings.globalStake * safeYield;
      const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
      globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;

      lastLostSymbol = symbol;
    }

    isTradeActive = false;
    expectedCallbacks = 0;
    batchPnL = 0;
    batchSymbol = null;

    if (currentSettings && isRunning) {
      if (sessionPnL >= currentSettings.takeProfit) {
        isRunning = false;
        isTradeActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Take Profit Hit!' });
      } else if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        isTradeActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      }
    }
    
    saveState();
  }
}

export async function initBot() {
  try {
    const db = getDb();
    if (!db) return;
    
    const settingsDoc = await db.collection("bot_data").doc("settings").get();
    if (settingsDoc.exists) {
      currentSettings = settingsDoc.data();
    }
    
    const stateDoc = await db.collection("bot_data").doc("state").get();
    if (stateDoc.exists) {
      const state = stateDoc.data();
      isRunning = state?.isRunning || false;
      globalCurrentStake = state?.globalCurrentStake || 1;
      sessionPnL = state?.sessionPnL || 0;
      cumulativeLoss = state?.cumulativeLoss || 0;
      lastLostSymbol = state?.lastLostSymbol || null;
      
      // Auto resume
      if (isRunning && currentSettings) {
        connect();
      }
    }
  } catch (err) {
    console.error('Error loading DB state:', err);
  }
}

export function startBotEngine(io: Server) {
  ioServer = io;

  io.on('connection', (socket) => {
    const isReady = ws && ws.readyState === WebSocket.OPEN;
    // Send immediate sync data to newly connected client
    socket.emit('bot_sync', {
        isRunning,
        currentSettings,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        isTradeActive,
        connectionStatus: isReady ? 'connected' : 'disconnected'
    });

    socket.on('worker_command', (data: any) => {
      if (data.type === 'UPDATE_SETTINGS') {
        const isNewToken = currentSettings?.apiToken !== data.settings?.apiToken;
        currentSettings = data.settings;
        
        saveSettings(currentSettings);

        // Also broadcast settings to other clients
        socket.broadcast.emit('bot_sync', { currentSettings });

        if (isNewToken && ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (!ws || ws.readyState !== WebSocket.OPEN) {
          connect();
        }
      }

      if (data.type === 'START') {
        currentSettings = data.settings;
        saveSettings(currentSettings);
        
        globalCurrentStake = currentSettings?.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        lastLostSymbol = null;
        sessionPnL = data.sessionPnL || 0;

        markets.forEach(m => { 
          marketStates[m].streak = 0;
        });

        isRunning = true;
        saveState();

        connect();
        io.emit('bot_sync', { isRunning: true }); // Notify all
      }

      if (data.type === 'STOP') {
        isRunning = false;
        isTradeActive = false;
        stopScheduledAndWaitingForRecovery = false;
        markets.forEach(m => { 
          marketStates[m].streak = 0;
        });
        saveState();
        
        io.emit('bot_sync', { isRunning: false }); // Notify all
      }

      if (data.type === 'TOPUP') {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send('{"topup_virtual":1}');
        }
      }
    });
  });
}
