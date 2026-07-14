const loadingScreen = document.querySelector('#loading-screen');
const loadingDots = [...document.querySelectorAll('.loading-dot')];
const loadingError = document.querySelector('#loading-error');

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

const minimumLoadingTime = new Promise((resolve) => {
    window.setTimeout(resolve, 1500);
});

async function revealDashboard() {
    await minimumLoadingTime;
    window.clearTimeout(startupTimeout);
    document.body.classList.add('is-ready');
    loadingScreen?.classList.add('is-leaving');
    window.setTimeout(() => loadingScreen?.remove(), 950);
}

const startupTimeout = window.setTimeout(() => {
    loadingScreen?.classList.add('has-error');
    if (loadingError) {
        loadingError.textContent = 'DASHBOARD INITIALIZATION FAILED';
    }
}, 7000);

window.addEventListener('habitat:ready', revealDashboard, { once: true });
animateLoadingDots();
