# Mobile Responsiveness Design

## Overview

Improve the documentation portal for tablet (iPad) and mobile (iPhone) devices while maintaining an excellent desktop experience. Address sidebar issues: content covered, hard-to-tap links, and poor scrolling.

## Layout

### Breakpoints
- **Desktop (1024px+)**: Collapsible sidebar, hamburger toggle in top bar
- **Tablet landscape (768-1023px)**: Collapsible sidebar with toggle + overlay backdrop
- **Tablet portrait / Mobile (<768px)**: Slide-out drawer sidebar

### Sidebar Behavior
- Sidebar always collapsible via hamburger toggle
- Desktop: Toggle collapses sidebar into icon-only mode (56px) or hides completely
- Tablet/Mobile: Sidebar slides in from left as drawer with overlay backdrop
- Overlay tap closes sidebar on mobile/tablet

### Touch Targets
- Minimum 44px tap areas for all interactive elements
- Sidebar items: 48px height minimum
- Adequate spacing between tappable items (8px+ gap)

### Scrolling
- Sidebar: Independent scroll with sticky brand header
- Main content: Independent scroll, no body scroll
- Smooth scroll behavior maintained

## Settings Section

### Placement
- Create dedicated Settings section in sidebar (not in top bar)
- Position: Bottom of sidebar, before any footer

### Contents
- Refresh button
- Clear Cache button
- Any future settings/utility actions

### UI
- Grouped with clear section label
- Consistent touch targets (48px min)

## Hamburger Toggle

### Position
- Fixed in top bar, left side
- Visible when sidebar is collapsed
- Hidden when sidebar is expanded (X/close icon shows)

### Behavior
- Toggles sidebar open/closed
- On mobile/tablet: Shows overlay backdrop when open
- Smooth transition animations (250ms)

## Colors & Theme

Maintain existing color palette:
- Sidebar bg: #1C2434
- Accent: #3C50E0
- Body bg: #F1F5F9

No theme toggle required for this scope.

## Search

### Mobile
- Sticky search bar at top of content area
- Collapses into icon, expands on tap
- Auto-focus on expand

### Tablet
- Collapsible search bar in top bar area
- Remains visible when sidebar is collapsed

### Desktop
- Prominent search in top bar
- Keyboard shortcut (Cmd/Ctrl + K)

## Typography

### Font Sizing
- Base font scales with viewport
- Desktop: 15px base
- Tablet: 14px base
- Mobile: 14px base

### Line Length
- Max-width on content: 75ch for readability
- Optimal reading line length: 65-75 characters
- Padding adjusts on smaller screens

## Navigation

### Breadcrumbs
- Show breadcrumb trail for nested pages
- Format: Home > Section > Page
- Truncate with ellipsis on mobile
- Tap to navigate to any level

### Previous/Next
- Navigation buttons at bottom of content
- Show page title in button
- Keyboard navigation support (left/right arrows)

## Performance

### Lazy Loading
- Images lazy load below the fold
- Use native lazy loading or Intersection Observer
- Placeholder shown until image loads

### Preloading
- Preload next/prev page resources on mobile
- Use link rel="prefetch" for likely next navigation
- Low-priority, doesn't block initial load

## iPad Specific

### Apple Pencil
- Detect hover proximity (if supported)
- Show hover states for interactive elements

### Split View
- Detect iPad split-view modes
- Adjust layout for multiple windows
- Remember last sidebar state per mode

## Acceptance Criteria

1. Sidebar hides on all devices via hamburger toggle
2. Mobile (<768px) shows slide-out drawer with overlay
3. Touch targets minimum 44px
4. Settings section visible in sidebar with Refresh and Clear Cache buttons
5. Independent scrolling for sidebar and content
6. Smooth 250ms transitions
7. Works on iPhone, iPad, and desktop browsers
8. Search works on all devices with appropriate UI per breakpoint
9. Typography readable on all screen sizes
10. Breadcrumbs and prev/next navigation functional
11. Images lazy load, next/prev pages prefetched
12. iPad split-view and Apple Pencil support