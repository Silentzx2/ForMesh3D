export const invalidateViewportRender = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('invalidateViewportRender'));
  }
};
