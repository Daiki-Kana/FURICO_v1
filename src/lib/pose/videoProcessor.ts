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
    playbackSpeed = 2.0,
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
    let lastExtractedTime = -1;
    let lastReportedPercent = 0;

    try {
      // 【最重要】動画再生前に0.0秒の静止フレームを確実にデコード・キャプチャ（video直接推論）
      try {
        video.currentTime = 0;
        await new Promise<void>((resolve) => {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            resolve();
          } else {
            const onReady = () => {
              video.removeEventListener('loadeddata', onReady);
              video.removeEventListener('seeked', onReady);
              resolve();
            };
            video.addEventListener('loadeddata', onReady, { once: true });
            video.addEventListener('seeked', onReady, { once: true });
            setTimeout(resolve, 300);
          }
        });

        // 0.0秒時点の直接骨格検出
        const initResult = landmarker.detect(video);
        if (initResult.landmarks && initResult.landmarks.length > 0) {
          const rawLandmarks = initResult.landmarks[0] as NormalizedLandmark[];
          const angles = extractJointAngles(rawLandmarks);
          if (angles) {
            frames.push({
              timestamp: 0,
              landmarks: rawLandmarks,
              angles,
            });
            lastExtractedTime = 0;
          }
        }
      } catch (initErr) {
        console.warn('Initial frame (0.0s) capture warning:', initErr);
      }

      // 再生速度を設定（ブラウザが対応していれば2倍速で素早く走査）
      video.playbackRate = playbackSpeed;

      await new Promise<void>((resolve, reject) => {
        let isCompleted = false;
        let stalledTimer: number | null = null;

        const finish = () => {
          if (isCompleted) return;
          isCompleted = true;
          if (stalledTimer) clearTimeout(stalledTimer);
          video.pause();
          resolve();
        };

        const processCurrentFrame = () => {
          if (isCompleted) return;

          const t = video.currentTime;

          // 最低インターバルごとにフレームをサンプリング
          if (lastExtractedTime < 0 || t - lastExtractedTime >= minInterval || t >= duration - 0.05) {
            lastExtractedTime = t;

            // MediaPipe骨格検出（videoから直接推論）
            try {
              const result = landmarker.detect(video);
              if (result.landmarks && result.landmarks.length > 0) {
                const rawLandmarks = result.landmarks[0] as NormalizedLandmark[];
                const angles = extractJointAngles(rawLandmarks);

                if (angles) {
                  frames.push({
                    timestamp: Math.round(t * 1000) / 1000,
                    landmarks: rawLandmarks,
                    angles,
                  });
                }
              }
            } catch (inferErr) {
              console.warn('Frame detection warning at', t, inferErr);
            }

            // 3. 進捗率の単調増加通知
            const rawPercent = Math.min(100, Math.floor((t / duration) * 100));
            const safePercent = Math.max(lastReportedPercent, rawPercent);
            lastReportedPercent = safePercent;

            if (onProgress) {
              onProgress({
                currentSeconds: t,
                totalSeconds: duration,
                progressPercent: safePercent,
                framesExtracted: frames.length,
              });
            }
          }

          // 終端到達判定
          if (video.ended || t >= duration - 0.05) {
            finish();
          }
        };

        // requestVideoFrameCallback が利用可能な場合（全モダンブラウザ）
        if ('requestVideoFrameCallback' in video) {
          const onFrameCallback = () => {
            if (isCompleted) return;
            processCurrentFrame();
            if (!isCompleted) {
              video.requestVideoFrameCallback(onFrameCallback);
            }
          };
          video.requestVideoFrameCallback(onFrameCallback);
        } else {
          // フォールバック: requestAnimationFrame
          const rafLoop = () => {
            if (isCompleted) return;
            processCurrentFrame();
            if (!isCompleted) {
              requestAnimationFrame(rafLoop);
            }
          };
          requestAnimationFrame(rafLoop);
        }

        // イベントリスナー
        video.onended = finish;
        video.onerror = () => {
          if (!isCompleted) {
            reject(new Error('Video playback error during analysis'));
          }
        };

        // 万が一のスタック防止タイマー（duration / playbackSpeed + 6秒）
        const maxWaitMs = Math.max(10000, (duration / playbackSpeed) * 1000 + 6000);
        stalledTimer = window.setTimeout(() => {
          console.warn('Playback scan reached timeout safety margin. Finalizing frames.');
          finish();
        }, maxWaitMs);

        // 再生開始
        video.currentTime = 0;
        video.play().catch((playErr) => {
          console.warn('Autoplay error, attempting retry:', playErr);
          // ユーザー操作後であれば muted なので成功する
          video.play().catch(reject);
        });
      });

      // 【静止時・冒頭欠落保証】もし冒頭（0.0s）にフレームがなければ最初の有効姿勢を0.0sへバックフィル
      if (frames.length > 0) {
        // タイムスタンプ順にソート（念のため）
        frames.sort((a, b) => a.timestamp - b.timestamp);

        if (frames[0].timestamp > 0.02) {
          frames.unshift({
            timestamp: 0.0,
            landmarks: frames[0].landmarks,
            angles: frames[0].angles,
          });
        }

        // 末尾（duration）にも最終有効フレームを配置（終端静止保証）
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
