import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MediaItem } from '../types';
import {
  uploadMediaFile,
  deleteMediaItem,
  plural,
  getCloudStatus,
  subscribeCloudStatus,
  resetCloudRetries,
  setMediaCaption,
} from '../utils/storage';
import { generateVideoThumbnail, compressImage } from '../utils/videoThumb';
import { MediaViewer } from './MediaViewer';
import {
  UploadCloud,
  Film,
  Image as ImageIcon,
  Play,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

/** Поле подписи под снимком: сохраняется при выходе из поля или по Enter. */
const CaptionField: React.FC<{ item: MediaItem; onSave: (item: MediaItem, caption: string) => void }> = ({
  item,
  onSave,
}) => {
  const [value, setValue] = useState(item.caption || '');
  const [focused, setFocused] = useState(false);
  // Только что сохранённая подпись: показываем её, пока список не обновится (иначе мелькает старая)
  const [pending, setPending] = useState<string | null>(null);

  // Подпись, пришедшую с другого устройства, подтягиваем, пока поле не редактируется
  useEffect(() => {
    if (pending !== null) {
      if ((item.caption || '') === pending) setPending(null);
      return;
    }
    if (!focused) setValue(item.caption || '');
  }, [item.caption, focused, pending]);

  const commit = () => {
    setFocused(false);
    const text = value.trim();
    if (text !== (item.caption || '')) {
      setPending(text);
      setValue(text);
      onSave(item, text);
    }
  };

  return (
    <input
      type="text"
      value={value}
      maxLength={300}
      placeholder="Добавить подпись…"
      onFocus={() => setFocused(true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="w-full rounded-lg border border-transparent hover:border-slate-200 focus:border-blue-400 bg-transparent focus:bg-white px-2 py-1 text-xs text-slate-700 placeholder-slate-400 outline-none transition-colors"
    />
  );
};

interface MediaGalleryProps {
  mediaList: MediaItem[];
  syncCode: string;
  onRefreshMedia: () => void;
  readOnly?: boolean; // режим клиента: только просмотр
}

export const MediaGallery: React.FC<MediaGalleryProps> = ({
  mediaList,
  syncCode,
  onRefreshMedia,
  readOnly = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>('all');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'ok' | 'err' | 'info';
  } | null>(null);
  const [activeViewerIndex, setActiveViewerIndex] = useState<number | null>(null);

  const showStatus = (text: string, type: 'ok' | 'err' | 'info' = 'info') => {
    setStatusMessage({ text, type });
    if (type !== 'info') {
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );

    if (list.length === 0) {
      showStatus('Пожалуйста, выберите фото или видеофайлы', 'err');
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const isVideo = file.type.startsWith('video/');

      showStatus(`Загрузка (${i + 1}/${list.length}): ${file.name}…`, 'info');
      setUploadProgress(10);

      try {
        let thumbnail = '';
        let duration = 0;

        if (isVideo) {
          showStatus(`Обработка превью видео: ${file.name}…`, 'info');
          const thumbResult = await generateVideoThumbnail(file, 0.5);
          thumbnail = thumbResult.thumbnailDataUrl;
          duration = thumbResult.duration;
        } else {
          // Compress photo for quick thumbnail
          try {
            thumbnail = await compressImage(file, 800, 0.8);
          } catch (e) {
            console.warn(e);
          }
        }

        await uploadMediaFile(file, syncCode, thumbnail, duration, (percent) => {
          setUploadProgress(percent);
        });

        successCount++;
      } catch (err: any) {
        console.error('Upload error:', err);
        errors.push(`${file.name}: ${err.message || 'Ошибка загрузки'}`);
      }
    }

    setIsUploading(false);
    setUploadProgress(0);
    onRefreshMedia();

    if (successCount === list.length) {
      showStatus(
        `✅ Успешно загружено: ${successCount} ${plural(successCount, [
          'файл',
          'файла',
          'файлов',
        ])}`,
        'ok'
      );
    } else if (successCount > 0) {
      showStatus(
        `Загружено ${successCount} из ${list.length}. Ошибки: ${errors.join('; ')}`,
        'err'
      );
    } else {
      showStatus(`Ошибка загрузки: ${errors.join('; ')}`, 'err');
    }
  };

  const handleDelete = async (item: MediaItem) => {
    try {
      await deleteMediaItem(syncCode, item);
      onRefreshMedia();
      showStatus('Файл удален', 'ok');
      if (activeViewerIndex !== null) {
        setActiveViewerIndex(null);
      }
    } catch (e) {
      showStatus('Не удалось удалить файл', 'err');
    }
  };

  const handleCaption = async (item: MediaItem, caption: string) => {
    try {
      await setMediaCaption(syncCode, item, caption);
      onRefreshMedia();
    } catch (e) {
      showStatus('Не удалось сохранить подпись', 'err');
    }
  };

  const filteredMedia = mediaList.filter((m) => {
    if (filterType === 'photo') return m.type === 'photo';
    if (filterType === 'video') return m.type === 'video';
    return true;
  });

  const photoCount = mediaList.filter((m) => m.type === 'photo').length;
  const videoCount = mediaList.filter((m) => m.type === 'video').length;

  // Статус облака: что уже выгружено, что нет, и почему
  const cloud = useSyncExternalStore(subscribeCloudStatus, getCloudStatus);
  const notInCloud = mediaList.filter((m) => !m.cloudUrl).length;

  return (
    <div className="space-y-6">
      {/* Cloud status */}
      {!readOnly && mediaList.length > 0 && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap ${
            cloud.uploading
              ? 'bg-blue-50 border-blue-200 text-blue-800'
              : cloud.lastError
              ? 'bg-red-50 border-red-200 text-red-800'
              : notInCloud > 0
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="min-w-0">
            {cloud.uploading ? (
              <span>
                ☁️ Выгрузка в облако: <b className="break-all">{cloud.uploading}</b> — {cloud.progress}%
              </span>
            ) : cloud.lastError ? (
              <span className="break-words">
                ⚠️ Не удалось выгрузить в облако — {cloud.lastError}. Файлы пока только на этом устройстве.
              </span>
            ) : notInCloud > 0 ? (
              <span>
                💾 {notInCloud} {plural(notInCloud, ['файл', 'файла', 'файлов'])} пока только на этом устройстве
              </span>
            ) : (
              <span>☁️ Все файлы в облаке и доступны на других устройствах</span>
            )}
          </div>
          {!cloud.uploading && notInCloud > 0 && (
            <button
              onClick={() => {
                resetCloudRetries();
                onRefreshMedia();
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/80 border border-current/20 hover:bg-white"
            >
              Выгрузить сейчас
            </button>
          )}
        </div>
      )}

      {/* Upload Dropzone (только для администратора) */}
      {!readOnly && (
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <span>➕ Добавить фото или видео</span>
          </h2>

          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 rounded-full font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Без Cloudinary и без ключей</span>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files) {
              handleFiles(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/70 scale-[1.01]'
              : 'border-slate-300 hover:border-blue-400 bg-slate-50/70 hover:bg-slate-50'
          }`}
        >
          <div className="p-3.5 bg-blue-100 text-blue-600 rounded-2xl shadow-2xs">
            <UploadCloud className="w-8 h-8" />
          </div>

          <div>
            <p className="text-sm sm:text-base font-semibold text-slate-800">
              Перетащите фото и видео сюда или <span className="text-blue-600 underline">выберите на устройстве</span>
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              Поддерживаются MP4, WebM, MOV, MKV, JPG, PNG, WEBP любого размера (до 200 МБ на файл)
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                handleFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
        </div>

        {/* Upload Progress Bar */}
        {isUploading && (
          <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-900 mb-1.5">
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                Загрузка файла…
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Status Notification */}
        {statusMessage && !isUploading && (
          <div
            className={`mt-4 p-3 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 ${
              statusMessage.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : statusMessage.type === 'err'
                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            {statusMessage.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : statusMessage.type === 'err' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>
      )}

      {/* Gallery Section */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">
              Галерея файлов
            </h3>
            <p className="text-xs text-slate-500">
              Всего: {mediaList.length} {plural(mediaList.length, ['файл', 'файла', 'файлов'])}
              {photoCount > 0 ? ` (${photoCount} фото` : ''}
              {videoCount > 0 ? `, ${videoCount} видео)` : photoCount > 0 ? ')' : ''}
            </p>
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                filterType === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Все ({mediaList.length})
            </button>
            <button
              onClick={() => setFilterType('photo')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                filterType === 'photo'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Фото ({photoCount})</span>
            </button>
            <button
              onClick={() => setFilterType('video')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                filterType === 'video'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Видео ({videoCount})</span>
            </button>
          </div>
        </div>

        {/* Media Grid */}
        {filteredMedia.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
              <Film className="w-7 h-7" />
            </div>
            <p className="text-slate-700 font-medium text-sm">
              {readOnly ? 'Пока здесь нет фото и видео 🙂' : 'Пока ничего нет — добавьте первое фото или видео 🙂'}
            </p>
            {!readOnly && (
              <>
                <p className="text-slate-400 text-xs mt-1">
                  Файлы сохраняются безопасно без сторонних ключей
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  Выбрать файлы
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredMedia.map((m, idx) => {
              const globalIdx = mediaList.findIndex((item) => item.id === m.id);

              return (
                <div key={m.id} className="flex flex-col gap-1.5">
                <div
                  onClick={() => setActiveViewerIndex(globalIdx)}
                  className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-2xs hover:shadow-md transition-all cursor-pointer"
                >
                  {/* Thumbnail */}
                  {m.type === 'photo' ? (
                    <img
                      src={m.thumb || m.url}
                      alt={m.caption || ""}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full relative bg-slate-900">
                      {m.thumb ? (
                        <img
                          src={m.thumb}
                          alt={m.caption || ""}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90"
                          loading="lazy"
                        />
                      ) : (
                        <video
                          src={m.url}
                          preload="metadata"
                          muted
                          playsInline
                          className="w-full h-full object-cover opacity-90"
                        />
                      )}
                      {/* Play Button Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-white group-hover:scale-110 group-hover:bg-blue-600 transition-all shadow-md">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Метка только у видео (у фото никаких надписей) */}
                  {m.type === 'video' && (
                    <span className="absolute top-2 left-2 bg-black/60 backdrop-blur-xs text-white text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-xs">
                      <Film className="w-2.5 h-2.5" />
                      <span>Видео</span>
                    </span>
                  )}

                  {/* Delete Button (только для администратора) */}
                  {!readOnly && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Удалить этот файл?')) {
                        handleDelete(m);
                      }
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 hover:bg-rose-600 text-white backdrop-blur-xs opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-all cursor-pointer shadow-xs"
                    title="Удалить"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  )}
                </div>

                {/* Подпись под снимком (клиент её только читает) */}
                {readOnly ? (
                  m.caption ? (
                    <p className="px-2 text-xs text-slate-700 break-words">{m.caption}</p>
                  ) : null
                ) : (
                  <CaptionField item={m} onSave={handleCaption} />
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fullscreen Media Viewer Lightbox */}
      {activeViewerIndex !== null && (
        <MediaViewer
          mediaList={mediaList}
          currentIndex={activeViewerIndex}
          onClose={() => setActiveViewerIndex(null)}
          onNavigate={(newIdx) => setActiveViewerIndex(newIdx)}
          onDelete={handleDelete}
          onUpdateCaption={handleCaption}
          readOnly={readOnly}
        />
      )}
    </div>
  );
};
