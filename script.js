<<<<<<< HEAD
'use strict';

const authScreen = document.querySelector('#auth-screen');
const siteContent = document.querySelector('#site-content');
const loginForm = document.querySelector('#login-form');
const mfaForm = document.querySelector('#mfa-form');
const authMessage = document.querySelector('#auth-message');
const loginButton = document.querySelector('#login-button');
const verifyButton = document.querySelector('#verify-button');
const resendButton = document.querySelector('#resend-button');

function showMessage(message, success = false) {
  authMessage.textContent = message || '';
  authMessage.classList.toggle('success', Boolean(success));
}
function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function showLogin() {
  document.body.classList.add('auth-locked');
  authScreen.classList.remove('hidden');
  siteContent.classList.add('hidden');
  loginForm.classList.remove('hidden');
  mfaForm.classList.add('hidden');
  loginForm.reset();
  mfaForm.reset();
  showMessage('');
}
function showMfa(message) {
  loginForm.classList.add('hidden');
  mfaForm.classList.remove('hidden');
  document.querySelector('#mfa-code').focus();
  showMessage(message, true);
}
function showPortfolio() {
  authScreen.classList.add('hidden');
  siteContent.classList.remove('hidden');
  document.body.classList.remove('auth-locked');
  const nav = document.querySelector('.nav-container');
  if (nav && !document.querySelector('#logout-button')) {
    const button = document.createElement('button');
    button.id = 'logout-button';
    button.className = 'github-nav auth-logout';
    button.type = 'button';
    button.textContent = 'Sign out';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
      catch (_) { /* Return to login even if the network is unavailable. */ }
      showLogin();
    });
    nav.appendChild(button);
  }
  // The page content is inserted only after MFA succeeds; re-run reveal setup.
  document.querySelectorAll('.section, .project-card, .skill-card, .education-card').forEach(element => {
    element.classList.add('reveal');
    if (element.getBoundingClientRect().top < window.innerHeight) element.classList.add('show');
  });
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  showMessage('');
  setBusy(loginButton, true, 'Checking credentials…');
  const email = document.querySelector('#login-email').value.trim();
  const password = document.querySelector('#login-password').value;
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.mfaRequired) showMfa(result.message || 'Enter the code sent to your email.');
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(loginButton, false);
  }
});

mfaForm.addEventListener('submit', async event => {
  event.preventDefault();
  showMessage('');
  setBusy(verifyButton, true, 'Verifying…');
  const code = document.querySelector('#mfa-code').value.trim();
  try {
    await api('/api/auth/verify-mfa', { method: 'POST', body: JSON.stringify({ code }) });
    showPortfolio();
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(verifyButton, false);
  }
});

resendButton.addEventListener('click', async () => {
  setBusy(resendButton, true, 'Sending…');
  showMessage('');
  try {
    const result = await api('/api/auth/resend-code', { method: 'POST', body: '{}' });
    showMessage(result.message, true);
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(resendButton, false);
  }
});

document.querySelector('#back-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {}
  showLogin();
});

// Start locked, then ask the backend whether this browser already has a verified session.
showLogin();
api('/api/auth/me').then(() => showPortfolio()).catch(() => showLogin());

// Smooth scrolling for in-page navigation.
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', function (event) {
    const targetId = this.getAttribute('href');
    if (targetId && targetId.startsWith('#')) {
      const target = document.querySelector(targetId);
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
});

const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', () => {
  if (navbar) navbar.style.background = window.scrollY > 50 ? 'rgba(7, 11, 20, 0.96)' : 'rgba(7, 11, 20, 0.82)';
});

const revealElements = document.querySelectorAll('.section, .project-card, .skill-card, .education-card');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('show'); });
  }, { threshold: 0.12 });
  revealElements.forEach(element => { element.classList.add('reveal'); observer.observe(element); });
}
const yearElement = document.querySelector('#year');
if (yearElement) yearElement.textContent = new Date().getFullYear();
=======
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
>>>>>>> origin/main
