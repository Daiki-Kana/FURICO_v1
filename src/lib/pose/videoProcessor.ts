import type { DanceSequence } from './types';

export interface ProcessVideoProgress {
  currentSeconds: number;
  totalSeconds: number;
  progressPercent: number;
  framesExtracted: number;
}

/**
 * ローカル動画ファイルを即時（0秒）ロードする
 * 重い事前シーク解析を完全撤廃し、アップロード待機時間をゼロ秒化。
 * トラッキングは動画本来のアスペクト比を維持したまま、プレイヤー上でリアルタイムに高精度追従する。
 */
export async function processVideoFile(
  file: File,
  options: {
    fps?: number;
    maxResolution?: number;
    playbackSpeed?: number;
    onInitialized?: (initialSequence: DanceSequence) => void;
    onProgress?: (progress: ProcessVideoProgress) => void;
  } = {}
): Promise<DanceSequence> {
  const { onInitialized, onProgress } = options;

  // 動画ファイルからBlob URLを生成（所要時間0.001秒）
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    // メタデータロード（所要時間約0.05秒）
    await new Promise<void>((resolve) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }

      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        // 万が一エラーでもデフォルト値でフォールバックして画面を止めない
        resolve();
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      // 安全タイムアウト（最大1秒）
      setTimeout(() => {
        cleanup();
        resolve();
      }, 1000);
    });

    const duration =
      video.duration && isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    const sequenceId = `seq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sequence: DanceSequence = {
      id: sequenceId,
      name: file.name.replace(/\.[^/.]+$/, ''),
      duration,
      fps: 20,
      createdAt: Date.now(),
      videoBlob: file,
      videoUrl,
      width,
      height,
      frames: [],
    };

    if (onInitialized) {
      onInitialized(sequence);
    }

    if (onProgress) {
      onProgress({
        currentSeconds: duration,
        totalSeconds: duration,
        progressPercent: 100,
        framesExtracted: 0,
      });
    }

    return sequence;
  } finally {
    // リソース解放
    video.src = '';
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
