// ==========================================
// SMOOTH SCROLLING
// ==========================================

document.querySelectorAll('nav a').forEach(link => {

    link.addEventListener('click', function (event) {

        const targetId = this.getAttribute('href');

        if (targetId && targetId.startsWith('#')) {

            const target = document.querySelector(targetId);

            if (target) {
                event.preventDefault();

                target.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        }
    });
});


// ==========================================
// NAVBAR EFFECT ON SCROLL
// ==========================================

const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {

    if (window.scrollY > 50) {

        navbar.style.background =
            'rgba(7, 11, 20, 0.96)';

    } else {

        navbar.style.background =
            'rgba(7, 11, 20, 0.82)';
    }
});


// ==========================================
// SCROLL REVEAL ANIMATION
// ==========================================

const revealElements = document.querySelectorAll(
    '.section, .project-card, .skill-card, .education-card'
);

const observer = new IntersectionObserver(
    (entries) => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.classList.add('show');

            }
        });

    },
    {
        threshold: 0.12
    }
);

revealElements.forEach(element => {

    element.classList.add('reveal');

    observer.observe(element);
});


// ==========================================
// CURRENT YEAR
// ==========================================

const yearElement = document.querySelector('#year');

if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
}