import React, { useEffect, useRef, useState } from 'react';
import { FastForward, FlipHorizontal, Pause, Play, RotateCcw } from 'lucide-react';
import { getSharedPoseLandmarker } from '../lib/pose/landmarker';
import { drawPoseOnCanvas } from '../lib/pose/renderer';
import type { DanceSequence, JointName, NormalizedLandmark } from '../lib/pose/types';
import { extractJointAngles } from '../lib/pose/geometry';

interface VideoComparisonViewerProps {
  modelSeq: DanceSequence;
  userSeq: DanceSequence;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  activeDiscrepancies?: JointName[];
}

export const VideoComparisonViewer: React.FC<VideoComparisonViewerProps> = ({
  modelSeq,
  userSeq,
  currentTime,
  onTimeUpdate,
  activeDiscrepancies = [],
}) => {
  const modelVideoRef = useRef<HTMLVideoElement | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);

  const modelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const userCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [mirrorUser, setMirrorUser] = useState<boolean>(false);

  const maxDuration = Math.max(modelSeq.duration, userSeq.duration) || 1;

  // 再生/一時停止の制御
  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  useEffect(() => {
    const mv = modelVideoRef.current;
    const uv = userVideoRef.current;
    if (!mv || !uv) return;

    if (isPlaying) {
      mv.playbackRate = playbackRate;
      uv.playbackRate = playbackRate;
      mv.play().catch((e) => console.warn('Model play error:', e));
      uv.play().catch((e) => console.warn('User play error:', e));
    } else {
      mv.pause();
      uv.pause();
    }
  }, [isPlaying, playbackRate]);

  // 外部からのcurrentTime変更（シークバー操作等）に同期
  useEffect(() => {
    const mv = modelVideoRef.current;
    const uv = userVideoRef.current;
    if (mv && Math.abs(mv.currentTime - currentTime) > 0.05) {
      mv.currentTime = Math.min(currentTime, mv.duration || currentTime);
    }
    if (uv && Math.abs(uv.currentTime - currentTime) > 0.05) {
      uv.currentTime = Math.min(currentTime, uv.duration || currentTime);
    }
  }, [currentTime]);

  // シークバー操作
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    onTimeUpdate(time);
  };

  // 速度変更
  const cyclePlaybackRate = () => {
    const rates = [1.0, 0.5];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  // リセット
  const handleReset = () => {
    onTimeUpdate(0);
    if (modelVideoRef.current) modelVideoRef.current.currentTime = 0;
    if (userVideoRef.current) userVideoRef.current.currentTime = 0;
  };

  // 【最重要】動画映像からの直接リアルタイム推論ループ（カメラと完全に同一）
  useEffect(() => {
    let animId: number;
    let isMounted = true;

    let lastModelLandmarks: NormalizedLandmark[] | null = null;
    let lastUserLandmarks: NormalizedLandmark[] | null = null;
    let lastModelInferredTime = -1;
    let lastUserInferredTime = -1;

    getSharedPoseLandmarker().then((landmarker) => {
      if (!isMounted) return;

      const loop = () => {
        if (!isMounted) return;

        const mv = modelVideoRef.current;
        const uv = userVideoRef.current;
        const mc = modelCanvasRef.current;
        const uc = userCanvasRef.current;

        // 再生時刻の同期更新
        if (mv && isPlaying) {
          onTimeUpdate(mv.currentTime);
          if (mv.ended || (uv && uv.ended)) {
            setIsPlaying(false);
          }
        }

        // 1. お手本動画の直接推論＆描画
        if (mv && mc && mv.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (mv.videoWidth > 0 && mv.videoHeight > 0) {
            if (mc.width !== mv.videoWidth || mc.height !== mv.videoHeight) {
              mc.width = mv.videoWidth;
              mc.height = mv.videoHeight;
            }
          }

          const mctx = mc.getContext('2d');
          if (mctx && mc.width > 0 && mc.height > 0) {
            mctx.clearRect(0, 0, mc.width, mc.height);

            if (Math.abs(mv.currentTime - lastModelInferredTime) > 0.02 || !isPlaying) {
              lastModelInferredTime = mv.currentTime;
              try {
                const res = landmarker.detect(mv);
                if (res.landmarks && res.landmarks.length > 0) {
                  lastModelLandmarks = res.landmarks[0] as NormalizedLandmark[];
                }
              } catch (err) {
                // スキップ
              }
            }

            if (lastModelLandmarks) {
              drawPoseOnCanvas(mctx, lastModelLandmarks, {
                mirror: false,
                glowEffect: true,
              });
            }
          }
        }

        // 2. 提出動画の直接推論＆描画（リアルタイム姿勢比較＆ズレ赤ハイライト）
        if (uv && uc && uv.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (uv.videoWidth > 0 && uv.videoHeight > 0) {
            if (uc.width !== uv.videoWidth || uc.height !== uv.videoHeight) {
              uc.width = uv.videoWidth;
              uc.height = uv.videoHeight;
            }
          }

          const uctx = uc.getContext('2d');
          if (uctx && uc.width > 0 && uc.height > 0) {
            uctx.clearRect(0, 0, uc.width, uc.height);

            if (Math.abs(uv.currentTime - lastUserInferredTime) > 0.02 || !isPlaying) {
              lastUserInferredTime = uv.currentTime;
              try {
                const res = landmarker.detect(uv);
                if (res.landmarks && res.landmarks.length > 0) {
                  lastUserLandmarks = res.landmarks[0] as NormalizedLandmark[];
                }
              } catch (err) {
                // スキップ
              }
            }

            // リアルタイムズレ判定
            let currentDiscrepancies = [...activeDiscrepancies];
            if (lastModelLandmarks && lastUserLandmarks) {
              const modelAngles = extractJointAngles(lastModelLandmarks);
              const userAngles = extractJointAngles(lastUserLandmarks);
              if (modelAngles && userAngles) {
                const liveDiscrepant: JointName[] = [];
                const checkJoint = (j: JointName) => {
                  if (Math.abs(modelAngles[j] - userAngles[j]) > 30) {
                    liveDiscrepant.push(j);
                  }
                };
                checkJoint('leftElbow');
                checkJoint('rightElbow');
                checkJoint('leftShoulder');
                checkJoint('rightShoulder');
                checkJoint('leftHip');
                checkJoint('rightHip');
                checkJoint('leftKnee');
                checkJoint('rightKnee');
                currentDiscrepancies = Array.from(new Set([...currentDiscrepancies, ...liveDiscrepant]));
              }
            }

            if (lastUserLandmarks) {
              drawPoseOnCanvas(uctx, lastUserLandmarks, {
                mirror: mirrorUser,
                activeDiscrepancies: currentDiscrepancies,
                glowEffect: true,
              });
            }
          }
        }

        animId = requestAnimationFrame(loop);
      };

      animId = requestAnimationFrame(loop);
    });

    return () => {
      isMounted = false;
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, activeDiscrepancies, mirrorUser, onTimeUpdate]);

  return (
    <div className="w-full flex flex-col gap-4">
      {/* 2画面サイドバイサイド動画エリア */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[42vh] sm:h-[48vh]">
        {/* 左側: お手本動画 */}
        <div className="relative w-full h-full bg-zinc-900 rounded-3xl overflow-hidden flex items-center justify-center shadow-xl">
          <div className="absolute top-4 left-4 z-20 px-3 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md text-[10px] font-bold tracking-widest uppercase text-zinc-300">
            REFERENCE ({modelSeq.frames.length} POSES)
          </div>
          <video
            ref={modelVideoRef}
            src={modelSeq.videoUrl}
            playsInline
            muted
            className="w-full h-full object-contain"
          />
          <canvas
            ref={modelCanvasRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        </div>

        {/* 右側: 提出動画 */}
        <div className="relative w-full h-full bg-zinc-900 rounded-3xl overflow-hidden flex items-center justify-center shadow-xl">
          <div className="absolute top-4 left-4 z-20 px-3 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md text-[10px] font-bold tracking-widest uppercase text-zinc-300">
            YOUR DANCE ({userSeq.frames.length} POSES)
          </div>

          {/* ミラートグルボタン */}
          <button
            onClick={() => setMirrorUser((p) => !p)}
            className={`absolute top-4 right-4 z-20 px-2.5 py-1.5 rounded-full flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase backdrop-blur-md transition cursor-pointer ${
              mirrorUser
                ? 'bg-white text-zinc-950 shadow-md'
                : 'bg-zinc-950/80 hover:bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
            title="Mirror Video & Skeleton"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span>MIRROR</span>
          </button>

          <video
            ref={userVideoRef}
            src={userSeq.videoUrl}
            playsInline
            muted
            className={`w-full h-full object-contain ${mirrorUser ? 'scale-x-[-1]' : ''}`}
          />
          <canvas
            ref={userCanvasRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        </div>
      </div>

      {/* 共通コントロールバー */}
      <div className="w-full bg-zinc-900/95 backdrop-blur-xl px-5 py-3 rounded-full flex items-center gap-4 shadow-xl">
        {/* 再生/一時停止 */}
        <button
          onClick={togglePlay}
          className="p-3 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 transition active:scale-90 cursor-pointer shadow-md shrink-0"
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {/* リセット */}
        <button
          onClick={handleReset}
          className="p-2.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer shrink-0"
          title="Restart"
          aria-label="Restart"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* シークバー */}
        <div className="flex-1 flex items-center gap-3">
          <span className="text-[10px] font-mono text-zinc-400 tabular-nums w-9 text-right shrink-0">
            {currentTime.toFixed(1)}s
          </span>
          <input
            type="range"
            min={0}
            max={maxDuration}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
          <span className="text-[10px] font-mono text-zinc-500 tabular-nums w-9 shrink-0">
            {maxDuration.toFixed(1)}s
          </span>
        </div>

        {/* 再生速度 */}
        <button
          onClick={cyclePlaybackRate}
          className="px-2.5 py-1.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-mono font-semibold transition active:scale-95 cursor-pointer shrink-0"
          title="Playback Speed"
          aria-label="Playback Speed"
        >
          {playbackRate}x
        </button>

        {/* コマ送り（+0.1s） */}
        <button
          onClick={() => {
            const next = Math.min(maxDuration, currentTime + 0.1);
            onTimeUpdate(next);
          }}
          className="p-2.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer shrink-0"
          title="Step Forward"
          aria-label="Step Forward"
        >
          <FastForward className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
