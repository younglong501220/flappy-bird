import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, RotateCcw, Trophy, Award } from 'lucide-react';

// Game state constants
enum GameState {
  START = 0,
  PLAYING = 1,
  GAMEOVER = 2,
}

interface Pipe {
  x: number;
  top: number;
  bottom: number;
  passed: boolean;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
}

export default function FlappyBird() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Audio state
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  isMutedRef.current = isMuted;

  // React state for external UI stats display
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [currentScore, setCurrentScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(() => {
    const saved = localStorage.getItem('flappy_highscore');
    return saved ? parseInt(saved, 10) || 0 : 0;
  });

  // Logical game resolution
  const V_WIDTH = 360;
  const V_HEIGHT = 540;
  const groundHeight = 80;

  // Mutable game state held in ref for 60fps loop
  const gameRef = useRef({
    state: GameState.START,
    frames: 0,
    score: 0,
    highScore: 0,
    groundOffset: 0,
    bird: {
      x: 70,
      y: 200,
      radius: 14,
      gravity: 0.28,
      lift: -6.0,
      velocity: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      scaleVelocityX: 0,
      scaleVelocityY: 0,
    },
    pipes: [] as Pipe[],
    clouds: [
      { x: 50, y: 80, s: 0.8 },
      { x: 220, y: 130, s: 1.1 },
      { x: 330, y: 60, s: 0.6 },
    ] as Cloud[],
  });

  // Sync high score from initial state
  useEffect(() => {
    gameRef.current.highScore = highScore;
  }, [highScore]);

  // Audio system using Web Audio API
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioCtxRef.current = new AudioContextClass();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, []);

  const playSound = useCallback((type: 'flap' | 'score' | 'hit') => {
    if (isMutedRef.current || !audioCtxRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'flap') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'score') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(900, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(40, now + 0.2);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch {
      // Audio context might fail on restricted browser contexts
    }
  }, []);

  // Flap action with instant upward tilt and jelly squash-and-stretch
  const triggerFlap = useCallback(() => {
    const g = gameRef.current;
    g.bird.velocity = g.bird.lift;
    // 玩家點擊跳躍時，小鳥身體瞬間向上傾斜 30 度 (-30° in radians)
    g.bird.rotation = -30 * (Math.PI / 180);
    // 果凍起跳彈跳效果：瞬間橫向收縮、縱向拉伸，賦予強烈 Q 彈果凍動感
    g.bird.scaleX = 0.74;
    g.bird.scaleY = 1.34;
    g.bird.scaleVelocityX = 0.08;
    g.bird.scaleVelocityY = -0.08;
    playSound('flap');
  }, [playSound]);

  // Action handler (flap or restart)
  const handleAction = useCallback(() => {
    initAudio();
    const g = gameRef.current;

    if (g.state === GameState.START) {
      g.state = GameState.PLAYING;
      setGameState(GameState.PLAYING);
      triggerFlap();
    } else if (g.state === GameState.PLAYING) {
      triggerFlap();
    } else if (g.state === GameState.GAMEOVER) {
      // Reset game
      g.bird.y = 220;
      g.bird.velocity = 0;
      g.bird.rotation = 0;
      g.bird.scaleX = 1;
      g.bird.scaleY = 1;
      g.bird.scaleVelocityX = 0;
      g.bird.scaleVelocityY = 0;
      g.pipes = [];
      g.score = 0;
      g.frames = 0;
      g.state = GameState.PLAYING;
      setGameState(GameState.PLAYING);
      setCurrentScore(0);
      triggerFlap();
    }
  }, [initAudio, triggerFlap]);

  // Main Canvas Render & Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const spawnPipe = () => {
      const g = gameRef.current;
      const pipeGap = 125;
      const minHeight = 50;
      const maxHeight = V_HEIGHT - groundHeight - pipeGap - minHeight;
      const topHeight = Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;

      g.pipes.push({
        x: V_WIDTH,
        top: topHeight,
        bottom: topHeight + pipeGap,
        passed: false,
      });
    };

    const triggerGameOver = () => {
      const g = gameRef.current;
      playSound('hit');
      // 果凍撞擊碰撞擠壓形變
      g.bird.scaleX = 1.32;
      g.bird.scaleY = 0.72;
      g.state = GameState.GAMEOVER;
      setGameState(GameState.GAMEOVER);
    };

    const loop = () => {
      const g = gameRef.current;
      const dpr = window.devicePixelRatio || 1;

      // Handle HiDPI scaling dynamically
      if (canvas.width !== V_WIDTH * dpr || canvas.height !== V_HEIGHT * dpr) {
        canvas.width = V_WIDTH * dpr;
        canvas.height = V_HEIGHT * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, V_WIDTH, V_HEIGHT);

      // --- 1. Background Sky & Clouds ---
      ctx.fillStyle = '#70c5ce';
      ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

      // Clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      g.clouds.forEach((c) => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 25 * c.s, 0, Math.PI * 2);
        ctx.arc(c.x + 20 * c.s, c.y - 8 * c.s, 20 * c.s, 0, Math.PI * 2);
        ctx.arc(c.x + 40 * c.s, c.y, 22 * c.s, 0, Math.PI * 2);
        ctx.fill();

        if (g.state === GameState.PLAYING) {
          c.x -= 0.3 * c.s;
          if (c.x < -60) c.x = V_WIDTH + 30;
        }
      });

      // City silhouette
      ctx.fillStyle = '#a4e2cc';
      ctx.fillRect(0, V_HEIGHT - groundHeight - 40, V_WIDTH, 40);

      // --- 2. Update logic ---
      if (g.state === GameState.PLAYING) {
        // Spawn pipes
        if (g.frames % 100 === 0) {
          spawnPipe();
        }

        const pipeWidth = 55;
        for (let i = 0; i < g.pipes.length; i++) {
          const p = g.pipes[i];
          p.x -= 2.2;

          // Score detection
          if (!p.passed && p.x + pipeWidth < g.bird.x) {
            p.passed = true;
            g.score++;
            setCurrentScore(g.score);
            playSound('score');
            if (g.score > g.highScore) {
              g.highScore = g.score;
              setHighScore(g.highScore);
              localStorage.setItem('flappy_highscore', String(g.highScore));
            }
          }

          // Pipe collision detection with bird (AABB with 3px forgiveness)
          if (
            g.bird.x + g.bird.radius - 3 > p.x &&
            g.bird.x - g.bird.radius + 3 < p.x + pipeWidth
          ) {
            if (
              g.bird.y - g.bird.radius + 3 < p.top ||
              g.bird.y + g.bird.radius - 3 > p.bottom
            ) {
              triggerGameOver();
            }
          }

          // Remove off-screen pipes
          if (p.x + pipeWidth < -10) {
            g.pipes.splice(i, 1);
            i--;
          }
        }

        // Bird update
        g.bird.velocity += g.bird.gravity;
        g.bird.y += g.bird.velocity;

        // 小鳥身體傾斜姿態：
        // 當小鳥往下掉時，身體稍微向下傾斜；當玩家點擊跳躍時，小鳥身體瞬間向上傾斜 30 度。
        if (g.bird.velocity > 0) {
          // 下墜中：身體平滑地稍微向下傾斜 (約 25~30 度)
          const targetDownwardAngle = Math.min(28 * (Math.PI / 180), (g.bird.velocity * 3.6 * Math.PI) / 180);
          g.bird.rotation += (targetDownwardAngle - g.bird.rotation) * 0.12;
        } else {
          // 上升中：由 triggerFlap 瞬間置為 -30 度，維持平穩向上仰角
          const targetUpwardAngle = -30 * (Math.PI / 180);
          g.bird.rotation += (targetUpwardAngle - g.bird.rotation) * 0.16;
        }

        // 果凍 Q 彈彈簧物理模擬 (Squash & Stretch spring dynamics)
        const springK = 0.22;
        const damping = 0.74;

        // 當快速下墜時，帶有受重力拉伸的 Q 彈果凍微變形
        let targetScaleX = 1.0;
        let targetScaleY = 1.0;
        if (g.bird.velocity > 2.5) {
          targetScaleX = 0.94;
          targetScaleY = 1.06;
        }

        const forceX = (targetScaleX - g.bird.scaleX) * springK;
        g.bird.scaleVelocityX = (g.bird.scaleVelocityX + forceX) * damping;
        g.bird.scaleX += g.bird.scaleVelocityX;

        const forceY = (targetScaleY - g.bird.scaleY) * springK;
        g.bird.scaleVelocityY = (g.bird.scaleVelocityY + forceY) * damping;
        g.bird.scaleY += g.bird.scaleVelocityY;

        // Ground collision
        if (g.bird.y + g.bird.radius >= V_HEIGHT - groundHeight) {
          g.bird.y = V_HEIGHT - groundHeight - g.bird.radius;
          triggerGameOver();
        }

        // Ceiling collision
        if (g.bird.y - g.bird.radius <= 0) {
          g.bird.y = g.bird.radius;
          g.bird.velocity = 0;
        }
      } else if (g.state === GameState.START) {
        // 首頁小鳥上下漂浮與微幅果凍呼吸感
        g.bird.y = 200 + Math.sin(g.frames * 0.08) * 8;
        g.bird.rotation = Math.sin(g.frames * 0.08) * 0.05;
        g.bird.scaleX = 1 + Math.sin(g.frames * 0.1) * 0.03;
        g.bird.scaleY = 1 - Math.sin(g.frames * 0.1) * 0.03;
      } else if (g.state === GameState.GAMEOVER) {
        // 遊戲結束後的果凍撞擊彈性回穩
        const forceX = (1.0 - g.bird.scaleX) * 0.18;
        g.bird.scaleVelocityX = (g.bird.scaleVelocityX + forceX) * 0.72;
        g.bird.scaleX += g.bird.scaleVelocityX;

        const forceY = (1.0 - g.bird.scaleY) * 0.18;
        g.bird.scaleVelocityY = (g.bird.scaleVelocityY + forceY) * 0.72;
        g.bird.scaleY += g.bird.scaleVelocityY;
      }

      // --- 3. Draw Pipes ---
      const pipeWidth = 55;
      g.pipes.forEach((pipe) => {
        ctx.fillStyle = '#73bf2e';
        ctx.strokeStyle = '#477e18';
        ctx.lineWidth = 2.5;

        // Top Pipe
        ctx.fillRect(pipe.x, 0, pipeWidth, pipe.top);
        ctx.strokeRect(pipe.x, 0, pipeWidth, pipe.top);
        // Top Pipe Cap
        ctx.fillRect(pipe.x - 3, pipe.top - 20, pipeWidth + 6, 20);
        ctx.strokeRect(pipe.x - 3, pipe.top - 20, pipeWidth + 6, 20);

        // Pipe highlight line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(pipe.x + 5, 0, 5, pipe.top - 22);

        // Bottom Pipe
        const bottomHeight = V_HEIGHT - groundHeight - pipe.bottom;
        ctx.fillStyle = '#73bf2e';
        ctx.fillRect(pipe.x, pipe.bottom, pipeWidth, bottomHeight);
        ctx.strokeRect(pipe.x, pipe.bottom, pipeWidth, bottomHeight);
        // Bottom Pipe Cap
        ctx.fillRect(pipe.x - 3, pipe.bottom, pipeWidth + 6, 20);
        ctx.strokeRect(pipe.x - 3, pipe.bottom, pipeWidth + 6, 20);

        // Bottom pipe highlight line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(pipe.x + 5, pipe.bottom + 22, 5, bottomHeight - 22);
      });

      // --- 4. Draw Ground ---
      const groundY = V_HEIGHT - groundHeight;
      // Dirt body
      ctx.fillStyle = '#dec387';
      ctx.fillRect(0, groundY, V_WIDTH, groundHeight);

      // Green grass banner
      ctx.fillStyle = '#5ee270';
      ctx.fillRect(0, groundY, V_WIDTH, 14);

      ctx.strokeStyle = '#409c4d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY + 14);
      ctx.lineTo(V_WIDTH, groundY + 14);
      ctx.stroke();

      // Rolling stripes
      ctx.strokeStyle = '#cdb072';
      ctx.lineWidth = 3;
      for (let x = -20 + g.groundOffset; x < V_WIDTH + 20; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, groundY + 16);
        ctx.lineTo(x - 10, V_HEIGHT);
        ctx.stroke();
      }

      if (g.state !== GameState.GAMEOVER) {
        g.groundOffset = (g.groundOffset - 2.2) % 16;
      }

      // --- 5. Draw Bird (with jelly scale and tilt rotation) ---
      ctx.save();
      ctx.translate(g.bird.x, g.bird.y);
      ctx.rotate(g.bird.rotation);
      ctx.scale(g.bird.scaleX, g.bird.scaleY);

      // Bird body (Yellow)
      ctx.fillStyle = '#f7d336';
      ctx.beginPath();
      ctx.arc(0, 0, g.bird.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d49b13';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Belly reflection
      ctx.fillStyle = '#fae175';
      ctx.beginPath();
      ctx.arc(-2, 2, g.bird.radius - 4, 0, Math.PI * 2);
      ctx.fill();

      // Wing (flaps when climbing)
      const wingOffset = g.bird.velocity < 0 ? -3 : 0;
      ctx.fillStyle = '#fce57e';
      ctx.beginPath();
      ctx.ellipse(-6, 2 + wingOffset, 7, 4, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d49b13';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Eye
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(6, -4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(8, -4, 2, 0, Math.PI * 2);
      ctx.fill();

      // Beak (Orange-red)
      ctx.fillStyle = '#f35d25';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(19, 3);
      ctx.lineTo(10, 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#a4340d';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();

      // --- 6. In-Game UI Overlay ---
      if (g.state === GameState.PLAYING) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.font = 'bold 36px "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText(String(g.score), V_WIDTH / 2, 70);
        ctx.fillText(String(g.score), V_WIDTH / 2, 70);
      } else if (g.state === GameState.START) {
        // Semi-transparent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

        // Title
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 4;
        ctx.font = 'bold 32px "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText('FLAPPY BIRD', V_WIDTH / 2, 155);
        ctx.fillText('FLAPPY BIRD', V_WIDTH / 2, 155);

        // Subtitle badge
        ctx.font = 'bold 15px "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#fef08a';
        ctx.strokeStyle = '#854d0e';
        ctx.lineWidth = 2;
        ctx.strokeText('飛天小鳥', V_WIDTH / 2, 185);
        ctx.fillText('飛天小鳥', V_WIDTH / 2, 185);

        // Start callout
        ctx.font = 'bold 16px "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('點擊螢幕 或 按 [空白鍵] 開始跳躍', V_WIDTH / 2, 285);
        ctx.fillText('點擊螢幕 或 按 [空白鍵] 開始跳躍', V_WIDTH / 2, 285);

        // High score
        ctx.font = '14px "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#f1f5f9';
        ctx.fillText(`最高紀錄：${g.highScore}`, V_WIDTH / 2, 325);
      } else if (g.state === GameState.GAMEOVER) {
        // Overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

        // Scoreboard panel
        const panelW = 250;
        const panelH = 160;
        const panelX = (V_WIDTH - panelW) / 2;
        const panelY = 165;

        // Card shadow & background
        ctx.fillStyle = '#e2dc96';
        ctx.strokeStyle = '#543847';
        ctx.lineWidth = 3;
        ctx.fillRect(panelX, panelY, panelW, panelH);
        ctx.strokeRect(panelX, panelY, panelW, panelH);

        // GAME OVER Banner
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.font = 'bold 28px "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText('GAME OVER', V_WIDTH / 2, 135);
        ctx.fillText('GAME OVER', V_WIDTH / 2, 135);

        // Medal icon logic
        const medalX = panelX + 38;
        const medalY = panelY + 68;
        let medalColor = '#94a3b8'; // Bronze / Silver / Gold
        let medalLabel = '銅牌';
        let hasMedal = false;

        if (g.score >= 30) {
          medalColor = '#facc15';
          medalLabel = '金牌';
          hasMedal = true;
        } else if (g.score >= 20) {
          medalColor = '#cbd5e1';
          medalLabel = '銀牌';
          hasMedal = true;
        } else if (g.score >= 10) {
          medalColor = '#d97706';
          medalLabel = '銅牌';
          hasMedal = true;
        }

        if (hasMedal) {
          ctx.beginPath();
          ctx.arc(medalX, medalY, 20, 0, Math.PI * 2);
          ctx.fillStyle = medalColor;
          ctx.fill();
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#451a03';
          ctx.font = 'bold 12px "Segoe UI", Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(medalLabel, medalX, medalY + 4);
        }

        // Scores
        ctx.textAlign = 'left';
        ctx.font = 'bold 16px "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#543847';
        const textOffsetX = hasMedal ? panelX + 75 : panelX + 35;
        ctx.fillText(`本次分數：${g.score}`, textOffsetX, panelY + 55);
        ctx.fillText(`最高紀錄：${g.highScore}`, textOffsetX, panelY + 95);

        // Restart prompt
        ctx.textAlign = 'center';
        ctx.font = 'bold 15px "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText('點擊螢幕重新開始', V_WIDTH / 2, panelY + 200);
        ctx.fillText('點擊螢幕重新開始', V_WIDTH / 2, panelY + 200);
      }

      ctx.restore();

      g.frames++;
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [playSound]);

  // Global Keyboard event listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        handleAction();
      } else if ((e.code === 'KeyR' || e.key === 'r' || e.key === 'R') && gameRef.current.state === GameState.GAMEOVER) {
        e.preventDefault();
        handleAction();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleAction]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-4 px-2 select-none" id="flappy-bird-wrapper">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between w-full max-w-[360px] mb-3 px-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-400 border-2 border-amber-600 flex items-center justify-center shadow-md">
            <span className="text-lg">🐤</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide leading-none">Flappy Bird</h1>
            <p className="text-xs text-amber-300">經典飛天小鳥</p>
          </div>
        </div>

        {/* Audio Mute / Unmute Button */}
        <button
          id="audio-toggle-btn"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            initAudio();
            setIsMuted((prev) => !prev);
          }}
          className={`p-2 rounded-full border transition-all ${
            isMuted
              ? 'bg-rose-950/80 border-rose-600 text-rose-400'
              : 'bg-emerald-950/80 border-emerald-600 text-emerald-400'
          } hover:scale-105 active:scale-95 shadow`}
          title={isMuted ? '開啟音效' : '靜音'}
          aria-label={isMuted ? '開啟音效' : '靜音'}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </header>

      {/* Main Game Stage Container */}
      <div
        id="gameContainer"
        ref={containerRef}
        className="relative rounded-2xl shadow-2xl overflow-hidden border-4 border-slate-700 bg-[#70c5ce] cursor-pointer touch-none"
        style={{ width: `${V_WIDTH}px`, height: `${V_HEIGHT}px` }}
        onMouseDown={(e) => {
          e.preventDefault();
          handleAction();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          handleAction();
        }}
      >
        <canvas
          id="gameCanvas"
          ref={canvasRef}
          className="w-full h-full block"
          style={{ width: `${V_WIDTH}px`, height: `${V_HEIGHT}px` }}
        />
      </div>

      {/* Control Bar & Quick Stats */}
      <div className="w-full max-w-[360px] mt-4 flex flex-col gap-3">
        {/* Score Ribbon */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 px-3 py-2 rounded-xl text-slate-300 shadow">
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-[11px] text-slate-400 block uppercase tracking-wider">目前得分</span>
              <span className="text-lg font-black text-amber-400 leading-tight">{currentScore}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 px-3 py-2 rounded-xl text-slate-300 shadow">
            <Award className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-[11px] text-slate-400 block uppercase tracking-wider">最高紀錄</span>
              <span className="text-lg font-black text-emerald-400 leading-tight">{highScore}</span>
            </div>
          </div>
        </div>

        {/* Action Button for mobile or convenient clicking */}
        <div className="flex gap-2">
          <button
            id="jump-flap-button"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleAction();
            }}
            className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 active:scale-98 text-slate-950 font-bold rounded-xl shadow-lg border border-amber-300 flex items-center justify-center gap-2 text-base transition-all"
          >
            <span>🐥</span>
            <span>
              {gameState === GameState.START
                ? '開始遊戲 (跳躍)'
                : gameState === GameState.GAMEOVER
                ? '再來一局'
                : '拍翅跳躍 (Flap)'}
            </span>
          </button>

          {gameState === GameState.GAMEOVER && (
            <button
              id="restart-game-button"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleAction();
              }}
              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-slate-200 transition-all active:scale-95"
              title="重新開始"
              aria-label="重新開始"
            >
              <RotateCcw className="w-5 h-5 text-amber-400" />
            </button>
          )}
        </div>

        {/* Instructions Footer */}
        <div className="text-center text-xs text-slate-400 bg-slate-800/50 p-2.5 rounded-xl border border-slate-800">
          <p className="font-medium text-slate-300 mb-1">🎮 操作指南</p>
          <p>電腦：按 <kbd className="px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-slate-200 text-[11px]">空白鍵</kbd> 或滑鼠點擊跳躍</p>
          <p>手機：輕觸畫布任意處或下方按鈕跳躍</p>
        </div>
      </div>
    </div>
  );
}
