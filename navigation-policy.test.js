import { describe, it, expect } from 'vitest';
import { lockNavigation } from './navigation-policy.js';

function fakeContents() {
  return {
    handlers: {},
    windowOpenHandler: null,
    on(name, handler) {
      this.handlers[name] = handler;
    },
    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    },
  };
}

function fakeEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

describe('lockNavigation', () => {
  // Dropping a file on the window navigates to it by default, and the page it
  // lands on would get the preload's window.api.
  it('blocks the window from navigating away', () => {
    const contents = fakeContents();
    lockNavigation(contents);
    const event = fakeEvent();
    contents.handlers['will-navigate'](event, 'file:///C:/Users/x/Downloads/evil.html');
    expect(event.prevented).toBe(true);
  });

  it('refuses to open new windows', () => {
    const contents = fakeContents();
    lockNavigation(contents);
    expect(contents.windowOpenHandler({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
  });
});
