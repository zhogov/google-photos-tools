// ==UserScript==
// @name         Google Photos Tools (Delete & Preload)
// @namespace    zhogov.google_photos_tools
// @version      1.0
// @description  "Press keyboard key to delete" and "different pre-caching strategies"
// @author       Aleksei Zhogov
// @match        https://photos.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- MUTABLE CONFIGURATION (Synced with UI) ---
    let cfg = {
        neighbors: 6,
        parallel: 4,
        warmerEnabled: false,
        warmerSteps: 120,
        warmerDelay: 120,
        autoCount: 200,
        autoDelay: 500,
        loggingEnabled: true,
        // Configurable tracking elements
        selectors: {
            deleteBtn: 'button[aria-label*="Delete"], button[aria-label*="trash"]',
            confirmTrashBtn: 'button',
            confirmTrashText: 'Move to trash',
            nextPhotoBtn: 'div[aria-label="View next photo"], div[jsname="OCpkoe"]',
            photoWrapper: 'div,section,ul',
            imageTag: 'img'
        }
    };

    let inflight = 0;
    const queue = [];
    const warmed = new Set();

// --- STYLING (CSP-safe native method) ---
    const style = document.createElement('style');

    // CSP: Using textContent avoids the HTML string parser (innerHTML) entirely
    style.textContent = `
        #gp-helper-ui {
            position: fixed; bottom: 20px; right: 20px;
            background: #202124; color: white; padding: 12px;
            border-radius: 8px; z-index: 999999;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-family: Roboto, Arial, sans-serif; font-size: 12px;
            display: flex; flex-direction: column; gap: 6px;
            border: 1px solid #5f6368; width: 260px;
            max-height: 85vh; overflow-y: auto;
        }
        .gp-row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
        .gp-section-title { font-weight: bold; color: #4285f4; margin-top: 5px; border-bottom: 1px solid #3c4043; padding-bottom: 2px; display: flex; align-items: center; gap: 4px; }
        .gp-info { cursor: help; color: #8ab4f8; font-weight: normal; font-size: 13px; margin-left: 2px; }
        .gp-btn {
            background: #4285f4; color: white; border: none;
            padding: 5px 12px; border-radius: 4px; cursor: pointer;
            font-weight: bold; flex-grow: 1;
        }
        .gp-btn:hover { background: #357abd; }
        .gp-btn.stop { background: #ea4335; }
        .gp-btn.secondary { background: #5f6368; flex-grow: 0; min-width: 30px; }
        .gp-input {
            width: 50px; background: #3c4043; color: white;
            border: 1px solid #5f6368; border-radius: 4px; padding: 2px 4px; font-size: 11px;
        }
        .gp-input-long { width: 150px; }
        #gp-docs {
            margin-top: 5px; padding-top: 5px; border-top: 1px solid #5f6368;
            font-size: 11px; color: #bdc1c6; line-height: 1.4;
        }
        .hidden { display: none !important; }
        .gp-toast {
            position: fixed; left: 50%; top: 70px; transform: translateX(-50%);
            background: rgba(0,0,0,.85); color: #fff; padding: 8px 12px;
            border-radius: 10px; font-size: 13px; z-index: 999999; pointer-events: none;
        }
    `;
    document.head.appendChild(style);

    // --- UTILITIES ---
    const log = (action, details = "") => {
        if (!cfg.loggingEnabled) return;
        console.log(`%c[GP Tools] %c${action}`, 'color: #4285f4; font-weight: bold;', 'color: #fff;', details);
    };

    const toast = (msg) => {
        const el = document.createElement('div');
        el.className = 'gp-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1600);
    };

    const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    };

    function escapeHTML(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function largestFromSrcset(imgEl) {
        const set = imgEl?.getAttribute('srcset');
        if (!set) return imgEl?.currentSrc || imgEl?.src || null;
        let bestUrl = null, bestW = -1;
        for (const part of set.split(',')) {
            const [url, size] = part.trim().split(/\s+/);
            const w = size && size.endsWith('w') ? parseInt(size) : 0;
            if (w > bestW) { bestW = w; bestUrl = url; }
        }
        return bestUrl || imgEl?.currentSrc || imgEl?.src || null;
    }

    function warm(url) {
        if (!url || warmed.has(url)) return;
        warmed.add(url);
        queue.push(url);
        log("Queued image for warmup", url.substring(0, 50) + '...');
        pump();
    }

    function pump() {
        while (inflight < cfg.parallel && queue.length) {
            const url = queue.shift();
            inflight++;
            const img = new Image();
            img.decoding = 'async';
            img.loading = 'eager';
            img.onload = img.onerror = () => { inflight--; pump(); };
            img.src = url;
        }
    }

    // --- CORE LOGIC ---
    function preloadViewerAndNeighbors() {
        log("Running preloader routine");
        const imgs = Array.from(document.querySelectorAll(cfg.selectors.imageTag));
        let main = null, bestArea = 0;
        for (const im of imgs) {
            const rect = im.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > bestArea && rect.width > 400 && isVisible(im)) { main = im; bestArea = area; }
        }

        if (main) warm(largestFromSrcset(main));

        const thumbs = (function() {
            const candidates = Array.from(document.querySelectorAll(cfg.selectors.photoWrapper)).filter(isVisible);
            let best = null, bestCount = 0;
            for (const c of candidates) {
                const innerImgs = c.querySelectorAll(cfg.selectors.imageTag);
                if (innerImgs.length > bestCount && innerImgs.length >= 5) { best = c; bestCount = innerImgs.length; }
            }
            return best ? Array.from(best.querySelectorAll(cfg.selectors.imageTag)) : [];
        })();

        if (thumbs.length) {
            const mainSrc = main ? (main.currentSrc || largestFromSrcset(main)) : null;
            let idx = thumbs.findIndex(t => mainSrc && largestFromSrcset(t)?.split('=')[0] === mainSrc.split('=')[0]);
            if (idx === -1) idx = Math.floor(thumbs.length / 2);
            log(`Found ${thumbs.length} thumbnails. Preloading ${cfg.neighbors} neighbors around index ${idx}`);
            for (let d = 1; d <= cfg.neighbors; d++) {
                if (thumbs[idx - d]) warm(largestFromSrcset(thumbs[idx - d]));
                if (thumbs[idx + d]) warm(largestFromSrcset(thumbs[idx + d]));
            }
        }
    }

    async function gridWarmer() {
        if (!cfg.warmerEnabled || /\/photo\//.test(location.pathname)) return;
        const sc = document.scrollingElement || document.documentElement;
        const startY = sc.scrollTop;
        const step = Math.max(200, window.innerHeight * 0.8);

        log("Starting Grid Warm-up");
        toast("Starting Grid Warm-up...");
        for (let i = 0; i < cfg.warmerSteps && cfg.warmerEnabled; i++) {
            sc.scrollTop += step;
            await new Promise(r => setTimeout(r, cfg.warmerDelay));
            document.querySelectorAll(cfg.selectors.imageTag).forEach(img => {
                const r = img.getBoundingClientRect();
                if (r.top < innerHeight * 1.6 && r.bottom > -innerHeight * 0.6) warm(largestFromSrcset(img));
            });
        }
        sc.scrollTop = startY;
        log("Grid Warm-up complete");
        toast("Warm-up complete");
    }

    function triggerDelete() {
        log("Delete triggered via hotkey");
        const btn = document.querySelector(cfg.selectors.deleteBtn);
        if (!btn) {
            log("Delete button not found using selector:", cfg.selectors.deleteBtn);
            return;
        }
        btn.click();
        log("Clicked initial delete button");

        let att = 0;
        const itv = setInterval(() => {
            const conf = Array.from(document.querySelectorAll(cfg.selectors.confirmTrashBtn)).find(b => b.textContent.includes(cfg.selectors.confirmTrashText));
            if (conf) {
                conf.click();
                log("Confirmed move to trash");
                clearInterval(itv);
            }
            else if (++att > 40) {
                log("Confirmation dialog not found. Timed out.");
                clearInterval(itv);
            }
        }, 50);
    }

// --- UI CONSTRUCTION (CSP: Zero-string structural DOM manipulation) ---
    const container = document.createElement('div');
    container.id = 'gp-helper-ui';

    // Top action row
    const rowTop = document.createElement('div');
    rowTop.className = 'gp-row';

    const btnScroll = document.createElement('button');
    btnScroll.id = 'btn-scroll';
    btnScroll.className = 'gp-btn';
    btnScroll.textContent = 'Auto-Scroll';

    const btnToggle = document.createElement('button');
    btnToggle.id = 'btn-toggle';
    btnToggle.className = 'gp-btn secondary';
    btnToggle.textContent = '≫';

    rowTop.appendChild(btnScroll);
    rowTop.appendChild(btnToggle);
    container.appendChild(rowTop);

    // Expanded Section panel
    const expanded = document.createElement('div');
    expanded.id = 'gp-expanded';
    expanded.className = 'hidden';

    // Helper to generate section headers safely
    const createSectionTitle = (titleText, tooltipText) => {
        const div = document.createElement('div');
        div.className = 'gp-section-title';
        div.textContent = titleText + ' ';

        const span = document.createElement('span');
        span.className = 'gp-info';
        span.textContent = 'ⓘ';
        span.title = tooltipText;

        div.appendChild(span);
        return div;
    };

    // Helper to generate rows with inputs safely
    const createInputRow = (labelText, inputId, inputType, initialValue, isChecked = false, longInput = false) => {
        const row = document.createElement('div');
        row.className = 'gp-row';

        const label = document.createElement('span');
        label.textContent = labelText;
        row.appendChild(label);

        const input = document.createElement('input');
        input.type = inputType;
        input.id = inputId;
        input.className = longInput ? 'gp-input gp-input-long' : 'gp-input';

        if (inputType === 'checkbox') {
            input.checked = isChecked;
        } else {
            input.value = initialValue;
        }

        row.appendChild(input);
        return row;
    };

    // Append Preloader Configs
    expanded.appendChild(createSectionTitle('Preloader', 'Pre-fetches high-resolution images of adjacent photos so they load instantly when navigating left/right.'));
    expanded.appendChild(createInputRow('Neighbors:', 'cfg-neighbors', 'number', cfg.neighbors));
    expanded.appendChild(createInputRow('Parallel:', 'cfg-parallel', 'number', cfg.parallel));

    // Append Grid Warmer Configs
    expanded.appendChild(createSectionTitle('Grid Warmer', 'Automatically scrolls down and pre-loads thumbnails in the gallery view to ensure smooth scrolling.'));
    expanded.appendChild(createInputRow('Enable:', 'cfg-warmer-on', 'checkbox', null, cfg.warmerEnabled));
    expanded.appendChild(createInputRow('Steps:', 'cfg-warmer-steps', 'number', cfg.warmerSteps));
    expanded.appendChild(createInputRow('Delay (ms):', 'cfg-warmer-delay', 'number', cfg.warmerDelay));

    // Append Auto-Scroll Configs
    expanded.appendChild(createSectionTitle('Auto-Scroll', 'Automatically advances through photos in the viewer at the set delay interval.'));
    expanded.appendChild(createInputRow('Limit:', 'cfg-auto-count', 'number', cfg.autoCount));
    expanded.appendChild(createInputRow('Delay (ms):', 'cfg-auto-delay', 'number', cfg.autoDelay));

    // Append Advanced Configs
    expanded.appendChild(createSectionTitle('Advanced & Tracking', 'Configure elements used for DOM tracking and toggle console logging.'));
    expanded.appendChild(createInputRow('Enable Logging:', 'cfg-logging', 'checkbox', null, cfg.loggingEnabled));
    expanded.appendChild(createInputRow('Del Btn:', 'cfg-sel-del', 'text', cfg.selectors.deleteBtn, false, true));
    expanded.appendChild(createInputRow('Next Btn:', 'cfg-sel-next', 'text', cfg.selectors.nextPhotoBtn, false, true));
    expanded.appendChild(createInputRow('Trash Txt:', 'cfg-sel-trash', 'text', cfg.selectors.confirmTrashText, false, true));

    // Documentation Panel
    const docs = document.createElement('div');
    docs.id = 'gp-docs';

    const docsTitle = document.createElement('strong');
    docsTitle.textContent = 'Hotkeys:';
    docs.appendChild(docsTitle);
    docs.appendChild(document.createElement('br'));

    docs.appendChild(document.createTextNode('• '));
    const b1 = document.createElement('b'); b1.textContent = 'End:'; docs.appendChild(b1);
    docs.appendChild(document.createTextNode(' Instant Delete'));
    docs.appendChild(document.createElement('br'));

    docs.appendChild(document.createTextNode('• '));
    const b2 = document.createElement('b'); b2.textContent = 'Arrows:'; docs.appendChild(b2);
    docs.appendChild(document.createTextNode(' Smart Preload Nav'));

    expanded.appendChild(docs);
    container.appendChild(expanded);

    // Mount to live DOM safely
    document.body.appendChild(container);

    // --- UI EVENTS ---
    const get = (id) => document.getElementById(id);

    get('btn-toggle').onclick = () => {
        const h = get('gp-expanded').classList.toggle('hidden');
        get('btn-toggle').textContent = h ? "≫" : "≪";
        log("UI Expanded Toggled", h ? "Hidden" : "Visible");
    };

    // Sync UI to Config Object
    const sync = () => {
        cfg.neighbors = parseInt(get('cfg-neighbors').value);
        cfg.parallel = parseInt(get('cfg-parallel').value);
        cfg.warmerSteps = parseInt(get('cfg-warmer-steps').value);
        cfg.warmerDelay = parseInt(get('cfg-warmer-delay').value);
        cfg.autoCount = parseInt(get('cfg-auto-count').value);
        cfg.autoDelay = parseInt(get('cfg-auto-delay').value);

        cfg.loggingEnabled = get('cfg-logging').checked;
        cfg.selectors.deleteBtn = get('cfg-sel-del').value;
        cfg.selectors.nextPhotoBtn = get('cfg-sel-next').value;
        cfg.selectors.confirmTrashText = get('cfg-sel-trash').value;

        const wasEnabled = cfg.warmerEnabled;
        cfg.warmerEnabled = get('cfg-warmer-on').checked;
        if (!wasEnabled && cfg.warmerEnabled) gridWarmer();
    };

    container.addEventListener('input', sync);

    // Auto-Scroll Logic
    let scrollItv = null;
    get('btn-scroll').onclick = () => {
        if (scrollItv) {
            log("Auto-scroll stopped");
            clearInterval(scrollItv); scrollItv = null;
            get('btn-scroll').textContent = "Auto-Scroll";
            get('btn-scroll').classList.remove('stop');
            return;
        }
        let cur = 0;
        log("Auto-scroll started");
        get('btn-scroll').textContent = "STOP";
        get('btn-scroll').classList.add('stop');
        scrollItv = setInterval(() => {
            const n = document.querySelector(cfg.selectors.nextPhotoBtn);
            if (++cur >= cfg.autoCount || !n) {
                log(n ? "Auto-scroll completed (Limit reached)" : "Auto-scroll completed (No next button found)");
                get('btn-scroll').click();
            } else {
                n.click();
                log(`Auto-scrolled (Item ${cur})`);
            }
        }, cfg.autoDelay);
    };

    // --- HANDLERS ---
    window.addEventListener('keydown', (e) => {
        if (e.key === "End") {
            e.preventDefault();
            triggerDelete();
        }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            log("Navigated via arrow keys");
            setTimeout(preloadViewerAndNeighbors, 100);
        }
    }, true);

    let lastPath = location.pathname;
    const observer = new MutationObserver(() => {
        if (location.pathname === lastPath) return;
        log(`Path changed from ${lastPath} to ${location.pathname}`);
        lastPath = location.pathname;
        setTimeout(() => {
            if (/\/photo\//.test(lastPath)) preloadViewerAndNeighbors();
            else if (cfg.warmerEnabled) gridWarmer();
        }, 300);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });

    log("Script initialized");
})();
