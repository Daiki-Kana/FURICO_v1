import type { JointAngles, NormalizedLandmark, PoseFrameData } from './types';

/**
 * 2つのスカラー値を線形補間する (Linear Interpolation)
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 2つの33点ランドマーク配列を時間比率 t (0〜1) で完全線形補間する
 */
export function interpolateLandmarks(
  landmarksA: NormalizedLandmark[],
  landmarksB: NormalizedLandmark[],
  t: number
): NormalizedLandmark[] {
  const count = Math.min(landmarksA.length, landmarksB.length);
  const result: NormalizedLandmark[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const a = landmarksA[i];
    const b = landmarksB[i];

    result[i] = {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: lerp(a.z ?? 0, b.z ?? 0, t),
      visibility: lerp(a.visibility ?? 1, b.visibility ?? 1, t),
    };
  }

  return result;
}

/**
 * 2つの関節角度群を線形補間する
 */
export function interpolateAngles(
  anglesA: JointAngles,
  anglesB: JointAngles,
  t: number
): JointAngles {
  return {
    leftElbow: lerp(anglesA.leftElbow, anglesB.leftElbow, t),
    rightElbow: lerp(anglesA.rightElbow, anglesB.rightElbow, t),
    leftShoulder: lerp(anglesA.leftShoulder, anglesB.leftShoulder, t),
    rightShoulder: lerp(anglesA.rightShoulder, anglesB.rightShoulder, t),
    leftHip: lerp(anglesA.leftHip, anglesB.leftHip, t),
    rightHip: lerp(anglesA.rightHip, anglesB.rightHip, t),
    leftKnee: lerp(anglesA.leftKnee, anglesB.leftKnee, t),
    rightKnee: lerp(anglesA.rightKnee, anglesB.rightKnee, t),
  };
}

/**
 * 指定した時刻 currentTime (秒) における補間済みフレームデータを取得する
 * 60fps/120fpsの滑らかなアニメーションを生成
 */
export function getInterpolatedFrame(
  frames: PoseFrameData[],
  currentTime: number
): { landmarks: NormalizedLandmark[]; angles: JointAngles } | null {
  if (!frames || frames.length === 0) return null;
  if (frames.length === 1) return { landmarks: frames[0].landmarks, angles: frames[0].angles };

  const first = frames[0];
  const last = frames[frames.length - 1];

  // 範囲外のクランプ
  if (currentTime <= first.timestamp) {
    return { landmarks: first.landmarks, angles: first.angles };
  }
  if (currentTime >= last.timestamp) {
    return { landmarks: last.landmarks, angles: last.angles };
  }

  // 二分探索でcurrentTimeの直前・直後のフレームインデックスを特定
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].timestamp <= currentTime) {
      if (mid === frames.length - 1 || frames[mid + 1].timestamp > currentTime) {
        low = mid;
        break;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idxA = Math.min(low, frames.length - 2);
  const idxB = idxA + 1;

  const frameA = frames[idxA];
  const frameB = frames[idxB];

  const timeDiff = frameB.timestamp - frameA.timestamp;
  const factor = timeDiff > 0 ? (currentTime - frameA.timestamp) / timeDiff : 0;
  const clampedFactor = Math.max(0, Math.min(1, factor));

  return {
    landmarks: interpolateLandmarks(frameA.landmarks, frameB.landmarks, clampedFactor),
    angles: interpolateAngles(frameA.angles, frameB.angles, clampedFactor),
  };
}

/**
 * 【最高速・歪みゼロ】二分探索で指定時刻に最も近い実測フレームを取得する
 * 計算量O(log N)（約0.0001ms）。架空の補間座標を作らないため、関節の伸び縮みや不自然な歪みが原理的に起きない。
 */
export function findClosestFrame(
  frames: PoseFrameData[],
  currentTime: number
): { landmarks: NormalizedLandmark[]; angles: JointAngles } | null {
  if (!frames || frames.length === 0) return null;
  if (frames.length === 1) return { landmarks: frames[0].landmarks, angles: frames[0].angles };

  const first = frames[0];
  const last = frames[frames.length - 1];

  if (currentTime <= first.timestamp) return { landmarks: first.landmarks, angles: first.angles };
  if (currentTime >= last.timestamp) return { landmarks: last.landmarks, angles: last.angles };

  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].timestamp === currentTime) {
      return { landmarks: frames[mid].landmarks, angles: frames[mid].angles };
    }
    if (frames[mid].timestamp < currentTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // low と high のうち、currentTime に時間差が小さい方を採用
  const idxA = Math.max(0, Math.min(frames.length - 1, high));
  const idxB = Math.max(0, Math.min(frames.length - 1, low));

  const diffA = Math.abs(frames[idxA].timestamp - currentTime);
  const diffB = Math.abs(frames[idxB].timestamp - currentTime);

  const best = diffA <= diffB ? frames[idxA] : frames[idxB];
  return { landmarks: best.landmarks, angles: best.angles };
}

