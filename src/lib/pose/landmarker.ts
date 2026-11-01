import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe公式CDNアセットパス
const WASM_CDN_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let visionResolverPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

/**
 * FilesetResolverのシングルトン取得
 */
export async function getVisionResolver() {
  if (!visionResolverPromise) {
    visionResolverPromise = FilesetResolver.forVisionTasks(WASM_CDN_PATH);
  }
  return visionResolverPromise;
}

/**
 * 指定した実行モード（VIDEO / IMAGE）でPoseLandmarkerインスタンスを作成する
 * GPUモードでの初期化を最優先し、失敗時は自動的にCPUへフォールバック
 */
export async function createPoseLandmarkerInstance(
  runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'
): Promise<PoseLandmarker> {
  const vision = await getVisionResolver();

  try {
    // 1. GPU (WebGL) デリゲートを試行
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_PATH,
        delegate: 'GPU',
      },
      runningMode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    return landmarker;
  } catch (gpuError) {
    console.warn('GPU acceleration failed for PoseLandmarker, falling back to CPU:', gpuError);

    // 2. CPU デリゲートでフォールバック再試行
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_PATH,
        delegate: 'CPU',
      },
      runningMode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    return landmarker;
  }
}

let sharedLandmarkerPromise: Promise<PoseLandmarker> | null = null;

/**
 * 共有のPoseLandmarker（IMAGEモード）インスタンスを取得する
 * 毎フレーム独立推論のため、シークや複数動画の同時推論でも状態競合が起きず極めて安定
 */
export async function getSharedPoseLandmarker(): Promise<PoseLandmarker> {
  if (!sharedLandmarkerPromise) {
    sharedLandmarkerPromise = createPoseLandmarkerInstance('IMAGE');
  }
  return sharedLandmarkerPromise;
}
