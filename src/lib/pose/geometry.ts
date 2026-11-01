import type { JointAngles, NormalizedLandmark } from './types';

// MediaPipe Poseの主要インデックス定数
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

/**
 * 3点（a, b, c）から中央の点bにおける角度（度数法: 0〜180度）を計算する
 * 画面内のスケールや位置に依存しないベクトル幾何計算
 */
export function calculateAngle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  // ベクトル BA および BC の算出
  const v1 = {
    x: a.x - b.x,
    y: a.y - b.y,
    z: (a.z ?? 0) - (b.z ?? 0),
  };
  const v2 = {
    x: c.x - b.x,
    y: c.y - b.y,
    z: (c.z ?? 0) - (b.z ?? 0),
  };

  // 内積の計算
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;

  // ベクトルの大きさ（ノルム）
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

  if (mag1 * mag2 === 0) return 0;

  // コサイン値を -1.0 〜 1.0 にクランプして arccos の定義域外エラーを防止
  const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  const angleRad = Math.acos(cosAngle);

  // ラジアンから度へ変換
  return (angleRad * 180) / Math.PI;
}

/**
 * 33点のランドマーク配列から、指定された主要8関節の角度をすべて算出する
 */
export function extractJointAngles(landmarks: NormalizedLandmark[]): JointAngles | null {
  if (!landmarks || landmarks.length < 29) {
    return null;
  }

  const p = landmarks;

  return {
    // 左右肘: 肩 - 肘 - 手首
    leftElbow: calculateAngle(
      p[POSE_LANDMARKS.LEFT_SHOULDER],
      p[POSE_LANDMARKS.LEFT_ELBOW],
      p[POSE_LANDMARKS.LEFT_WRIST]
    ),
    rightElbow: calculateAngle(
      p[POSE_LANDMARKS.RIGHT_SHOULDER],
      p[POSE_LANDMARKS.RIGHT_ELBOW],
      p[POSE_LANDMARKS.RIGHT_WRIST]
    ),

    // 左右肩: 股関節 - 肩 - 肘
    leftShoulder: calculateAngle(
      p[POSE_LANDMARKS.LEFT_HIP],
      p[POSE_LANDMARKS.LEFT_SHOULDER],
      p[POSE_LANDMARKS.LEFT_ELBOW]
    ),
    rightShoulder: calculateAngle(
      p[POSE_LANDMARKS.RIGHT_HIP],
      p[POSE_LANDMARKS.RIGHT_SHOULDER],
      p[POSE_LANDMARKS.RIGHT_ELBOW]
    ),

    // 左右股関節: 肩 - 股関節 - 膝
    leftHip: calculateAngle(
      p[POSE_LANDMARKS.LEFT_SHOULDER],
      p[POSE_LANDMARKS.LEFT_HIP],
      p[POSE_LANDMARKS.LEFT_KNEE]
    ),
    rightHip: calculateAngle(
      p[POSE_LANDMARKS.RIGHT_SHOULDER],
      p[POSE_LANDMARKS.RIGHT_HIP],
      p[POSE_LANDMARKS.RIGHT_KNEE]
    ),

    // 左右膝: 股関節 - 膝 - 足首
    leftKnee: calculateAngle(
      p[POSE_LANDMARKS.LEFT_HIP],
      p[POSE_LANDMARKS.LEFT_KNEE],
      p[POSE_LANDMARKS.LEFT_ANKLE]
    ),
    rightKnee: calculateAngle(
      p[POSE_LANDMARKS.RIGHT_HIP],
      p[POSE_LANDMARKS.RIGHT_KNEE],
      p[POSE_LANDMARKS.RIGHT_ANKLE]
    ),
  };
}
