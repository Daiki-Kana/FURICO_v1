import React, { useEffect, useRef, useState } from 'react';
import { FastForward, FlipHorizontal, Pause, Play, RotateCcw } from 'lucide-react';
import { DEFAULT_JOINT_ANGLES, extractJointAngles } from '../lib/pose/geometry';
import { findClosestFrame } from '../lib/pose/interpolator';
import { getSharedPoseLandmarker } from '../lib/pose/landmarker';
import { drawPoseOnCanvas } from '../lib/pose/renderer';
import type { DanceSequence, JointName, NormalizedLandmark, PoseFrameData } from '../lib/pose/types';

interface VideoComparisonViewerProps {
  modelSeq: DanceSequence;
  userSeq: DanceSequence;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  activeDiscrepancies?: JointName[];
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

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [mirrorUser, setMirrorUser] = useState<boolean>(false);

  const [modelAspect, setModelAspect] = useState<number | null>(
    modelSeq.width && modelSeq.height ? modelSeq.width / modelSeq.height : null
  );
  const [userAspect, setUserAspect] = useState<number | null>(
    userSeq.width && userSeq.height ? userSeq.width / userSeq.height : null
  );

  const landmarkerRef = useRef<any>(null);
  const isInferringRef = useRef<boolean>(false);
  const lastInferTimeRef = useRef<number>(0);
  const inferTargetRef = useRef<'model' | 'user'>('model');

  const latestModelLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const latestUserLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const latestModelAnglesRef = useRef<any>(null);
  const latestUserAnglesRef = useRef<any>(null);

  const maxDuration = Math.max(modelSeq.duration, userSeq.duration) || 1;

  // 共有MediaPipeインスタンスの読み込み
  useEffect(() => {
    let active = true;
    getSharedPoseLandmarker()
      .then((instance) => {
        if (active) landmarkerRef.current = instance;
      })
      .catch((err) => console.warn('Failed to load shared pose landmarker for comparison:', err));

    return () => {
      active = false;
    };
  }, []);

  // 再生/一時停止
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
      mv.play().catch(() => {});
      uv.play().catch(() => {});
    } else {
      mv.pause();
      uv.pause();
    }
  }, [isPlaying, playbackRate]);

  // 【重要: 再生中のシークフリーズを完全根絶】
  // 一時停止中（シークバー操作など）のみ video.currentTime を更新する
  useEffect(() => {
    if (isPlaying) return; // 再生中は動画自身の再生クロックに任せる！強制シークは絶対に禁止
    const mv = modelVideoRef.current;
    const uv = userVideoRef.current;
    if (mv && Math.abs(mv.currentTime - currentTime) > 0.08) {
      mv.currentTime = Math.min(currentTime, mv.duration || currentTime);
    }
    if (uv && Math.abs(uv.currentTime - currentTime) > 0.08) {
      uv.currentTime = Math.min(currentTime, uv.duration || currentTime);
    }
  }, [currentTime, isPlaying]);

  // 手動シーク操作
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    onTimeUpdate(time);
    if (modelVideoRef.current) {
      modelVideoRef.current.currentTime = Math.min(time, modelVideoRef.current.duration || time);
    }
    if (userVideoRef.current) {
      userVideoRef.current.currentTime = Math.min(time, userVideoRef.current.duration || time);
    }
  };

  // 速度変更
  const cyclePlaybackRate = () => {
    const rates = [1.0, 0.75, 0.5];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  // リセット
  const handleReset = () => {
    onTimeUpdate(0);
    if (modelVideoRef.current) modelVideoRef.current.currentTime = 0;
    if (userVideoRef.current) userVideoRef.current.currentTime = 0;
  };

  // 【超軽量・高精度 同期描画ループ（交互推論・ドリフト自動調停・完全吸着）】
  const lastStateUpdateTimeRef = useRef<number>(0);

  useEffect(() => {
    let animId: number;

    const loop = () => {
      const mv = modelVideoRef.current;
      const uv = userVideoRef.current;
      const mc = modelCanvasRef.current;
      const uc = userCanvasRef.current;

      const now = performance.now();

      // 再生時刻の同期更新（100msスロットリング）
      if (mv && isPlaying) {
        if (now - lastStateUpdateTimeRef.current > 100) {
          lastStateUpdateTimeRef.current = now;
          onTimeUpdate(mv.currentTime);

          // 2つの動画の再生位置が 0.35秒以上ズレた場合のみ、微小補正（カクつき防止）
          if (uv && Math.abs(mv.currentTime - uv.currentTime) > 0.35) {
            uv.currentTime = mv.currentTime;
          }
        }
      }

      // 1. お手本動画の解像度同期
      if (mv && mc && mv.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (mv.videoWidth > 0 && mv.videoHeight > 0) {
          if (mc.width !== mv.videoWidth || mc.height !== mv.videoHeight) {
            mc.width = mv.videoWidth;
            mc.height = mv.videoHeight;
            if (!modelAspect) setModelAspect(mv.videoWidth / mv.videoHeight);
          }
        }

        const mt = mv.currentTime;
        const cachedModel = findClosestFrame(modelSeq.frames, mt);
        if (cachedModel && Math.abs(cachedModel.timestamp - mt) <= 0.06) {
          latestModelLandmarksRef.current = cachedModel.landmarks;
          latestModelAnglesRef.current = cachedModel.angles;
        }

        const mctx = mc.getContext('2d');
        if (mctx && mc.width > 0 && mc.height > 0) {
          mctx.clearRect(0, 0, mc.width, mc.height);
          if (latestModelLandmarksRef.current) {
            drawPoseOnCanvas(mctx, latestModelLandmarksRef.current, {
              mirror: false,
              glowEffect: true,
            });
          }
        }
      }

      // 2. 提出動画の解像度同期 & リアルタイム比較描画
      if (uv && uc && uv.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (uv.videoWidth > 0 && uv.videoHeight > 0) {
          if (uc.width !== uv.videoWidth || uc.height !== uv.videoHeight) {
            uc.width = uv.videoWidth;
            uc.height = uv.videoHeight;
            if (!userAspect) setUserAspect(uv.videoWidth / uv.videoHeight);
          }
        }

        const ut = uv.currentTime;
        const cachedUser = findClosestFrame(userSeq.frames, ut);
        if (cachedUser && Math.abs(cachedUser.timestamp - ut) <= 0.06) {
          latestUserLandmarksRef.current = cachedUser.landmarks;
          latestUserAnglesRef.current = cachedUser.angles;
        }

        const uctx = uc.getContext('2d');
        if (uctx && uc.width > 0 && uc.height > 0) {
          uctx.clearRect(0, 0, uc.width, uc.height);

          if (latestUserLandmarksRef.current) {
            // お手本と提出動画の角度をリアルタイム比較（40度以上の明確なズレのみ赤発光）
            let currentDiscrepancies = [...activeDiscrepancies];
            const ma = latestModelAnglesRef.current;
            const ua = latestUserAnglesRef.current;

            if (ma && ua) {
              const liveDiscrepant: JointName[] = [];
              const checkJoint = (j: JointName) => {
                if (Math.abs(ma[j] - ua[j]) > 40) {
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

            drawPoseOnCanvas(uctx, latestUserLandmarksRef.current, {
              mirror: mirrorUser,
              activeDiscrepancies: currentDiscrepancies,
              glowEffect: true,
            });
          }
        }
      }

      // 3. 【推論の交互インターリーブ実行】メインスレッド負荷を半減させ、動画フリーズを根絶！
      if (
        landmarkerRef.current &&
        !isInferringRef.current &&
        now - lastInferTimeRef.current >= 35
      ) {
        const target = inferTargetRef.current;
        inferTargetRef.current = target === 'model' ? 'user' : 'model'; // 次回は相手を推論

        if (target === 'model' && mv && mv.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const mt = mv.currentTime;
          const cached = findClosestFrame(modelSeq.frames, mt);
          if (!cached || Math.abs(cached.timestamp - mt) > 0.06) {
            isInferringRef.current = true;
            try {
              const res = landmarkerRef.current.detect(mv);
              if (res.landmarks && res.landmarks.length > 0) {
                const lms = res.landmarks[0];
                latestModelLandmarksRef.current = lms;
                const angles = extractJointAngles(lms) || DEFAULT_JOINT_ANGLES;
                latestModelAnglesRef.current = angles;
                insertFrameSorted(modelSeq.frames, {
                  timestamp: mt,
                  landmarks: lms,
                  angles,
                });
              }
            } catch (_) {
            } finally {
              isInferringRef.current = false;
              lastInferTimeRef.current = performance.now();
            }
          }
        } else if (target === 'user' && uv && uv.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const ut = uv.currentTime;
          const cached = findClosestFrame(userSeq.frames, ut);
          if (!cached || Math.abs(cached.timestamp - ut) > 0.06) {
            isInferringRef.current = true;
            try {
              const res = landmarkerRef.current.detect(uv);
              if (res.landmarks && res.landmarks.length > 0) {
                const lms = res.landmarks[0];
                latestUserLandmarksRef.current = lms;
                const angles = extractJointAngles(lms) || DEFAULT_JOINT_ANGLES;
                latestUserAnglesRef.current = angles;
                insertFrameSorted(userSeq.frames, {
                  timestamp: ut,
                  landmarks: lms,
                  angles,
                });
              }
            } catch (_) {
            } finally {
              isInferringRef.current = false;
              lastInferTimeRef.current = performance.now();
            }
          }
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, modelSeq, userSeq, activeDiscrepancies, mirrorUser, onTimeUpdate, modelAspect, userAspect]);

  return (
    <div className="w-full flex flex-col gap-4">
      {/* 2画面サイドバイサイド動画エリア */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[42vh] sm:h-[48vh]">
        {/* 左側: お手本動画 */}
        <div className="relative w-full h-full bg-zinc-950 rounded-3xl overflow-hidden flex items-center justify-center shadow-xl">
          <div className="absolute top-4 left-4 z-20 px-3 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md text-[10px] font-bold tracking-widest uppercase text-zinc-300">
            REFERENCE DANCE
          </div>

          <div
            className="relative max-w-full max-h-full flex items-center justify-center overflow-hidden"
            style={{
              aspectRatio: modelAspect ? `${modelAspect}` : undefined,
              width: modelAspect && modelAspect > 1 ? '100%' : 'auto',
              height: modelAspect && modelAspect <= 1 ? '100%' : 'auto',
            }}
          >
            <video
              ref={modelVideoRef}
              src={modelSeq.videoUrl}
              playsInline
              muted
              loop
              onLoadedMetadata={() => {
                const v = modelVideoRef.current;
                if (v && v.videoWidth > 0 && v.videoHeight > 0) {
                  setModelAspect(v.videoWidth / v.videoHeight);
                }
              }}
              className="w-full h-full block object-contain"
            />
            <canvas
              ref={modelCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </div>
        </div>

        {/* 右側: 提出動画 */}
        <div className="relative w-full h-full bg-zinc-950 rounded-3xl overflow-hidden flex items-center justify-center shadow-xl">
          <div className="absolute top-4 left-4 z-20 px-3 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md text-[10px] font-bold tracking-widest uppercase text-zinc-300">
            YOUR DANCE
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

          <div
            className="relative max-w-full max-h-full flex items-center justify-center overflow-hidden"
            style={{
              aspectRatio: userAspect ? `${userAspect}` : undefined,
              width: userAspect && userAspect > 1 ? '100%' : 'auto',
              height: userAspect && userAspect <= 1 ? '100%' : 'auto',
            }}
          >
            <video
              ref={userVideoRef}
              src={userSeq.videoUrl}
              playsInline
              muted
              loop
              onLoadedMetadata={() => {
                const v = userVideoRef.current;
                if (v && v.videoWidth > 0 && v.videoHeight > 0) {
                  setUserAspect(v.videoWidth / v.videoHeight);
                }
              }}
              className={`w-full h-full block object-contain ${mirrorUser ? 'scale-x-[-1]' : ''}`}
            />
            <canvas
              ref={userCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </div>
        </div>
      </div>

      {/* 共通コントロールバー（ボーダーレス・アイコンファースト） */}
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
            if (modelVideoRef.current) modelVideoRef.current.currentTime = next;
            if (userVideoRef.current) userVideoRef.current.currentTime = next;
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
