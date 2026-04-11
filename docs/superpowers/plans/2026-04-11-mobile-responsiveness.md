# Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the documentation portal fully responsive for desktop, tablet, and mobile with collapsible sidebar, touch-friendly UI, and improved navigation.

**Architecture:** Single HTML file (DOCUMENTATION.html) with CSS media queries for responsive breakpoints. JavaScript handles sidebar toggle, overlay, search, and navigation state.

---

### Task 1: Add Responsive CSS Variables & Breakpoints

**Files:**
- Modify: `public/DOCUMENTATION.html:18-55`

- [ ] **Step 1: Add CSS custom properties for responsive values**

```css
:root {
  /* ... existing variables ... */
  
  /* Responsive */
  --sidebar-w: 260px;
  --sidebar-w-collapsed: 56px;
  --content-max-width: 75ch;
  --font-base-desktop: 15px;
  --font-base-tablet: 14px;
  --font-base-mobile: 14px;
  --touch-target-min: 44px;
  --sidebar-item-height: 48px;
  --transition-speed: 250ms;
  --overlay-bg: rgba(0, 0, 0, 0.5);
}
```

- [ ] **Step 2: Add responsive font sizing**

```css
html {
  font-size: var(--font-base-desktop);
}

@media (max-width: 1023px) {
  html {
    font-size: var(--font-base-tablet);
  }
}

@media (max-width: 767px) {
  html {
    font-size: var(--font-base-mobile);
  }
}
```

- [ ] **Step 3: Add breakpoint-based layout**

```css
@media (max-width: 767px) {
  .sidebar {
    transform: translateX(-100%);
    width: 280px;
    transition: transform var(--transition-speed) ease;
  }
  
  .sidebar.open {
    transform: translateX(0);
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform var(--transition-speed) ease;
  }
  
  .sidebar.open {
    transform: translateX(0);
  }
  
  .sidebar.collapsed {
    transform: translateX(-100%);
  }
}

@media (min-width: 1024px) {
  .sidebar.collapsed {
    width: var(--sidebar-w-collapsed);
  }
  
  .sidebar.collapsed .sidebar-brand-text,
  .sidebar.collapsed .sidebar-meta,
  .sidebar.collapsed .sidebar-nav {
    opacity: 0;
    visibility: hidden;
  }
}
```

- [ ] **Step 4: Add content layout adjustments**

```css
.main {
  margin-left: var(--sidebar-w);
  transition: margin-left var(--transition-speed) ease;
  max-width: var(--content-max-width);
  padding: 2rem;
}

.sidebar.collapsed ~ .main {
  margin-left: var(--sidebar-w-collapsed);
}

@media (max-width: 767px) {
  .main {
    margin-left: 0;
    padding: 1rem;
    padding-top: 60px;
  }
}
```

---

### Task 2: Hamburger Toggle & Overlay

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Add hamburger toggle button HTML**

Add after `<body>`:
```html
<button class="hamburger-toggle" aria-label="Toggle sidebar" aria-expanded="false">
  <span class="hamburger-icon"></span>
</button>
<div class="overlay"></div>
```

- [ ] **Step 2: Add hamburger CSS**

```css
.hamburger-toggle {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
  width: var(--touch-target-min);
  height: var(--touch-target-min);
  background: var(--sidebar-bg);
  border: none;
  cursor: pointer;
  align-items: center;
  justify-content: center;
}

.hamburger-icon {
  width: 20px;
  height: 2px;
  background: #fff;
  position: relative;
}

.hamburger-icon::before,
.hamburger-icon::after {
  content: '';
  position: absolute;
  width: 100%;
  height: 2px;
  background: #fff;
  left: 0;
}

.hamburger-icon::before { top: -6px; }
.hamburger-icon::after { top: 6px; }

.sidebar.collapsed ~ .hamburger-toggle {
  display: flex;
}

@media (max-width: 1023px) {
  .hamburger-toggle {
    display: flex;
  }
}

.overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg);
  z-index: 40;
  opacity: 0;
  transition: opacity var(--transition-speed) ease;
}

@media (max-width: 1023px) {
  .overlay {
    display: block;
  }
  
  .sidebar.open ~ .overlay {
    opacity: 1;
  }
}
```

- [ ] **Step 3: Add JavaScript for toggle**

```javascript
const hamburgerToggle = document.querySelector('.hamburger-toggle');
const sidebar = document.querySelector('.sidebar');
const overlay = document.querySelector('.overlay');

function toggleSidebar() {
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.remove('open');
    hamburgerToggle.setAttribute('aria-expanded', 'false');
  } else {
    sidebar.classList.add('open');
    hamburgerToggle.setAttribute('aria-expanded', 'true');
  }
}

function closeSidebar() {
  sidebar.classList.remove('open');
  hamburgerToggle.setAttribute('aria-expanded', 'false');
}

if (hamburgerToggle) {
  hamburgerToggle.addEventListener('click', toggleSidebar);
}

if (overlay) {
  overlay.addEventListener('click', closeSidebar);
}
```

---

### Task 3: Settings Section in Sidebar

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Add settings section HTML in sidebar**

Find the sidebar closing structure and add before `</aside>`:
```html
<div class="sidebar-settings">
  <div class="sidebar-section-label">Settings</div>
  <button class="sidebar-item" id="btn-refresh">
    <span class="sidebar-item-icon">⟳</span>
    <span class="sidebar-item-text">Refresh</span>
  </button>
  <button class="sidebar-item" id="btn-clear-cache">
    <span class="sidebar-item-icon">🗑</span>
    <span class="sidebar-item-text">Clear Cache</span>
  </button>
</div>
```

- [ ] **Step 2: Add settings CSS**

```css
.sidebar-settings {
  margin-top: auto;
  padding: 1rem 0;
  border-top: 1px solid var(--sidebar-border);
}

.sidebar-section-label {
  padding: 0.5rem 1.5rem;
  font-size: 0.65rem;
  color: var(--sidebar-label);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1.5rem;
  background: none;
  border: none;
  color: var(--sidebar-text);
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
  min-height: var(--sidebar-item-height);
  transition: background var(--transition-speed) ease;
}

.sidebar-item:hover,
.sidebar-item:focus {
  background: var(--sidebar-hover);
  color: var(--sidebar-active-text);
  outline: none;
}

.sidebar-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.sidebar-item-icon {
  font-size: 1rem;
  width: 20px;
  text-align: center;
}
```

- [ ] **Step 3: Add settings JavaScript**

```javascript
const refreshBtn = document.getElementById('btn-refresh');
const clearCacheBtn = document.getElementById('btn-clear-cache');

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    window.location.reload();
  });
}

if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  });
}
```

---

### Task 4: Touch Targets & Accessibility

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Update minimum touch targets**

```css
.sidebar-item,
button,
a {
  min-height: var(--touch-target-min);
  min-width: var(--touch-target-min);
}

.sidebar-item {
  padding: 0.75rem 1.5rem;
  gap: 0.75rem;
}
```

- [ ] **Step 2: Add spacing between tappable items**

```css
.sidebar-nav-item + .sidebar-nav-item {
  margin-top: 2px;
}

.sidebar-group + .sidebar-group {
  margin-top: 0.5rem;
}
```

---

### Task 5: Search UI

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Add search HTML**

Add after hamburger toggle:
```html
<div class="search-container">
  <button class="search-toggle" aria-label="Search">
    <span class="search-icon">🔍</span>
  </button>
  <div class="search-input-wrapper">
    <input type="search" class="search-input" placeholder="Search docs..." aria-label="Search documentation">
  </div>
</div>
```

- [ ] **Step 2: Add search CSS**

```css
.search-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--body-bg);
  border-radius: 8px;
  margin: 1rem;
}

.search-toggle {
  display: none;
  background: none;
  border: none;
  color: var(--text-secondary);
  padding: 0.5rem;
  cursor: pointer;
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.9rem;
  background: #fff;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}

@media (max-width: 767px) {
  .search-container {
    position: sticky;
    top: 0;
    background: var(--body-bg);
    margin: 0;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
    z-index: 30;
  }
  
  .search-toggle {
    display: block;
  }
  
  .search-input-wrapper {
    display: none;
    flex: 1;
  }
  
  .search-container.expanded .search-input-wrapper {
    display: block;
  }
  
  .search-container.expanded .search-toggle {
    display: none;
  }
}
```

- [ ] **Step 3: Add search JavaScript**

```javascript
const searchContainer = document.querySelector('.search-container');
const searchToggle = document.querySelector('.search-toggle');
const searchInput = document.querySelector('.search-input');

if (searchToggle) {
  searchToggle.addEventListener('click', () => {
    searchContainer.classList.add('expanded');
    searchInput.focus();
  });
}

// Cmd/Ctrl + K keyboard shortcut
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});
```

---

### Task 6: Breadcrumbs & Previous/Next Navigation

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Add breadcrumbs HTML in main content**

Add at top of main content:
```html
<nav class="breadcrumbs" aria-label="Breadcrumb">
  <a href="/">Home</a>
  <span class="breadcrumb-sep">›</span>
  <a href="#">Section</a>
  <span class="breadcrumb-sep">›</span>
  <span class="breadcrumb-current">Page</span>
</nav>
```

- [ ] **Step 2: Add breadcrumbs CSS**

```css
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.breadcrumbs a {
  color: var(--accent);
  text-decoration: none;
}

.breadcrumbs a:hover {
  text-decoration: underline;
}

.breadcrumb-sep {
  color: var(--text-muted);
}

.breadcrumb-current {
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

@media (max-width: 767px) {
  .breadcrumb-current {
    max-width: 100px;
  }
}
```

- [ ] **Step 3: Add prev/next navigation HTML**

Add at bottom of main content:
```html
<nav class="page-nav" aria-label="Page navigation">
  <a href="#" class="page-nav-btn page-nav-prev">
    <span class="page-nav-label">← Previous</span>
    <span class="page-nav-title">Previous Page Title</span>
  </a>
  <a href="#" class="page-nav-btn page-nav-next">
    <span class="page-nav-label">Next →</span>
    <span class="page-nav-title">Next Page Title</span>
  </a>
</nav>
```

- [ ] **Step 4: Add prev/next CSS**

```css
.page-nav {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
}

.page-nav-btn {
  display: flex;
  flex-direction: column;
  padding: 1rem 1.25rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
  color: var(--text-primary);
  min-width: 140px;
  transition: border-color var(--transition-speed) ease, box-shadow var(--transition-speed) ease;
}

.page-nav-btn:hover {
  border-color: var(--accent);
  box-shadow: 0 2px 8px rgba(60, 80, 224, 0.15);
}

.page-nav-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
}

.page-nav-title {
  font-size: 0.9rem;
  font-weight: 500;
}

.page-nav-next {
  text-align: right;
  margin-left: auto;
}
```

- [ ] **Step 5: Add keyboard navigation JavaScript**

```javascript
document.addEventListener('keydown', (e) => {
  const prevBtn = document.querySelector('.page-nav-prev');
  const nextBtn = document.querySelector('.page-nav-next');
  
  if (e.key === 'ArrowLeft' && prevBtn && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    prevBtn.click();
  }
  
  if (e.key === 'ArrowRight' && nextBtn && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    nextBtn.click();
  }
});
```

---

### Task 7: Performance - Lazy Loading & Preloading

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Add lazy loading for images**

Modify image tags to use native lazy loading:
```html
<img src="image.jpg" alt="Description" loading="lazy" width="800" height="400">
```

- [ ] **Step 2: Add intersection observer for lazy loading**

```javascript
if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  });
  
  document.querySelectorAll('img[data-src]').forEach(img => {
    imageObserver.observe(img);
  });
}
```

- [ ] **Step 3: Add prefetching for next/prev pages**

```javascript
const prefetchPage = (url) => {
  if (url && 'fetch' in window) {
    fetch(url, { method: 'HEAD', mode: 'cors' })
      .then(response => {
        if (response.ok) {
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = url;
          document.head.appendChild(link);
        }
      })
      .catch(() => {});
  }
};

// Prefetch on page idle
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => {
    const nextBtn = document.querySelector('.page-nav-next');
    const prevBtn = document.querySelector('.page-nav-prev');
    if (nextBtn) prefetchPage(nextBtn.href);
    if (prevBtn) prefetchPage(prevBtn.href);
  });
} else {
  setTimeout(() => {
    const nextBtn = document.querySelector('.page-nav-next');
    const prevBtn = document.querySelector('.page-nav-prev');
    if (nextBtn) prefetchPage(nextBtn.href);
    if (prevBtn) prefetchPage(prevBtn.href);
  }, 2000);
}
```

---

### Task 8: iPad Specific Features

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Add Apple Pencil hover detection**

```javascript
const isApplePencil = () => {
  return navigator.maxTouchPoints > 1 && 
         window.matchMedia('(hover: hover)').matches;
};

// Show hover states for Apple Pencil users
if (isApplePencil()) {
  document.body.classList.add('has-apple-pencil');
}
```

- [ ] **Step 2: Add iPad split-view detection**

```javascript
const getSplitViewWidth = () => {
  return window.outerWidth - window.innerWidth;
};

const handleSplitViewChange = () => {
  const splitWidth = getSplitViewWidth();
  const sidebar = document.querySelector('.sidebar');
  
  if (splitWidth > 0) {
    // iPad in split view mode
    sidebar.classList.add('split-view');
  } else {
    sidebar.classList.remove('split-view');
  }
};

window.addEventListener('resize', handleSplitViewChange);
handleSplitViewChange();

// LocalStorage for sidebar state
const saveSidebarState = () => {
  const isCollapsed = document.querySelector('.sidebar.collapsed');
  const splitWidth = getSplitViewWidth();
  const key = splitWidth > 0 ? 'sidebar-split-view' : 'sidebar-default';
  localStorage.setItem(key, isCollapsed ? 'collapsed' : 'expanded');
};

const loadSidebarState = () => {
  const splitWidth = getSplitViewWidth();
  const key = splitWidth > 0 ? 'sidebar-split-view' : 'sidebar-default';
  const state = localStorage.getItem(key);
  
  if (state === 'collapsed') {
    document.querySelector('.sidebar').classList.add('collapsed');
  }
};
```

---

### Task 9: Independent Scrolling

**Files:**
- Modify: `public/DOCUMENTATION.html`

- [ ] **Step 1: Ensure sidebar has independent scroll**

Confirm `.sidebar` has `overflow-y: auto` and fixed positioning.

- [ ] **Step 2: Add sticky search for mobile**

```css
@media (max-width: 767px) {
  .main {
    position: relative;
    height: 100vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  html, body {
    height: 100%;
    overflow: hidden;
  }
}
```

- [ ] **Step 3: Smooth scroll behavior**

```css
* {
  scroll-behavior: smooth;
}

html {
  scroll-behavior: smooth;
}
```

---

### Task 10: Verify & Test

**Files:**
- Test: `public/DOCUMENTATION.html`

- [ ] **Step 1: Verify all breakpoints work**

Test at:
- Desktop (1200px): Sidebar visible, can collapse with toggle
- Tablet landscape (900px): Sidebar collapses, overlay shows
- Mobile (375px): Drawer slides from left, overlay covers content

- [ ] **Step 2: Verify touch targets**

All interactive elements should have 44px minimum touch area.

- [ ] **Step 3: Verify settings section**

Refresh and Clear Cache buttons should be at bottom of sidebar.

- [ ] **Step 4: Test keyboard navigation**

Left/Right arrows should navigate between pages.

- [ ] **Step 5: Test search**

Cmd/Ctrl+K should focus search on desktop.

---

### Commit

```bash
git add public/DOCUMENTATION.html docs/superpowers/plans/2026-04-11-mobile-responsiveness.md
git commit -m "feat: add mobile responsiveness - collapsible sidebar, touch targets, search, navigation"
```