import React from 'react';
import { X, Check } from 'lucide-react';
import type { SlidingWindowOptions } from '../lib/comparator/slidingWindow';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: SlidingWindowOptions;
  onOptionsChange: (newOptions: SlidingWindowOptions) => void;
  mirror: boolean;
  onToggleMirror: () => void;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  options,
  onOptionsChange,
  mirror,
  onToggleMirror,
  devices,
  selectedDeviceId,
  onSelectDevice,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-zinc-900/95 rounded-3xl p-6 shadow-2xl space-y-6">
        {/* ヘッダー: 閉じるボタン */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold tracking-widest uppercase text-zinc-400">
            SETTINGS
          </span>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 判定感度スライダー（角度閾値） */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs tracking-wider uppercase text-zinc-400">
            <span>SENSITIVITY THRESHOLD</span>
            <span className="tabular-nums font-semibold text-zinc-200">
              {options.angleThreshold ?? 20}°
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={40}
            step={1}
            value={options.angleThreshold ?? 20}
            onChange={(e) =>
              onOptionsChange({
                ...options,
                angleThreshold: Number(e.target.value),
              })
            }
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
        </div>

        {/* 時間同期ウィンドウ幅 */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs tracking-wider uppercase text-zinc-400">
            <span>TEMPORAL WINDOW</span>
            <span className="tabular-nums font-semibold text-zinc-200">
              ±{options.windowSeconds ?? 0.5}s
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={options.windowSeconds ?? 0.5}
            onChange={(e) =>
              onOptionsChange({
                ...options,
                windowSeconds: Number(e.target.value),
              })
            }
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
        </div>

        {/* カメラ左右反転トグル */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs tracking-wider uppercase text-zinc-400">
            MIRROR CAMERA
          </span>
          <button
            onClick={onToggleMirror}
            className={`w-12 h-7 flex items-center rounded-full p-1 transition-colors duration-200 cursor-pointer ${
              mirror ? 'bg-white justify-end' : 'bg-zinc-800 justify-start'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full shadow-md transform transition-transform ${
                mirror ? 'bg-zinc-950' : 'bg-zinc-500'
              }`}
            />
          </button>
        </div>

        {/* カメラデバイス選択 */}
        {devices.length > 1 && (
          <div className="space-y-2 pt-2">
            <span className="text-xs tracking-wider uppercase text-zinc-400">
              CAMERA INPUT
            </span>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {devices.map((device, idx) => {
                const isSelected =
                  device.deviceId === selectedDeviceId ||
                  (!selectedDeviceId && idx === 0);
                return (
                  <button
                    key={device.deviceId || idx}
                    onClick={() => onSelectDevice(device.deviceId)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs transition cursor-pointer text-left ${
                      isSelected
                        ? 'bg-zinc-800 text-white font-medium'
                        : 'bg-zinc-900/50 hover:bg-zinc-800/60 text-zinc-400'
                    }`}
                  >
                    <span className="truncate pr-2">
                      {device.label || `Camera ${idx + 1}`}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-white shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
