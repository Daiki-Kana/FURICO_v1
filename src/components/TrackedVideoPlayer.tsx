import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { DEFAULT_JOINT_ANGLES, extractJointAngles } from '../lib/pose/geometry';
import { findClosestFrame } from '../lib/pose/interpolator';
import { getSharedPoseLandmarker } from '../lib/pose/landmarker';
import { drawPoseOnCanvas } from '../lib/pose/renderer';
import type { DanceSequence, NormalizedLandmark, PoseFrameData } from '../lib/pose/types';

interface TrackedVideoPlayerProps {
  sequence: DanceSequence;
  label?: string;
  onReplace?: () => void;
}

/**
 * 昇順を保ちながらフレームを挿入するヘルパー（重複時刻は上書き）
 */
function insertFrameSorted(frames: PoseFrameData[], newFrame: PoseFrameData) {
  const t = newFrame.timestamp;
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const diff = frames[mid].timestamp - t;
    if (Math.abs(diff) <= 0.03) {
      frames[mid] = newFrame;
      return;
    }
    if (diff < 0) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  frames.splice(low, 0, newFrame);
}

export const TrackedVideoPlayer: React.FC<TrackedVideoPlayerProps> = ({
  sequence,
  label,
  onReplace,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [videoAspect, setVideoAspect] = useState<number | null>(
    sequence.width && sequence.height ? sequence.width / sequence.height : null
  );

  const lastStateUpdateTimeRef = useRef<number>(0);
  const lastInferTimeRef = useRef<number>(0);
  const isInferringRef = useRef<boolean>(false);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const landmarkerInstanceRef = useRef<any>(null);

  // 共有MediaPipeインスタンスのロード
  useEffect(() => {
    let active = true;
    getSharedPoseLandmarker()
      .then((instance) => {
        if (active) {
          landmarkerInstanceRef.current = instance;
        }
      })
      .catch((err) => {
        console.warn('Failed to get shared pose landmarker:', err);
      });

    return () => {
      active = false;
    };
  }, []);

  // 動画のメタデータロード時に縦横比を取得
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoAspect(v.videoWidth / v.videoHeight);
    }
  };

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

  // 【60fps描画 & 20fpsリアルタイム推論 & 即時キャッシュ】
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let animId: number;

    const loop = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Canvasの内部解像度をビデオ解像度と完全に同期（1ピクセルのズレも根絶）
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            if (!videoAspect) {
              setVideoAspect(video.videoWidth / video.videoHeight);
            }
          }
        }

        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const t = video.currentTime;
          const now = performance.now();

          // シークバーの更新は100msごとにスロットリング（React負荷90%削減）
          if (now - lastStateUpdateTimeRef.current > 100) {
            lastStateUpdateTimeRef.current = now;
            setCurrentTime(t);
          }

          // 1. まずキャッシュ（既存フレーム）から探す
          const cached = findClosestFrame(sequence.frames, t);
          let currentLandmarks: NormalizedLandmark[] | null = null;

          if (cached && Math.abs(cached.timestamp - t) <= 0.06) {
            currentLandmarks = cached.landmarks;
            latestLandmarksRef.current = cached.landmarks;
          } else {
            // 2. キャッシュにない場合、20fps（50ms間隔）でリアルタイム推論を実行
            if (
              landmarkerInstanceRef.current &&
              !isInferringRef.current &&
              now - lastInferTimeRef.current >= 45
            ) {
              isInferringRef.current = true;
              try {
                const result = landmarkerInstanceRef.current.detect(video);
                if (result.landmarks && result.landmarks.length > 0) {
                  const lms = result.landmarks[0];
                  latestLandmarksRef.current = lms;
                  currentLandmarks = lms;

                  // 抽出した骨格フレームをキャッシュに記録（二分探索可能）
                  const angles = extractJointAngles(lms) || DEFAULT_JOINT_ANGLES;
                  const newFrame: PoseFrameData = {
                    timestamp: t,
                    landmarks: lms,
                    angles,
                  };
                  insertFrameSorted(sequence.frames, newFrame);
                }
              } catch (inferErr) {
                // シークや破棄時の安全ガード
              } finally {
                isInferringRef.current = false;
                lastInferTimeRef.current = performance.now();
              }
            }

            // 推論間隔の間は直近の骨格を維持してチラつきを防止
            if (!currentLandmarks && latestLandmarksRef.current) {
              currentLandmarks = latestLandmarksRef.current;
            }
          }

          // 3. 骨格のレンダリング（動画と100%吸着）
          if (currentLandmarks) {
            drawPoseOnCanvas(ctx, currentLandmarks, {
              mirror: false,
              glowEffect: true,
            });
          }
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [sequence, videoAspect]);

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
      ref={containerRef}
      className={`relative w-full h-full bg-zinc-950 rounded-3xl overflow-hidden flex items-center justify-center group select-none shadow-xl ${
        isFullscreen ? 'fixed inset-4 z-50 rounded-3xl shadow-2xl' : ''
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 
        動画とCanvasを同一のアスペクト比ラッパーに収めることで、
        親コンテナと動画の比率差（黒帯）による骨格ズレを100%根絶 
      */}
      <div
        className="relative max-w-full max-h-full flex items-center justify-center overflow-hidden"
        style={{
          aspectRatio: videoAspect ? `${videoAspect}` : undefined,
          width: videoAspect && videoAspect > 1 ? '100%' : 'auto',
          height: videoAspect && videoAspect <= 1 ? '100%' : 'auto',
        }}
      >
        {/* 動画本体 */}
        <video
          ref={videoRef}
          src={sequence.videoUrl}
          playsInline
          muted={isMuted}
          loop
          onLoadedMetadata={handleLoadedMetadata}
          className="w-full h-full block object-contain"
          onEnded={() => setIsPlaying(false)}
        />

        {/* 骨格ワイヤーフレーム描画Canvas（動画と寸分違わず100%吸着） */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      </div>

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

      {/* 下部コントロールバー（ボーダーレス・アイコンファースト） */}
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
