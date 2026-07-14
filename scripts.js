const loadingScreen = document.querySelector('#loading-screen');

window.setTimeout(() => {
    loadingScreen?.classList.add('is-leaving');

    window.setTimeout(() => {
        loadingScreen?.remove();
    }, 950);
}, 5000);
