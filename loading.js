const loadingScreen = document.querySelector('#loading-screen');
const loadingDots = [...document.querySelectorAll('.loading-dot')];
const loadingError = document.querySelector('#loading-error');
const minimumLoadingTime = 1500;
let loadingStartedAt = performance.now();

function animateLoadingDots() {
    if (!loadingDots.length) return;

    function update(now) {
        loadingDots.forEach((dot, index) => {
            const primaryWave = Math.max(0, Math.sin(index * 0.42 - now * 0.0024)) ** 5;
            const secondaryWave = Math.max(0, Math.sin(index * 0.31 - now * 0.0019 + 1.8)) ** 7;
            const tertiaryWave = Math.max(0, Math.sin(index * 0.24 - now * 0.0015 + 3.6)) ** 9;
            const brightness = Math.min(1, Math.max(primaryWave, secondaryWave * 0.72, tertiaryWave * 0.5));
            dot.style.opacity = String(0.1 + brightness * 0.9);
        });
        requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
}

function showLoading() {
    if (!loadingScreen) return;

    loadingScreen.hidden = false;
    loadingStartedAt = performance.now();
    loadingScreen.classList.remove('is-leaving', 'has-error');
    loadingScreen.classList.add('is-returning');
    document.body.classList.remove('auth-required');
}

function leaveLoading(afterLeave) {
    if (!loadingScreen) {
        afterLeave();
        return;
    }

    const elapsed = performance.now() - loadingStartedAt;
    const remaining = Math.max(0, minimumLoadingTime - elapsed);

    window.setTimeout(() => {
        loadingScreen.classList.add('is-leaving');
        window.setTimeout(() => {
            loadingScreen.hidden = true;
            loadingScreen.classList.remove('is-leaving', 'is-returning');
            afterLeave();
        }, 950);
    }, remaining);
}

async function revealDashboard() {
    leaveLoading(() => {
        document.body.classList.remove('auth-required');
        document.body.classList.add('is-ready');
    });
}

window.addEventListener('habitat:auth-required', () => {
    leaveLoading(() => document.body.classList.add('auth-required'));
});

window.addEventListener('habitat:auth-pending', showLoading);
window.addEventListener('habitat:ready', revealDashboard, { once: true });
window.addEventListener('habitat:startup-error', (event) => {
    const message = event.detail?.message ?? 'DASHBOARD INITIALIZATION FAILED';
    if (loadingError) loadingError.textContent = message;
    loadingScreen?.classList.add('has-error');
});

animateLoadingDots();
