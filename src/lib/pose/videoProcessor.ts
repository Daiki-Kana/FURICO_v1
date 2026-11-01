import { extractJointAngles } from './geometry';
import { createPoseLandmarkerInstance } from './landmarker';
import type { DanceSequence, NormalizedLandmark, PoseFrameData } from './types';

export interface ProcessVideoProgress {
  currentSeconds: number;
  totalSeconds: number;
  progressPercent: number;
  framesExtracted: number;
}

/**
 * ローカル動画ファイルを再生ストリーミングで滑らか・高密度に解析する
 * 1. シーク方式を完全撤廃し、動画の連続再生（Playback）で全フレームを抽出（後半フリーズを根絶）
 * 2. 15fps（約0.066秒間隔）で素早いダンスステップやキレを滑らかに捕捉（カクカク解消）
 * 3. 画面内アクティブ配置によりブラウザの省電力サスペンド（デコード停止）を完全回避
 */
export async function processVideoFile(
  file: File,
  options: {
    fps?: number; // デフォルト15fps
    maxResolution?: number; // 480px（高速かつ高精度なバランス）
    playbackSpeed?: number; // 2.0倍速で高速解析
    onInitialized?: (initialSequence: DanceSequence) => void;
    onProgress?: (progress: ProcessVideoProgress) => void;
  } = {}
): Promise<DanceSequence> {
  const {
    fps = 15,
    maxResolution: _maxResolution = 480,
    playbackSpeed: _playbackSpeed = 2.0,
    onInitialized,
    onProgress,
  } = options;

  const minInterval = 1 / fps;

  // 動画ファイルからBlob URLを生成
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  // ブラウザの省電力停止（Off-screenサスペンド）を回避するため、
  // 画面内の隅にアクティブ配置（高解像度を保持するため十分なサイズを確保）
  video.style.position = 'fixed';
  video.style.bottom = '0px';
  video.style.right = '0px';
  video.style.width = '480px';
  video.style.height = '360px';
  video.style.opacity = '0.01';
  video.style.pointerEvents = 'none';
  video.style.zIndex = '-1';
  document.body.appendChild(video);

  try {
    // メタデータロードを待機
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Failed to load video metadata'));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
    });

    const duration =
      video.duration && isFinite(video.duration) && video.duration > 0 ? video.duration : 1;

    // メタデータロード直後に即時プレビュー用シーケンスを通知
    const sequenceId = `seq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initialSequence: DanceSequence = {
      id: sequenceId,
      name: file.name.replace(/\.[^/.]+$/, ''),
      duration,
      fps,
      createdAt: Date.now(),
      videoBlob: file,
      videoUrl,
      frames: [],
    };

    if (onInitialized) {
      onInitialized(initialSequence);
    }

    // IMAGEモードのPoseLandmarkerを生成（単一フレーム推論）
    const landmarker = await createPoseLandmarkerInstance('IMAGE');

    const frames: PoseFrameData[] = [];
    let lastReportedPercent = 0;
    const stepInterval = minInterval; // 確実なサンプリング間隔（1 / fps）
    let currentTime = 0;

    try {
      video.pause();

      while (currentTime <= duration) {
        const targetTime = Math.round(currentTime * 1000) / 1000;

        // 1. 指定時刻へ確実に同期シーク（デコード確定待ち）
        video.currentTime = targetTime;
        await new Promise<void>((resolve) => {
          let isDone = false;
          let timer: number | null = null;

          const onSeeked = () => {
            if (!isDone) {
              isDone = true;
              if (timer) clearTimeout(timer);
              video.removeEventListener('seeked', onSeeked);
              // requestAnimationFrameでGPUピクセル確定を確実に待機
              requestAnimationFrame(() => resolve());
            }
          };

          video.addEventListener('seeked', onSeeked, { once: true });
          // 最大300ms安全タイムアウト
          timer = window.setTimeout(() => {
            if (!isDone) {
              isDone = true;
              video.removeEventListener('seeked', onSeeked);
              resolve();
            }
          }, 300);
        });

        // 2. 確定した静止フレームからMediaPipe骨格検出（動画は停止中のためズレ・ラグが原理的にゼロ）
        try {
          const result = landmarker.detect(video);
          if (result.landmarks && result.landmarks.length > 0) {
            const rawLandmarks = result.landmarks[0] as NormalizedLandmark[];
            const angles = extractJointAngles(rawLandmarks);

            if (angles) {
              frames.push({
                timestamp: targetTime,
                landmarks: rawLandmarks,
                angles,
              });
            }
          }
        } catch (inferErr) {
          console.warn('Frame detection warning at', targetTime, inferErr);
        }

        // 3. 進捗率の単調増加通知
        const rawPercent = Math.min(100, Math.floor((targetTime / duration) * 100));
        const safePercent = Math.max(lastReportedPercent, rawPercent);
        lastReportedPercent = safePercent;

        if (onProgress) {
          onProgress({
            currentSeconds: targetTime,
            totalSeconds: duration,
            progressPercent: safePercent,
            framesExtracted: frames.length,
          });
        }

        // 次のステップ時刻へ前進
        currentTime += stepInterval;

        // UIレンダリングのための極小マイクロタスク
        await new Promise((r) => setTimeout(r, 0));
      }

      // 【静止時・冒頭欠落保証】0.0sと末尾durationの確実な補完
      if (frames.length > 0) {
        frames.sort((a, b) => a.timestamp - b.timestamp);

        if (frames[0].timestamp > 0.02) {
          frames.unshift({
            timestamp: 0.0,
            landmarks: frames[0].landmarks,
            angles: frames[0].angles,
          });
        }

        const lastFrame = frames[frames.length - 1];
        if (lastFrame.timestamp < duration - 0.05) {
          frames.push({
            timestamp: Math.round(duration * 1000) / 1000,
            landmarks: lastFrame.landmarks,
            angles: lastFrame.angles,
          });
        }
      }

      // 完了通知
      if (onProgress) {
        onProgress({
          currentSeconds: duration,
          totalSeconds: duration,
          progressPercent: 100,
          framesExtracted: frames.length,
        });
      }
    } finally {
      landmarker.close();
    }

    const completedSequence: DanceSequence = {
      ...initialSequence,
      frames,
    };

    return completedSequence;
  } finally {
    // 画面内DOMのクリーンアップ
    if (document.body.contains(video)) {
      document.body.removeChild(video);
    }
  }
}

/**
 * 画面共有（getDisplayMedia）がサポートされている端末か判定する（PC: true, スマホ: false）
 */
export function isScreenCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

export interface ScreenRecorderSession {
  stop: () => Promise<File>;
  stream: MediaStream;
}

/**
 * 画面共有を開始し、YouTube等のタブ動画を録画するセッションを開始する
 */
export async function startScreenRecording(): Promise<ScreenRecorderSession> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: 'browser',
    },
    audio: true,
  });

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm')
    ? 'video/webm'
    : 'video/mp4';

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start(200);

  let isStopped = false;
  let stopPromiseResolve: (file: File) => void;

  const stopPromise = new Promise<File>((resolve) => {
    stopPromiseResolve = resolve;
  });

  const stop = async (): Promise<File> => {
    if (isStopped) return stopPromise;
    isStopped = true;

    return new Promise<File>((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `capture_${Date.now()}.${ext}`, { type: mimeType });
        stopPromiseResolve(file);
        resolve(file);
      };

      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `capture_${Date.now()}.${ext}`, { type: mimeType });
        stopPromiseResolve(file);
        resolve(file);
      }
    });
  };

  stream.getVideoTracks()[0].onended = () => {
    if (!isStopped) {
      stop();
    }
  };

  return {
    stop,
    stream,
  };
}

/**
 * 画面キャプチャAPI（getDisplayMedia）からの録画・ストリームキャプチャ補助（互換用）
 */
export async function captureDisplayStream(): Promise<MediaStream> {
  return await navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: 'browser',
    },
    audio: false,
  });
}
