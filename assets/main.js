(() => {
  'use strict';

  const hero = document.querySelector('.hero');
  const stage = document.querySelector('.hero-stage');
  const video = document.querySelector('#hero-video');
  const header = document.querySelector('.site-header');
  const bands = [...document.querySelectorAll('.hero-band')];
  const menuToggle = document.querySelector('.menu-toggle');
  const siteNav = document.querySelector('.site-nav');
  const loader = document.querySelector('.hero-loader');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileGate = window.matchMedia('(max-width: 767px)');
  const heroVideoUrl = 'assets/hero-scrub.mp4';
  const heroPoster = document.querySelector('.hero-poster');

  let heroOnScreen = true;
  let rafId = null;
  let lastTick = 0;
  let target = 0;
  let shown = 0;
  let seekBusy = false;
  let pendingTime = null;
  let currentBand = -1;
  let blobUrl = null;
  let fetchStarted = false;
  let posterReady = false;
  let loadScheduled = false;
  let currentProgress = -1;

  function heroProgress() {
    const rect = hero.getBoundingClientRect();
    const range = Math.max(1, hero.offsetHeight - window.innerHeight);
    return Math.max(0, Math.min(1, -rect.top / range));
  }

  function bandAt(progress) {
    if (progress < .24) return 0;
    if (progress < .49) return 1;
    if (progress < .74) return 2;
    return 3;
  }

  function setBand(index) {
    if (index === currentBand) return;
    currentBand = index;
    bands.forEach((band, i) => {
      const active = i === index;
      band.classList.toggle('is-active', active);
      band.setAttribute('aria-hidden', String(!active));
    });
    const label = String(index + 1).padStart(2, '0');
    const indexStart = document.querySelector('.hero-index span:first-child');
    if (indexStart) indexStart.textContent = label;
  }

  function updateHero(progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (Math.abs(p - currentProgress) > .002 || p === 0 || p === 1) {
      currentProgress = p;
      hero.style.setProperty('--hero-progress', p.toFixed(3));
    }
    setBand(bandAt(p));
  }

  function requestSeek(time) {
    if (!video.duration || !Number.isFinite(video.duration) || video.readyState < 2) return;
    const safeTime = Math.max(0, Math.min(video.duration - .12, time));
    if (seekBusy) {
      pendingTime = safeTime;
      return;
    }
    if (Math.abs(video.currentTime - safeTime) < .015) return;
    seekBusy = true;
    try {
      video.currentTime = safeTime;
    } catch {
      seekBusy = false;
      pendingTime = null;
    }
  }

  function syncHeroHeader() {
    const scrubbing = hero.classList.contains('is-scrubbing');
    const finalFrameReady = target >= 1 && shown >= .9995 && !seekBusy &&
      video.readyState >= 2 && Number.isFinite(video.duration) &&
      video.currentTime >= video.duration - .15;
    header.classList.toggle('is-hero-hidden', scrubbing && !finalFrameReady);
  }

  video.addEventListener('seeked', () => {
    seekBusy = false;
    if (pendingTime !== null) {
      const next = pendingTime;
      pendingTime = null;
      requestSeek(next);
    }
    syncHeroHeader();
  });
  video.addEventListener('error', () => {
    seekBusy = false;
    pendingTime = null;
    if (video.currentSrc || video.src) failVideo();
  });

  function tick(now) {
    const dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    const k = 0.17;
    shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));
    if (Math.abs(target - shown) < .0005) {
      shown = target;
      rafId = null;
      lastTick = 0;
    } else {
      rafId = requestAnimationFrame(tick);
    }
    if (hero.classList.contains('is-scrubbing')) requestSeek(shown * video.duration);
    updateHero(shown);
    syncHeroHeader();
  }

  function onScroll() {
    header.classList.toggle('is-scrolled', window.scrollY > 40);
    const scrubbing = hero.classList.contains('is-scrubbing');
    if (!scrubbing) {
      syncHeroHeader();
      return;
    }
    target = heroProgress();
    syncHeroHeader();
    if ((heroOnScreen || target >= 1) && rafId === null) rafId = requestAnimationFrame(tick);
  }

  function failVideo() {
    hero.classList.remove('is-loading', 'is-scrubbing');
    hero.classList.add('is-static-failed');
    stage.classList.remove('video-ready');
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    if (loader) loader.setAttribute('hidden', '');
    target = 0;
    shown = 0;
    updateHero(0);
    onScroll();
  }

  async function loadHeroBlob() {
    const controller = new AbortController();
    let watchdog = window.setTimeout(() => controller.abort(), 20000);
    try {
    const response = await fetch(heroVideoUrl, { signal: controller.signal, cache: 'force-cache', priority: 'low' });
    if (!response.ok || !response.body) throw new Error('Vídeo indisponível');
    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    const fallbackBytes = Number(video.dataset.bytes) || 0;
    const total = contentLength || fallbackBytes;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let lastPaint = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => controller.abort(), 20000);
      chunks.push(value);
      received += value.byteLength;
      const now = performance.now();
      if (total && (now - lastPaint > 100 || received >= total)) {
        lastPaint = now;
        stage.style.setProperty('--loader-dash', String(Math.round(126 * (1 - Math.min(1, received / total)))));
      }
    }
    window.clearTimeout(watchdog);
    stage.style.setProperty('--loader-dash', '0');
    blobUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('Content-Type') || 'video/mp4' }));
    video.src = blobUrl;
    video.load();
    video.addEventListener('loadedmetadata', () => {
      target = heroProgress();
      shown = target;
      requestSeek(shown * video.duration);
    }, { once: true });
    video.addEventListener('canplay', () => {
      hero.classList.remove('is-loading');
      hero.classList.add('is-scrubbing');
      stage.classList.add('video-ready');
      target = heroProgress();
      shown = target;
      updateHero(shown);
      requestSeek(shown * video.duration);
      onScroll();
    }, { once: true });
    } catch (error) {
      window.clearTimeout(watchdog);
      throw error;
    }
  }

  function scheduleHeroLoad() {
    if (fetchStarted || loadScheduled || mobileGate.matches || prefersReduced.matches || !posterReady) return;
    loadScheduled = true;
    const start = () => {
      loadScheduled = false;
      maybeLoadHero();
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 1800 });
    else window.setTimeout(start, 700);
  }

  function maybeLoadHero() {
    if (fetchStarted || mobileGate.matches || prefersReduced.matches || !posterReady || !('fetch' in window)) return;
    if (video.dataset.available !== 'true') {
      failVideo();
      return;
    }
    if (location.protocol === 'file:') {
      failVideo();
      return;
    }
    fetchStarted = true;
    hero.classList.add('is-loading', 'is-scrubbing');
    onScroll();
    loadHeroBlob().catch(failVideo);
  }

  const heroObserver = new IntersectionObserver((entries) => {
    heroOnScreen = entries[0].isIntersecting;
    if (heroOnScreen && hero.classList.contains('is-scrubbing')) onScroll();
  }, { threshold: 0 });
  heroObserver.observe(hero);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window.addEventListener('pagehide', () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, { once: true });
  prefersReduced.addEventListener?.('change', () => {
    if (prefersReduced.matches) failVideo();
    else maybeLoadHero();
  });
  mobileGate.addEventListener?.('change', () => {
    if (mobileGate.matches) failVideo();
    else maybeLoadHero();
  });
  function onHeroPosterReady() {
    if (posterReady) return;
    posterReady = true;
    scheduleHeroLoad();
  }
  if (heroPoster?.complete) onHeroPosterReady();
  else if (heroPoster) {
    heroPoster.addEventListener('load', onHeroPosterReady, { once: true });
    heroPoster.addEventListener('error', onHeroPosterReady, { once: true });
    window.setTimeout(onHeroPosterReady, 4000);
  } else {
    posterReady = true;
    scheduleHeroLoad();
  }

  // Reveal each lower-page moment as it enters view, then let it rest.
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: .12, rootMargin: '0px 0px -4% 0px' });
  document.querySelectorAll('.reveal, .section-doodle').forEach((item) => revealObserver.observe(item));

  // A short hold completes the page's one small, tactile coffee ritual.
  const brewButton = document.querySelector('#brew-button');
  const brewHint = document.querySelector('#brew-hint');
  const brewResult = document.querySelector('#brew-result');
  let holdStart = 0;
  let holdFrame = null;
  let holding = false;
  let completed = false;

  function finishHold() {
    holding = false;
    if (holdFrame !== null) cancelAnimationFrame(holdFrame);
    holdFrame = null;
    if (!completed) {
      brewButton.style.setProperty('--brew', '0%');
      brewHint.textContent = 'A pausa começou. Segure até completar.';
    }
  }

  function holdTick(now) {
    if (!holding || completed) return;
    const progress = Math.min(1, (now - holdStart) / 3000);
    brewButton.style.setProperty('--brew', `${(progress * 100).toFixed(1)}%`);
    if (progress >= 1) {
      completed = true;
      holding = false;
      brewButton.classList.add('is-complete');
      brewButton.querySelector('.brew-button-label').textContent = 'Pausa feita';
      brewButton.querySelector('.brew-arrow').textContent = '✓';
      brewButton.setAttribute('aria-pressed', 'true');
      brewHint.textContent = 'Pronto. Pode voltar ao seu dia.';
      brewResult.hidden = false;
      return;
    }
    holdFrame = requestAnimationFrame(holdTick);
  }

  function beginHold(event) {
    if (completed || holding) return;
    event.preventDefault();
    holding = true;
    holdStart = performance.now();
    brewHint.textContent = 'A água está passando…';
    holdFrame = requestAnimationFrame(holdTick);
    if (event.pointerId !== undefined) brewButton.setPointerCapture?.(event.pointerId);
  }

  brewButton.addEventListener('pointerdown', beginHold);
  brewButton.addEventListener('pointerup', finishHold);
  brewButton.addEventListener('pointercancel', finishHold);
  brewButton.addEventListener('lostpointercapture', finishHold);
  brewButton.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') beginHold(event);
  });
  brewButton.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') finishHold();
  });
  brewButton.addEventListener('blur', finishHold);

  // Mobile navigation closes after a choice or when Escape is pressed.
  function closeMenu() {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Abrir menu');
    siteNav.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  }
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    siteNav.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
  });
  siteNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
})();
