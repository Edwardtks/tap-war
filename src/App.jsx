import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// --- PRODUCTION CONFIGURATION ---
// These keys are pulled from your .env file
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Initialize Supabase (Only declared once now)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Tap War - Production Build (SECURED)
 * Features:
 * - Real Supabase Backend
 * - WebSocket Broadcasting
 * - SECURED HOST VIEW (Requires ?mode=host in URL)
 */

// --- 1. Game Context ---

const GameContext = createContext();

const GameProvider = ({ children }) => {
  const [gameState, setGameState] = useState({
    status: 'LOBBY', 
    winner: null,
    round_start_time: null
  });

  useEffect(() => {
    // Initial Fetch
    supabase.from('game_state').select().single().then(({ data, error }) => {
      if (!error && data) setGameState(data);
    });

    // Realtime Subscription
    const channel = supabase
      .channel('game_state_sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_state' }, (payload) => {
        if (payload.new) {
          setGameState(prev => ({ ...prev, ...payload.new }));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <GameContext.Provider value={{ gameState, setGameState, supabase }}>
      {children}
    </GameContext.Provider>
  );
};

// --- 2. Helper Functions ---

const assignTeam = async () => {
  // Production Auto-Balance: Check actual DB counts
  const { count: redCount } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('team', 'RED');
  const { count: blueCount } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('team', 'BLUE');
  
  // Default to Red if equal, otherwise smaller team
  return (redCount || 0) <= (blueCount || 0) ? 'RED' : 'BLUE';
};

// --- 3. Components ---

const PlayerView = () => {
  const { gameState, supabase } = useContext(GameContext);
  const [playerState, setPlayerState] = useState({ joined: false, nickname: '', team: null, id: null });
  const [inputName, setInputName] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [timeLeft, setTimeLeft] = useState(30);
  const [buttonPos, setButtonPos] = useState({ top: '50%', left: '50%' });
  const [isPressed, setIsPressed] = useState(false);
  
  const pressTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  const channelRef = useRef(null);

  // Restore Session
  useEffect(() => {
    const storedId = localStorage.getItem('tapwar_id');
    const storedTeam = localStorage.getItem('tapwar_team');
    const storedName = localStorage.getItem('tapwar_nickname');
    if (storedId && storedTeam && storedName) {
      setPlayerState({ joined: true, id: storedId, team: storedTeam, nickname: storedName });
    }
  }, []);

  // Timer Sync
  useEffect(() => {
    if (gameState.status === 'PLAYING' && gameState.round_start_time) {
      const interval = setInterval(() => {
        const start = new Date(gameState.round_start_time).getTime();
        const now = new Date().getTime();
        const elapsed = (now - start) / 1000;
        const remaining = Math.max(0, 30 - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.status, gameState.round_start_time]);

  // Click Batching
  useEffect(() => {
    if (playerState.joined && gameState.status === 'PLAYING') {
      channelRef.current = supabase.channel('room1');
      channelRef.current.subscribe();

      const intervalId = setInterval(() => {
        if (clickCountRef.current > 0) {
          const clicksToSend = clickCountRef.current;
          clickCountRef.current = 0; // Reset
          channelRef.current.send({
            type: 'broadcast',
            event: 'client-click',
            payload: { team: playerState.team, count: clicksToSend, from: playerState.nickname }
          });
        }
      }, 1000); // 1 Second Batch

      return () => {
        clearInterval(intervalId);
        if (channelRef.current) supabase.removeChannel(channelRef.current);
      };
    }
  }, [playerState.joined, gameState.status, playerState.team]);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inputName.trim()) return;
    setLoading(true);
    
    try {
      const assignedTeam = await assignTeam();
      const { data, error } = await supabase.from('players').insert({ nickname: inputName, team: assignedTeam }).select().single();
      
      if (error) throw error;

      localStorage.setItem('tapwar_id', data.id);
      localStorage.setItem('tapwar_team', assignedTeam);
      localStorage.setItem('tapwar_nickname', inputName);
      setPlayerState({ joined: true, id: data.id, team: assignedTeam, nickname: inputName });
    } catch (error) {
      console.error("Error joining:", error);
      alert("Could not join game. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleTap = () => {
    if (gameState.status !== 'PLAYING') return;
    clickCountRef.current += 1;
    if (navigator.vibrate) navigator.vibrate(5);
    setIsPressed(true);
    if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
    pressTimeoutRef.current = setTimeout(() => setIsPressed(false), 50);

    if (timeLeft <= 10 && timeLeft > 0) {
      const maxTop = window.innerHeight - 150; 
      const maxLeft = window.innerWidth - 150;
      const newTop = Math.max(50, Math.random() * maxTop);
      const newLeft = Math.max(50, Math.random() * maxLeft);
      setButtonPos({ top: `${newTop}px`, left: `${newLeft}px` });
    }
  };

  if (gameState.status === 'FINISHED' && playerState.joined) {
    const weWon = playerState.team === gameState.winner;
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen ${weWon ? 'bg-green-600' : 'bg-gray-900'} text-white transition-colors duration-1000`}>
        <div className="text-center animate-in zoom-in duration-500">
          <h1 className="text-6xl font-black uppercase mb-4 drop-shadow-xl">{weWon ? 'VICTORY!' : 'DEFEAT'}</h1>
          <p className="text-xl font-bold uppercase tracking-widest opacity-80">
            {weWon ? 'Well done, champion.' : 'Better luck next time.'}
          </p>
          <div className="mt-12 text-sm opacity-50 font-mono">Waiting for Host...</div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'PLAYING' && playerState.joined) {
    const isRed = playerState.team === 'RED';
    const isChaos = timeLeft <= 10;
    return (
      <div className={`fixed inset-0 flex flex-col items-center justify-center ${isRed ? 'bg-red-600' : 'bg-blue-600'} text-white overflow-hidden touch-none select-none`}>
        <div className="absolute top-8 text-center z-10 pointer-events-none">
          <div className="text-6xl font-black drop-shadow-xl font-mono">{timeLeft.toFixed(1)}s</div>
          {isChaos && <div className="text-yellow-300 font-bold animate-bounce mt-2">CHAOS MODE!</div>}
        </div>
        <button onPointerDown={handleTap} className="absolute w-64 h-64 rounded-full shadow-[0_10px_0_rgba(0,0,0,0.3)] flex items-center justify-center outline-none -webkit-tap-highlight-color-transparent z-20" style={{ backgroundColor: isRed ? '#ff4d4d' : '#4d94ff', border: '8px solid rgba(255,255,255,0.3)', top: isChaos ? buttonPos.top : '50%', left: isChaos ? buttonPos.left : '50%', transform: isChaos ? 'translate(0, 0)' : 'translate(-50%, -50%) ' + (isPressed ? 'scale(0.95) translateY(10px)' : 'scale(1) translateY(0)'), boxShadow: isPressed ? '0 0 0 rgba(0,0,0,0.3)' : '0 10px 0 rgba(0,0,0,0.3)', transition: isChaos ? 'none' : 'transform 75ms' }}>
          <span className="text-8xl select-none pointer-events-none">{isRed ? '🔥' : '💧'}</span>
        </button>
      </div>
    );
  }

  if (playerState.joined) {
    const isRed = playerState.team === 'RED';
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen p-6 transition-colors duration-500 ${isRed ? 'bg-red-950 text-red-100' : 'bg-blue-950 text-blue-100'}`}>
        <div className="text-center space-y-2 mb-12">
          <p className="text-sm opacity-60 uppercase tracking-widest">You are fighting for</p>
          <h1 className={`text-6xl font-black uppercase tracking-tighter ${isRed ? 'text-red-500' : 'text-blue-500'} drop-shadow-lg`}>TEAM {playerState.team}</h1>
        </div>
        <div className="w-full max-w-sm bg-black/30 backdrop-blur-sm border border-white/10 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-white/10 flex items-center justify-center text-3xl mb-4 border-2 border-white/20">{isRed ? '🔥' : '💧'}</div>
          <h2 className="text-2xl font-bold mb-2">{playerState.nickname}</h2>
          <p className="text-sm opacity-60">Waiting for host to start...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-6">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-blue-500 mb-2">TAP WAR</h1>
        <p className="text-zinc-500 text-sm">Enter your name to join the battle</p>
      </div>
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
        <form onSubmit={handleJoin} className="flex flex-col space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1 ml-1">Nickname</label>
            <input type="text" maxLength={12} value={inputName} onChange={(e) => setInputName(e.target.value)} placeholder="e.g. SpeedDemon" className="w-full bg-zinc-950 border-2 border-zinc-800 text-white text-lg font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-red-500 transition-colors placeholder:text-zinc-700" />
          </div>
          <button type="submit" disabled={loading || !inputName} className="w-full bg-white text-black font-black text-xl py-4 rounded-xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">{loading ? 'JOINING...' : 'JOIN GAME'}</button>
        </form>
      </div>
    </div>
  );
};

const HostView = () => {
  const { gameState, supabase } = useContext(GameContext);
  const [players, setPlayers] = useState([]);
  const [redScore, setRedScore] = useState(0);
  const [blueScore, setBlueScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [leaderboard, setLeaderboard] = useState({});

  const scoresRef = useRef({ red: 0, blue: 0 });
  const leaderboardRef = useRef({});

  useEffect(() => {
    supabase.from('players').select().then(({ data }) => { if (data) setPlayers(Array.isArray(data) ? data : []); });

    const dbChannel = supabase.channel('host_db_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players' }, (payload) => {
        setPlayers(prev => [...prev, payload.new]);
      })
      .subscribe();

    const gameChannel = supabase.channel('room1')
      .on('broadcast', { event: 'client-click' }, (payload) => {
        if (payload.team === 'RED') {
          setRedScore(prev => { const val = prev + payload.count; scoresRef.current.red = val; return val; });
        } else {
          setBlueScore(prev => { const val = prev + payload.count; scoresRef.current.blue = val; return val; });
        }
        const name = payload.from || 'Unknown';
        if (!leaderboardRef.current[name]) leaderboardRef.current[name] = 0;
        leaderboardRef.current[name] += payload.count;
        setLeaderboard({...leaderboardRef.current});
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dbChannel);
      supabase.removeChannel(gameChannel);
    };
  }, []);

  useEffect(() => {
    if (gameState.status === 'PLAYING' && gameState.round_start_time) {
      const interval = setInterval(() => {
        const start = new Date(gameState.round_start_time).getTime();
        const now = new Date().getTime();
        const elapsed = (now - start) / 1000;
        const remaining = Math.max(0, 30 - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
          const red = scoresRef.current.red;
          const blue = scoresRef.current.blue;
          let winner = 'DRAW';
          if (red > blue) winner = 'RED';
          if (blue > red) winner = 'BLUE';
          supabase.from('game_state').update({ status: 'FINISHED', winner }).eq('id', 1);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.status, gameState.round_start_time]);

  const handleStartGame = async () => {
    setRedScore(0); setBlueScore(0); setLeaderboard({}); scoresRef.current = { red: 0, blue: 0 }; leaderboardRef.current = {};
    await supabase.from('game_state').update({ status: 'PLAYING', round_start_time: new Date().toISOString() }).eq('id', 1);
  };

  const handleReset = async () => {
    setRedScore(0); setBlueScore(0); setLeaderboard({}); scoresRef.current = { red: 0, blue: 0 }; leaderboardRef.current = {};
    await supabase.from('game_state').update({ status: 'LOBBY', winner: null, round_start_time: null }).eq('id', 1);
  };

  const redPlayers = players.filter(p => p.team === 'RED');
  const bluePlayers = players.filter(p => p.team === 'BLUE');
  const totalScore = redScore + blueScore;
  const redPercent = totalScore === 0 ? 50 : (redScore / totalScore) * 100;
  const sortedPlayers = Object.entries(leaderboard).sort(([, scoreA], [, scoreB]) => scoreB - scoreA).slice(0, 3);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-8">
      <header className="w-full max-w-6xl flex justify-between items-end mb-8 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Host Dashboard</h1>
          <p className="text-zinc-500">Room Status: <span className={`font-mono font-bold ${gameState.status === 'PLAYING' ? 'text-green-500 animate-pulse' : 'text-yellow-500'}`}>{gameState.status}</span></p>
        </div>
        <div className="text-right">
          <div className="text-sm text-zinc-400">Time Remaining</div>
          <div className={`text-5xl font-mono font-bold ${timeLeft <= 10 && gameState.status === 'PLAYING' ? 'text-red-500 animate-pulse' : 'text-white'}`}>{gameState.status === 'FINISHED' ? '0.0s' : timeLeft.toFixed(1) + 's'}</div>
        </div>
      </header>

      {gameState.status === 'FINISHED' && (
        <div className="w-full max-w-6xl mb-12 flex flex-col gap-8 animate-in zoom-in duration-500">
          <div className="py-12 bg-zinc-900/50 border border-zinc-700 rounded-3xl text-center">
            <h2 className="text-2xl text-zinc-400 uppercase tracking-widest mb-4">WINNER</h2>
            <h1 className={`text-9xl font-black uppercase tracking-tighter drop-shadow-[0_0_30px_rgba(255,255,255,0.2)] ${gameState.winner === 'RED' ? 'text-red-500' : gameState.winner === 'BLUE' ? 'text-blue-500' : 'text-gray-400'}`}>{gameState.winner === 'DRAW' ? 'DRAW!' : `TEAM ${gameState.winner}`}</h1>
            <div className="flex justify-center gap-12 mt-8 text-4xl font-mono">
              <div className="text-red-500">Red: {redScore}</div>
              <div className="text-blue-500">Blue: {blueScore}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {sortedPlayers.map(([name, score], index) => (
              <div key={name} className={`bg-zinc-800/80 rounded-2xl p-6 border-2 flex flex-col items-center shadow-xl transform ${index === 0 ? 'scale-110 border-yellow-500 z-10' : index === 1 ? 'border-gray-400' : 'border-orange-700'}`}>
                <div className="text-4xl mb-2">{index === 0 ? '👑' : index === 1 ? '🥈' : '🥉'}</div>
                <div className="text-2xl font-bold truncate max-w-full">{name}</div>
                <div className="text-zinc-400 font-mono text-xl">{score} clicks</div>
              </div>
            ))}
            {sortedPlayers.length === 0 && <div className="col-span-3 text-center text-zinc-500 py-8 italic">No clicks recorded!</div>}
          </div>
        </div>
      )}

      {gameState.status === 'PLAYING' && (
        <div className="w-full max-w-6xl mb-12 animate-in fade-in zoom-in duration-500">
          <div className="flex justify-between mb-2 font-black text-4xl uppercase tracking-tighter">
            <span className="text-red-500">{redScore}</span>
            <span className="text-blue-500">{blueScore}</span>
          </div>
          <div className="relative h-24 w-full bg-zinc-900 rounded-2xl overflow-hidden border-4 border-zinc-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
            <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-white/20 z-10"></div>
            <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-900 to-red-600 transition-all duration-300 ease-out" style={{ width: `${redPercent}%` }}><div className="absolute right-0 top-0 bottom-0 w-2 bg-white/50 animate-pulse"></div></div>
            <div className="absolute top-0 bottom-0 right-0 left-0 bg-gradient-to-l from-blue-900 to-blue-600 -z-10"></div>
          </div>
        </div>
      )}

      {gameState.status !== 'FINISHED' && (
        <main className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-6xl flex-grow opacity-50 hover:opacity-100 transition-opacity">
          <div className="bg-zinc-900/30 border border-red-900/30 rounded-xl flex flex-col relative overflow-hidden h-[40vh]">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
            <div className="p-4 bg-zinc-900/80 border-b border-red-900/20 flex justify-between items-center backdrop-blur-sm"><h2 className="text-xl font-black text-red-500 uppercase italic">Team Red</h2><span className="bg-red-900/20 text-red-500 px-3 py-1 rounded text-sm font-mono">{redPlayers.length} Joined</span></div>
            <div className="flex-grow overflow-y-auto p-4 space-y-2 scrollbar-hide"><div className="grid grid-cols-2 gap-2">{redPlayers.map(p => <div key={p.id} className="bg-red-950/40 border border-red-900/20 rounded px-3 py-2 text-red-200 font-mono text-xs truncate">{p.nickname}</div>)}</div></div>
          </div>
          <div className="bg-zinc-900/30 border border-blue-900/30 rounded-xl flex flex-col relative overflow-hidden h-[40vh]">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-600"></div>
            <div className="p-4 bg-zinc-900/80 border-b border-blue-900/20 flex justify-between items-center backdrop-blur-sm"><h2 className="text-xl font-black text-blue-500 uppercase italic">Team Blue</h2><span className="bg-blue-900/20 text-blue-500 px-3 py-1 rounded text-sm font-mono">{bluePlayers.length} Joined</span></div>
            <div className="flex-grow overflow-y-auto p-4 space-y-2 scrollbar-hide"><div className="grid grid-cols-2 gap-2">{bluePlayers.map(p => <div key={p.id} className="bg-blue-950/40 border border-blue-900/20 rounded px-3 py-2 text-blue-200 font-mono text-xs truncate">{p.nickname}</div>)}</div></div>
          </div>
        </main>
      )}

      <footer className="w-full max-w-6xl mt-12 flex justify-center">
        {gameState.status === 'LOBBY' ? <button onClick={handleStartGame} disabled={players.length === 0} className="px-12 py-4 bg-white text-black font-black text-xl rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]">Start Game {players.length === 0 ? "(Waiting for Players)" : `(${players.length} Ready)`}</button>
        : gameState.status === 'FINISHED' ? <button onClick={handleReset} className="px-12 py-4 bg-white text-black font-black text-xl rounded-full hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]">Play Again</button>
        : <div className="text-2xl font-bold animate-pulse text-green-500">GAME IN PROGRESS</div>}
      </footer>
    </div>
  );
};

// --- 4. Main App Logic ---

const AppContent = () => {
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    // SECURITY FIX: Only allow Host View if URL query param ?mode=host is present
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'host') {
      setIsHost(true);
    }
  }, []);

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-red-500 selection:text-white overflow-hidden">
      {isHost ? <HostView /> : <PlayerView />}
    </div>
  );
};

const App = () => {
  return (
    <GameProvider>
      <AppContent />
    </GameProvider>
  );
};

export default App;