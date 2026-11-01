import { POSE_CONNECTIONS } from './renderer';
import type { NormalizedLandmark } from './types';

export type AvatarStyle = 'humanoid' | 'mocap' | 'mannequin' | 'tracer';

export interface AvatarRenderOptions {
  style?: AvatarStyle;
  rotationY?: number; // 左右3D視点回転角度（ラジアン）
  trajectoryPoints?: { leftWrist: { x: number; y: number }[]; rightWrist: { x: number; y: number }[] };
  glow?: boolean;
}

interface TransformedPoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/**
 * 3D回転変換（原点中心のY軸回転）
 */
function rotateY(
  x: number,
  y: number,
  z: number,
  centerX: number,
  angleRad: number
): { x: number; y: number; z: number } {
  if (angleRad === 0) return { x, y, z };
  const relX = x - centerX;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotX = relX * cos - z * sin;
  const rotZ = relX * sin + z * cos;
  return {
    x: centerX + rotX,
    y,
    z: rotZ,
  };
}

/**
 * 2点間に筋肉・肉付きのふくらみを持つアナトミカルな四肢パーツを描画する
 */
function drawMuscleLimb(
  ctx: CanvasRenderingContext2D,
  p1: TransformedPoint,
  p2: TransformedPoint,
  startR: number,
  midR: number,
  endR: number,
  depthZ: number
): void {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  // 法線ベクトル（単位ベクトルに直交）
  const nx = -dy / len;
  const ny = dx / len;

  // 中間点（筋肉のピーク: 40〜45%の位置）
  const midX = p1.x + dx * 0.45;
  const midY = p1.y + dy * 0.45;

  // 深度に応じたトーン（奥は影で暗く、手前は白くハイライト）
  const depthFactor = Math.max(0.4, Math.min(1.0, 0.7 - depthZ / 600));
  const fillAlpha = Math.max(0.75, Math.min(0.98, depthFactor + 0.15));
  const brightness = Math.round(200 + depthFactor * 55);

  ctx.beginPath();
  // 外側の曲線
  ctx.moveTo(p1.x + nx * startR, p1.y + ny * startR);
  ctx.quadraticCurveTo(midX + nx * midR, midY + ny * midR, p2.x + nx * endR, p2.y + ny * endR);
  // 終点の丸み
  ctx.arc(p2.x, p2.y, endR, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  // 内側の曲線
  ctx.quadraticCurveTo(midX - nx * midR, midY - ny * midR, p1.x - nx * startR, p1.y - ny * startR);
  // 始点の丸み
  ctx.arc(p1.x, p1.y, startR, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();

  // グラデーション塗り
  const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
  grad.addColorStop(0, `rgba(${brightness}, ${brightness}, ${brightness + 5}, ${fillAlpha})`);
  grad.addColorStop(1, `rgba(${brightness - 25}, ${brightness - 25}, ${brightness - 20}, ${fillAlpha})`);

  ctx.fillStyle = grad;
  ctx.fill();

  // 微細なエッジの立体ハイライト
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(255, 255, 255, ${depthFactor * 0.5})`;
  ctx.stroke();
}

/**
 * 人間の胴体（胸・ウエスト・骨盤）を滑らかなソリッド曲面で描画する
 */
function drawTorso(
  ctx: CanvasRenderingContext2D,
  ls: TransformedPoint, // 左肩
  rs: TransformedPoint, // 右肩
  lh: TransformedPoint, // 左腰
  rh: TransformedPoint, // 右腰
  depthZ: number
): void {
  // ウエスト位置（肩と腰の中間・少し内側にシェイプ）
  const waistL = {
    x: ls.x * 0.45 + lh.x * 0.55 + (rs.x - ls.x) * 0.08,
    y: ls.y * 0.45 + lh.y * 0.55,
  };
  const waistR = {
    x: rs.x * 0.45 + rh.x * 0.55 - (rs.x - ls.x) * 0.08,
    y: rs.y * 0.45 + rh.y * 0.55,
  };

  // 胸部中央・骨盤中央
  const chestCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const pelvisCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

  const depthFactor = Math.max(0.5, Math.min(1.0, 0.7 - depthZ / 600));
  const brightness = Math.round(210 + depthFactor * 45);

  ctx.beginPath();
  ctx.moveTo(ls.x, ls.y);
  // 肩からウエストへのくびれ
  ctx.quadraticCurveTo(ls.x * 0.7 + waistL.x * 0.3, ls.y * 0.5 + waistL.y * 0.5, waistL.x, waistL.y);
  // ウエストから骨盤へ
  ctx.quadraticCurveTo(lh.x, waistL.y * 0.3 + lh.y * 0.7, lh.x, lh.y);
  // 骨盤底
  ctx.quadraticCurveTo(pelvisCenter.x, pelvisCenter.y + 12, rh.x, rh.y);
  // 右骨盤からウエストへ
  ctx.quadraticCurveTo(rh.x, waistR.y * 0.3 + rh.y * 0.7, waistR.x, waistR.y);
  // ウエストから右肩へ
  ctx.quadraticCurveTo(rs.x * 0.7 + waistR.x * 0.3, rs.y * 0.5 + waistR.y * 0.5, rs.x, rs.y);
  // 鎖骨ライン
  ctx.quadraticCurveTo(chestCenter.x, chestCenter.y + 6, ls.x, ls.y);
  ctx.closePath();

  const grad = ctx.createLinearGradient(chestCenter.x, chestCenter.y, pelvisCenter.x, pelvisCenter.y);
  grad.addColorStop(0, `rgba(${brightness}, ${brightness}, ${brightness + 5}, 0.95)`);
  grad.addColorStop(1, `rgba(${brightness - 30}, ${brightness - 30}, ${brightness - 25}, 0.95)`);

  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(255, 255, 255, ${depthFactor * 0.6})`;
  ctx.stroke();

  // 首の描画
  const neckTopY = chestCenter.y - (pelvisCenter.y - chestCenter.y) * 0.28;
  const neckWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y) * 0.18;

  ctx.beginPath();
  ctx.moveTo(chestCenter.x - neckWidth, chestCenter.y);
  ctx.lineTo(chestCenter.x - neckWidth * 0.85, neckTopY);
  ctx.lineTo(chestCenter.x + neckWidth * 0.85, neckTopY);
  ctx.lineTo(chestCenter.x + neckWidth, chestCenter.y);
  ctx.closePath();
  ctx.fillStyle = `rgba(${brightness - 15}, ${brightness - 15}, ${brightness - 10}, 0.95)`;
  ctx.fill();
}

/**
 * 人間らしい頭部（フェイスライン・顎）を描画する
 */
function drawHumanHead(
  ctx: CanvasRenderingContext2D,
  nose: TransformedPoint,
  leftEar: TransformedPoint,
  rightEar: TransformedPoint,
  depthZ: number
): void {
  const headWidth = Math.max(22, Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y) * 0.95);
  const headHeight = headWidth * 1.35; // 人間の頭身（縦長オーバル）

  const depthFactor = Math.max(0.5, Math.min(1.0, 0.7 - depthZ / 600));
  const brightness = Math.round(220 + depthFactor * 35);

  ctx.save();
  ctx.beginPath();
  // 卵型（顎に向かってややシャープ）
  ctx.ellipse(nose.x, nose.y, headWidth / 2, headHeight / 2, 0, 0, Math.PI * 2);

  const grad = ctx.createRadialGradient(
    nose.x - headWidth * 0.15,
    nose.y - headHeight * 0.15,
    2,
    nose.x,
    nose.y,
    headHeight / 2
  );
  grad.addColorStop(0, `rgba(${brightness}, ${brightness}, ${brightness + 5}, 0.98)`);
  grad.addColorStop(1, `rgba(${brightness - 35}, ${brightness - 35}, ${brightness - 30}, 0.98)`);

  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(255, 255, 255, ${depthFactor * 0.7})`;
  ctx.stroke();

  ctx.restore();
}

/**
 * 画面中央に人間らしいモデルを描画する
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  options: AvatarRenderOptions = {}
): void {
  const { style = 'humanoid', rotationY = 0, trajectoryPoints, glow = true } = options;
  const { width, height } = ctx.canvas;

  ctx.save();

  // 1. 骨盤中心の計算
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const centerHipX = leftHip && rightHip ? (leftHip.x + rightHip.x) / 2 : 0.5;

  // 2. ランドマークの画面座標化と3D Y軸回転
  const transformed: TransformedPoint[] = landmarks.map((p) => {
    const rawX = p.x * width;
    const rawY = p.y * height;
    const rawZ = (p.z ?? 0) * width;
    const rot = rotateY(rawX, rawY, rawZ, centerHipX * width, rotationY);
    const fov = 1000;
    const scale = fov / (fov + rot.z);
    return {
      x: (rot.x - width / 2) * scale + width / 2,
      y: (rot.y - height / 2) * scale + height / 2,
      z: rot.z,
      visibility: p.visibility ?? 1,
    };
  });

  // 3. トレーサースタイルの軌跡
  if (style === 'tracer' && trajectoryPoints) {
    drawTracerTrail(ctx, trajectoryPoints.leftWrist, '#38bdf8');
    drawTracerTrail(ctx, trajectoryPoints.rightWrist, '#f43f5e');
  }

  // 4. スタイル別の描画実行
  if (style === 'humanoid') {
    // 【人間らしいソリッド・アナトミカルボディ】
    drawSolidHumanoid(ctx, transformed);
  } else {
    // 【既存のワイヤーフレーム／マネキン／トレーサースタイル】
    drawWireframeAvatar(ctx, transformed, style, glow);
  }

  ctx.restore();
}

/**
 * 本物の人間らしい立体アナトミカルボディの描画（Z深度ソート描画）
 */
function drawSolidHumanoid(ctx: CanvasRenderingContext2D, p: TransformedPoint[]): void {
  // 各部位のパーツ定義と平均Z座標の算出
  interface BodyPart {
    name: string;
    avgZ: number;
    draw: () => void;
  }

  const parts: BodyPart[] = [];

  // 左腕パーツ
  const leftUpperArmZ = (p[11].z + p[13].z) / 2;
  parts.push({
    name: 'leftUpperArm',
    avgZ: leftUpperArmZ,
    draw: () => drawMuscleLimb(ctx, p[11], p[13], 13, 16, 11, leftUpperArmZ),
  });

  const leftForearmZ = (p[13].z + p[15].z) / 2;
  parts.push({
    name: 'leftForearm',
    avgZ: leftForearmZ,
    draw: () => {
      drawMuscleLimb(ctx, p[13], p[15], 11, 14, 8, leftForearmZ);
      // 手首・手のひら
      ctx.beginPath();
      ctx.arc(p[15].x, p[15].y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },
  });

  // 右腕パーツ
  const rightUpperArmZ = (p[12].z + p[14].z) / 2;
  parts.push({
    name: 'rightUpperArm',
    avgZ: rightUpperArmZ,
    draw: () => drawMuscleLimb(ctx, p[12], p[14], 13, 16, 11, rightUpperArmZ),
  });

  const rightForearmZ = (p[14].z + p[16].z) / 2;
  parts.push({
    name: 'rightForearm',
    avgZ: rightForearmZ,
    draw: () => {
      drawMuscleLimb(ctx, p[14], p[16], 11, 14, 8, rightForearmZ);
      ctx.beginPath();
      ctx.arc(p[16].x, p[16].y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },
  });

  // 左脚パーツ
  const leftThighZ = (p[23].z + p[25].z) / 2;
  parts.push({
    name: 'leftThigh',
    avgZ: leftThighZ,
    draw: () => drawMuscleLimb(ctx, p[23], p[25], 19, 23, 15, leftThighZ),
  });

  const leftCalfZ = (p[25].z + p[27].z) / 2;
  parts.push({
    name: 'leftCalf',
    avgZ: leftCalfZ,
    draw: () => {
      drawMuscleLimb(ctx, p[25], p[27], 15, 18, 10, leftCalfZ);
      // 足首・靴
      ctx.beginPath();
      ctx.ellipse(p[27].x, p[27].y + 4, 11, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },
  });

  // 右脚パーツ
  const rightThighZ = (p[24].z + p[26].z) / 2;
  parts.push({
    name: 'rightThigh',
    avgZ: rightThighZ,
    draw: () => drawMuscleLimb(ctx, p[24], p[26], 19, 23, 15, rightThighZ),
  });

  const rightCalfZ = (p[26].z + p[28].z) / 2;
  parts.push({
    name: 'rightCalf',
    avgZ: rightCalfZ,
    draw: () => {
      drawMuscleLimb(ctx, p[26], p[28], 15, 18, 10, rightCalfZ);
      ctx.beginPath();
      ctx.ellipse(p[28].x, p[28].y + 4, 11, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },
  });

  // 胴体（トルソー）
  const torsoZ = (p[11].z + p[12].z + p[23].z + p[24].z) / 4;
  parts.push({
    name: 'torso',
    avgZ: torsoZ,
    draw: () => drawTorso(ctx, p[11], p[12], p[23], p[24], torsoZ),
  });

  // 頭部
  const headZ = p[0].z;
  parts.push({
    name: 'head',
    avgZ: headZ,
    draw: () => drawHumanHead(ctx, p[0], p[7], p[8], headZ),
  });

  // 【重要】Z座標（奥行き）でソートし、奥にあるパーツから手前へ順番に重ねて描画
  // これにより、手足が交差した時や前後を動いた時の圧倒的な人間らしい立体感が表現される
  parts.sort((a, b) => b.avgZ - a.avgZ);

  for (const part of parts) {
    part.draw();
  }
}

/**
 * 従来のMocap / Mannequinワイヤーフレーム描画
 */
function drawWireframeAvatar(
  ctx: CanvasRenderingContext2D,
  transformed: TransformedPoint[],
  style: AvatarStyle,
  glow: boolean
): void {
  // 接続線（ボーン）
  for (const conn of POSE_CONNECTIONS) {
    const p1 = transformed[conn[0]];
    const p2 = transformed[conn[1]];
    if (!p1 || !p2 || p1.visibility < 0.35 || p2.visibility < 0.35) continue;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineCap = 'round';

    if (style === 'mannequin') {
      const avgZ = (p1.z + p2.z) / 2;
      const depthFactor = Math.max(0.6, Math.min(1.4, 1 - avgZ / 800));
      ctx.lineWidth = 14 * depthFactor;
      ctx.strokeStyle = `rgba(228, 228, 231, ${0.4 * depthFactor})`;
      ctx.stroke();

      ctx.lineWidth = 4 * depthFactor;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      if (glow) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
        ctx.shadowBlur = 8;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  // 頭部リング
  const nose = transformed[0];
  const leftEar = transformed[7];
  const rightEar = transformed[8];
  if (nose && nose.visibility > 0.4) {
    const headRadius =
      leftEar && rightEar
        ? Math.max(16, Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y) * 0.9)
        : 22;

    ctx.beginPath();
    ctx.arc(nose.x, nose.y, headRadius, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    if (glow) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
      ctx.shadowBlur = 10;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // 関節球
  for (let i = 0; i < transformed.length; i++) {
    if (i > 0 && i < 11) continue;
    const p = transformed[i];
    if (!p || p.visibility < 0.35) continue;

    ctx.beginPath();
    const isMajorJoint = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(i);
    const radius = isMajorJoint ? 6 : 4;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    if (glow) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      ctx.shadowBlur = 10;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/**
 * 手首の残像軌跡を描画
 */
function drawTracerTrail(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string
): void {
  if (!points || points.length < 2) return;

  ctx.save();
  for (let i = 1; i < points.length; i++) {
    const alpha = (i / points.length) * 0.8;
    const width = (i / points.length) * 6;

    ctx.beginPath();
    ctx.moveTo(points[i - 1].x, points[i - 1].y);
    ctx.lineTo(points[i].x, points[i].y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}
