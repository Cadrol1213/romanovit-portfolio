(() => {
  const ITEMS = window.PORTFOLIO || [];
  const I18N = window.I18N;
  const LOGOS = window.LOGOS || {};
  const FILTERS = ['all', 'reels', 'youtube', 'edits', 'ai', '2d', '3d'];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const filtersEl = $('filters');
  const emptyEl = $('empty');
  const lightbox = $('lightbox');
  const lbVideo = $('lb-video');
  const langToggle = $('lang-toggle');

  let lang = loadLang();
  let filter = 'all';
  let visible = [];
  let columnsCount = 0;
  let lbIndex = -1;
  let lastFocus = null;

  // =============== Язык ===============
  function loadLang() {
    try {
      const saved = localStorage.getItem('lang');
      if (saved === 'ru' || saved === 'en') return saved;
    } catch (e) { /* хранилище недоступно — берём язык браузера */ }
    return (navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  const t = (key) => I18N[lang][key] ?? I18N.ru[key] ?? key;

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]').content = t('meta.description');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
    langToggle.textContent = lang === 'ru' ? 'EN' : 'RU';
    langToggle.setAttribute('aria-label', t('lang.switch'));
    $('works-count').textContent = `(${ITEMS.length})`;
    buildTapes();
    renderFilters();
    renderGrid();
    orbit.relabel();
    phone.relabel();
    if (lbIndex >= 0) fillCaption(visible[lbIndex]);
  }

  langToggle.addEventListener('click', () => {
    lang = lang === 'ru' ? 'en' : 'ru';
    try { localStorage.setItem('lang', lang); } catch (e) { /* не критично */ }
    applyLang();
  });

  // иконки приложений в уведомлениях вокруг телефона
  document.querySelectorAll('[data-logo]').forEach((el) => { el.innerHTML = LOGOS[el.dataset.logo] || ''; });

  // =============== Шапка ===============
  const header = $('header');
  const onScrollHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScrollHeader, { passive: true });
  onScrollHeader();

  const pad = (n) => String(n).padStart(2, '0');
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smoothstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

  // =============== Первый экран: телефон, рилсы листаются при прокрутке ===============
  const phone = (() => {
    const hero = $('hero');
    const scene = $('phone-scene');
    const rig = $('phone-rig');
    const feed = $('feed');
    const burst = $('like-burst');
    const dotsEl = $('hint-dots');
    const mobileQuery = window.matchMedia('(max-width: 900px)');
    const reels = ITEMS.filter((item) => item.height > item.width).slice(0, 3);

    const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    const HEART = 'M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.2 5 6.8 5c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.6 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z';
    const COMMENT = 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z';
    const SHARE = 'M22 3 11 14M22 3l-7 19-4-8-8-4z';

    const nodes = reels.map((item) => {
      const el = document.createElement('div');
      el.className = 'reel';
      el.innerHTML =
        `<video class="reel-video" muted loop playsinline preload="auto" poster="${item.poster}" src="${item.preview}"></video>` +
        `<div class="reel-shade"></div>` +
        `<div class="reel-side"><span class="reel-avatar">R</span>${icon(HEART)}${icon(COMMENT)}${icon(SHARE)}</div>` +
        `<div class="reel-meta"><b>@romanovit</b><span class="reel-title"></span></div>` +
        `<div class="reel-progress"><span></span></div>`;
      const video = el.querySelector('video');
      const bar = el.querySelector('.reel-progress span');
      video.addEventListener('timeupdate', () => {
        if (video.duration) bar.style.transform = `scaleX(${video.currentTime / video.duration})`;
      });
      feed.appendChild(el);
      return { el, video, item };
    });
    dotsEl.innerHTML = nodes.map(() => '<i></i>').join('');
    const dots = [...dotsEl.children];

    let pos = 0;
    let current = -1;
    let visibleHero = true;
    let paused = false;
    let rx = 0, ry = 0, trx = 0, tryY = 0;

    // 0…1 — насколько пролистан первый экран
    function progress() {
      const vh = window.innerHeight;
      if (!mobileQuery.matches) {
        const r = hero.getBoundingClientRect();
        const range = r.height - vh;
        return range > 0 ? clamp01(-r.top / range) : 0;
      }
      const r = scene.getBoundingClientRect();
      return clamp01((vh * 0.8 - r.top) / (r.height + vh * 0.2));
    }

    // Между рилсами — «удержание», потом быстрый свайп, как в ленте
    function targetPos() {
      const x = progress() * (nodes.length - 1);
      const i = Math.floor(x);
      return Math.min(nodes.length - 1, i + smoothstep(0.35, 1, x - i));
    }

    function setCurrent(i) {
      if (i === current) return;
      current = i;
      nodes.forEach((n, k) => {
        if (k === i && !paused) { n.video.currentTime = 0; n.video.play().catch(() => {}); }
        else n.video.pause();
      });
      dots.forEach((d, k) => d.classList.toggle('is-on', k === i));
      if (!reducedMotion) {
        burst.classList.remove('is-pop');
        void burst.offsetWidth; // перезапуск анимации сердечка
        burst.classList.add('is-pop');
      }
    }

    function frame(now) {
      if (!visibleHero) return;
      const target = targetPos();
      pos = reducedMotion ? target : pos + (target - pos) * 0.16;
      feed.style.transform = `translate3d(0, ${(-pos * 100).toFixed(3)}%, 0)`;
      setCurrent(Math.round(pos));

      if (!reducedMotion) {
        if (mobileQuery.matches || !canHover) { trx = 4; tryY = -12 + progress() * 24; }
        rx += (trx - rx) * 0.08;
        ry += (tryY - ry) * 0.08;
        const float = Math.sin(now / 1100) * 8;
        rig.style.transform = `translateY(${float.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      }
      requestAnimationFrame(frame);
    }

    // наклон за курсором
    trx = 6; tryY = -16;
    if (canHover && !reducedMotion) {
      window.addEventListener('mousemove', (e) => {
        trx = 6 + (0.5 - e.clientY / window.innerHeight) * 12;
        tryY = -16 + (e.clientX / window.innerWidth - 0.5) * 30;
      }, { passive: true });
    }

    new IntersectionObserver(([entry]) => {
      visibleHero = entry.isIntersecting;
      if (visibleHero) requestAnimationFrame(frame);
      else nodes.forEach((n) => n.video.pause());
      if (visibleHero && current >= 0 && !paused) nodes[current].video.play().catch(() => {});
    }).observe(scene);

    function relabel() {
      nodes.forEach((n) => { n.el.querySelector('.reel-title').textContent = n.item.title[lang]; });
    }
    function pause() { paused = true; nodes.forEach((n) => n.video.pause()); }
    function resume() {
      paused = false;
      if (visibleHero && current >= 0) nodes[current].video.play().catch(() => {});
    }

    return { relabel, pause, resume };
  })();

  // =============== Бегущие ленты ===============
  function buildTapes() {
    const words = t('tape');
    const chunk = words.map((w) => `<span>${w}</span><i aria-hidden="true">✦</i>`).join('');
    // дважды по две копии: анимация сдвигает на -50%, и стык незаметен
    document.querySelectorAll('[data-tape]').forEach((track) => { track.innerHTML = chunk.repeat(4); });
  }

  // =============== Появление при прокрутке ===============
  const revealer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        revealer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    if (reducedMotion) el.classList.add('is-in');
    else revealer.observe(el);
  });

  // =============== Фильтры ===============
  const matches = (item, f) => f === 'all' || item.category === f || item.tags.includes(f);

  function renderFilters() {
    filtersEl.innerHTML = '';
    for (const f of FILTERS) {
      const count = ITEMS.filter((item) => matches(item, f)).length;
      if (!count) continue; // пустые категории (например, ИИ-видео) не показываем
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('aria-pressed', String(f === filter));
      btn.innerHTML = `${t('filter.' + f)}<span class="chip-count">${count}</span>`;
      btn.addEventListener('click', () => {
        if (filter === f) return;
        filter = f;
        renderFilters();
        renderGrid();
      });
      filtersEl.appendChild(btn);
    }
  }

  // =============== Masonry ===============
  function getColumnsCount() {
    const w = grid.clientWidth;
    if (w >= 1200) return 4;
    if (w >= 840) return 3;
    if (w >= 340) return 2;
    return 1;
  }

  const formatDuration = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const categoryLabel = (item) => t('filter.' + item.category);

  function createTile(item, index) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.style.setProperty('--ar', `${item.width} / ${item.height}`);
    tile.style.setProperty('--i', index);
    tile.setAttribute('aria-label', `${t('tile.open')}: ${item.title[lang]}`);

    const video = document.createElement('video');
    video.className = 'tile-media';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.poster = item.poster;
    video.dataset.src = item.preview; // источник подставляется, когда плитка подъезжает к экрану
    video.setAttribute('aria-hidden', 'true');
    // тонкая полоска прогресса превью внизу плитки
    video.addEventListener('timeupdate', () => {
      if (video.duration) tile.style.setProperty('--p', video.currentTime / video.duration);
    });
    tile.appendChild(video);

    tile.insertAdjacentHTML('beforeend',
      `<span class="tile-badges">` +
        `<span class="badge mono">${formatDuration(item.duration)}</span>` +
        (item.market === 'us' ? `<span class="badge badge-accent mono">${t('badge.us')}</span>` : '') +
      `</span>` +
      `<span class="tile-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>` +
      `<span class="tile-info"><span class="tile-title"></span><span class="tile-meta mono"></span></span>` +
      `<span class="tile-progress" aria-hidden="true"></span>`);
    tile.querySelector('.tile-title').textContent = item.title[lang];
    tile.querySelector('.tile-meta').textContent = categoryLabel(item);

    tile.addEventListener('click', () => openLightbox(index));
    if (canHover && reducedMotion) {
      tile.addEventListener('mouseenter', () => { loadSrc(video); video.play().catch(() => {}); });
      tile.addEventListener('mouseleave', () => video.pause());
    }
    return tile;
  }

  function renderGrid() {
    visible = ITEMS.filter((item) => matches(item, filter));
    columnsCount = getColumnsCount();
    grid.innerHTML = '';
    emptyEl.hidden = visible.length > 0;

    const cols = Array.from({ length: columnsCount }, () => {
      const col = document.createElement('div');
      col.className = 'grid-col';
      grid.appendChild(col);
      return { el: col, height: 0 };
    });

    // Каждую плитку — в самую короткую колонку. Высоту считаем по пропорциям,
    // поэтому раскладка точная ещё до загрузки видео.
    visible.forEach((item, i) => {
      const shortest = cols.reduce((a, b) => (b.height < a.height ? b : a));
      shortest.el.appendChild(createTile(item, i));
      shortest.height += item.height / item.width + 0.04;
    });

    observeTiles();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (getColumnsCount() !== columnsCount) renderGrid();
      orbit.measure();
    }, 150);
  });

  // =============== Превью: играют, только пока видны ===============
  function loadSrc(video) {
    if (video.dataset.src) {
      video.src = video.dataset.src;
      delete video.dataset.src;
    }
  }

  const loader = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        loadSrc(entry.target);
        loader.unobserve(entry.target);
      }
    }
  }, { rootMargin: '300px 0px' });

  const player = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting && lightbox.hidden) {
        loadSrc(video);
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, { threshold: 0.4 });

  function observeTiles() {
    loader.disconnect();
    player.disconnect();
    grid.querySelectorAll('.tile-media').forEach((video) => {
      loader.observe(video);
      if (!reducedMotion) player.observe(video);
    });
  }

  const pauseGrid = () => grid.querySelectorAll('.tile-media').forEach((v) => v.pause());
  function resumeGrid() {
    if (reducedMotion) return;
    grid.querySelectorAll('.tile-media').forEach((v) => { player.unobserve(v); player.observe(v); });
  }

  // =============== 3D-кольцо инструментов ===============
  const FLOW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 8c3-3.5 6 3.5 9 0s6-3.5 9 0"/><path d="M3 12.5c3-3.5 6 3.5 9 0s6-3.5 9 0"/><path d="M3 17c3-3.5 6 3.5 9 0s6-3.5 9 0"/></svg>';

  // full: иконка — сама «плашка» с вырезанными буквами; knock — цвет, который виден в вырезах
  const TOOLS = [
    { name: 'After Effects', icon: LOGOS.adobeaftereffects, full: true, fg: '#00005B', knock: '#9999FF' },
    { name: 'Premiere Pro', icon: LOGOS.adobepremierepro, full: true, fg: '#00005B', knock: '#9999FF' },
    { name: 'CapCut', icon: LOGOS.capcut, bg: '#000', fg: '#fff' },
    { name: 'Grok', icon: LOGOS.grok, bg: '#000', fg: '#fff' },
    { name: 'Google Flow', icon: FLOW_ICON, bg: 'linear-gradient(135deg, #4285F4, #9B72CB 55%, #D96570)', fg: '#fff' },
    { name: 'YouTube', icon: LOGOS.youtube, bg: '#fff', fg: '#FF0000' },
    { name: { ru: 'VK Видео', en: 'VK Video' }, icon: LOGOS.vk, full: true, fg: '#0077FF', knock: '#fff' },
    { name: 'TikTok', icon: LOGOS.tiktok, bg: '#000', fg: '#fff', cls: 'app-tiktok' },
    { name: 'Instagram', icon: LOGOS.instagram, bg: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)', fg: '#fff' },
  ];

  const orbit = (() => {
    const el = $('orbit');
    const stage = $('orbit-stage');
    const ring = $('orbit-ring');
    const nameEl = $('orbit-name');
    const counterEl = $('orbit-counter');
    const step = 360 / TOOLS.length;
    const toolName = (tool) => (typeof tool.name === 'string' ? tool.name : tool.name[lang]);

    const nodes = TOOLS.map((tool) => {
      const item = document.createElement('div');
      item.className = 'orbit-item';
      item.innerHTML =
        `<span class="app ${tool.full ? 'app-full' : ''} ${tool.cls || ''}" style="--app-bg:${tool.bg || 'transparent'};--app-fg:${tool.fg};--app-knock:${tool.knock || 'transparent'}">` +
          (tool.full ? '<span class="app-knock"></span>' : '') + (tool.icon || '') +
        `</span><span class="orbit-label"></span>`;
      ring.appendChild(item);
      return item;
    });

    let radius = 200;
    let current = 0;
    let target = 0;
    let frontIndex = -1;
    let running = false;
    let lastTime = 0;
    let drift = 0;

    function measure() {
      const w = stage.clientWidth;
      const tile = Math.round(Math.max(56, Math.min(104, w * 0.17)));
      // кольцо целиком помещается в ширину сцены, с запасом на половину плитки
      radius = Math.max(100, Math.min(290, w * 0.5 - tile * 0.7));
      stage.style.setProperty('--tile', `${tile}px`);
    }

    function relabel() {
      nodes.forEach((node, i) => { node.querySelector('.orbit-label').textContent = toolName(TOOLS[i]); });
      if (frontIndex >= 0) nameEl.textContent = toolName(TOOLS[frontIndex]);
    }

    function render() {
      let best = -2;
      let bestIndex = 0;
      nodes.forEach((node, i) => {
        const a = ((i * step + current) * Math.PI) / 180;
        const x = Math.sin(a) * radius;
        const z = Math.cos(a) * radius;
        const depth = (Math.cos(a) + 1) / 2; // 1 — спереди, 0 — сзади
        // translate без поворота — плитки всегда смотрят на зрителя, как в карусели
        node.style.transform = `translate3d(${x.toFixed(1)}px, 0, ${z.toFixed(1)}px) rotateX(20deg)`;
        node.style.opacity = (0.18 + 0.82 * depth ** 1.6).toFixed(3);
        if (Math.cos(a) > best) { best = Math.cos(a); bestIndex = i; }
      });
      if (bestIndex !== frontIndex) {
        if (frontIndex >= 0) nodes[frontIndex].classList.remove('is-front');
        nodes[bestIndex].classList.add('is-front');
        frontIndex = bestIndex;
        nameEl.textContent = toolName(TOOLS[bestIndex]);
        counterEl.textContent = `${pad(bestIndex + 1)} / ${pad(TOOLS.length)}`;
      }
    }

    // Угол = прокрутка страницы + лёгкий дрейф; сглаживание даёт «инерцию»
    function loop(now) {
      if (!running) return;
      const dt = Math.min(64, now - (lastTime || now));
      lastTime = now;
      drift += dt * 0.006;
      target = -window.scrollY * 0.28 - drift;
      current += (target - current) * 0.09;
      render();
      requestAnimationFrame(loop);
    }

    function setRunning(on) {
      if (reducedMotion) return;
      if (on && !running) { running = true; lastTime = 0; requestAnimationFrame(loop); }
      if (!on) running = false;
    }

    // на узких экранах кольцо переезжает из боковой колонки в поток текста
    const mobileQuery = window.matchMedia('(max-width: 900px)');
    function place() {
      const slot = mobileQuery.matches ? $('orbit-slot-mobile') : $('orbit-slot-desktop');
      if (el.parentElement !== slot) slot.appendChild(el);
      measure();
      render();
    }
    mobileQuery.addEventListener('change', place);

    new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting)).observe(el);

    place();
    return { measure, relabel, render };
  })();

  // =============== Лайтбокс ===============
  function fillCaption(item) {
    $('lb-title').textContent = item.title[lang];
    $('lb-meta').textContent = `${categoryLabel(item)} · ${formatDuration(item.duration)}`;
  }

  function showItem(index) {
    lbIndex = (index + visible.length) % visible.length;
    const item = visible[lbIndex];
    lbVideo.poster = item.poster;
    lbVideo.src = item.full;
    lbVideo.play().catch(() => {});
    fillCaption(item);
  }

  function openLightbox(index) {
    lastFocus = document.activeElement;
    pauseGrid();
    phone.pause();
    lightbox.hidden = false;
    document.body.classList.add('no-scroll');
    showItem(index);
    lightbox.querySelector('.lb-close').focus();
  }

  function closeLightbox() {
    lbVideo.pause();
    lbVideo.removeAttribute('src');
    lbVideo.load(); // останавливает скачивание
    lightbox.hidden = true;
    lbIndex = -1;
    document.body.classList.remove('no-scroll');
    if (lastFocus) lastFocus.focus({ preventScroll: true });
    resumeGrid();
    phone.resume();
  }

  lightbox.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close' || e.target === lightbox) closeLightbox();
    else if (action === 'prev') showItem(lbIndex - 1);
    else if (action === 'next') showItem(lbIndex + 1);
  });

  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft' && e.target !== lbVideo) showItem(lbIndex - 1);
    else if (e.key === 'ArrowRight' && e.target !== lbVideo) showItem(lbIndex + 1);
    else if (e.key === 'Tab') {
      const focusables = [...lightbox.querySelectorAll('button, video')];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Свайп влево/вправо на телефоне (кроме панели управления плеера)
  let touchX = null;
  lightbox.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    const rect = lbVideo.getBoundingClientRect();
    const onControls = e.target === lbVideo && touch.clientY > rect.bottom - rect.height * 0.25;
    touchX = onControls ? null : touch.clientX;
  }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) showItem(lbIndex + (dx < 0 ? 1 : -1));
  });

  applyLang();
})();
