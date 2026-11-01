import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { getInterpolatedFrame } from '../lib/pose/interpolator';
import { drawPoseOnCanvas } from '../lib/pose/renderer';
import type { DanceSequence } from '../lib/pose/types';

interface TrackedVideoPlayerProps {
  sequence: DanceSequence;
  label?: string;
  onReplace?: () => void;
}

export const TrackedVideoPlayer: React.FC<TrackedVideoPlayerProps> = ({
  sequence,
  label,
  onReplace,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // 再生/一時停止
  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      v.play().catch((err) => console.warn('Play error:', err));
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  // シーク操作
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  // リセット（最初から再生）
  const handleRestart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // ミュート切り替え
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  // 骨格オーバーレイ描画ループ
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let animId: number;

    const loop = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const t = video.currentTime;
          setCurrentTime(t);

          if (sequence.frames.length > 0) {
            // 線形補間（Lerp）により現在時刻の骨格座標を滑らかに算出
            const interpolated = getInterpolatedFrame(sequence.frames, t);
            if (interpolated) {
              drawPoseOnCanvas(ctx, interpolated.landmarks, {
                mirror: false,
                glowEffect: true,
              });
            }
          }
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [sequence]);

  // 初回自動再生
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [sequence]);

  return (
    <div
      className={`relative w-full h-full bg-zinc-950 rounded-3xl overflow-hidden flex items-center justify-center group select-none shadow-xl ${
        isFullscreen ? 'fixed inset-4 z-50 rounded-3xl shadow-2xl' : ''
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 動画本体 */}
      <video
        ref={videoRef}
        src={sequence.videoUrl}
        playsInline
        muted={isMuted}
        loop
        className="w-full h-full object-contain"
        onEnded={() => setIsPlaying(false)}
      />

      {/* 骨格ワイヤーフレーム描画Canvas（動画の上にピタリと重なる） */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
      />

      {/* 上部バッジと操作ボタン */}
      <div className="absolute top-3 inset-x-3 flex items-center justify-between z-20 pointer-events-none">
        {label && (
          <span className="px-3 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md text-[10px] font-bold tracking-widest uppercase text-zinc-300">
            {label}
          </span>
        )}

        <div className="flex items-center gap-1.5 pointer-events-auto ml-auto">
          {/* 音量トグル */}
          <button
            onClick={toggleMute}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer backdrop-blur-md"
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label="Toggle Audio"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* 全画面拡大トグル */}
          <button
            onClick={() => setIsFullscreen((p) => !p)}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer backdrop-blur-md"
            title="Expand Preview"
            aria-label="Expand Preview"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* 再提出・削除ボタン */}
          {onReplace && (
            <button
              onClick={onReplace}
              className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition active:scale-95 cursor-pointer backdrop-blur-md"
              title="Replace Video"
              aria-label="Replace Video"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 下部コントロールバー（ホバーまたはタップで常時表示） */}
      <div className="absolute bottom-3 inset-x-3 z-20 bg-zinc-900/90 backdrop-blur-md px-3.5 py-2 rounded-2xl flex items-center gap-3 transition-opacity duration-200">
        {/* 再生/一時停止 */}
        <button
          onClick={togglePlay}
          className="p-2 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 transition active:scale-90 cursor-pointer shadow"
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          )}
        </button>

        {/* リスタート */}
        <button
          onClick={handleRestart}
          className="p-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
          title="Restart"
          aria-label="Restart"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* シークバー */}
        <div className="flex-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={sequence.duration || 1}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
          <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-8 text-right">
            {currentTime.toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
};
