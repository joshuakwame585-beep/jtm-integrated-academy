const menuToggle = document.getElementById('menuToggle');
const navLinks = document.getElementById('navLinks');
menuToggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  navLinks.classList.remove('open'); menuToggle.setAttribute('aria-expanded', 'false');
}));
document.getElementById('year').textContent = new Date().getFullYear();

document.querySelectorAll('.filter-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const filter = button.dataset.filter;
  document.querySelectorAll('.course-card').forEach(card => {
    card.hidden = filter !== 'all' && card.dataset.type !== filter;
  });
}));

document.querySelectorAll('.course-link').forEach(link => link.addEventListener('click', () => {
  const course = link.dataset.course;
  document.getElementById('visitorMessage').value = `Hello JTM, I would like to register my interest in: ${course}. Please let me know when it becomes available.`;
}));

document.getElementById('contactForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const message = form.elements.message.value.trim();
  const subject = encodeURIComponent(`JTM website enquiry from ${name}`);
  const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
  document.getElementById('formHint').textContent = 'Opening your email app with the message prepared. This website does not store your details.';
  window.location.href = `mailto:kwamejoshua703@gmail.com?subject=${subject}&body=${body}`;
});


// Pre-fill the enquiry form when a visitor selects a portfolio service.
document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
  const service = link.dataset.service;
  document.getElementById('visitorMessage').value = `Hello JTM, I would like to enquire about: ${service}. Please share more information. `;
}));


// Subtle scroll progress and accessible reveal animations.
const progressBar = document.getElementById('scrollProgress');
const updateProgress = () => {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
  progressBar.style.width = `${progress}%`;
};
window.addEventListener('scroll', updateProgress, { passive: true });
updateProgress();

const revealTargets = document.querySelectorAll('.section-heading, .service-card, .work-card, .academy-panel, .course-card, .founder-grid, .contact-grid, .credentials-panel');
revealTargets.forEach((element, index) => {
  element.classList.add('reveal');
  if (element.classList.contains('service-card') || element.classList.contains('work-card') || element.classList.contains('course-card')) {
    element.style.transitionDelay = `${(index % 3) * 70}ms`;
  }
});
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('reveal-ready');
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealTargets.forEach(element => revealObserver.observe(element));
} else {
  revealTargets.forEach(element => element.classList.add('is-visible'));
}
