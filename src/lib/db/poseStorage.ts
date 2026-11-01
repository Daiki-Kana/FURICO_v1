import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DanceSequence } from '../pose/types';

interface FuricoDBSchema extends DBSchema {
  sequences: {
    key: string;
    value: DanceSequence;
    indexes: { 'by-date': number };
  };
}

const DB_NAME = 'furico-dance-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FuricoDBSchema>> | null = null;

/**
 * IndexedDBインスタンスの取得
 */
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<FuricoDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sequences')) {
          const store = db.createObjectStore('sequences', { keyPath: 'id' });
          store.createIndex('by-date', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

/**
 * シーケンスのBlobから最新のBlob URLを確実に付与する
 */
export function attachLiveVideoUrl(seq: DanceSequence): DanceSequence {
  if (seq.videoBlob) {
    return {
      ...seq,
      videoUrl: URL.createObjectURL(seq.videoBlob),
    };
  }
  return seq;
}

/**
 * 解析済みダンスシーケンスを保存する（動画Blobも一緒に永続化）
 */
export async function saveDanceSequence(sequence: DanceSequence): Promise<void> {
  const db = await getDB();
  // videoUrlはセッション依存の一時文字列なので保存時は除外またはそのまま
  await db.put('sequences', sequence);
}

/**
 * ID指定でダンスシーケンスを取得する（再生用Blob URLを再発行）
 */
export async function getDanceSequence(id: string): Promise<DanceSequence | undefined> {
  const db = await getDB();
  const seq = await db.get('sequences', id);
  if (!seq) return undefined;
  return attachLiveVideoUrl(seq);
}

/**
 * 保存されているすべてのダンスシーケンス一覧を取得する（日付降順）
 */
export async function getAllDanceSequences(): Promise<DanceSequence[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('sequences', 'by-date');
  return all.reverse().map(attachLiveVideoUrl);
}

/**
 * ダンスシーケンスを削除する
 */
export async function deleteDanceSequence(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('sequences', id);
}
