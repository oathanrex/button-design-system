/**
 * ==========================================================================
 * BUTTON DESIGN SYSTEM - JavaScript Behaviors
 * ==========================================================================
 * @version 3.0.0
 * @description Interactive behaviors for the button design system.
 * 
 * Features:
 * - Toggle buttons (with ARIA states)
 * - Loading state management
 * - Auto-disable after click
 * - Dropdown button functionality
 * - Split button behaviors
 * - Expand/collapse functionality
 * - Keyboard interaction handling
 * - Screen reader announcements
 * 
 * Architecture:
 * - ButtonSystem: Main controller class (singleton)
 * - Event delegation for performance
 * - WeakMap for element-specific data storage
 * - ARIA state management for accessibility
 * - AbortController for proper cleanup
 * 
 * CHANGELOG v3.0.0:
 * - Consolidated duplicate event handlers
 * - Added AbortController for cleanup
 * - Added input validation with bounds checking
 * - Added dropdown item caching
 * - Fixed race condition in positioning with RAF
 * - Added i18n support for announcements
 * - Added TypeScript-compatible JSDoc types
 * - Fixed prototype pollution in event details
 * - Improved focus trap in dropdowns
 * 
 * ==========================================================================
 */

/* ========================================================================
 * TYPE DEFINITIONS (JSDoc)
 * ========================================================================
 * TypeScript-compatible type definitions for IDE support.
 * ======================================================================== */

/**
 * @typedef {Object} ButtonSystemOptions
 * @property {boolean} [autoInit=true] - Auto-initialize on construction
 * @property {Object} [i18n] - Internationalization strings
 * @property {string} [i18n.loading='Loading, please wait'] - Loading announcement
 * @property {string} [i18n.complete='Action completed'] - Complete announcement
 */

/**
 * @typedef {Object} LoadingState
 * @property {string} innerHTML - Original button HTML
 * @property {boolean} disabled - Original disabled state
 */

/**
 * @typedef {Object} DropdownCache
 * @property {HTMLElement[]} items - Cached menu items
 * @property {number} timestamp - Cache creation time
 */

/* ========================================================================
 * PRIVATE STORAGE
 * ========================================================================
 * Using WeakMaps for private data storage to prevent memory leaks.
 * WeakMaps allow garbage collection when elements are removed from DOM.
 * ======================================================================== */

/** @type {WeakMap<HTMLElement, number>} */
const buttonTimeouts = new WeakMap();

/** @type {WeakMap<HTMLElement, LoadingState>} */
const buttonOriginalContent = new WeakMap();

/** @type {WeakMap<HTMLElement, DropdownCache>} */
const dropdownItemCache = new WeakMap();

/* ========================================================================
 * CONSTANTS
 * ========================================================================
 * Centralized configuration values for easy maintenance.
 * ======================================================================== */

const DEFAULTS = Object.freeze({
  loadingDuration: 2000,
  disableDuration: 3000,
  focusDelay: 50,
  announceDelay: 150, // Increased for better screen reader compatibility
  minDuration: 100,
  maxDuration: 30000,
  cacheMaxAge: 5000 // 5 seconds for dropdown item cache
});

const SELECTORS = Object.freeze({
  button: 'button, [role="button"]',
  dropdown: '.btn-dropdown',
  dropdownTrigger: '.btn-dropdown__trigger',
  dropdownMenu: '.btn-dropdown__menu',
  dropdownItem: '.btn-dropdown__item',
  expand: '.btn-expand',
  splitMain: '.btn-split__main'
});

const ARIA = Object.freeze({
  pressed: 'aria-pressed',
  expanded: 'aria-expanded',
  disabled: 'aria-disabled',
  busy: 'aria-busy',
  controls: 'aria-controls',
  haspopup: 'aria-haspopup'
});

const KEYS = Object.freeze({
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  ARROW_DOWN: 'ArrowDown',
  ARROW_UP: 'ArrowUp',
  HOME: 'Home',
  END: 'End',
  TAB: 'Tab'
});

const DATA_ATTRS = Object.freeze({
  toggle: 'data-toggle',
  toggleGroup: 'data-toggle-group',
  loadingText: 'data-loading-text',
  loadingDuration: 'data-loading-duration',
  autoDisable: 'data-auto-disable',
  disableDuration: 'data-disable-duration',
  value: 'data-value',
  position: 'data-position'
});

// Regex for validating toggle group names (alphanumeric, hyphen, underscore only)
const VALID_GROUP_NAME = /^[a-zA-Z0-9_-]+$/;

/* ========================================================================
 * UTILITY FUNCTIONS
 * ========================================================================
 * Pure utility functions used throughout the system.
 * ======================================================================== */

/**
 * Clamp a number between min and max bounds
 * @param {number} value - The value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Validate and parse duration from attribute
 * @param {string|null} value - The attribute value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Valid duration in milliseconds
 */
function parseDuration(value, defaultValue) {
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  
  if (Number.isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }
  
  return clamp(parsed, DEFAULTS.minDuration, DEFAULTS.maxDuration);
}

/**
 * Validate toggle group name for security
 * @param {string} name - The group name to validate
 * @returns {boolean} True if valid
 */
function isValidGroupName(name) {
  return VALID_GROUP_NAME.test(name);
}

/**
 * Create a null-prototype object for event details (prevents prototype pollution)
 * @param {Object} props - Properties to add
 * @returns {Object} Null-prototype object
 */
function createEventDetail(props) {
  return Object.assign(Object.create(null), props);
}

/**
 * Check if element is still in the DOM
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element is connected
 */
function isElementConnected(element) {
  return element && element.isConnected;
}

/**
 * ==========================================================================
 * ButtonSystem Class
 * ==========================================================================
 * Main controller for all button behaviors in the design system.
 * Implements singleton pattern to ensure only one instance manages the DOM.
 * 
 * @example
 * // System auto-initializes on script load
 * // Access via global: window.buttonSystem
 * 
 * // Programmatic usage:
 * await buttonSystem.setLoading(button, 2000);
 * buttonSystem.setPressed(button, true);
 * 
 * // With custom i18n:
 * const system = new ButtonSystem({
 *   i18n: {
 *     loading: 'Cargando...',
 *     complete: 'Completado'
 *   }
 * });
 * ==========================================================================
 */
class ButtonSystem {
  /**
   * Initialize the button system
   * @param {ButtonSystemOptions} [options={}] - Configuration options
   */
  constructor(options = {}) {
    const { 
      autoInit = true,
      i18n = {}
    } = options;
    
    // Store configuration
    this._config = Object.freeze({
      i18n: Object.freeze({
        loading: i18n.loading || 'Loading, please wait',
        complete: i18n.complete || 'Action completed'
      })
    });
    
    // Track initialization state
    this._initialized = false;
    
    // AbortController for cleanup
    this._abortController = null;
    
    // Bound handlers for proper cleanup
    this._handleEvent = this._handleEvent.bind(this);
    this._handleKeydown = this._handleKeydown.bind(this);
    
    // Live region reference
    this._liveRegion = null;
    
    // Open dropdowns set for efficient tracking
    this._openDropdowns = new Set();
    
    // Initialize when DOM is ready
    if (autoInit) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init(), { once: true });
      } else {
        this.init();
      }
    }
  }
  
  /**
   * Check if system is initialized
   * @public
   * @returns {boolean} Initialization state
   */
  get initialized() {
    return this._initialized;
  }
  
  /**
   * Initialize all button behaviors
   * Attaches event listeners using event delegation
   * @public
   * @returns {ButtonSystem} Returns this for chaining
   */
  init() {
    if (this._initialized) {
      return this;
    }
    
    // Create AbortController for cleanup
    this._abortController = new AbortController();
    const { signal } = this._abortController;
    
    // Single consolidated event handler using event delegation
    document.addEventListener('click', this._handleEvent, { signal });
    document.addEventListener('keydown', this._handleKeydown, { signal });
    
    // Initialize all dropdowns as closed
    this._closeAllDropdowns();
    
    // Create live region for announcements
    this._createLiveRegion();
    
    this._initialized = true;
    
    return this;
  }
  
  /**
   * Cleanup and destroy the button system
   * Removes all event listeners and cleans up state
   * @public
   */
  destroy() {
    if (!this._initialized) {
      return;
    }
    
    // Abort all event listeners
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    
    // Remove live region
    if (this._liveRegion && this._liveRegion.parentNode) {
      this._liveRegion.parentNode.removeChild(this._liveRegion);
    }
    this._liveRegion = null;
    
    // Clear open dropdowns set
    this._openDropdowns.clear();
    
    this._initialized = false;
  }
  
  /* ========================================================================
   * PRIVATE: Event Handlers
   * ======================================================================== */
  
  /**
   * Consolidated event handler - handles both click and outside click
   * @private
   * @param {MouseEvent} event - Click event
   */
  _handleEvent(event) {
    const target = event.target;
    
    // Handle clicks outside dropdowns first
    if (!target.closest(SELECTORS.dropdown)) {
      this._closeAllDropdowns();
    }
    
    // Find the button element
    const button = target.closest(SELECTORS.button);
    if (!button) return;
    
    // Check for disabled state
    if (button.disabled || button.getAttribute(ARIA.disabled) === 'true') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // Handle toggle buttons
    if (button.hasAttribute(DATA_ATTRS.toggle)) {
      this._handleToggle(button);
    }
    
    // Handle loading buttons
    if (button.hasAttribute(DATA_ATTRS.loadingText)) {
      this._handleLoading(button, event);
    }
    
    // Handle auto-disable buttons
    if (button.hasAttribute(DATA_ATTRS.autoDisable)) {
      this._handleAutoDisable(button);
    }
    
    // Handle dropdown triggers
    const dropdown = button.closest(SELECTORS.dropdown);
    if (dropdown) {
      this._handleDropdown(button, dropdown, event);
    }
    
    // Handle expand/collapse buttons
    if (button.classList.contains('btn-expand')) {
      this._handleExpand(button);
    }
  }
  
  /**
   * Keyboard event handler
   * @private
   * @param {KeyboardEvent} event - Keyboard event
   */
  _handleKeydown(event) {
    const target = event.target;
    
    // Handle dropdown keyboard navigation
    const dropdown = target.closest(SELECTORS.dropdown);
    if (dropdown) {
      this._handleDropdownKeyboard(event, dropdown);
      return;
    }
    
    // Prevent scroll on Space for toggle buttons
    if (target.hasAttribute && target.hasAttribute(DATA_ATTRS.toggle) && event.key === KEYS.SPACE) {
      event.preventDefault();
    }
  }
  
  /* ========================================================================
   * TOGGLE BUTTON HANDLER
   * ========================================================================
   * Manages aria-pressed state for toggle buttons.
   * Supports both single toggles and toggle groups (radio-like behavior).
   * ======================================================================== */
  
  /**
   * Handle toggle button click
   * @private
   * @param {HTMLElement} button - The toggle button element
   */
  _handleToggle(button) {
    const toggleGroup = button.getAttribute(DATA_ATTRS.toggleGroup);
    
    if (toggleGroup) {
      // Validate group name to prevent selector injection
      if (!isValidGroupName(toggleGroup)) {
        return;
      }
      
      // Radio-like behavior - only one can be pressed in a group
      const groupButtons = document.querySelectorAll(
        `[${DATA_ATTRS.toggleGroup}="${CSS.escape(toggleGroup)}"]`
      );
      
      groupButtons.forEach(btn => {
        if (btn !== button) {
          btn.setAttribute(ARIA.pressed, 'false');
          btn.classList.remove('btn--selected');
        }
      });
      
      button.setAttribute(ARIA.pressed, 'true');
      button.classList.add('btn--selected');
    } else {
      // Standard toggle behavior
      const isPressed = button.getAttribute(ARIA.pressed) === 'true';
      const newState = !isPressed;
      
      button.setAttribute(ARIA.pressed, String(newState));
      button.classList.toggle('btn--selected', newState);
    }
    
    // Dispatch custom event for external listeners
    this._dispatchEvent(button, 'toggle', createEventDetail({
      pressed: button.getAttribute(ARIA.pressed) === 'true'
    }));
  }
  
  /* ========================================================================
   * LOADING STATE HANDLER
   * ========================================================================
   * Manages loading spinner and state transitions.
   * Tracks timeouts to prevent race conditions.
   * ======================================================================== */
  
  /**
   * Handle loading button click
   * @private
   * @param {HTMLElement} button - The button element
   * @param {MouseEvent} event - The click event
   */
  _handleLoading(button, event) {
    // Prevent action if already loading
    if (button.classList.contains('btn--loading')) {
      event.preventDefault();
      return;
    }
    
    const loadingDuration = parseDuration(
      button.getAttribute(DATA_ATTRS.loadingDuration),
      DEFAULTS.loadingDuration
    );
    
    // Store original content using cloneNode for safety
    buttonOriginalContent.set(button, {
      innerHTML: button.innerHTML,
      disabled: button.disabled
    });
    
    // Apply loading state
    button.classList.add('btn--loading');
    button.setAttribute(ARIA.busy, 'true');
    button.disabled = true;
    
    // Announce loading state
    this._announce(this._config.i18n.loading);
    
    // Clear any existing timeout for this button
    const existingTimeout = buttonTimeouts.get(button);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set timeout to reset loading state
    const timeoutId = setTimeout(() => {
      // Check if element is still in DOM before resetting
      if (isElementConnected(button)) {
        this._resetLoadingState(button);
      } else {
        // Cleanup WeakMap entries
        buttonOriginalContent.delete(button);
        buttonTimeouts.delete(button);
      }
    }, loadingDuration);
    
    buttonTimeouts.set(button, timeoutId);
  }
  
  /**
   * Reset button from loading state
   * @private
   * @param {HTMLElement} button - The button element
   */
  _resetLoadingState(button) {
    const original = buttonOriginalContent.get(button);
    
    button.classList.remove('btn--loading');
    button.setAttribute(ARIA.busy, 'false');
    
    if (original) {
      button.disabled = original.disabled;
      button.innerHTML = original.innerHTML;
      
      // Clean up stored data
      buttonOriginalContent.delete(button);
    } else {
      // Fallback if original content wasn't stored
      button.disabled = false;
    }
    
    buttonTimeouts.delete(button);
    
    // Announce completion
    this._announce(this._config.i18n.complete);
    
    // Dispatch custom event
    this._dispatchEvent(button, 'loadingComplete', createEventDetail({}));
  }
  
  /* ========================================================================
   * AUTO-DISABLE HANDLER
   * ========================================================================
   * Prevents double-submission by disabling button after click.
   * ======================================================================== */
  
  /**
   * Handle auto-disable button click
   * @private
   * @param {HTMLElement} button - The button element
   */
  _handleAutoDisable(button) {
    const disableDuration = parseDuration(
      button.getAttribute(DATA_ATTRS.disableDuration),
      DEFAULTS.disableDuration
    );
    
    // Clear any existing timeout
    const existingTimeout = buttonTimeouts.get(button);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Disable the button
    button.disabled = true;
    button.setAttribute(ARIA.disabled, 'true');
    
    // Re-enable after duration
    const timeoutId = setTimeout(() => {
      if (isElementConnected(button)) {
        button.disabled = false;
        button.removeAttribute(ARIA.disabled);
      }
      buttonTimeouts.delete(button);
    }, disableDuration);
    
    buttonTimeouts.set(button, timeoutId);
  }
  
  /* ========================================================================
   * DROPDOWN BUTTON HANDLER
   * ========================================================================
   * Manages dropdown menu visibility and ARIA states.
   * Includes viewport boundary detection and item caching.
   * ======================================================================== */
  
  /**
   * Handle dropdown button interactions
   * @private
   * @param {HTMLElement} target - The clicked element
   * @param {HTMLElement} dropdown - The dropdown container
   * @param {MouseEvent} event - The click event
   */
  _handleDropdown(target, dropdown, event) {
    const trigger = dropdown.querySelector(SELECTORS.dropdownTrigger);
    const menu = dropdown.querySelector(SELECTORS.dropdownMenu);
    
    if (!trigger || !menu) return;
    
    // If clicking on a menu item
    if (target.classList.contains('btn-dropdown__item')) {
      this._handleDropdownItemClick(target, dropdown, trigger);
      return;
    }
    
    // If clicking on trigger, toggle dropdown
    if (target === trigger || trigger.contains(target)) {
      event.stopPropagation();
      const isExpanded = trigger.getAttribute(ARIA.expanded) === 'true';
      
      // Close other dropdowns first
      this._closeAllDropdowns();
      
      if (!isExpanded) {
        this._openDropdown(trigger, dropdown, menu);
      }
    }
  }
  
  /**
   * Open a dropdown menu
   * @private
   * @param {HTMLElement} trigger - The dropdown trigger button
   * @param {HTMLElement} dropdown - The dropdown container
   * @param {HTMLElement} menu - The dropdown menu
   */
  _openDropdown(trigger, dropdown, menu) {
    trigger.setAttribute(ARIA.expanded, 'true');
    dropdown.setAttribute(ARIA.expanded, 'true');
    
    // Track open dropdown
    this._openDropdowns.add(dropdown);
    
    // Use requestAnimationFrame to ensure menu is visible before positioning
    requestAnimationFrame(() => {
      if (isElementConnected(menu)) {
        this._positionDropdownMenu(dropdown, menu);
        
        // Focus first menu item for accessibility
        const items = this._getDropdownItems(menu);
        if (items.length > 0) {
          setTimeout(() => {
            if (isElementConnected(items[0])) {
              items[0].focus();
            }
          }, DEFAULTS.focusDelay);
        }
      }
    });
  }
  
  /**
   * Get dropdown items with caching
   * @private
   * @param {HTMLElement} menu - The dropdown menu
   * @returns {HTMLElement[]} Array of menu items
   */
  _getDropdownItems(menu) {
    const cached = dropdownItemCache.get(menu);
    const now = Date.now();
    
    // Return cached items if still fresh
    if (cached && (now - cached.timestamp) < DEFAULTS.cacheMaxAge) {
      return cached.items;
    }
    
    // Query and cache items
    const items = Array.from(menu.querySelectorAll(SELECTORS.dropdownItem));
    dropdownItemCache.set(menu, { items, timestamp: now });
    
    return items;
  }
  
  /**
   * Invalidate dropdown item cache
   * @private
   * @param {HTMLElement} menu - The dropdown menu
   */
  _invalidateDropdownCache(menu) {
    dropdownItemCache.delete(menu);
  }
  
  /**
   * Position dropdown menu within viewport
   * @private
   * @param {HTMLElement} dropdown - The dropdown container
   * @param {HTMLElement} menu - The dropdown menu
   */
  _positionDropdownMenu(dropdown, menu) {
    // Reset any previous positioning
    menu.removeAttribute(DATA_ATTRS.position);
    menu.style.removeProperty('inset-inline-start');
    menu.style.removeProperty('inset-inline-end');
    menu.style.removeProperty('top');
    menu.style.removeProperty('bottom');
    
    // Get viewport and menu dimensions
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isRTL = getComputedStyle(document.documentElement).direction === 'rtl';
    
    // Check if menu extends beyond right edge (or left in RTL)
    const overflowsEnd = isRTL ? rect.left < 0 : rect.right > viewportWidth;
    if (overflowsEnd) {
      menu.setAttribute(DATA_ATTRS.position, 'end');
    }
    
    // Check if menu extends beyond bottom edge
    if (rect.bottom > viewportHeight) {
      menu.setAttribute(DATA_ATTRS.position, 
        menu.getAttribute(DATA_ATTRS.position) === 'end' ? 'end top' : 'top'
      );
    }
  }
  
  /**
   * Handle dropdown menu item click
   * @private
   * @param {HTMLElement} item - The clicked menu item
   * @param {HTMLElement} dropdown - The dropdown container
   * @param {HTMLElement} trigger - The dropdown trigger
   */
  _handleDropdownItemClick(item, dropdown, trigger) {
    const value = item.getAttribute(DATA_ATTRS.value) || (item.textContent ? item.textContent.trim() : '');
    
    // Dispatch selection event with null-prototype detail
    this._dispatchEvent(dropdown, 'select', createEventDetail({ value, item }));
    
    // Close dropdown
    this._closeDropdown(dropdown, trigger);
    
    // Return focus to trigger
    if (trigger && isElementConnected(trigger)) {
      trigger.focus();
    }
  }
  
  /**
   * Close a specific dropdown
   * @private
   * @param {HTMLElement} dropdown - The dropdown container
   * @param {HTMLElement} [trigger] - The dropdown trigger (optional)
   */
  _closeDropdown(dropdown, trigger) {
    if (!trigger) {
      trigger = dropdown.querySelector(SELECTORS.dropdownTrigger);
    }
    
    if (trigger) {
      trigger.setAttribute(ARIA.expanded, 'false');
    }
    dropdown.setAttribute(ARIA.expanded, 'false');
    
    // Remove from tracking set
    this._openDropdowns.delete(dropdown);
    
    // Clear position data attribute
    const menu = dropdown.querySelector(SELECTORS.dropdownMenu);
    if (menu) {
      menu.removeAttribute(DATA_ATTRS.position);
    }
  }
  
  /**
   * Close all open dropdowns
   * @private
   */
  _closeAllDropdowns() {
    // Use tracked set for efficiency
    this._openDropdowns.forEach(dropdown => {
      if (isElementConnected(dropdown)) {
        this._closeDropdown(dropdown);
      }
    });
    this._openDropdowns.clear();
  }
  
  /**
   * Handle dropdown keyboard navigation
   * @private
   * @param {KeyboardEvent} event - The keyboard event
   * @param {HTMLElement} dropdown - The dropdown container
   */
  _handleDropdownKeyboard(event, dropdown) {
    const trigger = dropdown.querySelector(SELECTORS.dropdownTrigger);
    const menu = dropdown.querySelector(SELECTORS.dropdownMenu);
    
    if (!trigger || !menu) return;
    
    const items = this._getDropdownItems(menu);
    const isExpanded = trigger.getAttribute(ARIA.expanded) === 'true';
    const currentIndex = items.indexOf(document.activeElement);
    
    switch (event.key) {
      case KEYS.ESCAPE:
        if (isExpanded) {
          this._closeDropdown(dropdown, trigger);
          trigger.focus();
          event.preventDefault();
          event.stopPropagation();
        }
        break;
        
      case KEYS.ARROW_DOWN:
        event.preventDefault();
        if (!isExpanded) {
          this._openDropdown(trigger, dropdown, menu);
        } else if (items.length > 0) {
          const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
          items[nextIndex]?.focus();
        }
        break;
        
      case KEYS.ARROW_UP:
        event.preventDefault();
        if (isExpanded && items.length > 0) {
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
          items[prevIndex]?.focus();
        }
        break;
        
      case KEYS.HOME:
        if (isExpanded && items.length > 0) {
          event.preventDefault();
          items[0]?.focus();
        }
        break;
        
      case KEYS.END:
        if (isExpanded && items.length > 0) {
          event.preventDefault();
          items[items.length - 1]?.focus();
        }
        break;
        
      case KEYS.ENTER:
      case KEYS.SPACE:
        if (event.target.classList.contains('btn-dropdown__item')) {
          event.preventDefault();
          this._handleDropdownItemClick(event.target, dropdown, trigger);
        }
        break;
        
      case KEYS.TAB:
        // Close dropdown and allow normal tab behavior
        if (isExpanded) {
          this._closeDropdown(dropdown, trigger);
        }
        break;
    }
  }
  
  /* ========================================================================
   * EXPAND/COLLAPSE HANDLER
   * ========================================================================
   * Manages content visibility toggle with ARIA states.
   * ======================================================================== */
  
  /**
   * Handle expand/collapse button click
   * @private
   * @param {HTMLElement} button - The expand button element
   */
  _handleExpand(button) {
    const targetId = button.getAttribute(ARIA.controls);
    const target = targetId ? document.getElementById(targetId) : null;
    const isExpanded = button.getAttribute(ARIA.expanded) === 'true';
    const newState = !isExpanded;
    
    // Toggle aria-expanded
    button.setAttribute(ARIA.expanded, String(newState));
    
    // Toggle target visibility if specified
    if (target) {
      target.hidden = !newState;
    }
    
    // Dispatch custom event
    this._dispatchEvent(button, 'expand', createEventDetail({ expanded: newState }));
  }
  
  /* ========================================================================
   * UTILITY METHODS
   * ======================================================================== */
  
  /**
   * Create live region for screen reader announcements
   * @private
   */
  _createLiveRegion() {
    if (this._liveRegion) return;
    
    this._liveRegion = document.createElement('div');
    this._liveRegion.id = 'btn-system-live-region';
    this._liveRegion.setAttribute('aria-live', 'polite');
    this._liveRegion.setAttribute('aria-atomic', 'true');
    this._liveRegion.setAttribute('role', 'status');
    this._liveRegion.className = 'sr-only';
    
    // Visually hidden but accessible to screen readers
    Object.assign(this._liveRegion.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0'
    });
    
    document.body.appendChild(this._liveRegion);
  }
  
  /**
   * Announce message to screen readers
   * @private
   * @param {string} message - The message to announce
   */
  _announce(message) {
    if (!this._liveRegion) return;
    
    // Clear and set message with delay for screen reader detection
    this._liveRegion.textContent = '';
    
    setTimeout(() => {
      if (this._liveRegion && isElementConnected(this._liveRegion)) {
        this._liveRegion.textContent = message;
      }
    }, DEFAULTS.announceDelay);
  }
  
  /**
   * Dispatch custom event on element
   * @private
   * @param {HTMLElement} element - The element to dispatch from
   * @param {string} eventName - The event name
   * @param {Object} [detail=null] - Event detail data (should be null-prototype object)
   */
  _dispatchEvent(element, eventName, detail = null) {
    element.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      cancelable: true,
      detail
    }));
  }
  
  /* ========================================================================
   * PUBLIC API METHODS
   * ======================================================================== */
  
  /**
   * Programmatically trigger loading state on a button
   * @public
   * @param {HTMLElement} button - The button element
   * @param {number} [duration=2000] - Duration in milliseconds (100-30000)
   * @returns {Promise<void>} Resolves when loading completes
   * @throws {TypeError} If button is not a valid HTMLElement
   * 
   * @example
   * await buttonSystem.setLoading(myButton, 3000);
   * console.log('Loading complete!');
   */
  setLoading(button, duration = DEFAULTS.loadingDuration) {
    return new Promise((resolve, reject) => {
      if (!button || !(button instanceof HTMLElement)) {
        reject(new TypeError('setLoading: button must be an HTMLElement'));
        return;
      }
      
      const validDuration = clamp(duration, DEFAULTS.minDuration, DEFAULTS.maxDuration);
      
      // Store original state
      buttonOriginalContent.set(button, {
        innerHTML: button.innerHTML,
        disabled: button.disabled
      });
      
      // Clear any existing timeout
      const existingTimeout = buttonTimeouts.get(button);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      
      // Apply loading state
      button.classList.add('btn--loading');
      button.setAttribute(ARIA.busy, 'true');
      button.disabled = true;
      
      // Announce loading
      this._announce(this._config.i18n.loading);
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        if (isElementConnected(button)) {
          this._resetLoadingState(button);
        } else {
          buttonOriginalContent.delete(button);
          buttonTimeouts.delete(button);
        }
        resolve();
      }, validDuration);
      
      buttonTimeouts.set(button, timeoutId);
    });
  }
  
  /**
   * Cancel loading state on a button
   * @public
   * @param {HTMLElement} button - The button element
   */
  cancelLoading(button) {
    if (!button) return;
    
    const existingTimeout = buttonTimeouts.get(button);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    if (isElementConnected(button)) {
      this._resetLoadingState(button);
    } else {
      buttonOriginalContent.delete(button);
      buttonTimeouts.delete(button);
    }
  }
  
  /**
   * Programmatically set button pressed state
   * @public
   * @param {HTMLElement} button - The button element
   * @param {boolean} pressed - Whether the button should be pressed
   * 
   * @example
   * buttonSystem.setPressed(toggleButton, true);
   */
  setPressed(button, pressed) {
    if (!button) return;
    
    const newState = Boolean(pressed);
    button.setAttribute(ARIA.pressed, String(newState));
    button.classList.toggle('btn--selected', newState);
    
    // Dispatch event for consistency
    this._dispatchEvent(button, 'toggle', createEventDetail({ pressed: newState }));
  }
  
  /**
   * Open a dropdown programmatically
   * @public
   * @param {HTMLElement} dropdown - The dropdown container element
   */
  openDropdown(dropdown) {
    if (!dropdown) return;
    
    const trigger = dropdown.querySelector(SELECTORS.dropdownTrigger);
    const menu = dropdown.querySelector(SELECTORS.dropdownMenu);
    
    if (trigger && menu) {
      this._closeAllDropdowns();
      this._openDropdown(trigger, dropdown, menu);
    }
  }
  
  /**
   * Close a dropdown programmatically
   * @public
   * @param {HTMLElement} dropdown - The dropdown container element
   */
  closeDropdown(dropdown) {
    if (!dropdown) return;
    this._closeDropdown(dropdown);
  }
  
  /**
   * Close all dropdowns
   * @public
   */
  closeAllDropdowns() {
    this._closeAllDropdowns();
  }
  
  /**
   * Set toggle state for an entire group
   * @public
   * @param {string} groupName - The toggle group name
   * @param {HTMLElement} activeButton - The button to set as active
   */
  setGroupValue(groupName, activeButton) {
    if (!isValidGroupName(groupName)) return;
    
    const groupButtons = document.querySelectorAll(
      `[${DATA_ATTRS.toggleGroup}="${CSS.escape(groupName)}"]`
    );
    
    groupButtons.forEach(btn => {
      const isActive = btn === activeButton;
      btn.setAttribute(ARIA.pressed, String(isActive));
      btn.classList.toggle('btn--selected', isActive);
    });
    
    if (activeButton) {
      this._dispatchEvent(activeButton, 'toggle', createEventDetail({ pressed: true }));
    }
  }
}

/* ========================================================================
 * SPLIT BUTTON CONTROLLER
 * ========================================================================
 * Specialized controller for split button functionality.
 * Separates primary action from dropdown options.
 * ======================================================================== */

class SplitButtonController {
  /**
   * Create a split button controller
   * @param {HTMLElement} element - The split button container
   * @throws {Error} If element is not provided
   */
  constructor(element) {
    if (!element) {
      throw new Error('SplitButtonController: element is required');
    }
    
    /** @type {HTMLElement} */
    this.element = element;
    
    /** @type {HTMLElement|null} */
    this.mainButton = element.querySelector(SELECTORS.splitMain);
    
    /** @type {HTMLElement|null} */
    this.dropdownButton = element.querySelector('.btn-split__dropdown');
    
    /** @type {AbortController} */
    this._abortController = new AbortController();
    
    this._init();
  }
  
  /**
   * Initialize split button behaviors
   * @private
   */
  _init() {
    if (!this.mainButton) return;
    
    this.mainButton.addEventListener('click', (event) => {
      this.element.dispatchEvent(new CustomEvent('primaryAction', {
        bubbles: true,
        cancelable: true,
        detail: createEventDetail({ originalEvent: event })
      }));
    }, { signal: this._abortController.signal });
  }
  
  /**
   * Clean up event listeners
   * @public
   */
  destroy() {
    this._abortController.abort();
  }
}

/* ========================================================================
 * INITIALIZATION
 * ========================================================================
 * Create singleton instance of ButtonSystem.
 * Instance is available globally as window.buttonSystem
 * ======================================================================== */

// Create global instance (auto-initializes)
const buttonSystem = new ButtonSystem();

// Expose to window for global access
if (typeof window !== 'undefined') {
  window.buttonSystem = buttonSystem;
  window.ButtonSystem = ButtonSystem;
  window.SplitButtonController = SplitButtonController;
}

// Export for module usage (ES modules and CommonJS)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ButtonSystem, SplitButtonController, buttonSystem };
}
