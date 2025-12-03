import React, { useState, useEffect, createContext, useContext, useRef } from 'react';

// ==========================================
// 1. UNCOMMENT THESE LINES IN YOUR LOCAL PROJECT:
// ==========================================
// import { createClient } from '@supabase/supabase-js';
// const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// 2. DELETE THIS SECTION IN YOUR LOCAL PROJECT (It prevents preview crashes):
// ==========================================
const supabase = { 
  channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  from: () => ({ 
    select: () => ({ 
      single: () => Promise.resolve({ data: null, error: null }),
      then: (cb) => Promise.resolve({ data: null, error: null }).then(cb)
    }),
    insert: () => ({ 
      select: () => ({ 
        single: () => Promise.resolve({ data: { id: 'mock-id' }, error: null }) 
      }) 
    }),
    delete: () => ({ eq: () => Promise.resolve({}) })
  })
}; 
// ==========================================


/**
 * Tap War - Production Build (v2.4 - Fixes)
 * Updates:
 * - Fixed Broadcast Payload Destructuring: Real Supabase wraps events in an object.
 * We now destructure `{ payload }` to access data correctly, fixing the NaN/0 score bug.
 * - Added safety checks for count arithmetic.
 */

// --- Global Styles ---
const GlobalStyles = () => (
  <style>{`
    @keyframes floatUp {
      0% { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(-100px) scale(1.5); opacity: 0; }
    }
    @keyframes explode {
      0% { transform: translate(0, 0) scale(1); opacity: 1; }
      100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
    }
    .animate-float { animation: floatUp 0.8s ease-out forwards; }
    .animate-particle { animation: explode 0.6s ease-out forwards; }
    .bar-pulse-red { animation: pulseRed 0.2s ease-out; }
    .bar-pulse-blue { animation: pulseBlue 0.2s ease-out; }
    @keyframes pulseRed { 0% { filter: brightness(1); } 50% { filter: brightness(2) drop-shadow(0 0 10px red); } 100% { filter: brightness(1); } }
    @keyframes pulseBlue { 0% { filter: brightness(1); } 50% { filter: brightness(2) drop-shadow(0 0 10px blue); } 100% { filter: brightness(1); } }
  `}</style>
);

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
      if (supabase.removeChannel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <GameContext.Provider value={{ gameState, setGameState, supabase }}>
      {children}
    </GameContext.Provider>
  );
};

// --- Visual Components ---
const FloatingItem = ({ id, x, y, onComplete, children, className }) => {
  useEffect(() => {
    const timer = setTimeout(() => onComplete(id), 800);
    return () => clearTimeout(timer);
  }, [id, onComplete]);
  return <div className={`absolute pointer-events-none z-50 ${className}`} style={{ left: x, top: y }}>{children}</div>;
};

const Particle = ({ id, x, y, color, onComplete }) => {
  const tx = useRef(`${(Math.random() - 0.5) * 200}px`);
  const ty = useRef(`${(Math.random() - 0.5) * 200}px`);
  useEffect(() => {
    const timer = setTimeout(() => onComplete(id), 600);
    return () => clearTimeout(timer);
  }, [id, onComplete]);
  return <div className="absolute w-3 h-3 rounded-full animate-particle pointer-events-none z-40" style={{ left: x, top: y, backgroundColor: color, '--tx': tx.current, '--ty': ty.current }} />;
};

// --- Helper Functions ---
const assignTeam = async () => {
  const { count: redCount } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('team', 'RED');
  const { count: blueCount } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('team', 'BLUE');
  return (redCount || 0) <= (blueCount || 0) ? 'RED' : 'BLUE';
};

// --- Player View ---
const PlayerView = () => {
  const { gameState, supabase } = useContext(GameContext);
  const [playerState, setPlayerState] = useState({ joined: false, nickname: '', team: null, id: null });
  const [inputName, setInputName] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  
  // Visuals
  const [buttonPos, setButtonPos] = useState({ top: '50%', left: '50%' });
  const [isPressed, setIsPressed] = useState(false);
  const [effects, setEffects] = useState([]);
  
  const pressTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  const channelRef = useRef(null);

  // SESSION CHECK (Using sessionStorage to allow resets)
  useEffect(() => {
    const storedId = sessionStorage.getItem('tapwar_id');
    const storedTeam = sessionStorage.getItem('tapwar_team');
    const storedName = sessionStorage.getItem('tapwar_nickname');
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
        const remaining = Math.max(0, 30 - (now - start) / 1000);
        setTimeLeft(remaining);
        if (remaining <= 0) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.status, gameState.round_start_time]);

  // Click Batching
  useEffect(() => {
    if (playerState.joined) {
      if (gameState.status === 'PLAYING') {
        channelRef.current = supabase.channel('room1');
        channelRef.current.subscribe();
        const intervalId = setInterval(() => {
          if (clickCountRef.current > 0) {
            const clicks = clickCountRef.current;
            clickCountRef.current = 0;
            channelRef.current.send({
              type: 'broadcast',
              event: 'client-click',
              payload: { team: playerState.team, count: clicks, from: playerState.nickname }
            });
          }
        }, 1000);
        return () => {
          clearInterval(intervalId);
          if (channelRef.current && supabase.removeChannel) supabase.removeChannel(channelRef.current);
        };
      } else if (gameState.status === 'FINISHED') {
        // Final Flush
        if (clickCountRef.current > 0 && channelRef.current) {
           const clicks = clickCountRef.current;
           clickCountRef.current = 0;
           channelRef.current.send({
              type: 'broadcast',
              event: 'client-click',
              payload: { team: playerState.team, count: clicks, from: playerState.nickname }
           });
        }
      }
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
      
      // Store in Session Storage (Cleared on browser close)
      sessionStorage.setItem('tapwar_id', data.id);
      sessionStorage.setItem('tapwar_team', assignedTeam);
      sessionStorage.setItem('tapwar_nickname', inputName);
      setPlayerState({ joined: true, id: data.id, team: assignedTeam, nickname: inputName });
    } catch (error) {
      console.error(error);
      // Alert removed for preview safety, feel free to add back
      // alert("Join failed. Try again."); 
      // Mock fallback for preview
      const assignedTeam = Math.random() > 0.5 ? 'RED' : 'BLUE';
      setPlayerState({ joined: true, id: 'mock', team: assignedTeam, nickname: inputName });
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (confirm("Leave game? You will lose your spot.")) {
        if (playerState.id) {
            // Delete from DB so Host count updates
            await supabase.from('players').delete().eq('id', playerState.id);
        }
        sessionStorage.clear();
        setPlayerState({ joined: false, nickname: '', team: null, id: null });
        setInputName('');
    }
  };

  const handleTap = (e) => {
    if (gameState.status !== 'PLAYING') return;
    clickCountRef.current += 1;
    if (navigator.vibrate) navigator.vibrate(5);

    setIsPressed(true);
    if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
    pressTimeoutRef.current = setTimeout(() => setIsPressed(false), 50);

    const touch = e.touches ? e.touches[0] : e;
    const x = touch ? (touch.clientX || e.clientX) : e.clientX;
    const y = touch ? (touch.clientY || e.clientY) : e.clientY;
    
    const newItems = [{ id: Date.now() + 'num', type: 'number', x, y }];
    for (let i = 0; i < 8; i++) {
        newItems.push({ id: Date.now() + 'p' + i, type: 'particle', x, y });
    }
    setEffects(prev => [...prev, ...newItems]);

    if (timeLeft <= 10 && timeLeft > 0) {
      const maxTop = window.innerHeight - 150; 
      const maxLeft = window.innerWidth - 150;
      setButtonPos({ 
        top: `${Math.max(50, Math.random() * maxTop)}px`, 
        left: `${Math.max(50, Math.random() * maxLeft)}px` 
      });
    }
  };

  const removeEffect = (id) => {
    setEffects(prev => prev.filter(f => f.id !== id));
  };

  if (gameState.status === 'FINISHED' && playerState.joined) {
    const weWon = playerState.team === gameState.winner;
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen ${weWon ? 'bg-green-600' : 'bg-gray-900'} text-white transition-colors duration-1000`}>
        <GlobalStyles />
        <div className="text-center animate-bounce">
          <h1 className="text-6xl font-black uppercase mb-4 drop-shadow-xl">{weWon ? 'VICTORY!' : 'DEFEAT'}</h1>
          <p className="text-xl font-bold uppercase tracking-widest opacity-80">
            {weWon ? 'GLORY TO THE WINNERS!' : 'YOU FOUGHT BRAVELY'}
          </p>
          <div className="mt-12 flex flex-col gap-4">
             <div className="text-sm opacity-50 font-mono">Check Host Screen for MVP</div>
             <button onClick={handleLeave} className="text-xs text-white/50 underline hover:text-white">Leave Game</button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'PLAYING' && playerState.joined) {
    const isRed = playerState.team === 'RED';
    const isChaos = timeLeft <= 10;
    return (
      <div className={`fixed inset-0 flex flex-col items-center justify-center ${isRed ? 'bg-red-600' : 'bg-blue-600'} text-white overflow-hidden touch-none select-none`}>
        <GlobalStyles />
        <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
          {effects.map(f => (
            f.type === 'number' ? 
              <FloatingItem key={f.id} id={f.id} x={f.x} y={f.y} onComplete={removeEffect} className="animate-float">
                 <span className="text-5xl font-black text-white drop-shadow-md">+1</span>
              </FloatingItem>
            : 
              <Particle key={f.id} id={f.id} x={f.x} y={f.y} color="white" onComplete={removeEffect} />
          ))}
        </div>

        <div className="absolute top-8 text-center z-10 pointer-events-none">
          <div className={`text-6xl font-black drop-shadow-xl font-mono ${isChaos ? 'text-yellow-300 scale-110 duration-75' : ''}`}>
            {timeLeft.toFixed(1)}s
          </div>
          {isChaos && <div className="text-yellow-300 font-bold animate-pulse mt-2 text-2xl">CHAOS MODE!</div>}
        </div>
        
        <button
          onPointerDown={handleTap}
          className="absolute w-64 h-64 rounded-full shadow-[0_10px_0_rgba(0,0,0,0.3)] flex items-center justify-center outline-none -webkit-tap-highlight-color-transparent z-20"
          style={{
            backgroundColor: isRed ? '#ef4444' : '#3b82f6',
            border: '8px solid rgba(255,255,255,0.4)',
            top: isChaos ? buttonPos.top : '50%',
            left: isChaos ? buttonPos.left : '50%',
            transform: isChaos ? 'translate(0, 0)' : 'translate(-50%, -50%) ' + (isPressed ? 'scale(0.92) translateY(10px)' : 'scale(1) translateY(0)'),
            boxShadow: isPressed ? '0 0 0 rgba(0,0,0,0.3), inset 0 0 20px rgba(0,0,0,0.2)' : '0 15px 30px rgba(0,0,0,0.4), inset 0 0 0 rgba(0,0,0,0)',
            transition: isChaos ? 'none' : 'transform 50ms cubic-bezier(0.175, 0.885, 0.32, 1.275)'
          }}
        >
          <span className="text-8xl select-none pointer-events-none filter drop-shadow-lg scale-110">{isRed ? '🔥' : '💧'}</span>
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
        <div className="w-full max-w-sm bg-black/30 backdrop-blur-sm border border-white/10 rounded-2xl p-8 text-center relative">
          <div className="w-20 h-20 mx-auto rounded-full bg-white/10 flex items-center justify-center text-3xl mb-4 border-2 border-white/20">{isRed ? '🔥' : '💧'}</div>
          <h2 className="text-2xl font-bold mb-2">{playerState.nickname}</h2>
          <p className="text-sm opacity-60 mb-6">Waiting for host to start...</p>
          <button onClick={handleLeave} className="text-xs bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full text-white/70 hover:text-white transition-colors">
            Leave Game
          </button>
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
  const [pulseClass, setPulseClass] = useState('');

  const scoresRef = useRef({ red: 0, blue: 0 });
  const leaderboardRef = useRef({});

  useEffect(() => {
    const savedScores = localStorage.getItem('tapwar_host_scores');
    const savedLeaderboard = localStorage.getItem('tapwar_host_leaderboard');
    if (savedScores) {
      const parsed = JSON.parse(savedScores);
      scoresRef.current = parsed;
      setRedScore(parsed.red);
      setBlueScore(parsed.blue);
    }
    if (savedLeaderboard) {
      const parsed = JSON.parse(savedLeaderboard);
      leaderboardRef.current = parsed;
      setLeaderboard(parsed);
    }
  }, []);

  useEffect(() => {
    supabase.from('players').select().then(({ data }) => { if (data) setPlayers(Array.isArray(data) ? data : []); });

    const dbChannel = supabase.channel('host_db_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players' }, (payload) => {
        setPlayers(prev => [...prev, payload.new]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' }, (payload) => {
        // Remove deleted players from the list
        setPlayers(prev => prev.filter(p => p.id !== payload.old.id));
      })
      .subscribe();

    const gameChannel = supabase.channel('room1')
      // FIXED: Destructure payload correctly from the event envelope
      .on('broadcast', { event: 'client-click' }, ({ payload }) => {
        if (payload.team === 'RED') {
          setPulseClass('bar-pulse-red');
          setRedScore(prev => { 
            const val = prev + (payload.count || 0); 
            scoresRef.current.red = val; 
            return val; 
          });
        } else {
          setPulseClass('bar-pulse-blue');
          setBlueScore(prev => { 
            const val = prev + (payload.count || 0); 
            scoresRef.current.blue = val; 
            return val; 
          });
        }
        setTimeout(() => setPulseClass(''), 200);

        const name = payload.from || 'Unknown';
        if (!leaderboardRef.current[name]) leaderboardRef.current[name] = 0;
        leaderboardRef.current[name] += (payload.count || 0);
        
        setLeaderboard({...leaderboardRef.current});
        localStorage.setItem('tapwar_host_scores', JSON.stringify(scoresRef.current));
        localStorage.setItem('tapwar_host_leaderboard', JSON.stringify(leaderboardRef.current));
      })
      .subscribe();

    return () => {
      if (supabase.removeChannel) {
        supabase.removeChannel(dbChannel);
        supabase.removeChannel(gameChannel);
      }
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
          finishGame();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.status, gameState.round_start_time]);

  const finishGame = async () => {
    const red = scoresRef.current.red;
    const blue = scoresRef.current.blue;
    let winner = 'DRAW';
    if (red > blue) winner = 'RED';
    if (blue > red) winner = 'BLUE';
    await supabase.from('game_state').update({ status: 'FINISHED', winner }).eq('id', 1);
  };

  const handleStartGame = async () => {
    localStorage.removeItem('tapwar_host_scores');
    localStorage.removeItem('tapwar_host_leaderboard');
    setRedScore(0); setBlueScore(0); setLeaderboard({}); 
    scoresRef.current = { red: 0, blue: 0 }; leaderboardRef.current = {};
    
    await supabase.from('game_state').update({ status: 'PLAYING', round_start_time: new Date().toISOString() }).eq('id', 1);
  };

  const handleReset = async () => {
    localStorage.removeItem('tapwar_host_scores');
    localStorage.removeItem('tapwar_host_leaderboard');
    setRedScore(0); setBlueScore(0); setLeaderboard({}); 
    scoresRef.current = { red: 0, blue: 0 }; leaderboardRef.current = {};
    await supabase.from('game_state').update({ status: 'LOBBY', winner: null, round_start_time: null }).eq('id', 1);
  };

  const redPlayers = players.filter(p => p.team === 'RED');
  const bluePlayers = players.filter(p => p.team === 'BLUE');
  const totalScore = redScore + blueScore;
  const redPercent = totalScore === 0 ? 50 : (redScore / totalScore) * 100;
  const sortedPlayers = Object.entries(leaderboard).sort(([, scoreA], [, scoreB]) => scoreB - scoreA).slice(0, 3);

  const bgGradient = totalScore === 0 
    ? 'bg-black' 
    : redScore > blueScore 
      ? `bg-gradient-to-br from-red-950 via-black to-black` 
      : `bg-gradient-to-bl from-blue-950 via-black to-black`;

  return (
    <div className={`flex flex-col items-center justify-center min-h-screen text-white p-8 transition-colors duration-1000 ${bgGradient}`}>
      <GlobalStyles />
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
            {sortedPlayers.length === 0 && <div className="col-span-3 text-center text-zinc-500 py-8 italic">No clicks recorded yet!</div>}
          </div>
        </div>
      )}

      {gameState.status === 'PLAYING' && (
        <div className="w-full max-w-6xl mb-12 animate-in fade-in zoom-in duration-500">
          <div className="flex justify-between mb-2 font-black text-4xl uppercase tracking-tighter">
            <span className={`text-red-500 ${pulseClass === 'bar-pulse-red' ? 'scale-110' : ''} transition-transform duration-75`}>{redScore}</span>
            <span className={`text-blue-500 ${pulseClass === 'bar-pulse-blue' ? 'scale-110' : ''} transition-transform duration-75`}>{blueScore}</span>
          </div>
          <div className={`relative h-24 w-full bg-zinc-900 rounded-2xl overflow-hidden border-4 border-zinc-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] ${pulseClass} transition-all duration-100`}>
            <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-white/20 z-10"></div>
            <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-900 to-red-600 transition-all duration-300 ease-out" style={{ width: `${redPercent}%` }}>
                <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/50 animate-pulse"></div>
            </div>
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

      <footer className="w-full max-w-6xl mt-12 flex justify-center pb-8 gap-4">
        {gameState.status === 'LOBBY' ? (
           <button onClick={handleStartGame} disabled={players.length === 0} className="px-12 py-4 bg-white text-black font-black text-xl rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]">
             Start Game {players.length === 0 ? "(Waiting for Players)" : `(${players.length} Ready)`}
           </button>
        ) : gameState.status === 'FINISHED' ? (
           <button onClick={handleReset} className="px-12 py-4 bg-white text-black font-black text-xl rounded-full hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]">
             Play Again
           </button>
        ) : (
          <div className="flex flex-col items-center gap-2">
             <div className="text-2xl font-bold animate-pulse text-green-500">GAME IN PROGRESS</div>
             {timeLeft <= 5 && (
               <button onClick={finishGame} className="text-xs bg-red-900/50 text-red-300 px-3 py-1 rounded hover:bg-red-800">
                 Force Finish
               </button>
             )}
          </div>
        )}
      </footer>
    </div>
  );
};

const AppContent = () => {
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
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