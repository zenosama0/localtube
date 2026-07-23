// Turns "a folder" or "a bunch of picked files" into video entries, and
// supports diffing a fresh directory listing against a cached index so
// re-scans only do work for what actually changed.
const LTScanner = (() => {
  const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|3gp|3gpp)$/i;

  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function makeId(folder, name, size, lastModified) {
    return `${folder}/${name}-${size}-${lastModified}`;
  }

  // Read a File out of an entry regardless of whether it came from a live
  // FileSystemFileHandle (desktop / cached) or a plain File (mobile picker).
  function getEntryFile(entry) {
    return entry.kind === 'handle' ? entry.fileHandle.getFile() : Promise.resolve(entry.file);
  }

  /* ---------------- Directory listing (fast, no metadata probing) ---------------- */
  async function* walk(dirHandle, path) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file') {
        if (VIDEO_EXT.test(name)) yield { fileHandle: handle, name, folder: path || dirHandle.name };
      } else if (handle.kind === 'directory') {
        yield* walk(handle, path ? `${path}/${name}` : name);
      }
    }
  }

  // Lists every video under a directory handle (recursively) as lightweight
  // entries — size/lastModified known, but no duration/dimensions/thumb yet.
  async function listDirectoryHandle(dirHandle, rootId, onProgress) {
    const out = [];
    let count = 0;
    for await (const item of walk(dirHandle, '')) {
      const file = await item.fileHandle.getFile();
      count++;
      onProgress && onProgress(count, item.name);
      out.push({
        id: makeId(item.folder, item.name, file.size, file.lastModified),
        name: item.name, folder: item.folder, size: file.size, lastModified: file.lastModified,
        kind: 'handle', fileHandle: item.fileHandle, rootId,
        duration: 0, width: 0, height: 0, isShort: false, thumb: null
      });
    }
    return out;
  }

  // Fallback for browsers/platforms without directory access: build entries
  // straight from a FileList (native gallery / file / webkitdirectory picker).
  function scanFileList(fileList, rootId) {
    const out = [];
    for (const file of fileList) {
      if (!file.type.startsWith('video/') && !VIDEO_EXT.test(file.name)) continue;
      const folder = file.webkitRelativePath
        ? (file.webkitRelativePath.split('/').slice(0, -1).join('/') || 'Device')
        : 'Device';
      out.push({
        id: makeId(folder, file.name, file.size, file.lastModified),
        name: file.name, folder, size: file.size, lastModified: file.lastModified,
        kind: 'file', file, rootId,
        duration: 0, width: 0, height: 0, isShort: false, thumb: null
      });
    }
    return out;
  }

  // Reuses a cached index's fileHandles by matching id, so a video that's
  // unchanged since last scan doesn't need re-probing at all.
  function diffAgainstCache(freshEntries, cachedEntries) {
    const cachedById = new Map((cachedEntries || []).map(e => [makeId(e.folder, e.name, e.size, e.lastModified), e]));
    const freshIds = new Set(freshEntries.map(e => e.id));
    const unchanged = [];
    const added = [];
    for (const e of freshEntries) {
      const hit = cachedById.get(e.id);
      if (hit && hit.duration) {
        unchanged.push({ ...e, duration: hit.duration, width: hit.width, height: hit.height, isShort: hit.isShort, thumb: hit.thumb });
      } else {
        added.push(e);
      }
    }
    const removed = (cachedEntries || []).filter(e => !freshIds.has(makeId(e.folder, e.name, e.size, e.lastModified)));
    return { unchanged, added, removed };
  }

  /* ---------------- Metadata probing (duration + dimensions) ---------------- */
  function probeMeta(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.src = url;
      let settled = false;
      const finish = (r) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(r); };
      const timeout = setTimeout(() => finish({ duration: 0, width: 0, height: 0 }), 6000);
      v.addEventListener('loadedmetadata', () => { clearTimeout(timeout); finish({ duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight }); });
      v.addEventListener('error', () => { clearTimeout(timeout); finish({ duration: 0, width: 0, height: 0 }); });
    });
  }

  // Grabs a mid-video frame as a thumbnail (data URL) plus duration/dimensions.
  function extractThumbAndDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = url;
      let settled = false;
      const finish = (r) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(r); };
      const timeout = setTimeout(() => finish({ thumb: null, duration: 0, width: 0, height: 0 }), 8000);
      v.addEventListener('loadedmetadata', () => {
        const seekTo = Math.min(Math.max(v.duration * 0.25, 0.1), v.duration || 0.1);
        try { v.currentTime = seekTo; } catch (e) { finish({ thumb: null, duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight }); }
      });
      v.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = Math.round(320 * (v.videoHeight / v.videoWidth || 9 / 16));
          canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
          const thumb = canvas.toDataURL('image/jpeg', 0.7);
          clearTimeout(timeout);
          finish({ thumb, duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight });
        } catch (e) {
          clearTimeout(timeout);
          finish({ thumb: null, duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight });
        }
      });
      v.addEventListener('error', () => { clearTimeout(timeout); finish({ thumb: null, duration: 0, width: 0, height: 0 }); });
    });
  }

  function classify(meta) {
    return !!(meta.duration && meta.duration < 60 && meta.width && meta.height && (meta.height / meta.width) >= 1.15);
  }

  // Probes entries (metadata only — cheap) with limited concurrency, calling
  // onEntryReady(entry) as soon as each one is classified, and onProgress
  // for a running count. Mutates entries in place.
  async function probeEntries(entries, onEntryReady, onProgress, concurrency = 4) {
    let done = 0, idx = 0;
    async function worker() {
      while (idx < entries.length) {
        const entry = entries[idx++];
        try {
          const file = await getEntryFile(entry);
          const meta = await probeMeta(file);
          entry.duration = meta.duration; entry.width = meta.width; entry.height = meta.height;
          entry.isShort = classify(meta);
        } catch (e) { entry.duration = 0; entry.width = 0; entry.height = 0; entry.isShort = false; }
        done++;
        onProgress && onProgress(done, entries.length);
        onEntryReady && onEntryReady(entry);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, entries.length || 1) }, worker);
    await Promise.all(workers);
    return entries;
  }

  return {
    supportsDirectoryPicker, VIDEO_EXT, makeId, getEntryFile,
    listDirectoryHandle, scanFileList, diffAgainstCache,
    probeMeta, extractThumbAndDuration, probeEntries
  };
})();
