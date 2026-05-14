// ==UserScript==
// @name         Google Photos "End" to Delete & Auto-Scroll
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Press "End" to delete. Floating UI for auto-scrolling right.
// @author       Gemini
// @match        https://photos.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- STYLING ---
    const style = document.createElement('style');
    style.innerHTML = `
        #gp-helper-ui {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #202124;
            color: white;
            padding: 10px;
            border-radius: 8px;
            z-index: 9999;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-family: Roboto, Arial, sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border: 1px solid #5f6368;
        }
        .gp-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
        .gp-btn {
            background: #4285f4;
            color: white;
            border: none;
            padding: 5px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            min-width: 80px;
        }
        .gp-btn:hover { background: #357abd; }
        .gp-btn.stop { background: #ea4335; }
        .gp-btn.stop:hover { background: #d93025; }
        .gp-btn.secondary { background: #5f6368; min-width: auto; }
        .gp-input {
            width: 60px;
            background: #3c4043;
            color: white;
            border: 1px solid #5f6368;
            border-radius: 4px;
            padding: 2px 5px;
        }
        #gp-docs {
            margin-top: 5px;
            padding-top: 5px;
            border-top: 1px solid #5f6368;
            font-size: 11px;
            color: #bdc1c6;
            line-height: 1.4;
        }
        .hidden { display: none !important; }
    `;
    document.head.appendChild(style);

    // --- UI CONSTRUCTION ---
    const container = document.createElement('div');
    container.id = 'gp-helper-ui';
    container.innerHTML = `
        <div class="gp-row">
            <button id="btn-scroll" class="gp-btn">Scroll</button>
            <button id="btn-toggle" class="gp-btn secondary">>></button>
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
                <strong>Docs:</strong><br>
                • <b>End:</b> Delete current photo<br>
                • <b>Scroll:</b> Clicks the "Next" UI button<br>
                • <b>Stop:</b> Halts the auto-scroll loop
            </div>
        </div>
    `;
    document.body.appendChild(container);

    const btnScroll = document.getElementById('btn-scroll');
    const btnToggle = document.getElementById('btn-toggle');
    const expandedArea = document.getElementById('gp-expanded');
    const inpCount = document.getElementById('inp-count');
    const inpDelay = document.getElementById('inp-delay');

    // --- LOGIC: TOGGLE WINDOW ---
    btnToggle.addEventListener('click', () => {
        const isHidden = expandedArea.classList.toggle('hidden');
        btnToggle.textContent = isHidden ? ">>" : "<<";
    });

    // --- LOGIC: AUTO-SCROLL ---
    let scrollInterval = null;

    const stopScrolling = () => {
        clearInterval(scrollInterval);
        scrollInterval = null;
        btnScroll.textContent = "Scroll";
        btnScroll.classList.remove('stop');
    };

    const clickNextButton = () => {
        // Attempt to find the button via the aria-label you provided
        const nextBtn = document.querySelector('div[aria-label="View next photo"]') ||
                        document.querySelector('div[jsname="OCpkoe"]');

        if (nextBtn) {
            nextBtn.click();
            return true;
        } else {
            console.warn("[GP-Helper] Next button not found. Are you in full-screen view?");
            return false;
        }
    };

    btnScroll.addEventListener('click', () => {
        if (scrollInterval) {
            stopScrolling();
            return;
        }

        let count = parseInt(inpCount.value);
        let delay = parseInt(inpDelay.value);
        let current = 0;

        btnScroll.textContent = "Stop";
        btnScroll.classList.add('stop');

        scrollInterval = setInterval(() => {
            current++;
            const success = clickNextButton();

            if (current >= count || !success) {
                stopScrolling();
            }
        }, delay);
    });

    // --- LOGIC: DELETE (Your Original Code) ---
    document.addEventListener('keydown', function(e) {
        if (e.key === "End") {
            e.preventDefault();
            e.stopPropagation();

            const trashButton = document.querySelector('button[aria-label*="Delete"], button[aria-label*="trash"]');
            if (trashButton) {
                trashButton.click();
                let attempts = 0;
                const findConfirmButton = setInterval(() => {
                    attempts++;
                    const buttons = document.querySelectorAll('button');
                    const confirmBtn = Array.from(buttons).find(b =>
                        b.textContent.includes("Move to trash") ||
                        b.innerText.includes("Move to trash")
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
    }, true);
})();
