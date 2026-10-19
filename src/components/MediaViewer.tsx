import React, { useEffect, useRef, useState } from 'react';
import { MediaItem } from '../types';
import { formatFileSize } from '../utils/storage';
import {
  X,
  Trash2,
  Download,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
} from 'lucide-react';

interface MediaViewerProps {
  mediaList: MediaItem[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
  onDelete: (item: MediaItem) => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({
  mediaList,
  currentIndex,
  onClose,
  onNavigate,
  onDelete,
}) => {
  const currentItem = mediaList[currentIndex];
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onNavigate((currentIndex - 1 + mediaList.length) % mediaList.length);
      if (e.key === 'ArrowRight') onNavigate((currentIndex + 1) % mediaList.length);
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, mediaList.length, isPlaying]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const changeSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextSpeed = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
    setPlaybackRate(nextSpeed);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  if (!currentItem) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none"
      onClick={onClose}
    >
      {/* Top Bar Controls */}
      <div
        className="w-full flex items-center justify-between text-white z-10 py-2 max-w-6xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (window.confirm('Удалить этот файл из галереи?')) {
                onDelete(currentItem);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            title="Удалить"
          >
            <Trash2 className="w-4 h-4" />
            <span>Удалить</span>
          </button>

          <a
            href={currentItem.url}
            download={currentItem.name || 'download'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
            title="Скачать на устройство"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Скачать</span>
          </a>
        </div>

        <div className="text-center text-xs text-slate-300 font-medium truncate max-w-xs sm:max-w-md px-2">
          <span className="font-bold text-white">
            {currentIndex + 1} из {mediaList.length}
          </span>
          {currentItem.name && <span className="opacity-80"> • {currentItem.name}</span>}
          {currentItem.size ? <span className="opacity-60"> ({formatFileSize(currentItem.size)})</span> : null}
        </div>

        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          title="Закрыть (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Media Viewer Area */}
      <div
        className="relative flex-1 w-full max-w-6xl flex items-center justify-center overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Navigation Arrows */}
        {mediaList.length > 1 && (
          <>
            <button
              onClick={() => onNavigate((currentIndex - 1 + mediaList.length) % mediaList.length)}
              className="absolute left-2 sm:left-4 z-20 p-3 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-xs transition-all cursor-pointer hover:scale-105"
              title="Предыдущий файл (Стрелка влево)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() => onNavigate((currentIndex + 1) % mediaList.length)}
              className="absolute right-2 sm:right-4 z-20 p-3 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-xs transition-all cursor-pointer hover:scale-105"
              title="Следующий файл (Стрелка вправо)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Video or Photo Display */}
        {currentItem.type === 'video' ? (
          <div className="relative max-w-full max-h-[82vh] flex flex-col items-center justify-center rounded-2xl overflow-hidden bg-black shadow-2xl">
            <video
              ref={videoRef}
              src={currentItem.url}
              poster={currentItem.thumb}
              autoPlay
              playsInline
              onClick={togglePlay}
              onTimeUpdate={() => {
                if (videoRef.current) {
                  setCurrentTime(videoRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  setDuration(videoRef.current.duration);
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="max-w-full max-h-[75vh] object-contain cursor-pointer"
            />

            {/* Custom Video Controls Bar */}
            <div className="w-full bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 flex flex-col gap-2">
              {/* Progress seeker */}
              <input
                type="range"
                min="0"
                max={duration || 100}
                step="0.1"
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (videoRef.current) {
                    videoRef.current.currentTime = val;
                  }
                  setCurrentTime(val);
                }}
                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />

              <div className="flex items-center justify-between text-white text-xs">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="p-1 hover:text-blue-400 transition-colors cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                  </button>

                  <button
                    onClick={toggleMute}
                    className="p-1 hover:text-blue-400 transition-colors cursor-pointer"
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>

                  <span className="font-mono text-slate-300">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={changeSpeed}
                    className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                    title="Скорость воспроизведения"
                  >
                    {playbackRate}x
                  </button>

                  <button
                    onClick={() => {
                      if (videoRef.current?.requestFullscreen) {
                        videoRef.current.requestFullscreen();
                      }
                    }}
                    className="p-1 hover:text-blue-400 transition-colors cursor-pointer"
                    title="Во весь экран"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <img
            src={currentItem.url}
            alt={currentItem.name}
            className="max-w-[92vw] max-h-[82vh] object-contain rounded-xl shadow-2xl transition-all"
          />
        )}
      </div>

      {/* Bottom Metadata Bar */}
      <div className="text-center text-xs text-slate-400 pb-2">
        {currentItem.created ? (
          <span>
            Добавлено: {new Date(currentItem.created).toLocaleString('ru-RU')}
          </span>
        ) : null}
      </div>
    </div>
  );
};
