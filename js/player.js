// Wraps the <video> element with a YouTube-style custom control bar, plus
// mobile fullscreen gestures: double-tap left/right to seek ±10s, vertical
// swipe on the right for volume, vertical swipe on the left for a simulated
// "brightness" dim (browsers can't touch the real screen backlight), and
// swipe-up-from-center to reveal a recommendations sheet.
function createLTPlayer(opts) {
  const {
    video, wrap, progressBar, progressPlayed, progressBuffered, progressThumb,
    playPauseBtn, iconPlay, iconPause, muteBtn, iconVolHigh, iconVolMute, volSlider, timeDisplay,
    fullscreenBtn, pipBtn, nextBtn,
    gestureLayer, seekRippleLeft, seekRippleLeftLabel, seekRippleRight, seekRippleRightLabel,
    gestureIndicator, gestureIndicatorIcon, gestureIndicatorFill, gestureIndicatorValue,
    brightnessOverlay, swipeUpHint, recsSheet,
    playerError, playerErrorSub, playerErrorBack,
    gestureSettings
  } = opts;

  let hideTimer = null;
  let scrubbing = false;
  let onEndedCb = null;
  let onNextCb = null;
  let onSwipeUpRecsCb = null;
  let onErrorBackCb = null;
  let brightness = 1; // 1 = normal, 0 = fully dimmed (simulated only)

  const ICON_VOL = '<path d="M4 9v6h4l5 5V4L8 9H4z" fill="#fff"/><path d="M16 8a5 5 0 010 8M18.5 5.5a9 9 0 010 13" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>';
  const ICON_SUN = '<circle cx="12" cy="12" r="4" fill="#fff"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>';

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = h ? String(m).padStart(2, '0') : m;
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function updatePlayIcon() {
    const playing = !video.paused && !video.ended;
    iconPlay.classList.toggle('hidden', playing);
    iconPause.classList.toggle('hidden', !playing);
  }

  function updateProgress() {
    if (scrubbing) return;
    const d = video.duration || 0;
    const pct = d ? (video.currentTime / d) * 100 : 0;
    progressPlayed.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
    if (video.buffered.length) {
      const buffEnd = video.buffered.end(video.buffered.length - 1);
      progressBuffered.style.width = (d ? (buffEnd / d) * 100 : 0) + '%';
    }
    timeDisplay.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
  }

  function seekToClientX(clientX) {
    const rect = progressBar.getBoundingClientRect();
    const pct = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const d = video.duration || 0;
    video.currentTime = pct * d;
    progressPlayed.style.width = (pct * 100) + '%';
    progressThumb.style.left = (pct * 100) + '%';
  }
  progressBar.addEventListener('pointerdown', (e) => { scrubbing = true; progressBar.setPointerCapture(e.pointerId); seekToClientX(e.clientX); });
  progressBar.addEventListener('pointermove', (e) => { if (scrubbing) seekToClientX(e.clientX); });
  progressBar.addEventListener('pointerup', () => { scrubbing = false; });
  progressBar.addEventListener('click', (e) => seekToClientX(e.clientX));

  function togglePlay() {
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }
  playPauseBtn.addEventListener('click', togglePlay);
  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);
  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('progress', updateProgress);
  video.addEventListener('loadedmetadata', updateProgress);
  video.addEventListener('ended', () => onEndedCb && onEndedCb());

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    iconVolHigh.classList.toggle('hidden', video.muted);
    iconVolMute.classList.toggle('hidden', !video.muted);
    if (!video.muted && video.volume === 0) { video.volume = 1; volSlider.value = 1; }
  });
  volSlider.addEventListener('input', () => {
    video.volume = parseFloat(volSlider.value);
    video.muted = video.volume === 0;
    iconVolHigh.classList.toggle('hidden', video.muted);
    iconVolMute.classList.toggle('hidden', !video.muted);
  });

  nextBtn.addEventListener('click', () => onNextCb && onNextCb());

  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iOS Safari fallback
  });

  document.addEventListener('fullscreenchange', () => {
    const isThisPlayerFullscreen = document.fullscreenElement === wrap;
    wrap.classList.toggle('is-fullscreen', isThisPlayerFullscreen);
    if (isThisPlayerFullscreen) {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    } else {
      if (screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch (e) {} }
      closeRecsSheet();
    }
  });

  pipBtn && pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch (e) { /* PiP not available */ }
  });

  /* ---------------- Auto-hide controls ---------------- */
  function showControls() {
    wrap.classList.remove('controls-hidden');
    clearTimeout(hideTimer);
    if (!video.paused) hideTimer = setTimeout(() => wrap.classList.add('controls-hidden'), 2600);
  }
  wrap.addEventListener('mousemove', showControls, { passive: true });
  video.addEventListener('play', showControls);
  video.addEventListener('pause', () => { wrap.classList.remove('controls-hidden'); clearTimeout(hideTimer); });

  document.addEventListener('keydown', (e) => {
    if (!wrap.matches(':hover') && document.activeElement !== video) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { video.currentTime = Math.min(video.currentTime + 5, video.duration || 0); }
    else if (e.key === 'ArrowLeft') { video.currentTime = Math.max(video.currentTime - 5, 0); }
    else if (e.key === 'f') { fullscreenBtn.click(); }
    else if (e.key === 'm') { muteBtn.click(); }
  });

  /* ---------------- Seek ripple (double-tap feedback) ---------------- */
  let rippleTimer = { left: null, right: null };
  function flashSeekRipple(side, seconds) {
    const el = side === 'left' ? seekRippleLeft : seekRippleRight;
    const label = side === 'left' ? seekRippleLeftLabel : seekRippleRightLabel;
    label.textContent = `${seconds}s`;
    el.classList.add('show');
    clearTimeout(rippleTimer[side]);
    rippleTimer[side] = setTimeout(() => el.classList.remove('show'), 500);
  }

  /* ---------------- Recommendations sheet (swipe up) ---------------- */
  let recsOpen = false;
  function openRecsSheet() { recsOpen = true; recsSheet.classList.add('open'); onSwipeUpRecsCb && onSwipeUpRecsCb(); }
  function closeRecsSheet() { recsOpen = false; recsSheet.classList.remove('open'); }
  recsSheet.addEventListener('click', (e) => { if (e.target === recsSheet) closeRecsSheet(); });

  /* ---------------- Gesture indicator (volume/brightness) ---------------- */
  function showGestureIndicator(side, iconSvg, pct) {
    gestureIndicator.classList.remove('hidden', 'left', 'right');
    gestureIndicator.classList.add(side);
    gestureIndicatorIcon.innerHTML = iconSvg;
    gestureIndicatorFill.style.height = Math.round(pct * 100) + '%';
    gestureIndicatorValue.textContent = Math.round(pct * 100) + '%';
  }
  function hideGestureIndicatorSoon() {
    clearTimeout(hideGestureIndicatorSoon._t);
    hideGestureIndicatorSoon._t = setTimeout(() => gestureIndicator.classList.add('hidden'), 500);
  }

  /* ---------------- Unified tap/drag gesture handling ---------------- */
  function zoneFor(x) {
    const rect = wrap.getBoundingClientRect();
    const rel = (x - rect.left) / rect.width;
    if (rel < 0.35) return 'left';
    if (rel > 0.65) return 'right';
    return 'middle';
  }
  function isFullscreenActive() { return document.fullscreenElement === wrap; }

  let g = null; // active gesture state
  let lastTap = { time: 0, zone: null };
  let lastPointerType = 'mouse';

  gestureLayer.style.pointerEvents = 'auto';
  gestureLayer.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return; // mouse handled by click below
    const rect = wrap.getBoundingClientRect();
    g = {
      zone: zoneFor(e.clientX), startX: e.clientX, startY: e.clientY, startTime: performance.now(),
      mode: null, startVolume: video.volume, startBrightness: brightness, rectH: rect.height,
      controlsHiddenAtStart: wrap.classList.contains('controls-hidden')
    };
    showControls();
  }, { passive: true });

  gestureLayer.addEventListener('pointermove', (e) => {
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.mode) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
        if (dy < 0 && g.zone === 'middle' && isFullscreenActive()) g.mode = 'swipeup';
        else if (g.zone === 'right' && isFullscreenActive() && gestureSettings.volume) g.mode = 'volume';
        else if (g.zone === 'left' && isFullscreenActive() && gestureSettings.brightness) g.mode = 'brightness';
        else g.mode = 'none';
      } else if (Math.abs(dx) > 14) {
        g.mode = 'none';
      }
    }
    if (g.mode === 'volume') {
      const delta = -dy / (g.rectH * 0.75);
      const v = Math.min(Math.max(g.startVolume + delta, 0), 1);
      video.volume = v; video.muted = v === 0;
      iconVolHigh.classList.toggle('hidden', video.muted);
      iconVolMute.classList.toggle('hidden', !video.muted);
      volSlider.value = v;
      showGestureIndicator('right', ICON_VOL, v);
    } else if (g.mode === 'brightness') {
      const delta = -dy / (g.rectH * 0.75);
      brightness = Math.min(Math.max(g.startBrightness + delta, 0.15), 1);
      brightnessOverlay.style.opacity = String(1 - brightness);
      showGestureIndicator('left', ICON_SUN, brightness);
    } else if (g.mode === 'swipeup') {
      const dist = Math.min(Math.max(-dy, 0), 140);
      swipeUpHint.style.opacity = String(Math.min(dist / 60, 1));
      if (dist > 70) { openRecsSheet(); g.mode = 'swipeup-done'; }
    }
  }, { passive: true });

  gestureLayer.addEventListener('pointerup', (e) => {
    if (!g) return;
    const dt = performance.now() - g.startTime;
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    const wasTap = Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300;
    swipeUpHint.style.opacity = '0';
    if (g.mode === 'volume' || g.mode === 'brightness') hideGestureIndicatorSoon();

    if (wasTap) {
      const zone = g.zone;
      if (zone === 'left' || zone === 'right') {
        const now = performance.now();
        if (gestureSettings.doubleTap && lastTap.zone === zone && (now - lastTap.time) < 320) {
          const secs = zone === 'left' ? -10 : 10;
          video.currentTime = Math.min(Math.max(video.currentTime + secs, 0), video.duration || Infinity);
          flashSeekRipple(zone, 10);
          lastTap = { time: 0, zone: null };
        } else {
          lastTap = { time: now, zone };
          if (g.controlsHiddenAtStart) { /* reveal only, already shown via showControls() on down */ }
          else if (!video.paused) { wrap.classList.add('controls-hidden'); clearTimeout(hideTimer); }
        }
      } else { // middle zone tap
        if (g.controlsHiddenAtStart) { /* revealed already */ }
        else if (!video.paused) { wrap.classList.add('controls-hidden'); clearTimeout(hideTimer); }
      }
    }
    g = null;
  }, { passive: true });

  // Desktop mouse click on the video area: toggle play (classic behavior).
  // Touch taps are already handled by the pointerdown/pointerup gesture
  // logic above, so we ignore the synthetic click that follows a touch tap.
  gestureLayer.addEventListener('click', () => {
    if (lastPointerType === 'touch' || lastPointerType === 'pen') return;
    togglePlay();
  });

  playerErrorBack.addEventListener('click', () => onErrorBackCb && onErrorBackCb());

  return {
    load(src) {
      video.pause();
      video.src = src;
      video.load();
      video.play().catch(() => {});
      updatePlayIcon();
      brightness = 1; brightnessOverlay.style.opacity = '0';
      closeRecsSheet();
    },
    play() { video.play().catch(() => {}); },
    pause() { video.pause(); },
    showError(message) {
      playerErrorSub.textContent = message || "It may have been moved, renamed, or its folder hasn't been reconnected.";
      playerError.classList.remove('hidden');
    },
    hideError() { playerError.classList.add('hidden'); },
    set onEnded(cb) { onEndedCb = cb; },
    set onNext(cb) { onNextCb = cb; },
    set onSwipeUpRecs(cb) { onSwipeUpRecsCb = cb; },
    set onErrorBack(cb) { onErrorBackCb = cb; },
    get el() { return video; }
  };
}
