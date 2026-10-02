'use client';

import { useSyncExternalStore } from 'react';

const SOUND_KEY = 'content-lab:sound';

// Sound on or off for the inspector's video, remembered in this browser across
// ads and visits. Each ad mounts a new player, so the choice lives out here.
let soundOn: boolean | undefined;
const listeners = new Set<() => void>();

export function getSoundOn(): boolean {
  if (soundOn === undefined) {
    try {
      soundOn = window.localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
      // Storage can be blocked; sound then starts off.
      soundOn = false;
    }
  }
  return soundOn;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSoundOn(on: boolean) {
  soundOn = on;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered after a reload, still kept for this visit.
  }
  listeners.forEach((l) => l());
}

export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribe, getSoundOn, () => false);
}
