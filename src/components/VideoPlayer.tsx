import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { drawPoseOnCanvas } from '../lib/pose/renderer';
import type { DanceSequence } from '../lib/pose/types';

interface VideoPlayerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sequence: DanceSequence | null;
  isPlaying: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  showSkeleton?: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoRef,
  sequence,
  isPlaying,
  onTimeUpdate,
  onEnded,
  showSkeleton = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const [isMuted, setIsMuted] = useState(true);

  // 再生/一時停止の制御
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch((e) => console.warn('Video play error:', e));
    } else {
      video.pause();
    }
  }, [isPlaying, videoRef]);

  // ミュート状態の反映
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  // お手本骨格のオーバーレイ描画ループ
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !sequence) return;

    let isRunning = true;

    const loop = () => {
      if (!isRunning) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (showSkeleton && sequence.frames.length > 0) {
            const currentTime = video.currentTime;

            // 現在時刻に最も近いお手本フレームを最近傍探索
            let closest = sequence.frames[0];
            let minDiff = Math.abs(closest.timestamp - currentTime);

            for (let i = 1; i < sequence.frames.length; i++) {
              const diff = Math.abs(sequence.frames[i].timestamp - currentTime);
              if (diff < minDiff) {
                minDiff = diff;
                closest = sequence.frames[i];
              }
            }

            if (closest && minDiff < 0.25) {
              drawPoseOnCanvas(ctx, closest.landmarks, {
                mirror: false,
                glowEffect: false,
              });
            }
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(loop);
    };

    animFrameIdRef.current = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [videoRef, sequence, showSkeleton]);

  if (!sequence) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 rounded-3xl p-6 text-center select-none">
        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <span className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
          NO REFERENCE VIDEO
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-zinc-900 rounded-3xl overflow-hidden select-none shadow-2xl group">
      <video
        ref={videoRef}
        src={sequence.videoUrl}
        playsInline
        muted={isMuted}
        loop
        className="w-full h-full object-contain"
        onTimeUpdate={() => {
          if (videoRef.current && onTimeUpdate) {
            onTimeUpdate(videoRef.current.currentTime);
          }
        }}
        onEnded={onEnded}
      />
      {/* 骨格オーバーレイ用Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
      />

      {/* 音声ミュートトグルボタン（ボーダーレス・アイコンファースト） */}
      <button
        onClick={toggleMute}
        className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-zinc-950/70 hover:bg-zinc-900 text-zinc-300 hover:text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition duration-200 active:scale-95 cursor-pointer"
        title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
    </div>
  );
};
