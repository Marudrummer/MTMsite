const setupMobileNav = () => {
  const navToggle = document.getElementById('navToggle');
  const nav = document.getElementById('siteNav');
  if (!navToggle || !nav) return;

  const toggle = () => {
    nav.classList.toggle('open');
    document.body.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
  };

  navToggle.addEventListener('click', toggle);
  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      document.body.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMobileNav);
} else {
  setupMobileNav();
}

const setupThumbPicker = (form) => {
  const input = form.querySelector('input[name="video_url"]');
  const hidden = form.querySelector('input[name="image_url"]');
  const container = form.querySelector('[data-thumb-picker]');
  if (!input || !hidden || !container) return;

  const extractYouTubeId = (url) => {
    if (!url) return '';
    const trimmed = url.trim();
    const match = trimmed.match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
    return match ? match[1] : '';
  };

  const buildOptions = (videoId) => {
    if (!videoId) return [];
    return [
      { label: 'maxres', url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` },
      { label: 'hq', url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` },
      { label: 'mq', url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` },
      { label: 'sd', url: `https://img.youtube.com/vi/${videoId}/sddefault.jpg` }
    ];
  };

  const render = () => {
    const videoId = extractYouTubeId(input.value);
    const options = buildOptions(videoId);
    container.innerHTML = '';
    container.dataset.video = videoId;

    if (!options.length) {
      hidden.value = hidden.value || '';
      return;
    }

    let selected = hidden.value;
    if (!selected) {
      selected = options[1].url;
      hidden.value = selected;
    }

    options.forEach(opt => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `thumb-option${selected === opt.url ? ' active' : ''}`;
      button.dataset.url = opt.url;
      button.innerHTML = `<img src="${opt.url}" alt="thumbnail ${opt.label}" loading="lazy" />`;
      button.addEventListener('click', () => {
        hidden.value = opt.url;
        container.querySelectorAll('.thumb-option').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
      });
      container.appendChild(button);
    });
  };

  input.addEventListener('input', render);
  render();
};

document.querySelectorAll('form[data-admin-form]').forEach(setupThumbPicker);

const projectGrid = document.getElementById('projectGrid');
if (projectGrid) {
  const categoryFilters = document.querySelectorAll('[data-filter-category]');
  const frontFilters = document.querySelectorAll('[data-filter-front]');
  let activeCategory = 'all';
  let activeFront = 'all';

  const applyFilters = () => {
    projectGrid.querySelectorAll('.project').forEach(card => {
      const matchesCategory = activeCategory === 'all' || card.dataset.category === activeCategory;
      const matchesFront = activeFront === 'all' || card.dataset.front === activeFront;
      card.style.display = matchesCategory && matchesFront ? 'block' : 'none';
    });
  };

  categoryFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.filterCategory;
      applyFilters();
    });
  });

  frontFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      frontFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFront = btn.dataset.filterFront;
      applyFilters();
    });
  });
}

const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const postGrid = document.getElementById('postGrid');
if (postGrid && searchInput && categoryFilter) {
  const filterPosts = () => {
    const term = searchInput.value.toLowerCase();
    const category = categoryFilter.value;
    postGrid.querySelectorAll('.link-card').forEach(card => {
      const matchesTerm = card.querySelector('h3').textContent.toLowerCase().includes(term);
      const matchesCategory = !category || card.dataset.category === category;
      card.style.display = matchesTerm && matchesCategory ? 'block' : 'none';
    });
  };
  searchInput.addEventListener('input', filterPosts);
  categoryFilter.addEventListener('change', filterPosts);
}

const carousels = document.querySelectorAll('.carousel');
carousels.forEach(carousel => {
  const track = carousel.querySelector('.carousel-track');
  const prev = carousel.querySelector('.carousel-btn.prev');
  const next = carousel.querySelector('.carousel-btn.next');
  if (!track || !prev || !next) return;

  if (!track.dataset.loopReady) {
    const originals = Array.from(track.children);
    let guard = 0;
    while (track.scrollWidth <= track.clientWidth * 2 && originals.length && guard < 6) {
      originals.forEach(node => track.appendChild(node.cloneNode(true)));
      guard += 1;
    }
    track.dataset.loopReady = "true";
  }

  const scrollByCard = () => {
    const card = track.querySelector('.card');
    return card ? card.offsetWidth + 20 : 300;
  };

  prev.addEventListener('click', () => {
    track.scrollBy({ left: -scrollByCard(), behavior: 'smooth' });
  });

  next.addEventListener('click', () => {
    track.scrollBy({ left: scrollByCard(), behavior: 'smooth' });
  });

  let rafId = null;
  const speed = 3.2;
  const step = () => {
    track.scrollBy({ left: speed, behavior: 'auto' });
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    if (atEnd) track.scrollLeft = 0;
    rafId = requestAnimationFrame(step);
  };
  const startAuto = () => {
    if (rafId) return;
    if (track.scrollWidth <= track.clientWidth + 5) return;
    rafId = requestAnimationFrame(step);
  };
  const stopAuto = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  };

  startAuto();
  carousel.addEventListener('mouseenter', stopAuto);
  carousel.addEventListener('mouseleave', startAuto);
});

const slugify = (text) => {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
};

document.querySelectorAll('[data-admin-form]').forEach(form => {
  const titleInput = form.querySelector('input[name="title"]');
  const slugInput = form.querySelector('input[name="slug"]');
  const excerptInput = form.querySelector('input[name="excerpt"]');
  const contentInput = form.querySelector('textarea[name="content"]');
  const editor = form.querySelector('[data-editor]');
  const toolbar = form.querySelector('.editor-toolbar');
  const videoInput = form.querySelector('input[name="video_url"]');
  const orientationInput = form.querySelector('select[name="video_orientation"]');
  const readTimeInput = form.querySelector('input[name="read_time"]');
  const categoryInput = form.querySelector('input[name="category"]');
  const preview = document.getElementById('postPreview');

  let slugEdited = false;
  if (slugInput) {
    slugInput.addEventListener('input', () => {
      slugEdited = slugInput.value.trim().length > 0;
    });
  }
  if (titleInput && slugInput) {
    titleInput.addEventListener('input', () => {
      if (!slugEdited) slugInput.value = slugify(titleInput.value);
    });
  }

  const normalizeVideoUrl = (url) => {
    if (!url) return '';
    const trimmed = url.trim();
    const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const ytEmbed = trimmed.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
    if (ytEmbed) return trimmed;
    const vimeoMatch = trimmed.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return trimmed;
  };

  const updatePreview = () => {
    if (!preview) return;
    const setText = (key, value) => {
      const el = preview.querySelector(`[data-preview="${key}"]`);
      if (!el) return;
      el.textContent = value || el.textContent;
    };
    setText('title', titleInput?.value || 'Título do artigo');
    setText('excerpt', excerptInput?.value || 'Resumo do artigo aparece aqui para você conferir a leitura.');
    if (readTimeInput) {
      setText('read_time', readTimeInput.value || '5 min');
    }
    setText('category', categoryInput?.value || 'Categoria');
    const body = preview.querySelector('[data-preview="content"]');
    if (body) {
      const html = editor ? editor.innerHTML : (contentInput?.value || '');
      body.innerHTML = html || '';
    }
    const media = preview.querySelector('[data-preview="video"]');
    if (media) {
      const url = normalizeVideoUrl(videoInput?.value || '');
      const isVertical = orientationInput?.value === 'vertical';
      media.innerHTML = url
        ? `<div class="embed ${isVertical ? 'embed-vertical' : ''}"><iframe src="${url}" title="Vídeo" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
        : '';
    }
  };

  [titleInput, excerptInput, contentInput, readTimeInput, categoryInput, videoInput, orientationInput].forEach(input => {
    if (input) input.addEventListener('input', updatePreview);
  });

  if (editor && contentInput) {
    const syncEditor = () => {
      contentInput.value = editor.innerHTML;
      updatePreview();
    };
    editor.addEventListener('input', syncEditor);
    syncEditor();
  }

  if (toolbar && editor) {
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      const value = btn.dataset.value || null;
      if (cmd === 'createLink') {
        const url = prompt('URL do link');
        if (url) document.execCommand(cmd, false, url);
      } else {
        document.execCommand(cmd, false, value);
      }
      editor.focus();
      updatePreview();
    });
  }

  if (videoInput) {
    form.addEventListener('submit', () => {
      videoInput.value = normalizeVideoUrl(videoInput.value || '');
      updatePreview();
    });
  }

  updatePreview();
});

document.querySelectorAll('[data-confirm]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (!confirm(btn.dataset.confirm)) e.preventDefault();
  });
});

const syncTagPicker = (picker) => {
  const form = picker.closest('form');
  const input = form ? form.querySelector('input[name="tags"]') : null;
  const chips = picker.querySelectorAll('.chip');
  const selected = Array.from(chips)
    .filter(c => c.classList.contains('active'))
    .map(c => c.dataset.tag);
  if (input) input.value = selected.join(', ');
};

document.querySelectorAll('[data-tag-picker]').forEach(syncTagPicker);

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const picker = chip.closest('[data-tag-picker]');
  if (!picker) return;
  e.preventDefault();
  const chips = picker.querySelectorAll('.chip');
  const allowMultiple = picker.dataset.multi === 'false' ? false : true;
  if (!allowMultiple) {
    chips.forEach(c => {
      c.classList.remove('active');
      c.setAttribute('aria-pressed', 'false');
    });
  }
  const isActive = chip.classList.toggle('active');
  chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  syncTagPicker(picker);
});

const commentSearch = document.getElementById('commentSearch');
if (commentSearch) {
  const cards = document.querySelectorAll('[data-comment]');
  const filterComments = () => {
    const term = commentSearch.value.toLowerCase();
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(term) ? 'block' : 'none';
    });
  };
  commentSearch.addEventListener('input', filterComments);
}
