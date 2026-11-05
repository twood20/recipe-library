/* ==========================================================================
   Personal Recipe Library — Client-Side Application (app.js)
   Static, zero-backend recipe browser, servings scaler, and JSON importer
   ========================================================================== */

(() => {
  'use strict';

  const STORAGE_KEY = 'recipe_library_device_state_v1';

  // Friendly Unicode fractions for culinary quantities
  const FRACTIONS = [
    { val: 1 / 8, sym: '⅛' },
    { val: 1 / 6, sym: '⅙' },
    { val: 1 / 4, sym: '¼' },
    { val: 1 / 3, sym: '⅓' },
    { val: 3 / 8, sym: '⅜' },
    { val: 1 / 2, sym: '½' },
    { val: 5 / 8, sym: '⅝' },
    { val: 2 / 3, sym: '⅔' },
    { val: 3 / 4, sym: '¾' },
    { val: 5 / 6, sym: '⅚' },
    { val: 7 / 8, sym: '⅞' },
  ];

  const METRIC_INT_UNITS = new Set(['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters']);
  const METRIC_DEC_UNITS = new Set(['kg', 'kilogram', 'kilograms', 'l', 'liter', 'liters']);

  const UNIT_PAIRS = [
    ['cup', 'cups'],
    ['tablespoon', 'tablespoons'],
    ['teaspoon', 'teaspoons'],
    ['clove', 'cloves'],
    ['pound', 'pounds'],
    ['ounce', 'ounces'],
    ['quart', 'quarts'],
    ['slice', 'slices'],
    ['packet', 'packets'],
    ['pack', 'packs'],
    ['stalk', 'stalks'],
    ['nest', 'nests'],
    ['can', 'cans'],
    ['box', 'boxes'],
    ['bunch', 'bunches'],
  ];

  // Application state
  const state = {
    bundledRecipes: [],
    importedRecipes: [],
    recipes: [],
    searchQuery: '',
    activeRecipe: null,
    chosenServings: 2,
    savedScrollY: 0,
    openedFromGrid: false,
    wakeLock: null,
    toastTimer: null,
  };

  // DOM Elements
  const dom = {
    libraryView: document.getElementById('library-view'),
    recipeView: document.getElementById('recipe-view'),
    recipeCountLabel: document.getElementById('recipe-count-label'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    emptyState: document.getElementById('empty-state'),
    emptyStateBody: document.getElementById('empty-state-body'),
    emptyClearBtn: document.getElementById('empty-clear-btn'),
    recipeGrid: document.getElementById('recipe-grid'),

    updateRecipesBtn: document.getElementById('update-recipes-btn'),
    exportLibraryBtn: document.getElementById('export-library-btn'),
    resetImportsBtn: document.getElementById('reset-imports-btn'),
    importFileInput: document.getElementById('import-file-input'),
    importStatusLine: document.getElementById('import-status-line'),

    backBtn: document.getElementById('back-btn'),
    topbarRecipeTitle: document.getElementById('topbar-recipe-title'),
    wakeLockBtn: document.getElementById('wake-lock-btn'),
    shareRecipeBtn: document.getElementById('share-recipe-btn'),

    recipeHeroMedia: document.getElementById('recipe-hero-media'),
    recipeBadges: document.getElementById('recipe-badges'),
    recipeTitle: document.getElementById('recipe-title'),
    recipeSubtitle: document.getElementById('recipe-subtitle'),

    scalerBar: document.getElementById('scaler-bar'),
    servingsMinus: document.getElementById('servings-minus'),
    servingsPlus: document.getElementById('servings-plus'),
    servingsValue: document.getElementById('servings-value'),
    scalerResetBtn: document.getElementById('scaler-reset-btn'),
    scaledIndicator: document.getElementById('scaled-indicator'),

    recipeColumns: document.querySelector('.recipe-columns'),
    ingredientsSection: document.getElementById('ingredients-section'),
    ingredientsContainer: document.getElementById('ingredients-container'),
    stepsSection: document.getElementById('steps-section'),
    stepsList: document.getElementById('steps-list'),
    notesSection: document.getElementById('notes-section'),
    notesBody: document.getElementById('notes-body'),
    sourceSection: document.getElementById('source-section'),
    sourceLink: document.getElementById('source-link'),

    toast: document.getElementById('toast'),
  };

  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  /* ========================================================================
     Normalization & Data Model Helpers
     ======================================================================== */

  function normalizeTitleKey(title) {
    return String(title || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function slugify(text) {
    const base = String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || 'recipe';
  }

  /**
   * Normalizes repeating-decimal approximations like 0.333 -> 1/3 and 0.667 -> 2/3
   * before scaling so 0.333 * 3 becomes exact 1 rather than 0.999.
   */
  function normalizeBaseAmount(num) {
    const whole = Math.floor(num);
    const rem = num - whole;
    if (Math.abs(rem - 1 / 3) < 0.002) return whole + 1 / 3;
    if (Math.abs(rem - 2 / 3) < 0.002) return whole + 2 / 3;
    return num;
  }

  /**
   * Formats a positive numeric quantity using friendly fractions where sensible,
   * or clean metric / short decimal numbers.
   */
  function formatQuantity(value, unit) {
    const cleanUnit = String(unit || '').trim().toLowerCase();

    if (METRIC_INT_UNITS.has(cleanUnit)) {
      if (value >= 10) return String(Math.round(value));
      return String(Number(value.toFixed(1)));
    }

    if (METRIC_DEC_UNITS.has(cleanUnit)) {
      return String(Number(value.toFixed(2)));
    }

    const nearestInt = Math.round(value);
    if (nearestInt > 0 && Math.abs(value - nearestInt) < 0.012) {
      return String(nearestInt);
    }

    if (value < 0.1) {
      if (Math.abs(value - 0.0625) < 0.015) return '1/16';
      return String(Math.max(0.01, Number(value.toFixed(2))));
    }

    const whole = Math.floor(value + 0.009);
    const rem = value - whole;

    if (rem < 0.009) {
      return String(whole);
    }

    let bestFrac = null;
    let bestDiff = Infinity;
    for (const frac of FRACTIONS) {
      const diff = Math.abs(rem - frac.val);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestFrac = frac;
      }
    }

    if (bestFrac && bestDiff < 0.009) {
      return whole > 0 ? `${whole}${bestFrac.sym}` : bestFrac.sym;
    }

    return String(Number(value.toFixed(value >= 10 ? 1 : 2)));
  }

  /**
   * Adjusts unit singular/plural form when servings have been scaled.
   */
  function formatUnit(unit, scaledValue, isScaled) {
    if (!unit) return '';
    let u = String(unit).trim();
    if (!u) return '';

    if (!isScaled) return u;

    // Strip base-batch range hints like "(20-25)" or "tsp (1-2)" when scaled
    if (/^\(\d+\s*-\s*\d+\)$/.test(u)) {
      return '';
    }
    u = u.replace(/\s*\(\d+\s*-\s*\d+\)$/, '');

    const isSingular = scaledValue <= 1.009;
    const lower = u.toLowerCase();

    for (const [sing, plur] of UNIT_PAIRS) {
      if (lower === sing || lower === plur) {
        return isSingular ? sing : plur;
      }
      if (lower.startsWith(sing + ' (')) {
        const rest = u.slice(sing.length);
        return (isSingular ? sing : plur) + rest;
      }
      if (lower.startsWith(plur + ' (')) {
        const rest = u.slice(plur.length);
        return (isSingular ? sing : plur) + rest;
      }
    }

    return u;
  }

  /**
   * Parses and validates a single recipe object into the canonical brief data model.
   * Supports both the canonical brief schema (`ingredientGroups`, `baseServings`, `partial`)
   * and the legacy flat schema (`ingredients`, `base_servings`, `source_status`).
   * Returns `null` if the entry is not a valid recipe object.
   */
  function parseRecipeEntry(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    if (typeof raw.title !== 'string' || !raw.title.trim()) {
      return null;
    }

    if (raw.ingredientGroups != null && !Array.isArray(raw.ingredientGroups)) {
      return null;
    }
    if (raw.ingredients != null && !Array.isArray(raw.ingredients)) {
      return null;
    }
    if (raw.steps != null && !Array.isArray(raw.steps)) {
      return null;
    }

    const title = raw.title.trim();
    const hasExplicitId = typeof raw.id === 'string' && Boolean(raw.id.trim());
    const id = hasExplicitId ? raw.id.trim() : slugify(title);
    const subtitle = String(raw.subtitle ?? raw.summary ?? '').trim();

    const hasExplicitPhoto = ('photo' in raw) || ('image' in raw) || ('photo_url' in raw) || ('image_url' in raw);
    const rawPhoto = raw.photo ?? raw.image ?? raw.photo_url ?? raw.image_url ?? null;
    const photo = (typeof rawPhoto === 'string' && rawPhoto.trim()) ? rawPhoto.trim() : null;

    const rawServings = Number(raw.baseServings ?? raw.base_servings);
    const baseServings = (Number.isFinite(rawServings) && rawServings > 0) ? rawServings : 2;

    const partial = typeof raw.partial === 'boolean'
      ? raw.partial
      : (raw.source_status === 'partial');

    let ingredientGroups = [];

    if (Array.isArray(raw.ingredientGroups)) {
      ingredientGroups = raw.ingredientGroups
        .filter((g) => g && typeof g === 'object' && Array.isArray(g.items))
        .map((g) => ({
          heading: (typeof g.heading === 'string' && g.heading.trim()) ? g.heading.trim() : null,
          items: g.items
            .filter((it) => it && typeof it === 'object' && typeof it.name === 'string' && it.name.trim())
            .map((it) => {
              const hasNumericAmount = typeof it.amount === 'number' && Number.isFinite(it.amount) && it.amount > 0;
              return {
                amount: hasNumericAmount ? it.amount : null,
                unit: hasNumericAmount && typeof it.unit === 'string' && it.unit.trim() ? it.unit.trim() : null,
                name: it.name.trim(),
              };
            }),
        }))
        .filter((g) => g.items.length > 0);
    } else if (Array.isArray(raw.ingredients)) {
      // Support flat `ingredients` format seamlessly if imported directly
      const groupMap = new Map();
      for (const ing of raw.ingredients) {
        if (!ing || typeof ing !== 'object') continue;
        const itemName = String(ing.item ?? ing.name ?? '').trim();
        if (!itemName) continue;
        const groupKey = (typeof ing.group === 'string' && ing.group.trim()) ? ing.group.trim() : null;
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, []);
        }
        const qty = (typeof ing.qty === 'number' && Number.isFinite(ing.qty) && ing.qty > 0) ? ing.qty : null;
        const unit = (typeof ing.unit === 'string' && ing.unit.trim()) ? ing.unit.trim() : '';
        const scalable = ing.scalable !== false && qty !== null;

        if (scalable) {
          groupMap.get(groupKey).push({
            amount: qty,
            unit: unit || null,
            name: itemName,
          });
        } else {
          let lineName = itemName;
          if (qty !== null) {
            const qStr = formatQuantity(normalizeBaseAmount(qty), unit);
            lineName = [qStr, unit, itemName].filter(Boolean).join(' ');
          } else if (unit.toLowerCase() === 'dash' || unit.toLowerCase() === 'pinch') {
            lineName = `${itemName} (${unit})`;
          }
          groupMap.get(groupKey).push({
            amount: null,
            unit: null,
            name: lineName,
          });
        }
      }

      const singleUnheaded = groupMap.size === 1;
      for (const [gName, items] of groupMap.entries()) {
        if (items.length > 0) {
          ingredientGroups.push({
            heading: singleUnheaded ? null : gName,
            items,
          });
        }
      }
    }

    const steps = Array.isArray(raw.steps)
      ? raw.steps
          .filter((s) => typeof s === 'string' && s.trim())
          .map((s) => s.trim())
      : [];

    const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';
    const source = String(raw.source ?? raw.source_url ?? '').trim();

    return {
      id,
      title,
      subtitle,
      photo,
      baseServings,
      partial,
      ingredientGroups,
      steps,
      notes,
      source,
      _hasExplicitId: hasExplicitId,
      _hasExplicitPhoto: hasExplicitPhoto,
    };
  }

  /**
   * Ensures every recipe in a merged list has a unique `id` slug for URL routing.
   */
  function ensureUniqueIds(list) {
    const usedIds = new Set();
    return list.map((recipe) => {
      let candidate = recipe.id || slugify(recipe.title);
      let suffix = 2;
      while (usedIds.has(candidate)) {
        candidate = `${recipe.id || slugify(recipe.title)}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(candidate);
      return candidate === recipe.id ? recipe : { ...recipe, id: candidate };
    });
  }

  /**
   * Merges an overlay array of recipes onto a base array by normalized title.
   * Existing titles are replaced in place; new titles are appended.
   */
  function mergeRecipeLists(baseList, overlayList) {
    const result = baseList.map((r) => ({ ...r }));
    const indexByTitle = new Map();

    result.forEach((r, idx) => {
      indexByTitle.set(normalizeTitleKey(r.title), idx);
    });

    for (const incoming of overlayList) {
      const key = normalizeTitleKey(incoming.title);
      if (indexByTitle.has(key)) {
        const idx = indexByTitle.get(key);
        const existing = result[idx];
        result[idx] = {
          ...incoming,
          id: incoming._hasExplicitId ? incoming.id : (existing.id || incoming.id),
          photo: incoming.photo || (!incoming._hasExplicitPhoto ? existing.photo : null),
        };
      } else {
        indexByTitle.set(key, result.length);
        result.push({ ...incoming });
      }
    }

    return ensureUniqueIds(result);
  }

  /* ========================================================================
     Persistence (Bundled recipes.json + Local Storage Device Imports)
     ======================================================================== */

  function loadDeviceStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { imported: [], snapshot: null };
      const parsed = JSON.parse(raw);
      const imported = Array.isArray(parsed?.imported)
        ? parsed.imported.map(parseRecipeEntry).filter(Boolean)
        : [];
      const snapshot = Array.isArray(parsed?.snapshot)
        ? parsed.snapshot.map(parseRecipeEntry).filter(Boolean)
        : null;
      return { imported, snapshot };
    } catch {
      return { imported: [], snapshot: null };
    }
  }

  function saveDeviceStorage(imported, snapshot) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ imported, snapshot })
      );
    } catch {
      showToast('Storage full on this browser — export library to back up.');
    }
  }

  function syncResetButtonVisibility() {
    dom.resetImportsBtn.hidden = state.importedRecipes.length === 0;
  }

  /* ========================================================================
     Placeholder Tile & Media Helpers
     ======================================================================== */

  function createPlaceholderTile() {
    const tile = document.createElement('div');
    tile.className = 'placeholder-tile';
    tile.setAttribute('aria-hidden', 'true');
    tile.innerHTML = `
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 17h22a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9Z"/>
        <path d="M11 26h10M11 12c0-1.5 1-2.5 1-4m4 4c0-1.5 1-2.5 1-4m4 4c0-1.5 1-2.5 1-4"/>
      </svg>
    `;
    return tile;
  }

  function buildMediaElement(photoUrl, title, isCard) {
    if (!photoUrl) {
      return createPlaceholderTile();
    }

    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = title;
    if (isCard) {
      img.className = 'card-photo';
      img.loading = 'lazy';
      img.decoding = 'async';
    } else {
      img.decoding = 'async';
    }

    img.addEventListener('error', () => {
      img.replaceWith(createPlaceholderTile());
    }, { once: true });

    return img;
  }

  /* ========================================================================
     Grid Rendering & Live Search
     ======================================================================== */

  function getFilteredRecipes() {
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return state.recipes;

    const tokens = q.split(/\s+/).filter(Boolean);
    return state.recipes.filter((recipe) => {
      const haystack = `${recipe.title} ${recipe.subtitle}`.toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });
  }

  function renderGrid() {
    const filtered = getFilteredRecipes();
    const total = state.recipes.length;
    const hasQuery = state.searchQuery.trim().length > 0;

    dom.searchClear.hidden = !hasQuery;

    if (hasQuery) {
      dom.recipeCountLabel.textContent = `${filtered.length} of ${total}`;
    } else {
      dom.recipeCountLabel.textContent = `${total} ${total === 1 ? 'recipe' : 'recipes'}`;
    }

    dom.recipeGrid.replaceChildren();

    if (filtered.length === 0) {
      dom.recipeGrid.hidden = true;
      dom.emptyState.hidden = false;
      dom.emptyStateBody.textContent = hasQuery
        ? `Nothing matched “${state.searchQuery.trim()}”.`
        : 'No recipes in the library yet.';
      dom.emptyClearBtn.hidden = !hasQuery;
      return;
    }

    dom.emptyState.hidden = true;
    dom.recipeGrid.hidden = false;

    const frag = document.createDocumentFragment();

    for (const recipe of filtered) {
      const card = document.createElement('a');
      card.className = 'recipe-card';
      card.href = `#recipe/${encodeURIComponent(recipe.id)}`;
      card.setAttribute('role', 'listitem');
      card.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          return;
        }
        e.preventDefault();
        openRecipeFromGrid(recipe);
      });

      const media = document.createElement('div');
      media.className = 'card-media';
      media.appendChild(buildMediaElement(recipe.photo, recipe.title, true));

      if (recipe.partial) {
        const badge = document.createElement('span');
        badge.className = 'card-badge-partial';
        badge.textContent = 'Partial';
        media.appendChild(badge);
      }

      const body = document.createElement('div');
      body.className = 'card-body';

      const h2 = document.createElement('h2');
      h2.className = 'card-title';
      h2.textContent = recipe.title;
      body.appendChild(h2);

      if (recipe.subtitle) {
        const sub = document.createElement('p');
        sub.className = 'card-subtitle';
        sub.textContent = recipe.subtitle;
        body.appendChild(sub);
      }

      card.appendChild(media);
      card.appendChild(body);
      frag.appendChild(card);
    }

    dom.recipeGrid.appendChild(frag);
  }

  /* ========================================================================
     Full Recipe View & Servings Scaler
     ======================================================================== */

  function renderIngredients() {
    const recipe = state.activeRecipe;
    if (!recipe) return;

    const base = recipe.baseServings || 2;
    const chosen = state.chosenServings;
    const isScaled = chosen !== base;
    const ratio = chosen / base;

    dom.servingsValue.textContent = String(chosen);
    dom.servingsMinus.disabled = chosen <= 1;
    dom.scalerResetBtn.hidden = !isScaled;
    dom.scalerResetBtn.textContent = `Reset (${base})`;

    if (isScaled) {
      const multStr = Number((ratio).toFixed(2));
      dom.scaledIndicator.textContent = `${multStr}× recipe`;
      dom.scaledIndicator.hidden = false;
    } else {
      dom.scaledIndicator.hidden = true;
    }

    const groups = recipe.ingredientGroups || [];
    const totalItems = groups.reduce((acc, g) => acc + (g.items ? g.items.length : 0), 0);

    if (totalItems === 0) {
      dom.ingredientsSection.hidden = true;
      dom.scalerBar.hidden = true;
      return;
    }

    dom.ingredientsSection.hidden = false;
    dom.scalerBar.hidden = false;

    // Preserve checked state across serving adjustments within the currently open recipe
    const previouslyChecked = new Set();
    dom.ingredientsContainer.querySelectorAll('.ingredient-item.is-checked').forEach((el) => {
      if (el.dataset.key) previouslyChecked.add(el.dataset.key);
    });

    dom.ingredientsContainer.replaceChildren();
    const frag = document.createDocumentFragment();

    groups.forEach((group, gIdx) => {
      if (!group.items || group.items.length === 0) return;

      const groupWrap = document.createElement('div');
      groupWrap.className = 'ingredient-group';

      if (group.heading) {
        const h3 = document.createElement('h3');
        h3.className = 'ingredient-group-heading';
        h3.textContent = group.heading;
        groupWrap.appendChild(h3);
      }

      const ul = document.createElement('ul');
      ul.className = 'ingredient-list';

      group.items.forEach((item, iIdx) => {
        const key = `${gIdx}-${iIdx}`;
        const li = document.createElement('li');
        li.className = 'ingredient-item';
        li.dataset.key = key;
        if (previouslyChecked.has(key)) {
          li.classList.add('is-checked');
        }

        const check = document.createElement('span');
        check.className = 'ing-check';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = `
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m2.5 6.2 2.3 2.3 4.7-5"/>
          </svg>
        `;

        const textSpan = document.createElement('span');
        textSpan.className = 'ing-text';

        if (typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0) {
          const scaledNumeric = normalizeBaseAmount(item.amount) * ratio;
          const amountText = formatQuantity(scaledNumeric, item.unit);
          const unitText = formatUnit(item.unit, scaledNumeric, isScaled);

          const amountSpan = document.createElement('span');
          amountSpan.className = isScaled ? 'ing-amount is-scaled' : 'ing-amount';
          amountSpan.textContent = unitText ? `${amountText} ${unitText}` : amountText;

          textSpan.appendChild(amountSpan);
          textSpan.appendChild(document.createTextNode(` ${item.name}`));
        } else {
          textSpan.textContent = item.name;
        }

        li.appendChild(check);
        li.appendChild(textSpan);

        li.addEventListener('click', () => {
          li.classList.toggle('is-checked');
        });

        ul.appendChild(li);
      });

      groupWrap.appendChild(ul);
      frag.appendChild(groupWrap);
    });

    dom.ingredientsContainer.appendChild(frag);
  }

  /**
   * Renders plain text while safely turning embedded http(s) URLs into clickable links.
   */
  function renderTextWithLinks(container, text) {
    container.replaceChildren();
    const parts = text.split(/(https?:\/\/[^\s)]+)/g);
    for (const part of parts) {
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement('a');
        a.href = part;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = part;
        container.appendChild(a);
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    }
  }

  function renderRecipeView(recipe) {
    state.activeRecipe = recipe;
    state.chosenServings = recipe.baseServings || 2;

    document.title = `${recipe.title} — Recipe Library`;
    dom.topbarRecipeTitle.textContent = recipe.title;
    dom.topbarRecipeTitle.classList.remove('is-visible');

    // Hero photo or plain placeholder tile
    dom.recipeHeroMedia.replaceChildren(
      buildMediaElement(recipe.photo, recipe.title, false)
    );

    // Partial badge
    dom.recipeBadges.hidden = !recipe.partial;

    // Title & subtitle
    dom.recipeTitle.textContent = recipe.title;
    if (recipe.subtitle) {
      dom.recipeSubtitle.textContent = recipe.subtitle;
      dom.recipeSubtitle.hidden = false;
    } else {
      dom.recipeSubtitle.textContent = '';
      dom.recipeSubtitle.hidden = true;
    }

    // Ingredients + Scaler
    renderIngredients();

    // Numbered Steps
    const steps = recipe.steps || [];
    if (steps.length > 0) {
      dom.stepsSection.hidden = false;
      dom.stepsList.replaceChildren();
      steps.forEach((stepStr, idx) => {
        const li = document.createElement('li');
        li.className = 'step-item';

        const num = document.createElement('span');
        num.className = 'step-num';
        num.textContent = String(idx + 1);

        const p = document.createElement('p');
        p.className = 'step-text';
        p.textContent = stepStr;

        li.appendChild(num);
        li.appendChild(p);
        li.addEventListener('click', () => {
          li.classList.toggle('is-done');
        });

        dom.stepsList.appendChild(li);
      });
    } else {
      dom.stepsSection.hidden = true;
      dom.stepsList.replaceChildren();
    }

    // Notes
    if (recipe.notes) {
      dom.notesSection.hidden = false;
      renderTextWithLinks(dom.notesBody, recipe.notes);
    } else {
      dom.notesSection.hidden = true;
      dom.notesBody.replaceChildren();
    }

    // Original source link
    if (recipe.source && /^https?:\/\//i.test(recipe.source)) {
      dom.sourceSection.hidden = false;
      dom.sourceLink.href = recipe.source;
    } else {
      dom.sourceSection.hidden = true;
      dom.sourceLink.removeAttribute('href');
    }

    const hasRightColumn = !dom.stepsSection.hidden || !dom.notesSection.hidden || !dom.sourceSection.hidden;
    if (dom.recipeColumns) {
      dom.recipeColumns.classList.toggle('is-single-column', dom.ingredientsSection.hidden || !hasRightColumn);
    }
  }

  /* ========================================================================
     Navigation & Scroll Position Preservation
     ======================================================================== */

  function openRecipeFromGrid(recipe) {
    state.savedScrollY = window.scrollY;
    state.openedFromGrid = true;

    renderRecipeView(recipe);
    dom.libraryView.hidden = true;
    dom.recipeView.hidden = false;
    window.scrollTo(0, 0);

    history.pushState(
      { recipeId: recipe.id },
      '',
      `#recipe/${encodeURIComponent(recipe.id)}`
    );
  }

  function showLibraryView(restoreScroll) {
    state.activeRecipe = null;
    document.title = 'Recipe Library';

    dom.recipeView.hidden = true;
    dom.libraryView.hidden = false;

    releaseWakeLock();

    if (restoreScroll) {
      window.scrollTo({ top: state.savedScrollY, left: 0, behavior: 'instant' });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function handleBackClick() {
    if (state.openedFromGrid) {
      history.back();
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showLibraryView(false);
    }
  }

  function syncRouteFromHash(isInitialLoad) {
    const hash = window.location.hash || '';
    if (hash.startsWith('#recipe/')) {
      const id = decodeURIComponent(hash.slice('#recipe/'.length));
      const found = state.recipes.find((r) => r.id === id);
      if (found) {
        if (isInitialLoad) {
          state.openedFromGrid = false;
        }
        renderRecipeView(found);
        dom.libraryView.hidden = true;
        dom.recipeView.hidden = false;
        window.scrollTo(0, 0);
        return;
      }
    }

    showLibraryView(!isInitialLoad);
  }

  /* ========================================================================
     Update Recipes (JSON Merge Import) & Export Library
     ======================================================================== */

  async function handleImportFile(file) {
    if (!file) return;

    let parsedJson;
    try {
      const text = await file.text();
      parsedJson = JSON.parse(text);
    } catch {
      showImportSummary('Could not parse file — please select a valid .json file.');
      return;
    }

    const rawEntries = Array.isArray(parsedJson)
      ? parsedJson
      : (Array.isArray(parsedJson?.recipes) ? parsedJson.recipes : null);

    if (!rawEntries) {
      showImportSummary('Expected a JSON array of recipe objects.');
      return;
    }

    const existingByTitle = new Map(
      state.recipes.map((r) => [normalizeTitleKey(r.title), r])
    );
    const seenInBatch = new Map();

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawEntry of rawEntries) {
      const normalized = parseRecipeEntry(rawEntry);
      if (!normalized) {
        skipped += 1;
        continue;
      }

      const key = normalizeTitleKey(normalized.title);
      const prev = seenInBatch.get(key) || existingByTitle.get(key);
      if (prev) {
        if (!normalized._hasExplicitId && prev.id) {
          normalized.id = prev.id;
        }
        if (!normalized._hasExplicitPhoto && prev.photo) {
          normalized.photo = prev.photo;
        }
      }
      delete normalized._hasExplicitId;
      delete normalized._hasExplicitPhoto;

      if (!seenInBatch.has(key)) {
        if (existingByTitle.has(key)) {
          updated += 1;
        } else {
          added += 1;
        }
      }
      seenInBatch.set(key, normalized);
    }

    const validIncoming = Array.from(seenInBatch.values());

    if (validIncoming.length > 0) {
      state.importedRecipes = mergeRecipeLists(state.importedRecipes, validIncoming);
      state.recipes = mergeRecipeLists(state.bundledRecipes, state.importedRecipes);
      saveDeviceStorage(state.importedRecipes, state.recipes);
      syncResetButtonVisibility();
      renderGrid();
    }

    const summary = skipped > 0
      ? `Added ${added}, updated ${updated} (${skipped} skipped)`
      : `Added ${added}, updated ${updated}`;

    showImportSummary(summary);
    showToast(summary);
  }

  function showImportSummary(message) {
    dom.importStatusLine.textContent = message;
    dom.importStatusLine.hidden = false;
  }

  function exportLibraryAsJson() {
    const cleanPayload = state.recipes.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle || '',
      photo: r.photo || null,
      baseServings: r.baseServings || 2,
      partial: Boolean(r.partial),
      ingredientGroups: r.ingredientGroups || [],
      steps: r.steps || [],
      notes: r.notes || '',
      source: r.source || '',
    }));

    const blob = new Blob(
      [JSON.stringify(cleanPayload, null, 2) + '\n'],
      { type: 'application/json;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recipes.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${cleanPayload.length} recipes`);
  }

  function resetDeviceImports() {
    if (!window.confirm('Clear recipes imported on this device and revert to the hosted recipes.json library?')) {
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    state.importedRecipes = [];
    state.recipes = ensureUniqueIds(state.bundledRecipes);
    dom.importStatusLine.hidden = true;
    syncResetButtonVisibility();
    renderGrid();
    showToast('Reverted to bundled recipes.json');
  }

  /* ========================================================================
     Phone Cooking Conveniences (Screen Wake Lock & Native Share)
     ======================================================================== */

  function initWakeLockSupport() {
    if ('wakeLock' in navigator) {
      dom.wakeLockBtn.hidden = false;
    }
  }

  async function toggleWakeLock() {
    if (!('wakeLock' in navigator)) return;

    if (state.wakeLock) {
      await releaseWakeLock();
      showToast('Screen auto-lock restored');
      return;
    }

    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      dom.wakeLockBtn.setAttribute('aria-pressed', 'true');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
        dom.wakeLockBtn.setAttribute('aria-pressed', 'false');
      });
      showToast('Screen will stay awake while cooking');
    } catch {
      showToast('Couldn’t keep screen awake on this browser');
    }
  }

  async function releaseWakeLock() {
    if (state.wakeLock) {
      try {
        await state.wakeLock.release();
      } catch {
        // Ignore already released lock
      }
      state.wakeLock = null;
    }
    dom.wakeLockBtn.setAttribute('aria-pressed', 'false');
  }

  async function shareCurrentRecipe() {
    if (!state.activeRecipe) return;
    const shareUrl = window.location.href;
    const shareData = {
      title: state.activeRecipe.title,
      text: state.activeRecipe.subtitle || state.activeRecipe.title,
      url: shareUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Recipe link copied');
    } catch {
      showToast('Copy the URL from your address bar to share');
    }
  }

  function showToast(message) {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
    }
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      dom.toast.hidden = true;
    }, 2800);
  }

  /* ========================================================================
     Event Listeners & Bootstrapping
     ======================================================================== */

  function bindEvents() {
    dom.searchInput.addEventListener('input', () => {
      state.searchQuery = dom.searchInput.value;
      renderGrid();
    });

    dom.searchClear.addEventListener('click', () => {
      state.searchQuery = '';
      dom.searchInput.value = '';
      renderGrid();
      dom.searchInput.focus();
    });

    dom.emptyClearBtn.addEventListener('click', () => {
      state.searchQuery = '';
      dom.searchInput.value = '';
      renderGrid();
    });

    dom.backBtn.addEventListener('click', handleBackClick);

    dom.servingsMinus.addEventListener('click', () => {
      if (state.chosenServings > 1) {
        state.chosenServings -= 1;
        renderIngredients();
      }
    });

    dom.servingsPlus.addEventListener('click', () => {
      state.chosenServings += 1;
      renderIngredients();
    });

    dom.scalerResetBtn.addEventListener('click', () => {
      if (!state.activeRecipe) return;
      state.chosenServings = state.activeRecipe.baseServings || 2;
      renderIngredients();
    });

    dom.updateRecipesBtn.addEventListener('click', () => {
      dom.importFileInput.value = '';
      dom.importFileInput.click();
    });

    dom.importFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        handleImportFile(file);
      }
    });

    dom.exportLibraryBtn.addEventListener('click', exportLibraryAsJson);
    dom.resetImportsBtn.addEventListener('click', resetDeviceImports);

    dom.wakeLockBtn.addEventListener('click', toggleWakeLock);
    dom.shareRecipeBtn.addEventListener('click', shareCurrentRecipe);

    window.addEventListener('popstate', () => {
      syncRouteFromHash(false);
    });

    window.addEventListener('scroll', () => {
      if (dom.recipeView.hidden) return;
      const titleRect = dom.recipeTitle.getBoundingClientRect();
      dom.topbarRecipeTitle.classList.toggle('is-visible', titleRect.bottom < 56);
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dom.recipeView.hidden) {
        handleBackClick();
      } else if (e.key === '/' && dom.recipeView.hidden && document.activeElement !== dom.searchInput) {
        e.preventDefault();
        dom.searchInput.focus();
      }
    });
  }

  async function init() {
    initWakeLockSupport();
    bindEvents();

    const stored = loadDeviceStorage();
    state.importedRecipes = stored.imported;

    let bundled = [];
    let fetchFailed = false;

    try {
      const res = await fetch('./recipes.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('recipes.json must be an array');
      bundled = json.map(parseRecipeEntry).filter(Boolean);
    } catch {
      fetchFailed = true;
    }

    dom.loadingState.hidden = true;

    if (fetchFailed && !stored.snapshot && state.importedRecipes.length === 0) {
      dom.errorState.hidden = false;
      return;
    }

    state.bundledRecipes = ensureUniqueIds(bundled.length > 0 ? bundled : (stored.snapshot || []));
    state.recipes = mergeRecipeLists(state.bundledRecipes, state.importedRecipes);

    if (state.importedRecipes.length > 0) {
      saveDeviceStorage(state.importedRecipes, state.recipes);
    }

    syncResetButtonVisibility();
    renderGrid();
    syncRouteFromHash(true);
  }

  init();
})();
