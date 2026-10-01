// Loaded on demand by Widget.astro: React and the chat (together ~140KB) only
// download once a visitor shows intent to use K.AI, not on every page view.
import { createRoot } from 'react-dom/client';
import Chat from './Chat';

export function mountChat(el: HTMLElement, open: boolean) {
  createRoot(el).render(<Chat initiallyOpen={open} skipEntrance />);
}
