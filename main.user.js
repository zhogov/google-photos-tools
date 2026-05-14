// ==UserScript==
// @name         Google Photos: Ultimate Helper (Preload, Delete, & Auto-Scroll)
// @namespace    aleksei.gemini.gp_helper
// @version      2.0
// @description  Combines instant browsing (preloading), "End" key to delete, and a floating UI for auto-navigation.
// @author       Aleksei & Gemini
// @match        https://photos.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION (Preloader) ---
    const NEIGHBORS_TO_PRELOAD = 6;
    const MAX_CONCURRENT_FETCHES = 4;
    const ENABLE_GRID_WARMER_DEFAULT = false;
    const GRID_WARMER_SCROLL_STEPS = 120;
    const GRID_WARMER_DELAY_MS = 120;

    let enableGridWarmer = ENABLE_GRID_WARMER_DEFAULT;
    let inflight = 0;
    const queue = [];
    const warmed = new Set();

    // --- STYLING (UI & Toasts) ---
    const style = document.createElement('style');
    style.innerHTML = `
        #gp-helper-ui {
            position: fixed; bottom: 20px; right: 20px;
            background: #202124; color: white; padding: 10px;
            border-radius: 8px; z-index: 999999;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-family: Roboto, Arial, sans-serif; font-size: 13px;
            display: flex; flex-direction: column; gap: 8px;
            border: 1px solid #5f6368;
        }
        .gp-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
        .gp-btn {
            background: #4285f4; color: white; border: none;
            padding: 5px 12px; border-radius: 4px; cursor: pointer;
            font-weight: bold; min-width: 80px;
        }
        .gp-btn:hover { background: #357abd; }
        .gp-btn.stop { background: #ea4335; }
        .gp-btn.secondary { background: #5f6368; min-width: auto; }
        .gp-input {
            width: 60px; background: #3c4043; color: white;
            border: 1px solid #5f6368; border-radius: 4px; padding: 2px 5px;
        }
        #gp-docs {
            margin-top: 5px; padding-top: 5px; border-top: 1px solid #5f6368;
            font-size: 11px; color: #bdc1c6; line-height: 1.4;
        }
        .hidden { display: none !important; }
        .gp-toast {
            position: fixed; left: 50%; top: 70px; transform: translateX(-50%);
            background: rgba(0,0,0,.85); color: #fff; padding: 8px 12px;
            border-radius: 10px; fontSize: 13px; z-index: 999999;
            box-shadow: 0 6px 24px rgba(0,0,0,.3); pointer-events: none;
        }
    `;
    document.head.appendChild(style);

    // --- UTILITIES ---
    function log(...a) { console.debug("[GP-Ultimate]", ...a); }

    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'gp-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1600);
    }

    function isVisible(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    }

    // --- PRELOADER LOGIC ---
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
        pump();
    }

    function pump() {
        while (inflight < MAX_CONCURRENT_FETCHES && queue.length) {
            const url = queue.shift();
            inflight++;
            const img = new Image();
            img.decoding = 'async';
            img.loading = 'eager';
            img.referrerPolicy = 'strict-origin-when-cross-origin';
            img.onload = img.onerror = () => { inflight--; pump(); };
            img.src = url;
        }
    }

    function findViewerImage() {
        const imgs = Array.from(document.querySelectorAll('img'));
        let best = null, bestArea = 0;
        for (const im of imgs) {
            const rect = im.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > bestArea && rect.width > 400 && rect.height > 300 && isVisible(im)) {
                best = im; bestArea = area;
            }
        }
        return best;
    }

    function findFilmstripThumbnails() {
        const candidates = Array.from(document.querySelectorAll('div,section,ul')).filter(isVisible);
        let best = null, bestCount = 0;
        for (const c of candidates) {
            const imgs = c.querySelectorAll('img');
            if (imgs.length > bestCount && imgs.length >= 5) { best = c; bestCount = imgs.length; }
        }
        return best ? Array.from(best.querySelectorAll('img')) : [];
    }

    function preloadViewerAndNeighbors() {
        const main = findViewerImage();
        if (main) {
            const big = largestFromSrcset(main);
            warm(big);
            log("Warmed current:", big);
        }
        const thumbs = findFilmstripThumbnails();
        if (thumbs.length) {
            const mainSrc = main ? (main.currentSrc || largestFromSrcset(main)) : null;
            let idx = -1;
            for (let i = 0; i < thumbs.length; i++) {
                const u = largestFromSrcset(thumbs[i]);
                if (mainSrc && u && mainSrc.split('=')[0] === u.split('=')[0]) { idx = i; break; }
            }
            if (idx === -1) idx = Math.floor(thumbs.length / 2);
            for (let delta = 1; delta <= NEIGHBORS_TO_PRELOAD; delta++) {
                const left = thumbs[idx - delta], right = thumbs[idx + delta];
                if (left) warm(largestFromSrcset(left));
                if (right) warm(largestFromSrcset(right));
            }
        }
    }

    // --- GRID WARMER (Passive Caching) ---
    async function gridWarmer() {
        if (!enableGridWarmer) return;
        const sc = document.scrollingElement || document.documentElement;
        const startY = sc.scrollTop;
        const step = Math.max(200, window.innerHeight * 0.8);
        for (let i = 0; i < GRID_WARMER_SCROLL_STEPS; i++) {
            sc.scrollTop += step;
            await new Promise(r => setTimeout(r, GRID_WARMER_DELAY_MS));
            document.querySelectorAll('img').forEach(img => {
                const r = img.getBoundingClientRect();
                if (r.top < innerHeight * 1.6 && r.bottom > -innerHeight * 0.6) {
                    warm(largestFromSrcset(img));
                }
            });
        }
        sc.scrollTop = startY;
        toast("Grid warm-up run finished");
    }

    // --- DELETE LOGIC ---
    function triggerDelete() {
        const trashButton = document.querySelector('button[aria-label*="Delete"], button[aria-label*="trash"]');
        if (trashButton) {
            trashButton.click();
            let attempts = 0;
            const findConfirmButton = setInterval(() => {
                attempts++;
                const confirmBtn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent.includes("Move to trash") || b.innerText.includes("Move to trash")
                );
                if (confirmBtn) {
                    confirmBtn.click();
                    clearInterval(findConfirmButton);
                } else if (attempts > 40) {
                    clearInterval(findConfirmButton);
                }
            }, 50);
        }
    }

    // --- UI CONSTRUCTION (Floating Panel) ---
    const container = document.createElement('div');
    container.id = 'gp-helper-ui';
    container.innerHTML = `
        <div class="gp-row">
            <button id="btn-scroll" class="gp-btn">Scroll</button>
            <button id="btn-toggle" class="gp-btn secondary">≫</button>
        </div>
        <div id="gp-expanded" class="hidden">
            <div class="gp-row">
                <span>Count:</span>
                <input type="number" id="inp-count" class="gp-input" value="200">
            </div>
            <div class="gp-row">
                <span>Delay (ms):</span>
                <input type="number" id="inp-delay" class="gp-input" value="500">
            </div>
            <div id="gp-docs">
                <strong>Hotkeys:</strong><br>
                • <b>End:</b> Delete photo<br>
                • <b>Alt+P:</b> Toggle Grid Cache<br>
                • <b>Arrows:</b> Instant Nav (Preloaded)
            </div>
        </div>
    `;
    document.body.appendChild(container);

    const btnScroll = document.getElementById('btn-scroll');
    const btnToggle = document.getElementById('btn-toggle');
    const expandedArea = document.getElementById('gp-expanded');
    const inpCount = document.getElementById('inp-count');
    const inpDelay = document.getElementById('inp-delay');

    btnToggle.addEventListener('click', () => {
        const isHidden = expandedArea.classList.toggle('hidden');
        btnToggle.textContent = isHidden ? "≫" : "≪";
    });

    // --- AUTO-SCROLL LOGIC ---
    let autoScrollInterval = null;

    const stopAutoScroll = () => {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
        btnScroll.textContent = "Scroll";
        btnScroll.classList.remove('stop');
    };

    const clickNextButton = () => {
        const nextBtn = document.querySelector('div[aria-label="View next photo"]') || 
                        document.querySelector('div[jsname="OCpkoe"]');
        if (nextBtn) {
            nextBtn.click();
            return true;
        }
        return false;
    };

    btnScroll.addEventListener('click', () => {
        if (autoScrollInterval) {
            stopAutoScroll();
            return;
        }
        let count = parseInt(inpCount.value);
        let current = 0;
        btnScroll.textContent = "Stop";
        btnScroll.classList.add('stop');

        autoScrollInterval = setInterval(() => {
            current++;
            const success = clickNextButton();
            if (current >= count || !success) stopAutoScroll();
        }, parseInt(inpDelay.value));
    });

    // --- NAVIGATION & KEYBOARD HANDLERS ---
    window.addEventListener('keydown', (e) => {
        // 1. Delete Photo
        if (e.key === "End") {
            e.preventDefault(); e.stopPropagation();
            triggerDelete();
        } 
        // 2. Preload on Navigation
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            setTimeout(preloadViewerAndNeighbors, 60);
        } 
        // 3. Toggle Grid Warmer
        else if (e.altKey && (e.key.toLowerCase() === 'p')) {
            enableGridWarmer = !enableGridWarmer;
            toast(`Grid warmer ${enableGridWarmer ? 'ON' : 'OFF'}`);
            if (enableGridWarmer && !/\/photo\//.test(location.pathname)) gridWarmer();
        }
    }, true);

    // Watch for SPA navigation
    let lastPath = location.pathname;
    const observer = new MutationObserver(() => {
        const now = location.pathname;
        if (now === lastPath) return;
        lastPath = now;
        setTimeout(() => {
            if (/\/photo\//.test(now)) preloadViewerAndNeighbors();
            else if (enableGridWarmer) gridWarmer();
        }, 250);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });

    // Initial load
    setTimeout(() => {
        if (/\/photo\//.test(location.pathname)) preloadViewerAndNeighbors();
    }, 800);

})();
