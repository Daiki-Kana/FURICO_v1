/**
 * 骨格推定・関節角度・比較に関する型定義
 */

// MediaPipeの正規化ランドマーク型
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

// 算出対象の主要8関節の角度（度数法 0〜180度）
export interface JointAngles {
  leftElbow: number;
  rightElbow: number;
  leftShoulder: number;
  rightShoulder: number;
  leftHip: number;
  rightHip: number;
  leftKnee: number;
  rightKnee: number;
}

// 各関節の名前
export type JointName = keyof JointAngles;

// 1フレーム分の骨格データ
export interface PoseFrameData {
  timestamp: number; // 秒単位のタイムスタンプ
  landmarks: NormalizedLandmark[]; // 33点のランドマーク
  angles: JointAngles; // 8箇所の関節角度
}

// 保存されるお手本動画の骨格時系列データ
export interface DanceSequence {
  id: string;
  name: string;
  duration: number; // 秒
  fps: number;
  createdAt: number;
  videoBlob?: Blob; // IndexedDB永続化用の動画バイナリ
  videoUrl?: string; // 再生用Blob URL（実行時生成）
  width?: number; // 動画の元幅
  height?: number; // 動画の元高さ
  frames: PoseFrameData[];
}

// 関節ごとの比較結果
export interface JointDiff {
  joint: JointName;
  userAngle: number;
  modelAngle: number;
  delta: number; // 角度差 |userAngle - modelAngle|
  isDiscrepancy: boolean; // 閾値を超えているか
  advice: string; // 修正アドバイス（例: "Raise Left Arm"）
}

// 比較フレームの結果
export interface ComparisonResult {
  matchedTimestamp: number; // マッチしたお手本のタイムスタンプ
  score: number; // 一致度スコア（0〜100）
  diffs: Record<JointName, JointDiff>;
  activeDiscrepancies: JointName[]; // 閾値を超えた関節一覧
  primaryAdvice: string | null; // 最もズレが大きい部位へのアドバイス
}
