import React, { useEffect, useRef, useState } from 'react';
import {
  FastForward,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  User,
} from 'lucide-react';
import { drawAvatar, type AvatarStyle } from '../lib/pose/avatarRenderer';
import { getInterpolatedFrame } from '../lib/pose/interpolator';
import type { DanceSequence } from '../lib/pose/types';

interface PoseModelViewerProps {
  sequence: DanceSequence;
  onReset?: () => void;
}

export const PoseModelViewer: React.FC<PoseModelViewerProps> = ({ sequence }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 再生制御ステート
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [style, setStyle] = useState<AvatarStyle>('humanoid');

  // 3D視点回転（Yaw角度）
  const [rotationY, setRotationY] = useState<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const lastMouseXRef = useRef<number>(0);

  // 再生ループ用のRef
  const currentTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  const playbackRateRef = useRef<number>(playbackRate);
  playbackRateRef.current = playbackRate;

  const styleRef = useRef<AvatarStyle>(style);
  styleRef.current = style;

  const rotationYRef = useRef<number>(rotationY);
  rotationYRef.current = rotationY;

  // 軌跡トレース用の座標履歴
  const trajectoryRef = useRef<{
    leftWrist: { x: number; y: number }[];
    rightWrist: { x: number; y: number }[];
  }>({ leftWrist: [], rightWrist: [] });

  // シークバー操作
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    currentTimeRef.current = val;
    setCurrentTime(val);
  };

  // 再生トグル
  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  // 速度切り替え（1.0x -> 0.5x -> 0.25x -> 1.0x）
  const cyclePlaybackRate = () => {
    const rates = [1.0, 0.5, 0.25];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  // スタイル切り替え（Humanoid -> Mocap -> Mannequin -> Tracer）
  const cycleStyle = () => {
    const styles: AvatarStyle[] = ['humanoid', 'mocap', 'mannequin', 'tracer'];
    const nextIdx = (styles.indexOf(style) + 1) % styles.length;
    setStyle(styles[nextIdx]);
  };

  // マウスドラッグによる3D視点回転イベント
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastMouseXRef.current = e.clientX;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - lastMouseXRef.current;
    lastMouseXRef.current = e.clientX;
    setRotationY((prev) => {
      const next = prev + deltaX * 0.01;
      rotationYRef.current = next;
      return next;
    });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // 60fps/120fps 超滑らか補間描画ループ
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    let lastTimestamp = performance.now();

    const loop = (now: number) => {
      const deltaSec = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      // 再生進捗の更新
      if (isPlayingRef.current && sequence.duration > 0) {
        let nextTime = currentTimeRef.current + deltaSec * playbackRateRef.current;
        if (nextTime > sequence.duration) {
          nextTime = 0; // ループ再生
          trajectoryRef.current = { leftWrist: [], rightWrist: [] };
        }
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
      }

      // Canvasサイズ調整
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.round(rect.width * dpr);
      const targetHeight = Math.round(rect.height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 線形補間（Lerp）による現在フレームの取得
        const interpolated = getInterpolatedFrame(sequence.frames, currentTimeRef.current);

        if (interpolated) {
          // Tracer用の座標履歴追従
          const leftWrist = interpolated.landmarks[15];
          const rightWrist = interpolated.landmarks[16];

          if (leftWrist && rightWrist) {
            const lw = { x: leftWrist.x * canvas.width, y: leftWrist.y * canvas.height };
            const rw = { x: rightWrist.x * canvas.width, y: rightWrist.y * canvas.height };

            trajectoryRef.current.leftWrist.push(lw);
            trajectoryRef.current.rightWrist.push(rw);

            if (trajectoryRef.current.leftWrist.length > 18) {
              trajectoryRef.current.leftWrist.shift();
              trajectoryRef.current.rightWrist.shift();
            }
          }

          // 人型モデルの描画
          drawAvatar(ctx, interpolated.landmarks, {
            style: styleRef.current,
            rotationY: rotationYRef.current,
            trajectoryPoints: trajectoryRef.current,
            glow: true,
          });
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [sequence]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-zinc-950 overflow-hidden select-none">
      {/* 3Dドラッグ回転可能な描画キャンバス */}
      <div
        className="relative w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
        />

        {/* 3D視点リセットボタン */}
        {rotationY !== 0 && (
          <button
            onClick={() => {
              setRotationY(0);
              rotationYRef.current = 0;
            }}
            className="absolute top-6 left-6 p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white backdrop-blur-md transition active:scale-95 cursor-pointer"
            title="Reset View"
            aria-label="Reset View"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}

        {/* スタイル表示バッジ */}
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <button
            onClick={cycleStyle}
            className="px-4 py-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 hover:text-white backdrop-blur-md flex items-center gap-2 text-xs font-bold tracking-widest uppercase transition active:scale-95 cursor-pointer shadow-lg"
          >
            {style === 'humanoid' && <User className="w-3.5 h-3.5 text-zinc-100" />}
            {style === 'mocap' && <User className="w-3.5 h-3.5 text-zinc-400" />}
            {style === 'mannequin' && <Layers className="w-3.5 h-3.5 text-zinc-400" />}
            {style === 'tracer' && <Sparkles className="w-3.5 h-3.5 text-pink-400" />}
            <span>{style}</span>
          </button>
        </div>
      </div>

      {/* 下部コントロールエリア（ボーダーレス） */}
      <footer aria-label="Playback controls" className="absolute bottom-6 w-full max-w-xl px-6 flex flex-col items-center gap-3 pointer-events-auto">
        {/* タイムラインシークバー */}
        <div className="w-full flex items-center gap-4 bg-zinc-900/90 backdrop-blur-md px-4 py-2 rounded-full shadow-2xl">
          <span className="text-[10px] font-mono font-semibold tabular-nums text-zinc-400 w-10 text-right">
            {currentTime.toFixed(2)}s
          </span>
          <input
            type="range"
            min={0}
            max={sequence.duration || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
          <span className="text-[10px] font-mono font-semibold tabular-nums text-zinc-500 w-10">
            {sequence.duration.toFixed(2)}s
          </span>
        </div>

        {/* コントロールボタン群 */}
        <div className="flex items-center gap-3 bg-zinc-900/95 backdrop-blur-xl px-5 py-2.5 rounded-full shadow-2xl">
          {/* 再生速度セレクタ */}
          <button
            onClick={cyclePlaybackRate}
            className="px-2.5 py-1.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-mono font-semibold transition active:scale-95 cursor-pointer"
            title="Playback Speed"
            aria-label="Playback Speed"
          >
            {playbackRate}x
          </button>

          {/* 再生 / 一時停止 */}
          <button
            onClick={togglePlay}
            className="p-3.5 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 transition active:scale-90 cursor-pointer shadow-lg"
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          {/* 最初から再生 */}
          <button
            onClick={() => {
              currentTimeRef.current = 0;
              setCurrentTime(0);
            }}
            className="p-2.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
            title="Restart"
            aria-label="Restart"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* コマ送り（+0.05秒） */}
          <button
            onClick={() => {
              const next = Math.min(sequence.duration, currentTimeRef.current + 0.05);
              currentTimeRef.current = next;
              setCurrentTime(next);
            }}
            className="p-2.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
            title="Step Forward"
            aria-label="Step Forward"
          >
            <FastForward className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
};
