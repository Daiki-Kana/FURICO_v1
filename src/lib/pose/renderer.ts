import type { JointName, NormalizedLandmark } from './types';
import { POSE_LANDMARKS } from './geometry';

// 骨格接続線のペア定義 [点1, 点2]
export const POSE_CONNECTIONS: [number, number][] = [
  // 上半身・肩・腰
  [11, 12], // 肩
  [11, 23], // 左胴体
  [12, 24], // 右胴体
  [23, 24], // 腰
  // 左腕
  [11, 13], // 左上腕
  [13, 15], // 左前腕
  [15, 17], // 左手首-小指
  [15, 19], // 左手首-人差指
  [15, 21], // 左手首-親指
  // 右腕
  [12, 14], // 右上腕
  [14, 16], // 右前腕
  [16, 18], // 右手首-小指
  [16, 20], // 右手首-人差指
  [16, 22], // 右手首-親指
  // 左脚
  [23, 25], // 左大腿
  [25, 27], // 左下腿
  [27, 29], // 左足首-踵
  [27, 31], // 左足首-爪先
  [29, 31],
  // 右脚
  [24, 26], // 右大腿
  [26, 28], // 右下腿
  [28, 30], // 右足首-踵
  [28, 32], // 右足首-爪先
  [30, 32],
];

// 関節名と対応するランドマークインデックス
export const JOINT_TO_LANDMARK: Record<JointName, number> = {
  leftElbow: POSE_LANDMARKS.LEFT_ELBOW,
  rightElbow: POSE_LANDMARKS.RIGHT_ELBOW,
  leftShoulder: POSE_LANDMARKS.LEFT_SHOULDER,
  rightShoulder: POSE_LANDMARKS.RIGHT_SHOULDER,
  leftHip: POSE_LANDMARKS.LEFT_HIP,
  rightHip: POSE_LANDMARKS.RIGHT_HIP,
  leftKnee: POSE_LANDMARKS.LEFT_KNEE,
  rightKnee: POSE_LANDMARKS.RIGHT_KNEE,
};

// 関節名と影響を受ける接続線ペア
const JOINT_CONNECTIONS: Record<JointName, [number, number][]> = {
  leftElbow: [
    [11, 13],
    [13, 15],
  ],
  rightElbow: [
    [12, 14],
    [14, 16],
  ],
  leftShoulder: [
    [11, 12],
    [11, 13],
    [11, 23],
  ],
  rightShoulder: [
    [11, 12],
    [12, 14],
    [12, 24],
  ],
  leftHip: [
    [11, 23],
    [23, 24],
    [23, 25],
  ],
  rightHip: [
    [12, 24],
    [23, 24],
    [24, 26],
  ],
  leftKnee: [
    [23, 25],
    [25, 27],
  ],
  rightKnee: [
    [24, 26],
    [26, 28],
  ],
};

/**
 * 2つのインデックスが接続線として一致するか判定
 */
function isMatchingConnection(connA: [number, number], connB: [number, number]): boolean {
  return (
    (connA[0] === connB[0] && connA[1] === connB[1]) ||
    (connA[0] === connB[1] && connA[1] === connB[0])
  );
}

export interface RenderPoseOptions {
  mirror?: boolean; // 水平反転表示
  activeDiscrepancies?: JointName[]; // 閾値を超えて不一致となっている関節
  drawVideo?: boolean; // 背景にビデオフレームを描画するか
  glowEffect?: boolean; // グロー効果
}

/**
 * Canvasに骨格ワイヤーフレームと関節を直接高速描画する
 */
export function drawPoseOnCanvas(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  options: RenderPoseOptions = {}
): void {
  const { mirror = true, activeDiscrepancies = [], glowEffect = true } = options;
  const { width, height } = ctx.canvas;

  ctx.save();

  // ミラー表示の場合は左右を反転
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }

  // 不一致関節のランドマークインデックスセット
  const discrepancyLandmarkIndices = new Set<number>();
  for (const joint of activeDiscrepancies) {
    discrepancyLandmarkIndices.add(JOINT_TO_LANDMARK[joint]);
  }

  // 不一致関節に接続するコネクション判定用関数
  const isDiscrepantConnection = (conn: [number, number]) => {
    return activeDiscrepancies.some((joint) =>
      JOINT_CONNECTIONS[joint]?.some((jc) => isMatchingConnection(conn, jc))
    );
  };

  // 1. 接続線（ボーン）の描画
  for (const conn of POSE_CONNECTIONS) {
    const p1 = landmarks[conn[0]];
    const p2 = landmarks[conn[1]];

    if (!p1 || !p2) continue;
    // 信頼度が低い点はスキップ
    if ((p1.visibility ?? 1) < 0.35 || (p2.visibility ?? 1) < 0.35) continue;

    const x1 = p1.x * width;
    const y1 = p1.y * height;
    const x2 = p2.x * width;
    const y2 = p2.y * height;

    const isWrong = isDiscrepantConnection(conn);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineCap = 'round';

    if (isWrong) {
      // ズレ部位: ソリッドな赤ハイライト
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ef4444';
      if (glowEffect) {
        ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
        ctx.shadowBlur = 12;
      }
    } else {
      // 正常部位: 洗練されたミニマルホワイト
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(244, 244, 245, 0.85)';
      if (glowEffect) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
        ctx.shadowBlur = 6;
      }
    }

    ctx.stroke();
    ctx.shadowBlur = 0; // リセット
  }

  // 2. 関節ノード（点）の描画
  for (let i = 0; i < landmarks.length; i++) {
    // 主要関節のみを描画（顔の細かい点などは省略してクリーンに保つ）
    if (i > 0 && i < 11) continue;

    const p = landmarks[i];
    if (!p || (p.visibility ?? 1) < 0.35) continue;

    const x = p.x * width;
    const y = p.y * height;
    const isWrong = discrepancyLandmarkIndices.has(i);

    ctx.beginPath();

    if (isWrong) {
      // 警告ノード
      ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.fillStyle = '#ef4444';
      if (glowEffect) {
        ctx.shadowColor = 'rgba(239, 68, 68, 1)';
        ctx.shadowBlur = 14;
      }
      ctx.fill();

      // 内側の白いコア
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      // 通常ノード
      ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      if (glowEffect) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.shadowBlur = 8;
      }
      ctx.fill();
    }

    ctx.shadowBlur = 0;
  }

  ctx.restore();
}
