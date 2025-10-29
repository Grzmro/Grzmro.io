(function () {

  function updateClock() {
    const clockEl = document.getElementById("clock");
    if (clockEl) {
      const now = new Date();
      const time = now.toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit'
      });
      clockEl.textContent = time;
    }
  }

  updateClock();
  setInterval(updateClock, 30000);

  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }


  var KEY = 'pref-theme';
  var btn = document.getElementById('themeBtn');
  var html = document.documentElement;

  var saved = localStorage.getItem(KEY);
  if (saved) {
    html.setAttribute('data-theme', saved);
  }

  btn.onclick = function () {
    var cur = html.getAttribute('data-theme');
    var next = (cur === 'light') ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
  };


  
  const form = document.getElementById('contactForm');
  const emailInput = document.getElementById('email');
  const emailError = document.getElementById('emailError');
  const successMessage = document.getElementById('success');
  const messageInput = document.getElementById('message');
  const messageError = document.getElementById('messageError');
  successMessage.style.display = 'none';

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      
      emailError.hidden = true;
      successMessage.style.display = 'none';

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailInput.value)) {
        emailError.hidden = false;
        return;
      }

      if (messageInput.value.trim() === '') {
        messageError.hidden = false;
        return;
      }
      
      messageError.hidden = true;
      successMessage.style.display = 'block';
      form.reset();
    });
  }

})();
