// ==UserScript==
// @name         Google Photos: Ultimate Helper (Preload, Delete, & Auto-Scroll)
// @namespace    zhogov.google_photos_tools
// @version      1.0
// @description  Press keyboard key to delete and different precaching strategies
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
        autoDelay: 500
    };

    let inflight = 0;
    const queue = [];
    const warmed = new Set();

    // --- STYLING ---
    const style = document.createElement('style');
    style.innerHTML = `
        #gp-helper-ui {
            position: fixed; bottom: 20px; right: 20px;
            background: #202124; color: white; padding: 12px;
            border-radius: 8px; z-index: 999999;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-family: Roboto, Arial, sans-serif; font-size: 12px;
            display: flex; flex-direction: column; gap: 6px;
            border: 1px solid #5f6368; width: 220px;
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
        const imgs = Array.from(document.querySelectorAll('img'));
        let main = null, bestArea = 0;
        for (const im of imgs) {
            const rect = im.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > bestArea && rect.width > 400 && isVisible(im)) { main = im; bestArea = area; }
        }

        if (main) warm(largestFromSrcset(main));

        const thumbs = (function() {
            const candidates = Array.from(document.querySelectorAll('div,section,ul')).filter(isVisible);
            let best = null, bestCount = 0;
            for (const c of candidates) {
                const imgs = c.querySelectorAll('img');
                if (imgs.length > bestCount && imgs.length >= 5) { best = c; bestCount = imgs.length; }
            }
            return best ? Array.from(best.querySelectorAll('img')) : [];
        })();

        if (thumbs.length) {
            const mainSrc = main ? (main.currentSrc || largestFromSrcset(main)) : null;
            let idx = thumbs.findIndex(t => mainSrc && largestFromSrcset(t)?.split('=')[0] === mainSrc.split('=')[0]);
            if (idx === -1) idx = Math.floor(thumbs.length / 2);
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
        
        toast("Starting Grid Warm-up...");
        for (let i = 0; i < cfg.warmerSteps && cfg.warmerEnabled; i++) {
            sc.scrollTop += step;
            await new Promise(r => setTimeout(r, cfg.warmerDelay));
            document.querySelectorAll('img').forEach(img => {
                const r = img.getBoundingClientRect();
                if (r.top < innerHeight * 1.6 && r.bottom > -innerHeight * 0.6) warm(largestFromSrcset(img));
            });
        }
        sc.scrollTop = startY;
        toast("Warm-up complete");
    }

    function triggerDelete() {
        const btn = document.querySelector('button[aria-label*="Delete"], button[aria-label*="trash"]');
        if (!btn) return;
        btn.click();
        let att = 0;
        const itv = setInterval(() => {
            const conf = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes("Move to trash"));
            if (conf) { conf.click(); clearInterval(itv); }
            else if (++att > 40) clearInterval(itv);
        }, 50);
    }

    // --- UI CONSTRUCTION ---
    const container = document.createElement('div');
    container.id = 'gp-helper-ui';
    container.innerHTML = `
        <div class="gp-row">
            <button id="btn-scroll" class="gp-btn">Auto-Scroll</button>
            <button id="btn-toggle" class="gp-btn secondary">≫</button>
        </div>
        <div id="gp-expanded" class="hidden">
            <div class="gp-section-title">
                Preloader 
                <span class="gp-info" title="Pre-fetches high-resolution images of adjacent photos so they load instantly when navigating left/right.">ⓘ</span>
            </div>
            <div class="gp-row"><span>Neighbors:</span><input type="number" id="cfg-neighbors" class="gp-input" value="${cfg.neighbors}"></div>
            <div class="gp-row"><span>Parallel:</span><input type="number" id="cfg-parallel" class="gp-input" value="${cfg.parallel}"></div>
            
            <div class="gp-section-title">
                Grid Warmer 
                <span class="gp-info" title="Automatically scrolls down and pre-loads thumbnails in the gallery view to ensure smooth scrolling.">ⓘ</span>
            </div>
            <div class="gp-row"><span>Enable:</span><input type="checkbox" id="cfg-warmer-on"></div>
            <div class="gp-row"><span>Steps:</span><input type="number" id="cfg-warmer-steps" class="gp-input" value="${cfg.warmerSteps}"></div>
            <div class="gp-row"><span>Delay (ms):</span><input type="number" id="cfg-warmer-delay" class="gp-input" value="${cfg.warmerDelay}"></div>

            <div class="gp-section-title">
                Auto-Scroll 
                <span class="gp-info" title="Automatically advances through photos in the viewer at the set delay interval.">ⓘ</span>
            </div>
            <div class="gp-row"><span>Limit:</span><input type="number" id="cfg-auto-count" class="gp-input" value="${cfg.autoCount}"></div>
            <div class="gp-row"><span>Delay (ms):</span><input type="number" id="cfg-auto-delay" class="gp-input" value="${cfg.autoDelay}"></div>

            <div id="gp-docs">
                <strong>Hotkeys:</strong><br>
                • <b>End:</b> Instant Delete<br>
                • <b>Arrows:</b> Smart Preload Nav
            </div>
        </div>
    `;
    document.body.appendChild(container);

    // --- UI EVENTS ---
    const get = (id) => document.getElementById(id);
    
    get('btn-toggle').onclick = () => {
        const h = get('gp-expanded').classList.toggle('hidden');
        get('btn-toggle').textContent = h ? "≫" : "≪";
    };

    // Sync UI to Config Object
    const sync = () => {
        cfg.neighbors = parseInt(get('cfg-neighbors').value);
        cfg.parallel = parseInt(get('cfg-parallel').value);
        cfg.warmerSteps = parseInt(get('cfg-warmer-steps').value);
        cfg.warmerDelay = parseInt(get('cfg-warmer-delay').value);
        cfg.autoCount = parseInt(get('cfg-auto-count').value);
        cfg.autoDelay = parseInt(get('cfg-auto-delay').value);
        
        const wasEnabled = cfg.warmerEnabled;
        cfg.warmerEnabled = get('cfg-warmer-on').checked;
        if (!wasEnabled && cfg.warmerEnabled) gridWarmer();
    };

    container.addEventListener('input', sync);

    // Auto-Scroll Logic
    let scrollItv = null;
    get('btn-scroll').onclick = () => {
        if (scrollItv) {
            clearInterval(scrollItv); scrollItv = null;
            get('btn-scroll').textContent = "Auto-Scroll";
            get('btn-scroll').classList.remove('stop');
            return;
        }
        let cur = 0;
        get('btn-scroll').textContent = "STOP";
        get('btn-scroll').classList.add('stop');
        scrollItv = setInterval(() => {
            const n = document.querySelector('div[aria-label="View next photo"]') || document.querySelector('div[jsname="OCpkoe"]');
            if (++cur >= cfg.autoCount || !n) get('btn-scroll').click();
            else n.click();
        }, cfg.autoDelay);
    };

    // --- HANDLERS ---
    window.addEventListener('keydown', (e) => {
        if (e.key === "End") { e.preventDefault(); triggerDelete(); } 
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            setTimeout(preloadViewerAndNeighbors, 100);
        }
    }, true);

    let lastPath = location.pathname;
    const observer = new MutationObserver(() => {
        if (location.pathname === lastPath) return;
        lastPath = location.pathname;
        setTimeout(() => {
            if (/\/photo\//.test(lastPath)) preloadViewerAndNeighbors();
            else if (cfg.warmerEnabled) gridWarmer();
        }, 300);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });

})();
