/*
 * Grzegorz Mróz — portfolio behaviour.
 *
 * Four jobs only: keep the running head aware of scroll position, keep the
 * contents list in sync with what's being read, let that list open on narrow
 * screens, and reveal sections as they arrive. Everything degrades to plain,
 * fully readable HTML when JavaScript is unavailable.
 */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Colophon year ---------- */
    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    /* ---------- Running head ---------- */
    var runhead = document.getElementById('runhead');
    if (runhead) {
        var onScroll = function () {
            runhead.classList.toggle('is-scrolled', window.scrollY > 80);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    /* ---------- Contents list: disclosure on narrow screens ---------- */
    var toc = document.getElementById('toc');
    var tocBtn = document.getElementById('toc-btn');

    if (toc && tocBtn) {
        var setOpen = function (open) {
            toc.classList.toggle('is-open', open);
            tocBtn.setAttribute('aria-expanded', String(open));
        };

        tocBtn.addEventListener('click', function () {
            setOpen(!toc.classList.contains('is-open'));
        });

        toc.addEventListener('click', function (e) {
            if (e.target.closest('a')) setOpen(false);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && toc.classList.contains('is-open')) {
                setOpen(false);
                tocBtn.focus();
            }
        });
    }

    /* ---------- Contents list: track the section being read ---------- */
    var links = toc ? Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]')) : [];

    if (links.length && 'IntersectionObserver' in window) {
        var byId = {};
        var targets = [];

        links.forEach(function (link) {
            var id = link.getAttribute('href').slice(1);
            var el = document.getElementById(id);
            if (!el) return;
            byId[id] = link;
            targets.push(el);
        });

        // Track the topmost section currently intersecting the reading band.
        var visible = new Set();

        var mark = function () {
            var current = null;
            targets.forEach(function (el) {
                if (visible.has(el.id) && !current) current = el.id;
            });
            links.forEach(function (link) {
                link.classList.toggle(
                    'is-current',
                    current !== null && link === byId[current]
                );
            });
        };

        var spy = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) visible.add(entry.target.id);
                    else visible.delete(entry.target.id);
                });
                mark();
            },
            { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
        );

        targets.forEach(function (el) {
            spy.observe(el);
        });
    }

    /* ---------- Reveal on scroll ---------- */
    var revealables = document.querySelectorAll(
        '.sec, .subsec, .abstract, .fig, .matgrid, .edu'
    );

    if (!reduceMotion && 'IntersectionObserver' in window) {
        var show = function (el) {
            el.classList.add('is-in');
        };

        var reveal = new IntersectionObserver(
            function (entries, observer) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    show(entry.target);
                    observer.unobserve(entry.target);
                });
            },
            { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
        );

        revealables.forEach(function (el) {
            // Added here rather than in the markup so that the page stays
            // fully visible when this script does not run.
            el.classList.add('reveal');

            // Anything already on screen is shown synchronously: an observer
            // only delivers once the page composites a frame, which does not
            // happen in a background or hidden tab.
            var box = el.getBoundingClientRect();
            if (box.top < window.innerHeight && box.bottom > 0) {
                show(el);
                return;
            }

            reveal.observe(el);
        });

        // Failsafe. Hiding content in CSS is only safe if something is
        // guaranteed to bring it back; if no frame is ever composited, this
        // does it instead of leaving the page blank.
        window.setTimeout(function () {
            revealables.forEach(show);
        }, 2000);
    }
})();
