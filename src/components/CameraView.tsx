import React, { useEffect, useRef } from 'react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { compareWithSlidingWindow, type SlidingWindowOptions } from '../lib/comparator/slidingWindow';
import { extractJointAngles } from '../lib/pose/geometry';
import { drawPoseOnCanvas } from '../lib/pose/renderer';
import type { ComparisonResult, PoseFrameData } from '../lib/pose/types';

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarker: PoseLandmarker | null;
  modelFrames: PoseFrameData[] | null;
  modelVideoRef: React.RefObject<HTMLVideoElement | null>;
  isPracticing: boolean;
  mirror?: boolean;
  comparisonOptions: SlidingWindowOptions;
  onComparisonUpdate?: (result: ComparisonResult | null) => void;
}

export const CameraView: React.FC<CameraViewProps> = ({
  videoRef,
  landmarker,
  modelFrames,
  modelVideoRef,
  isPracticing,
  mirror = true,
  comparisonOptions,
  onComparisonUpdate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const lastTimestampMsRef = useRef<number>(0);
  const lastResultTimeRef = useRef<number>(0);

  // コールバック関数やオプションの最新値を保持するRef
  const optionsRef = useRef(comparisonOptions);
  optionsRef.current = comparisonOptions;

  const onUpdateRef = useRef(onComparisonUpdate);
  onUpdateRef.current = onComparisonUpdate;

  const isPracticingRef = useRef(isPracticing);
  isPracticingRef.current = isPracticing;

  const modelFramesRef = useRef(modelFrames);
  modelFramesRef.current = modelFrames;

  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let isRunning = true;

    const renderLoop = () => {
      if (!isRunning) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Canvasサイズをビデオの解像度に同期
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;

          // 1. ビデオ背景の描画（ミラーリング対応）
          ctx.save();
          if (mirrorRef.current) {
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(video, 0, 0, width, height);
          ctx.restore();

          // 2. 骨格推論（フレーム更新時のみ実行）
          if (landmarker && video.currentTime !== lastVideoTimeRef.current) {
            try {
              // MediaPipeの単調増加タイムスタンプ制約を厳密に保証
              const rawNow = performance.now();
              const monotonicTimestamp = Math.max(rawNow, lastTimestampMsRef.current + 1);
              lastTimestampMsRef.current = monotonicTimestamp;
              lastVideoTimeRef.current = video.currentTime;

              const detectionResult = landmarker.detectForVideo(video, monotonicTimestamp);

              if (detectionResult.landmarks && detectionResult.landmarks.length > 0) {
                const landmarks = detectionResult.landmarks[0];
                const userAngles = extractJointAngles(landmarks);

                let activeDiscrepancies: ComparisonResult['activeDiscrepancies'] = [];
                let comparisonResult: ComparisonResult | null = null;

                // 3. 練習中かつお手本データが存在する場合に比較判定
                if (
                  isPracticingRef.current &&
                  userAngles &&
                  modelFramesRef.current &&
                  modelVideoRef.current
                ) {
                  const currentVideoTime = modelVideoRef.current.currentTime;
                  comparisonResult = compareWithSlidingWindow(
                    userAngles,
                    currentVideoTime,
                    modelFramesRef.current,
                    optionsRef.current
                  );

                  if (comparisonResult) {
                    activeDiscrepancies = comparisonResult.activeDiscrepancies;
                  }
                }

                // HUD更新通知（約100msごとにスロットリング）
                if (monotonicTimestamp - lastResultTimeRef.current > 90) {
                  lastResultTimeRef.current = monotonicTimestamp;
                  if (onUpdateRef.current) {
                    onUpdateRef.current(comparisonResult);
                  }
                }

                // 4. 骨格ワイヤーフレームの直接描画
                drawPoseOnCanvas(ctx, landmarks, {
                  mirror: mirrorRef.current,
                  activeDiscrepancies,
                  glowEffect: true,
                });
              } else {
                if (onUpdateRef.current && monotonicTimestamp - lastResultTimeRef.current > 150) {
                  lastResultTimeRef.current = monotonicTimestamp;
                  onUpdateRef.current(null);
                }
              }
            } catch (err) {
              // detectForVideo内部エラー時のループ安全保護
              console.warn('Pose detection frame skipped:', err);
            }
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [videoRef, landmarker, modelVideoRef]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-zinc-950 overflow-hidden select-none">
      {/* 隠しvideo要素（カメラ映像受信用） */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="hidden"
        style={{ display: 'none' }}
      />

      {/* 骨格・カメラ映像を描画する高パフォーマンス直接Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain pointer-events-none"
      />
    </div>
  );
};
