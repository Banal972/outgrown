export async function ensure() {
  if (!('IntersectionObserver' in window)) {
    await import('intersection-observer')
  }
}
